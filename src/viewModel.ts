import { allocatedPeriodHours, cloneScenario, formatNumber, HOURS_MATCH_EPSILON, MAX_DAILY_HOURS, summarizeScenario, validateDevice, validatePeriods, validateScenarioSettings } from './domain';
import { findScenario, type EnergyRepository } from './repository';
import type { EnergyDevice, EnergyDocument, EnergyScenario, Notice, TimePeriod, ViewStatus } from './types';

export interface EnergyLensState {
  document: EnergyDocument | null;
  status: ViewStatus;
  notice: Notice | null;
}

type Listener = (state: EnergyLensState) => void;

export class EnergyLensViewModel {
  private state: EnergyLensState = { document: null, status: 'loading', notice: null };
  private readonly listeners = new Set<Listener>();

  constructor(private readonly repository: EnergyRepository) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): EnergyLensState { return this.state; }

  initialize(): void {
    try {
      this.state = { document: this.repository.load(), status: 'ready', notice: null };
    } catch {
      this.state = { document: null, status: 'error', notice: { kind: 'error', text: '本地数据读取失败，请刷新重试' } };
    }
    this.emit();
  }

  get activeScenario(): EnergyScenario | null {
    if (!this.state.document) return null;
    return findScenario(this.state.document, this.state.document.activeScenarioId) ?? null;
  }

  get activeSummary() {
    return this.activeScenario ? summarizeScenario(this.activeScenario) : null;
  }

  updateDevice(deviceId: string, patch: Partial<Pick<EnergyDevice, 'name' | 'watts' | 'dailyHours'>>): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const device = scenario.devices.find((item) => item.id === deviceId);
    if (!device) return;
    const next = { ...device, ...patch };
    const error = validateDevice(next);
    if (error) {
      this.setNotice({ kind: 'error', text: error });
      return;
    }
    this.commit((current) => ({ ...current, devices: current.devices.map((item) => item.id === deviceId ? next : item) }), '参数已更新');
  }

  addDevice(): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const device: EnergyDevice = { id: `device-${Date.now()}`, name: '新设备', watts: 100, dailyHours: 1 };
    this.commit((current) => ({ ...current, devices: [...current.devices, device] }), '已添加设备，可继续修改参数');
  }

  removeDevice(deviceId: string): void {
    const scenario = this.activeScenario;
    if (!scenario || scenario.devices.length <= 1) {
      this.setNotice({ kind: 'info', text: '至少保留一个设备，便于计算方案' });
      return;
    }
    this.commit((current) => ({ ...current, devices: current.devices.filter((item) => item.id !== deviceId) }), '设备已移除');
  }

  updateSettings(patch: Partial<Pick<EnergyScenario, 'name' | 'pricePerKwh' | 'daysPerMonth'>>): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const next = { ...scenario, ...patch };
    const error = validateScenarioSettings(next.pricePerKwh, next.daysPerMonth);
    if (error) {
      this.setNotice({ kind: 'error', text: error });
      return;
    }
    this.commit((current) => ({ ...current, name: next.name.trim() || '未命名方案', pricePerKwh: next.pricePerKwh, daysPerMonth: next.daysPerMonth }), '计费参数已更新');
  }

  addPeriod(): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const periods = scenario.timePeriods ?? [];
    const dayEnd = periods.reduce((max, period) => Math.max(max, period.endHour), 0);
    if (dayEnd >= MAX_DAILY_HOURS) {
      this.setNotice({ kind: 'info', text: '一天的 24 小时已被时段排满，可先调整现有时段' });
      return;
    }
    const period: TimePeriod = {
      id: `period-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `时段${periods.length + 1}`,
      startHour: dayEnd,
      endHour: Math.min(dayEnd + 2, MAX_DAILY_HOURS),
      pricePerKwh: scenario.pricePerKwh,
    };
    this.commit((current) => ({ ...current, timePeriods: [...(current.timePeriods ?? []), period] }), '已添加时段，可设置名称、时间与单价');
  }

  updatePeriod(periodId: string, patch: Partial<Omit<TimePeriod, 'id'>>): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const periods = (scenario.timePeriods ?? []).map((period) => period.id === periodId ? { ...period, ...patch } : period);
    const error = validatePeriods(periods);
    if (error) {
      this.setNotice({ kind: 'error', text: error });
      return;
    }
    this.commit((current) => ({ ...current, timePeriods: periods }), '时段已更新');
  }

  removePeriod(periodId: string): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    this.commit((current) => ({
      ...current,
      timePeriods: (current.timePeriods ?? []).filter((period) => period.id !== periodId),
      devices: current.devices.map((device) => {
        if (!device.periodWeights || !(periodId in device.periodWeights)) return device;
        const weights = { ...device.periodWeights };
        delete weights[periodId];
        return { ...device, periodWeights: Object.keys(weights).length > 0 ? weights : undefined };
      }),
    }), '时段已移除，相关设备在该时段的时长已一并清除');
  }

  enableDeviceWeights(deviceId: string): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const periods = scenario.timePeriods ?? [];
    const device = scenario.devices.find((item) => item.id === deviceId);
    if (!device || periods.length === 0) return;
    const next: EnergyDevice = { ...device, periodWeights: { [periods[0].id]: device.dailyHours } };
    this.commit((current) => ({ ...current, devices: current.devices.map((item) => item.id === deviceId ? next : item) }), '已按时段分配时长，可调整各时段的小时数');
  }

  updateDeviceWeight(deviceId: string, periodId: string, hours: number): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const device = scenario.devices.find((item) => item.id === deviceId);
    if (!device) return;
    if (!Number.isFinite(hours) || hours < 0) {
      this.setNotice({ kind: 'error', text: '时段时长不能为负数' });
      return;
    }
    if (hours > MAX_DAILY_HOURS) {
      this.setNotice({ kind: 'error', text: '单个时段的时长不能超过 24 小时' });
      return;
    }
    const next: EnergyDevice = { ...device, periodWeights: { ...(device.periodWeights ?? {}), [periodId]: hours } };
    const deviation = allocatedPeriodHours(next, scenario.timePeriods) - next.dailyHours;
    const notice = Math.abs(deviation) > HOURS_MATCH_EPSILON
      ? `时段时长已更新；已分配合计与每日总时长相差 ${formatNumber(Math.abs(deviation))} 小时`
      : '时段时长已更新';
    this.commit((current) => ({ ...current, devices: current.devices.map((item) => item.id === deviceId ? next : item) }), notice);
  }

  clearDeviceWeights(deviceId: string): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const device = scenario.devices.find((item) => item.id === deviceId);
    if (!device || device.periodWeights === undefined) return;
    const next: EnergyDevice = { ...device, periodWeights: undefined };
    this.commit((current) => ({ ...current, devices: current.devices.map((item) => item.id === deviceId ? next : item) }), '已恢复按统一电价计算');
  }

  duplicateActive(): void {
    const source = this.activeScenario;
    if (!source || !this.state.document) return;
    const id = `scenario-${Date.now()}`;
    const copy = cloneScenario(source, id, `${source.name} · 副本`);
    const document = { ...this.state.document, scenarios: [...this.state.document.scenarios, copy], activeScenarioId: id };
    this.persist(document, '方案已复制，现在可以修改副本');
  }

  selectScenario(id: string): void {
    if (!this.state.document || !findScenario(this.state.document, id)) return;
    this.persist({ ...this.state.document, activeScenarioId: id }, '已切换方案');
  }

  complete(): void {
    this.state = { ...this.state, status: 'completed', notice: { kind: 'success', text: '本次推演已保存，可随时回来继续调整' } };
    this.emit();
  }

  private commit(update: (scenario: EnergyScenario) => EnergyScenario, notice: string): void {
    if (!this.state.document) return;
    const document = { ...this.state.document, scenarios: this.state.document.scenarios.map((scenario) => scenario.id === this.state.document?.activeScenarioId ? update(scenario) : scenario) };
    this.persist(document, notice);
  }

  private persist(document: EnergyDocument, notice: string): void {
    try {
      this.repository.save(document);
      this.state = { document, status: 'editing', notice: { kind: 'success', text: notice } };
    } catch {
      this.state = { ...this.state, status: 'error', notice: { kind: 'error', text: '保存失败，当前页面仍可继续编辑' } };
    }
    this.emit();
  }

  private setNotice(notice: Notice): void {
    this.state = { ...this.state, status: notice.kind === 'error' ? 'error' : 'editing', notice };
    this.emit();
  }

  private emit(): void { this.listeners.forEach((listener) => listener(this.state)); }
}

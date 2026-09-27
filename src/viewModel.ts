import {
  cloneScenario,
  createDefaultPricePeriods,
  sortPeriods,
  summarizeScenario,
  validateDevice,
  validatePricePeriods,
  validateScenarioSettings,
} from './domain';
import { findScenario, type EnergyRepository } from './repository';
import type { EnergyDevice, EnergyDocument, EnergyScenario, Notice, PricePeriod, ViewStatus } from './types';

export interface EnergyLensState {
  document: EnergyDocument | null;
  status: ViewStatus;
  notice: Notice | null;
}

type Listener = (state: EnergyLensState) => void;

function prunePeriodHours(device: EnergyDevice, removedIds: Set<string>): EnergyDevice {
  if (!device.periodHours) return device;
  const periodHours = Object.fromEntries(Object.entries(device.periodHours).filter(([periodId]) => !removedIds.has(periodId)));
  return { ...device, periodHours: Object.keys(periodHours).length > 0 ? periodHours : undefined };
}

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

  updateDevice(deviceId: string, patch: Partial<Pick<EnergyDevice, 'name' | 'watts' | 'dailyHours' | 'periodHours'>>): void {
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
    const notice = this.commit((current) => ({ ...current, devices: current.devices.map((item) => item.id === deviceId ? next : item) }), '参数已更新');
    if (notice) this.setNotice(notice);
  }

  updateDevicePeriodHours(deviceId: string, periodId: string, hours: number): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const device = scenario.devices.find((item) => item.id === deviceId);
    if (!device) return;
    if (!Number.isFinite(hours) || hours < 0) {
      this.setNotice({ kind: 'error', text: '时段权重不能为负数' });
      return;
    }
    if (hours > 24) {
      this.setNotice({ kind: 'error', text: '单个时段的使用时长不能超过 24 小时' });
      return;
    }
    const periodHours = { ...(device.periodHours ?? {}), [periodId]: hours };
    this.updateDevice(deviceId, { periodHours });
  }

  clearDevicePeriodHours(deviceId: string): void {
    this.updateDevice(deviceId, { periodHours: undefined });
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

  enablePricePeriods(): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    if (scenario.pricePeriods && scenario.pricePeriods.length > 0) return;
    this.commit((current) => ({ ...current, pricePeriods: createDefaultPricePeriods() }), '已添加峰谷时段，可为设备登记时段权重');
  }

  disablePricePeriods(): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    this.commit((current) => ({
      ...current,
      pricePeriods: undefined,
      devices: current.devices.map((device) => device.periodHours ? { ...device, periodHours: undefined } : device),
    }), '已恢复统一电价，设备将按原方式计算');
  }

  updatePricePeriod(periodId: string, patch: Partial<Pick<PricePeriod, 'name' | 'pricePerKwh' | 'startHour' | 'endHour'>>): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const currentPeriods = scenario.pricePeriods ?? [];
    const existingError = validatePricePeriods(currentPeriods);
    if (currentPeriods.length === 0) {
      this.setNotice({ kind: 'error', text: '请先添加计费时段' });
      return;
    }
    if (existingError) {
      this.setNotice({ kind: 'error', text: existingError });
      return;
    }

    const sorted = sortPeriods(currentPeriods);
    const target = sorted.find((period) => period.id === periodId);
    if (!target) {
      this.setNotice({ kind: 'error', text: '未找到要修改的时段' });
      return;
    }
    const targetIndex = sorted.findIndex((period) => period.id === periodId);
    const nextStart = patch.startHour ?? target.startHour;
    const nextEnd = patch.endHour ?? target.endHour;
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) {
      this.setNotice({ kind: 'error', text: '时段时间必须是有效数字' });
      return;
    }
    if (nextStart < 0 || nextEnd > 24) {
      this.setNotice({ kind: 'error', text: '时段不能超出 00:00–24:00' });
      return;
    }
    if (patch.pricePerKwh !== undefined && (!Number.isFinite(patch.pricePerKwh) || patch.pricePerKwh < 0)) {
      this.setNotice({ kind: 'error', text: '时段电价不能为负数' });
      return;
    }
    const updated: PricePeriod = {
      ...target,
      name: patch.name ?? target.name,
      pricePerKwh: patch.pricePerKwh ?? target.pricePerKwh,
      startHour: nextStart,
      endHour: nextEnd,
    };

    if (targetIndex === 0 && updated.startHour !== 0) {
      this.setNotice({ kind: 'error', text: '第一个时段必须从 00:00 开始' });
      return;
    }
    if (targetIndex === sorted.length - 1 && updated.endHour !== 24) {
      this.setNotice({ kind: 'error', text: '最后一个时段必须在 24:00 结束' });
      return;
    }

    const nextPeriods = sorted.map((period, index) => {
      if (index === targetIndex) return updated;
      if (index === targetIndex - 1) return { ...period, endHour: updated.startHour };
      if (index === targetIndex + 1) return { ...period, startHour: updated.endHour };
      return period;
    });

    const error = validatePricePeriods(nextPeriods);
    if (error) {
      this.setNotice({ kind: 'error', text: error });
      return;
    }
    this.commit((current) => ({ ...current, pricePeriods: nextPeriods }), '时段设置已更新');
  }

  splitPricePeriod(periodId: string): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const currentPeriods = scenario.pricePeriods ?? [];
    const error = validatePricePeriods(currentPeriods);
    if (error) {
      this.setNotice({ kind: 'error', text: error ?? '当前时段设置不能拆分' });
      return;
    }
    const target = sortPeriods(currentPeriods).find((period) => period.id === periodId);
    if (!target) {
      this.setNotice({ kind: 'error', text: '未找到要拆分的时段' });
      return;
    }
    if (target.endHour - target.startHour < 2) {
      this.setNotice({ kind: 'error', text: '时段至少需要 2 小时，才能拆成两个完整小时时段' });
      return;
    }
    const splitHour = Math.round((target.startHour + target.endHour) / 2);
    const nextPeriods = sortPeriods(currentPeriods).flatMap((period) => period.id !== periodId ? [period] : [
      { ...period, endHour: splitHour },
      { ...period, id: `period-${Date.now()}`, name: '新时段', startHour: splitHour },
    ]);
    this.commit((current) => ({ ...current, pricePeriods: nextPeriods }), '时段已拆分，请设置新时段名称和电价');
  }

  removePricePeriod(periodId: string): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const currentPeriods = scenario.pricePeriods ?? [];
    const error = validatePricePeriods(currentPeriods);
    if (error) {
      this.setNotice({ kind: 'error', text: error ?? '当前时段设置不能删除' });
      return;
    }
    const sorted = sortPeriods(currentPeriods);
    if (sorted.length <= 1) {
      this.setNotice({ kind: 'error', text: '至少保留一个覆盖全天的时段；如不需要峰谷电价可关闭分时段' });
      return;
    }
    const index = sorted.findIndex((period) => period.id === periodId);
    let nextPeriods: PricePeriod[] = sorted.filter((period) => period.id !== periodId);
    if (index >= 0 && nextPeriods[index - 1]) {
      nextPeriods = nextPeriods.map((period, currentIndex) => currentIndex === index - 1
        ? { ...period, endHour: sorted[index].endHour }
        : period,
      );
    }
    const nextError = validatePricePeriods(nextPeriods);
    if (nextError) {
      this.setNotice({ kind: 'error', text: nextError });
      return;
    }
    const removedIds = new Set([periodId]);
    this.commit((current) => ({
      ...current,
      pricePeriods: nextPeriods,
      devices: current.devices.map((device) => prunePeriodHours(device, removedIds)),
    }), '时段已删除，相邻时段已自动补齐');
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

  private commit(update: (scenario: EnergyScenario) => EnergyScenario, notice: string): Notice | null {
    if (!this.state.document) return null;
    const document = { ...this.state.document, scenarios: this.state.document.scenarios.map((scenario) => scenario.id === this.state.document?.activeScenarioId ? update(scenario) : scenario) };
    const active = document.scenarios.find((scenario) => scenario.id === document.activeScenarioId);
    const allocationError = active ? summarizeScenario(active).devices.find((device) => device.allocation.error)?.allocation.error ?? null : null;
    const persistNotice = allocationError ?? notice;
    this.persist(document, persistNotice, allocationError ? 'error' : 'success');
    return allocationError ? { kind: 'error', text: allocationError } : null;
  }

  private persist(document: EnergyDocument, notice: string, kind: Notice['kind'] = 'success'): void {
    try {
      this.repository.save(document);
      this.state = { document, status: kind === 'error' ? 'error' : 'editing', notice: { kind, text: notice } };
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

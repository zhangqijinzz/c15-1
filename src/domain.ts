import type {
  DeviceAllocationState,
  EnergyDevice,
  EnergyEstimate,
  EnergyScenario,
  PeriodEstimate,
  PricePeriod,
  ScenarioSummary,
} from './types';

export const MAX_DAILY_HOURS = 24;
export const HOURS_EPSILON = 0.01;
export const FLAT_PERIOD_ID = 'flat-price';

export const exampleScenario: EnergyScenario = {
  id: 'scenario-home',
  name: '夏日居家方案',
  pricePerKwh: 0.62,
  daysPerMonth: 30,
  createdAt: '2026-01-01T00:00:00.000Z',
  devices: [
    { id: 'device-aircon', name: '客厅空调', watts: 1200, dailyHours: 6 },
    { id: 'device-fridge', name: '冰箱', watts: 150, dailyHours: 10 },
    { id: 'device-lamp', name: '书桌台灯', watts: 12, dailyHours: 5 },
  ],
};

export function createDefaultPricePeriods(): PricePeriod[] {
  return [
    { id: 'period-valley-night', name: '低谷', startHour: 0, endHour: 8, pricePerKwh: 0.35 },
    { id: 'period-standard-day', name: '平段', startHour: 8, endHour: 22, pricePerKwh: 0.62 },
    { id: 'period-valley-evening', name: '低谷', startHour: 22, endHour: 24, pricePerKwh: 0.35 },
  ];
}

export function estimateDevice(device: EnergyDevice, daysPerMonth: number, pricePerKwh: number): EnergyEstimate {
  const dailyKwh = (device.watts * device.dailyHours) / 1000;
  const monthlyKwh = dailyKwh * daysPerMonth;
  return { dailyKwh, monthlyKwh, monthlyCost: monthlyKwh * pricePerKwh };
}

export function validatePricePeriods(periods: PricePeriod[] | undefined): string | null {
  if (!periods || periods.length === 0) return null;
  if (periods.some((period) => !period.name.trim())) return '请填写每个时段的名称';
  if (periods.some((period) => !Number.isFinite(period.pricePerKwh) || period.pricePerKwh < 0)) return '时段电价不能为负数';

  const ids = new Set<string>();
  for (const period of periods) {
    if (period.id === FLAT_PERIOD_ID) return '统一电价桶为系统保留标识';
    if (ids.has(period.id)) return '时段 ID 不能重复';
    ids.add(period.id);
    if (!Number.isFinite(period.startHour) || !Number.isFinite(period.endHour)) return '时段时间必须是有效数字';
    if (period.startHour < 0 || period.endHour > MAX_DAILY_HOURS) return '时段不能超出 00:00–24:00';
    if (period.startHour >= period.endHour) return '时段开始时间必须早于结束时间';
  }

  const sorted = sortPeriods(periods);
  if (sorted[0].startHour !== 0 || sorted[sorted.length - 1].endHour !== MAX_DAILY_HOURS) return '时段需要从 00:00 连续覆盖到 24:00';
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].endHour !== sorted[index].startHour) return '时段不能重叠，也不能留下空隙';
  }
  return null;
}

export function getDeviceAllocationState(device: EnergyDevice, periods: PricePeriod[] | undefined): DeviceAllocationState {
  const validPeriods = periods && periods.length > 0 && !validatePricePeriods(periods) ? periods : [];
  if (validPeriods.length === 0 || !device.periodHours) return { status: 'flat', allocatedHours: 0, difference: 0, error: null };

  const validIds = new Set(validPeriods.map((period) => period.id));
  const allocatedHours = Object.entries(device.periodHours)
    .filter(([periodId, hours]) => validIds.has(periodId) && Number.isFinite(hours) && hours > 0)
    .reduce((sum, [, hours]) => sum + hours, 0);
  if (allocatedHours <= HOURS_EPSILON) return { status: 'flat', allocatedHours: 0, difference: 0, error: null };

  const difference = device.dailyHours - allocatedHours;
  if (Math.abs(difference) <= HOURS_EPSILON) {
    return { status: 'allocated', allocatedHours, difference: 0, error: null };
  }

  const direction = difference > 0 ? '少' : '多';
  return {
    status: 'mismatch',
    allocatedHours,
    difference,
    error: `${device.name || '该设备'}的时段权重合计为 ${formatHours(allocatedHours)} 小时，与每日总时长 ${formatHours(device.dailyHours)} 小时相差 ${formatHours(Math.abs(difference))} 小时（${direction}登记）。请调整后再按分时段结算。`,
  };
}

export function summarizeScenario(scenario: EnergyScenario): ScenarioSummary {
  const periodError = validatePricePeriods(scenario.pricePeriods);
  const periods = !periodError && scenario.pricePeriods ? sortPeriods(scenario.pricePeriods) : [];

  const periodTotals = new Map<string, PeriodAccumulator>();
  periods.forEach((period) => periodTotals.set(period.id, { ...period, hours: 0, dailyKwh: 0, monthlyKwh: 0, monthlyCost: 0 }));
  let flat: PeriodAccumulator | null = null;
  const ensureFlat = (): PeriodAccumulator => {
    if (!flat) {
      flat = {
        id: FLAT_PERIOD_ID,
        name: periods.length > 0 ? '未分配 · 统一电价' : '统一电价',
        startHour: 0,
        endHour: 24,
        pricePerKwh: scenario.pricePerKwh,
        hours: 0,
        dailyKwh: 0,
        monthlyKwh: 0,
        monthlyCost: 0,
      };
    }
    return flat;
  };

  const devices = scenario.devices.map((device) => {
    const base = estimateDevice(device, scenario.daysPerMonth, scenario.pricePerKwh);
    const allocation = getDeviceAllocationState(device, periods);
    const result = { ...device, ...base, share: 0, costShare: 0, effectivePricePerKwh: scenario.pricePerKwh, allocation };

    if (allocation.status === 'allocated') {
      let monthlyCost = 0;
      periods.forEach((period) => {
        const hours = device.periodHours?.[period.id] ?? 0;
        if (hours <= 0) return;
        const dailyKwh = (device.watts * hours) / 1000;
        const monthlyKwh = dailyKwh * scenario.daysPerMonth;
        monthlyCost += monthlyKwh * period.pricePerKwh;
        addToPeriod(periodTotals.get(period.id)!, hours, dailyKwh, monthlyKwh, monthlyKwh * period.pricePerKwh);
      });
      result.monthlyCost = monthlyCost;
      result.effectivePricePerKwh = result.monthlyKwh ? monthlyCost / result.monthlyKwh : 0;
    } else {
      addToPeriod(ensureFlat(), device.dailyHours, result.dailyKwh, result.monthlyKwh, result.monthlyCost);
    }
    return result;
  });

  const total = devices.reduce(
    (sum, device) => ({
      dailyKwh: sum.dailyKwh + device.dailyKwh,
      monthlyKwh: sum.monthlyKwh + device.monthlyKwh,
      monthlyCost: sum.monthlyCost + device.monthlyCost,
    }),
    { dailyKwh: 0, monthlyKwh: 0, monthlyCost: 0 },
  );

  devices.forEach((device) => {
    device.share = total.monthlyKwh ? device.monthlyKwh / total.monthlyKwh : 0;
    device.costShare = total.monthlyCost ? device.monthlyCost / total.monthlyCost : 0;
  });

  const accumulators = [...periodTotals.values()].filter((period) => period.hours > 0 || period.monthlyKwh > 0 || period.monthlyCost > 0);
  if (flat) accumulators.push(flat);
  const periodEstimates: PeriodEstimate[] = accumulators.map((period) => ({
    periodId: period.id,
    name: period.name,
    hours: period.hours,
    pricePerKwh: period.pricePerKwh,
    dailyKwh: period.dailyKwh,
    monthlyKwh: period.monthlyKwh,
    monthlyCost: period.monthlyCost,
    share: total.monthlyKwh ? period.monthlyKwh / total.monthlyKwh : 0,
    costShare: total.monthlyCost ? period.monthlyCost / total.monthlyCost : 0,
  }));

  return { total, devices, periods: periodEstimates, periodValidationError: periodError };
}

export function validateDevice(device: Pick<EnergyDevice, 'name' | 'watts' | 'dailyHours'>): string | null {
  if (!device.name.trim()) return '请填写设备名称';
  if (!Number.isFinite(device.watts) || device.watts < 0) return '功率不能为负数';
  if (!Number.isFinite(device.dailyHours) || device.dailyHours < 0) return '使用时间不能为负数';
  if (device.dailyHours > MAX_DAILY_HOURS) return '每日使用时间不能超过 24 小时';
  return null;
}

export function validateScenarioSettings(pricePerKwh: number, daysPerMonth: number): string | null {
  if (!Number.isFinite(pricePerKwh) || pricePerKwh < 0) return '电价不能为负数';
  if (!Number.isFinite(daysPerMonth) || daysPerMonth < 1 || daysPerMonth > 31) return '计费天数需在 1–31 天之间';
  return null;
}

export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatHour(value: number): string {
  return formatNumber(value, value % 1 === 0 ? 0 : 2);
}

export function formatClockHour(hour: number): string {
  const minutes = Math.round(hour * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function formatHours(value: number): string {
  return formatHour(value);
}

export function cloneScenario(source: EnergyScenario, id: string, name: string): EnergyScenario {
  return {
    ...source,
    id,
    name,
    createdAt: new Date().toISOString(),
    pricePeriods: source.pricePeriods?.map((period) => ({ ...period })),
    devices: source.devices.map((device) => ({ ...device, periodHours: device.periodHours ? { ...device.periodHours } : undefined, id: `${id}-${device.id}` })),
  };
}

export function sortPeriods(periods: PricePeriod[]): PricePeriod[] {
  return [...periods].sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
}

interface PeriodAccumulator extends PricePeriod {
  hours: number;
  dailyKwh: number;
  monthlyKwh: number;
  monthlyCost: number;
}

function addToPeriod(period: PeriodAccumulator, hours: number, dailyKwh: number, monthlyKwh: number, monthlyCost: number): void {
  period.hours += hours;
  period.dailyKwh += dailyKwh;
  period.monthlyKwh += monthlyKwh;
  period.monthlyCost += monthlyCost;
}

import type { EnergyDevice, EnergyEstimate, EnergyScenario, ScenarioSummary, TimePeriod } from './types';

export const MAX_DAILY_HOURS = 24;
/** 权重合计与每日总时长偏差小于该值时视为一致（容忍浮点误差） */
export const HOURS_MATCH_EPSILON = 0.001;

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

export function hasPeriodWeights(device: EnergyDevice): boolean {
  return !!device.periodWeights && Object.keys(device.periodWeights).length > 0;
}

/** 设备每日落在已定义时段上的小时数合计（忽略指向不存在时段的权重） */
export function allocatedPeriodHours(device: EnergyDevice, timePeriods?: TimePeriod[]): number {
  if (!hasPeriodWeights(device)) return 0;
  const weights = device.periodWeights ?? {};
  return (timePeriods ?? []).reduce((sum, period) => sum + (weights[period.id] ?? 0), 0);
}

export function estimateDevice(device: EnergyDevice, daysPerMonth: number, pricePerKwh: number, timePeriods?: TimePeriod[]): EnergyEstimate {
  if ((timePeriods ?? []).length > 0 && hasPeriodWeights(device)) {
    const weights = device.periodWeights ?? {};
    const dailyKwh = (device.watts * allocatedPeriodHours(device, timePeriods)) / 1000;
    const monthlyKwh = dailyKwh * daysPerMonth;
    const monthlyCost = (timePeriods ?? []).reduce(
      (sum, period) => sum + ((device.watts * (weights[period.id] ?? 0)) / 1000) * daysPerMonth * period.pricePerKwh,
      0,
    );
    return { dailyKwh, monthlyKwh, monthlyCost };
  }
  const dailyKwh = (device.watts * device.dailyHours) / 1000;
  const monthlyKwh = dailyKwh * daysPerMonth;
  return { dailyKwh, monthlyKwh, monthlyCost: monthlyKwh * pricePerKwh };
}

export function summarizeScenario(scenario: EnergyScenario): ScenarioSummary {
  const periods = scenario.timePeriods ?? [];
  const usesTimeOfUse = periods.length > 0;
  const devices = scenario.devices.map((device) => {
    const weighted = usesTimeOfUse && hasPeriodWeights(device);
    const allocatedHours = weighted ? allocatedPeriodHours(device, periods) : null;
    return {
      ...device,
      ...estimateDevice(device, scenario.daysPerMonth, scenario.pricePerKwh, scenario.timePeriods),
      share: 0,
      allocatedHours,
      weightDeviation: allocatedHours === null ? null : allocatedHours - device.dailyHours,
    };
  });
  const total = devices.reduce(
    (sum, device) => ({
      dailyKwh: sum.dailyKwh + device.dailyKwh,
      monthlyKwh: sum.monthlyKwh + device.monthlyKwh,
      monthlyCost: sum.monthlyCost + device.monthlyCost,
    }),
    { dailyKwh: 0, monthlyKwh: 0, monthlyCost: 0 },
  );
  const periodSummaries = periods.map((period) => {
    const monthlyKwh = scenario.devices.reduce(
      (sum, device) => sum + (device.watts * ((hasPeriodWeights(device) ? device.periodWeights?.[period.id] ?? 0 : 0) / 1000)) * scenario.daysPerMonth,
      0,
    );
    return { period, monthlyKwh, monthlyCost: monthlyKwh * period.pricePerKwh, costShare: 0 };
  });
  return {
    total,
    devices: devices.map((device) => ({ ...device, share: total.monthlyKwh ? device.monthlyKwh / total.monthlyKwh : 0 })),
    periods: periodSummaries.map((entry) => ({ ...entry, costShare: total.monthlyCost ? entry.monthlyCost / total.monthlyCost : 0 })),
    usesTimeOfUse,
  };
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

export function validatePeriods(periods: TimePeriod[]): string | null {
  for (const period of periods) {
    if (!period.name.trim()) return '请填写时段名称';
    if (!Number.isFinite(period.startHour) || !Number.isFinite(period.endHour)) return '时段时间需为数字';
    if (period.startHour < 0 || period.startHour >= MAX_DAILY_HOURS) return `时段“${period.name}”的开始时间需在 0–24 之间`;
    if (period.endHour <= 0 || period.endHour > MAX_DAILY_HOURS) return `时段“${period.name}”的结束时间需在 0–24 之间`;
    if (period.endHour <= period.startHour) return `时段“${period.name}”的结束时间需晚于开始时间`;
    if (!Number.isFinite(period.pricePerKwh) || period.pricePerKwh < 0) return '时段电价不能为负数';
  }
  const sorted = periods.slice().sort((a, b) => a.startHour - b.startHour);
  let covered = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    if (index > 0 && sorted[index].startHour < sorted[index - 1].endHour) {
      return `时段“${sorted[index].name}”与“${sorted[index - 1].name}”重叠，请调整时间范围`;
    }
    covered += sorted[index].endHour - sorted[index].startHour;
  }
  if (covered > MAX_DAILY_HOURS) return '所有时段合计不能超过 24 小时';
  return null;
}

export function formatClock(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function cloneScenario(source: EnergyScenario, id: string, name: string): EnergyScenario {
  return {
    ...source,
    id,
    name,
    createdAt: new Date().toISOString(),
    devices: source.devices.map((device) => ({
      ...device,
      id: `${id}-${device.id}`,
      periodWeights: device.periodWeights ? { ...device.periodWeights } : undefined,
    })),
    timePeriods: source.timePeriods?.map((period) => ({ ...period })),
  };
}

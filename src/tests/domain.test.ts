import { describe, expect, it } from 'vitest';
import { allocatedPeriodHours, estimateDevice, summarizeScenario, validateDevice, validatePeriods } from '../domain';
import type { EnergyScenario, TimePeriod } from '../types';

const touPeriods: TimePeriod[] = [
  { id: 'peak', name: '峰时', startHour: 8, endHour: 21, pricePerKwh: 0.9 },
  { id: 'valley', name: '谷时', startHour: 21, endHour: 24, pricePerKwh: 0.3 },
];

describe('energy domain', () => {
  it('calculates kWh and cost from watts, hours, days and price', () => {
    const result = estimateDevice({ id: 'a', name: '空调', watts: 1000, dailyHours: 2 }, 30, 0.5);
    expect(result).toEqual({ dailyKwh: 2, monthlyKwh: 60, monthlyCost: 30 });
  });

  it('keeps device shares explainable and sums to 100%', () => {
    const scenario: EnergyScenario = { id: 's', name: 'test', pricePerKwh: 1, daysPerMonth: 30, createdAt: '', devices: [
      { id: 'a', name: 'a', watts: 100, dailyHours: 1 }, { id: 'b', name: 'b', watts: 300, dailyHours: 1 },
    ] };
    const summary = summarizeScenario(scenario);
    expect(summary.total.monthlyKwh).toBe(12);
    expect(summary.devices.map((device) => device.share)).toEqual([0.25, 0.75]);
  });

  it('rejects negative power and more than 24 hours', () => {
    expect(validateDevice({ name: 'x', watts: -1, dailyHours: 1 })).toBe('功率不能为负数');
    expect(validateDevice({ name: 'x', watts: 1, dailyHours: 24.1 })).toBe('每日使用时间不能超过 24 小时');
  });
});

describe('time-of-use billing', () => {
  it('settles weighted devices per period and sums up, while unweighted devices stay on flat price', () => {
    const scenario: EnergyScenario = { id: 's', name: 'tou', pricePerKwh: 0.6, daysPerMonth: 30, createdAt: '', timePeriods: touPeriods, devices: [
      { id: 'a', name: '空调', watts: 1000, dailyHours: 4, periodWeights: { peak: 3, valley: 1 } },
      { id: 'b', name: '冰箱', watts: 100, dailyHours: 10 },
    ] };
    const summary = summarizeScenario(scenario);
    // 空调: 1 kW × (3 h × 0.9 + 1 h × 0.3) × 30 天 = 90 元
    expect(summary.devices[0].monthlyCost).toBeCloseTo(90);
    expect(summary.devices[0].monthlyKwh).toBeCloseTo(120);
    // 冰箱未登记权重: 0.1 kW × 10 h × 30 天 × 0.6 = 18 元
    expect(summary.devices[1].monthlyCost).toBeCloseTo(18);
    expect(summary.total.monthlyCost).toBeCloseTo(108);
    expect(summary.usesTimeOfUse).toBe(true);
  });

  it('aggregates cost and kWh per period so the expensive periods are visible', () => {
    const scenario: EnergyScenario = { id: 's', name: 'tou', pricePerKwh: 0.6, daysPerMonth: 30, createdAt: '', timePeriods: touPeriods, devices: [
      { id: 'a', name: '空调', watts: 1000, dailyHours: 4, periodWeights: { peak: 3, valley: 1 } },
      { id: 'b', name: '冰箱', watts: 100, dailyHours: 10 },
    ] };
    const summary = summarizeScenario(scenario);
    const peak = summary.periods.find((entry) => entry.period.id === 'peak');
    const valley = summary.periods.find((entry) => entry.period.id === 'valley');
    expect(peak?.monthlyKwh).toBeCloseTo(90);
    expect(peak?.monthlyCost).toBeCloseTo(81);
    expect(valley?.monthlyKwh).toBeCloseTo(30);
    expect(valley?.monthlyCost).toBeCloseTo(9);
    expect(peak?.costShare).toBeCloseTo(81 / 108);
  });

  it('keeps flat-price results unchanged for scenarios without time periods', () => {
    const scenario: EnergyScenario = { id: 's', name: 'legacy', pricePerKwh: 0.5, daysPerMonth: 30, createdAt: '', devices: [
      { id: 'a', name: '灯', watts: 100, dailyHours: 2 },
    ] };
    const summary = summarizeScenario(scenario);
    expect(summary.total.monthlyKwh).toBe(6);
    expect(summary.total.monthlyCost).toBe(3);
    expect(summary.usesTimeOfUse).toBe(false);
    expect(summary.periods).toEqual([]);
    expect(summary.devices[0].allocatedHours).toBeNull();
    expect(summary.devices[0].weightDeviation).toBeNull();
  });

  it('ignores weights pointing at removed periods', () => {
    const device = { id: 'a', name: '空调', watts: 1000, dailyHours: 4, periodWeights: { peak: 3, ghost: 5 } };
    expect(allocatedPeriodHours(device, touPeriods)).toBe(3);
  });

  it('reports the deviation between weight sum and daily hours', () => {
    const scenario: EnergyScenario = { id: 's', name: 'tou', pricePerKwh: 0.6, daysPerMonth: 30, createdAt: '', timePeriods: touPeriods, devices: [
      { id: 'a', name: '空调', watts: 1000, dailyHours: 4, periodWeights: { peak: 3 } },
    ] };
    const summary = summarizeScenario(scenario);
    expect(summary.devices[0].allocatedHours).toBe(3);
    expect(summary.devices[0].weightDeviation).toBeCloseTo(-1);
  });
});

describe('validatePeriods', () => {
  it('accepts adjacent non-overlapping periods within a day', () => {
    expect(validatePeriods([
      { id: 'a', name: '峰', startHour: 8, endHour: 12, pricePerKwh: 1 },
      { id: 'b', name: '谷', startHour: 12, endHour: 24, pricePerKwh: 0.3 },
    ])).toBeNull();
  });

  it('rejects overlapping periods regardless of order', () => {
    expect(validatePeriods([
      { id: 'b', name: '谷', startHour: 11, endHour: 13, pricePerKwh: 0.3 },
      { id: 'a', name: '峰', startHour: 8, endHour: 12, pricePerKwh: 1 },
    ])).toContain('重叠');
  });

  it('rejects periods beyond 24 hours or with inverted range', () => {
    expect(validatePeriods([{ id: 'a', name: '夜', startHour: 22, endHour: 25, pricePerKwh: 0.3 }])).toContain('0–24');
    expect(validatePeriods([{ id: 'a', name: '夜', startHour: 12, endHour: 12, pricePerKwh: 0.3 }])).toContain('结束时间需晚于开始时间');
    expect(validatePeriods([{ id: 'a', name: '夜', startHour: -1, endHour: 6, pricePerKwh: 0.3 }])).toContain('0–24');
  });

  it('rejects negative prices and empty names', () => {
    expect(validatePeriods([{ id: 'a', name: '峰', startHour: 8, endHour: 12, pricePerKwh: -0.1 }])).toBe('时段电价不能为负数');
    expect(validatePeriods([{ id: 'a', name: ' ', startHour: 8, endHour: 12, pricePerKwh: 1 }])).toBe('请填写时段名称');
  });
});

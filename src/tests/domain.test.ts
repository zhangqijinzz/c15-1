import { describe, expect, it } from 'vitest';
import {
  createDefaultPricePeriods,
  estimateDevice,
  summarizeScenario,
  validateDevice,
  validatePricePeriods,
} from '../domain';
import type { EnergyScenario, PricePeriod } from '../types';

const basicScenario: EnergyScenario = {
  id: 's',
  name: 'test',
  pricePerKwh: 1,
  daysPerMonth: 30,
  createdAt: '',
  devices: [
    { id: 'a', name: 'a', watts: 100, dailyHours: 1 },
    { id: 'b', name: 'b', watts: 300, dailyHours: 1 },
  ],
};

describe('energy domain', () => {
  it('calculates kWh and cost from watts, hours, days and price', () => {
    const result = estimateDevice({ id: 'a', name: '空调', watts: 1000, dailyHours: 2 }, 30, 0.5);
    expect(result).toEqual({ dailyKwh: 2, monthlyKwh: 60, monthlyCost: 30 });
  });

  it('keeps old scenarios without price periods producing the original result', () => {
    const summary = summarizeScenario(basicScenario);
    expect(summary.total.monthlyKwh).toBe(12);
    expect(summary.total.monthlyCost).toBe(12);
    expect(summary.devices.map((device) => device.share)).toEqual([0.25, 0.75]);
    expect(summary.devices.every((device) => device.allocation.status === 'flat')).toBe(true);
    expect(summary.periods.find((period) => period.periodId === 'flat-price')?.monthlyCost).toBe(12);
  });

  it('settles registered device hours with each time-of-use price', () => {
    const periods: PricePeriod[] = [
      { id: 'valley', name: '低谷', startHour: 0, endHour: 1, pricePerKwh: 0.3 },
      { id: 'peak', name: '高峰', startHour: 1, endHour: 24, pricePerKwh: 0.6 },
    ];
    const scenario: EnergyScenario = {
      ...basicScenario,
      pricePeriods: periods,
      devices: [{ id: 'a', name: '空调', watts: 1000, dailyHours: 2, periodHours: { valley: 1, peak: 1 } }],
    };
    const summary = summarizeScenario(scenario);
    expect(summary.total.monthlyKwh).toBe(60);
    expect(summary.total.monthlyCost).toBe(27);
    expect(summary.devices[0].effectivePricePerKwh).toBeCloseTo(0.45);
    expect(summary.periods.map((period) => [period.periodId, period.monthlyCost])).toEqual([
      ['valley', 9],
      ['peak', 18],
    ]);
    expect(summary.periods.find((period) => period.periodId === 'peak')?.costShare).toBeCloseTo(2 / 3);
  });

  it('reports the exact weight mismatch and falls back to flat pricing', () => {
    const periods: PricePeriod[] = [
      { id: 'valley', name: '低谷', startHour: 0, endHour: 8, pricePerKwh: 0.3 },
      { id: 'peak', name: '高峰', startHour: 8, endHour: 24, pricePerKwh: 0.6 },
    ];
    const scenario: EnergyScenario = {
      ...basicScenario,
      pricePerKwh: 0.5,
      pricePeriods: periods,
      devices: [{ id: 'a', name: '空调', watts: 1000, dailyHours: 2, periodHours: { valley: 0.5, peak: 0 } }],
    };
    const summary = summarizeScenario(scenario);
    expect(summary.devices[0].allocation.status).toBe('mismatch');
    expect(summary.devices[0].allocation.difference).toBe(1.5);
    expect(summary.devices[0].allocation.error).toContain('相差 1.50 小时');
    expect(summary.total.monthlyCost).toBe(30);
  });

  it('rejects periods that overlap, leave gaps, or exceed one day', () => {
    expect(validatePricePeriods([
      { id: 'a', name: 'A', startHour: 0, endHour: 9, pricePerKwh: 0.4 },
      { id: 'b', name: 'B', startHour: 8, endHour: 24, pricePerKwh: 0.8 },
    ])).toBe('时段不能重叠，也不能留下空隙');
    expect(validatePricePeriods([
      { id: 'a', name: 'A', startHour: 1, endHour: 24, pricePerKwh: 0.8 },
    ])).toBe('时段需要从 00:00 连续覆盖到 24:00');
  });

  it('provides default periods covering the entire day', () => {
    expect(validatePricePeriods(createDefaultPricePeriods())).toBeNull();
  });

  it('rejects negative power and more than 24 hours', () => {
    expect(validateDevice({ name: 'x', watts: -1, dailyHours: 1 })).toBe('功率不能为负数');
    expect(validateDevice({ name: 'x', watts: 1, dailyHours: 24.1 })).toBe('每日使用时间不能超过 24 小时');
  });
});

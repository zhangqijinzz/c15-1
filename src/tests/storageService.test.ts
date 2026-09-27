// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { exampleScenario, summarizeScenario } from '../domain';
import { LocalEnergyRepository } from '../repository';

const STORAGE_KEY = 'energy-lens.document.v1';

describe('local persistence recovery', () => {
  beforeEach(() => localStorage.clear());

  it('falls back to a valid example when saved JSON is damaged', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, scenarios: [null], activeScenarioId: 'missing' }));
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.activeScenarioId).toBe(exampleScenario.id);
    expect(recovered.scenarios[0].devices.length).toBeGreaterThan(0);
  });

  it('loads legacy documents without time-of-use fields and keeps their results unchanged', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      activeScenarioId: 'legacy',
      scenarios: [{ id: 'legacy', name: '老方案', createdAt: '2026-01-01T00:00:00.000Z', pricePerKwh: 0.5, daysPerMonth: 30, devices: [{ id: 'd1', name: '灯', watts: 100, dailyHours: 2 }] }],
    }));
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.scenarios[0].id).toBe('legacy');
    expect(recovered.scenarios[0].timePeriods).toBeUndefined();
    const summary = summarizeScenario(recovered.scenarios[0]);
    expect(summary.total.monthlyKwh).toBe(6);
    expect(summary.total.monthlyCost).toBe(3);
    expect(summary.usesTimeOfUse).toBe(false);
  });

  it('round-trips documents with time periods and device weights', () => {
    const repository = new LocalEnergyRepository();
    repository.save({
      version: 1,
      activeScenarioId: 'tou',
      scenarios: [{
        id: 'tou', name: '峰谷方案', createdAt: '2026-02-01T00:00:00.000Z', pricePerKwh: 0.6, daysPerMonth: 30,
        timePeriods: [{ id: 'p1', name: '谷时', startHour: 23, endHour: 24, pricePerKwh: 0.3 }],
        devices: [{ id: 'd1', name: '热水器', watts: 2000, dailyHours: 1, periodWeights: { p1: 1 } }],
      }],
    });
    const recovered = repository.load();
    expect(recovered.scenarios[0].timePeriods).toHaveLength(1);
    const summary = summarizeScenario(recovered.scenarios[0]);
    // 2 kW × 1 h × 30 天 × 0.3 = 18 元
    expect(summary.total.monthlyCost).toBeCloseTo(18);
  });

  it('rejects documents with malformed time periods or weights', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      activeScenarioId: 'bad',
      scenarios: [{
        id: 'bad', name: '坏方案', createdAt: '', pricePerKwh: 0.6, daysPerMonth: 30,
        timePeriods: [{ id: 'p1', name: '超长', startHour: 20, endHour: 30, pricePerKwh: 0.3 }],
        devices: [{ id: 'd1', name: '灯', watts: 100, dailyHours: 2 }],
      }],
    }));
    expect(new LocalEnergyRepository().load().scenarios[0].id).toBe(exampleScenario.id);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      activeScenarioId: 'bad2',
      scenarios: [{
        id: 'bad2', name: '坏方案', createdAt: '', pricePerKwh: 0.6, daysPerMonth: 30,
        devices: [{ id: 'd1', name: '灯', watts: 100, dailyHours: 2, periodWeights: { p1: -3 } }],
      }],
    }));
    expect(new LocalEnergyRepository().load().scenarios[0].id).toBe(exampleScenario.id);
  });
});

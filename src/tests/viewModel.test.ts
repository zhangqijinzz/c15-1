import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleScenario } from '../domain';
import type { EnergyDocument } from '../types';
import { EnergyLensViewModel } from '../viewModel';
import type { EnergyRepository } from '../repository';

function makeRepository(): EnergyRepository & { data: EnergyDocument; save: ReturnType<typeof vi.fn> } {
  const data: EnergyDocument = { version: 1, scenarios: [structuredClone(exampleScenario)], activeScenarioId: exampleScenario.id };
  return { data, load: () => data, save: vi.fn((next: EnergyDocument) => { data.scenarios = next.scenarios; data.activeScenarioId = next.activeScenarioId; }) };
}

describe('EnergyLensViewModel', () => {
  let repository: ReturnType<typeof makeRepository>;
  let vm: EnergyLensViewModel;
  beforeEach(() => { repository = makeRepository(); vm = new EnergyLensViewModel(repository); vm.initialize(); });

  it('initializes, persists edits, and recalculates results', () => {
    expect(vm.getState().status).toBe('ready');
    const before = vm.activeSummary?.total.monthlyKwh;
    vm.updateDevice('device-aircon', { dailyHours: 2 });
    expect(vm.activeSummary?.total.monthlyKwh).toBeLessThan(before ?? Infinity);
    expect(repository.save).toHaveBeenCalled();
  });

  it('keeps invalid values out of the document and exposes an error notice', () => {
    vm.updateDevice('device-aircon', { watts: -50 });
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice?.text).toBe('功率不能为负数');
    expect(vm.activeScenario?.devices[0].watts).toBe(1200);
  });

  it('duplicates a scenario and can recover a saved document', () => {
    vm.duplicateActive();
    expect(vm.getState().document?.scenarios).toHaveLength(2);
    const recovered = new EnergyLensViewModel(repository);
    recovered.initialize();
    expect(recovered.getState().document?.scenarios).toHaveLength(2);
  });

  it('surfaces persistence failure as a recoverable error', () => {
    repository.save.mockImplementation(() => { throw new Error('quota'); });
    vm.addDevice();
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice?.text).toContain('保存失败');
  });
});

describe('time-of-use editing', () => {
  let repository: ReturnType<typeof makeRepository>;
  let vm: EnergyLensViewModel;
  beforeEach(() => { repository = makeRepository(); vm = new EnergyLensViewModel(repository); vm.initialize(); });

  it('adds periods after the last occupied hour and refuses a full day', () => {
    vm.addPeriod();
    vm.addPeriod();
    const periods = vm.activeScenario?.timePeriods ?? [];
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ startHour: 0, endHour: 2 });
    expect(periods[1]).toMatchObject({ startHour: 2, endHour: 4 });
    vm.updatePeriod(periods[1].id, { endHour: 24 });
    vm.addPeriod();
    expect(vm.activeScenario?.timePeriods).toHaveLength(2);
    expect(vm.getState().notice?.text).toContain('24 小时已被时段排满');
  });

  it('rejects overlapping period edits without touching the document', () => {
    vm.addPeriod();
    vm.addPeriod();
    const [first, second] = vm.activeScenario?.timePeriods ?? [];
    vm.updatePeriod(second.id, { startHour: 1 });
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice?.text).toContain('重叠');
    expect(vm.activeScenario?.timePeriods?.find((period) => period.id === second.id)?.startHour).toBe(2);
    vm.updatePeriod(first.id, { endHour: 25 });
    expect(vm.getState().notice?.text).toContain('0–24');
    expect(vm.activeScenario?.timePeriods?.find((period) => period.id === first.id)?.endHour).toBe(2);
  });

  it('settles device hours per period and reports weight deviation', () => {
    vm.addPeriod();
    vm.addPeriod();
    const [peak, valley] = vm.activeScenario?.timePeriods ?? [];
    vm.updatePeriod(peak.id, { pricePerKwh: 1 });
    vm.updatePeriod(valley.id, { pricePerKwh: 0.5 });
    vm.enableDeviceWeights('device-aircon');
    expect(vm.activeScenario?.devices[0].periodWeights).toEqual({ [peak.id]: 6 });
    vm.updateDeviceWeight('device-aircon', valley.id, 2);
    vm.updateDeviceWeight('device-aircon', peak.id, 4);
    // 空调 1.2 kW: (4 h × 1 + 2 h × 0.5) × 30 天 = 180 元；其余设备仍按统一电价
    const aircon = vm.activeSummary?.devices.find((device) => device.id === 'device-aircon');
    expect(aircon?.monthlyCost).toBeCloseTo(180);
    expect(aircon?.weightDeviation).toBeCloseTo(0);
    expect(vm.activeSummary?.usesTimeOfUse).toBe(true);
    vm.updateDeviceWeight('device-aircon', peak.id, 3);
    expect(vm.getState().notice?.text).toContain('相差 1.00 小时');
    expect(vm.activeSummary?.devices.find((device) => device.id === 'device-aircon')?.weightDeviation).toBeCloseTo(-1);
  });

  it('keeps unweighted devices on flat price inside a time-of-use scenario', () => {
    vm.addPeriod();
    const [period] = vm.activeScenario?.timePeriods ?? [];
    vm.enableDeviceWeights('device-aircon');
    const fridge = vm.activeSummary?.devices.find((device) => device.id === 'device-fridge');
    // 冰箱: 0.15 kW × 10 h × 30 天 × 0.62 = 27.9 元
    expect(fridge?.monthlyCost).toBeCloseTo(27.9);
    expect(period).toBeDefined();
  });

  it('removing a period prunes device weights and restoring flat billing works', () => {
    vm.addPeriod();
    const [period] = vm.activeScenario?.timePeriods ?? [];
    vm.enableDeviceWeights('device-aircon');
    vm.removePeriod(period.id);
    const aircon = vm.activeScenario?.devices.find((device) => device.id === 'device-aircon');
    expect(aircon?.periodWeights).toBeUndefined();
    expect(vm.activeScenario?.timePeriods).toHaveLength(0);
    expect(vm.activeSummary?.usesTimeOfUse).toBe(false);
    // 回到老算法: 1.2 kW × 6 h × 30 天 × 0.62
    expect(vm.activeSummary?.devices.find((device) => device.id === 'device-aircon')?.monthlyCost).toBeCloseTo(133.92);
  });

  it('clearing weights restores flat billing for a single device', () => {
    vm.addPeriod();
    vm.enableDeviceWeights('device-aircon');
    vm.clearDeviceWeights('device-aircon');
    expect(vm.activeScenario?.devices.find((device) => device.id === 'device-aircon')?.periodWeights).toBeUndefined();
    expect(vm.activeSummary?.devices.find((device) => device.id === 'device-aircon')?.monthlyCost).toBeCloseTo(133.92);
  });

  it('duplicating a scenario deep-copies periods and weights', () => {
    vm.addPeriod();
    const [period] = vm.activeScenario?.timePeriods ?? [];
    vm.enableDeviceWeights('device-aircon');
    vm.duplicateActive();
    const copy = vm.activeScenario;
    expect(copy?.timePeriods).toHaveLength(1);
    expect(copy?.devices[0].periodWeights).toEqual({ [period.id]: 6 });
    vm.updatePeriod(period.id, { pricePerKwh: 9 });
    expect(repository.data.scenarios[0].timePeriods?.[0].pricePerKwh).not.toBe(9);
  });
});

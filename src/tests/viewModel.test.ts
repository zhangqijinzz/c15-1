import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPricePeriods, exampleScenario } from '../domain';
import type { EnergyDocument } from '../types';
import { EnergyLensViewModel } from '../viewModel';
import type { EnergyRepository } from '../repository';

function makeRepository(document: EnergyDocument): EnergyRepository & { data: EnergyDocument; save: ReturnType<typeof vi.fn> } {
  return { data: document, load: () => document, save: vi.fn((next: EnergyDocument) => {
    document.scenarios = next.scenarios;
    document.activeScenarioId = next.activeScenarioId;
  }) };
}

function makeRepositoryWithExample() {
  const document: EnergyDocument = { version: 1, scenarios: [structuredClone(exampleScenario)], activeScenarioId: exampleScenario.id };
  return makeRepository(document);
}

describe('EnergyLensViewModel', () => {
  let repository: ReturnType<typeof makeRepositoryWithExample>;
  let vm: EnergyLensViewModel;
  beforeEach(() => { repository = makeRepositoryWithExample(); vm = new EnergyLensViewModel(repository); vm.initialize(); });

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

  it('enables time-of-use pricing, allocates valid weights, and settles by period', () => {
    vm.enablePricePeriods();
    expect(vm.activeScenario?.pricePeriods).toEqual(createDefaultPricePeriods());
    const [valley, standard] = vm.activeScenario!.pricePeriods!;
    vm.updateDevicePeriodHours('device-aircon', valley.id, 2);
    vm.updateDevicePeriodHours('device-aircon', standard.id, 4);
    expect(vm.activeSummary?.devices[0].allocation.status).toBe('allocated');
    expect(vm.activeSummary?.devices[0].monthlyCost).toBeCloseTo((1.2 * 2 * 0.35 + 1.2 * 4 * 0.62) * 30);
    expect(vm.activeSummary?.periods.some((period) => period.periodId === standard.id)).toBe(true);
  });

  it('persists mismatch feedback when period weights do not equal total daily hours', () => {
    vm.enablePricePeriods();
    const [valley] = vm.activeScenario!.pricePeriods!;
    vm.updateDevicePeriodHours('device-aircon', valley.id, 2);
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice?.text).toContain('相差 4 小时');
    expect(vm.activeSummary?.devices[0].allocation.status).toBe('mismatch');
  });

  it('keeps periods contiguous when a boundary is adjusted', () => {
    vm.enablePricePeriods();
    const [, standard] = vm.activeScenario!.pricePeriods!;
    vm.updatePricePeriod(standard.id, { startHour: 7 });
    const periods = vm.activeScenario?.pricePeriods ?? [];
    expect(periods[0]).toMatchObject({ startHour: 0, endHour: 7 });
    expect(periods[1]).toMatchObject({ startHour: 7, endHour: 22 });
  });

  it('removes a middle period, expands the previous period, and prunes its weights', () => {
    const document: EnergyDocument = {
      version: 1,
      activeScenarioId: 's',
      scenarios: [{
        id: 's', name: 's', pricePerKwh: 0.5, daysPerMonth: 30, createdAt: '',
        pricePeriods: [
          { id: 'a', name: 'A', startHour: 0, endHour: 8, pricePerKwh: 0.3 },
          { id: 'b', name: 'B', startHour: 8, endHour: 16, pricePerKwh: 0.7 },
          { id: 'c', name: 'C', startHour: 16, endHour: 24, pricePerKwh: 0.4 },
        ],
        devices: [{ id: 'd', name: '设备', watts: 1000, dailyHours: 3, periodHours: { a: 1, b: 1, c: 1 } }],
      }],
    };
    const customRepository = makeRepository(document);
    const customVm = new EnergyLensViewModel(customRepository);
    customVm.initialize();
    customVm.removePricePeriod('b');
    const active = customVm.activeScenario!;
    expect(active.pricePeriods?.map((period) => [period.id, period.startHour, period.endHour])).toEqual([
      ['a', 0, 16],
      ['c', 16, 24],
    ]);
    expect(active.devices[0].periodHours).toEqual({ a: 1, c: 1 });
    expect(customVm.activeSummary?.devices[0].allocation.status).toBe('mismatch');
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

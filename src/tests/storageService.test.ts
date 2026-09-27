// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { exampleScenario } from '../domain';
import { LocalEnergyRepository } from '../repository';
import type { EnergyDocument } from '../types';

describe('local persistence recovery', () => {
  beforeEach(() => localStorage.clear());

  it('falls back to a valid example when saved JSON is damaged', () => {
    localStorage.setItem('energy-lens.document.v1', JSON.stringify({ version: 1, scenarios: [null], activeScenarioId: 'missing' }));
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.activeScenarioId).toBe(exampleScenario.id);
    expect(recovered.scenarios[0].devices.length).toBeGreaterThan(0);
  });

  it('loads legacy documents without price period fields unchanged', () => {
    const legacy: EnergyDocument = { version: 1, scenarios: [structuredClone(exampleScenario)], activeScenarioId: exampleScenario.id };
    localStorage.setItem('energy-lens.document.v1', JSON.stringify(legacy));
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.scenarios[0].pricePeriods).toBeUndefined();
    expect(recovered.scenarios[0].devices[0].periodHours).toBeUndefined();
  });

  it('rejects time periods that do not cover the complete day', () => {
    const damaged = {
      version: 1,
      activeScenarioId: 's',
      scenarios: [{
        ...structuredClone(exampleScenario),
        id: 's',
        pricePeriods: [{ id: 'p', name: '峰段', startHour: 8, endHour: 22, pricePerKwh: 0.8 }],
      }],
    };
    localStorage.setItem('energy-lens.document.v1', JSON.stringify(damaged));
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.activeScenarioId).toBe(exampleScenario.id);
  });
});

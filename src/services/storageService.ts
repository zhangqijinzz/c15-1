import type { EnergyDocument, EnergyScenario, TimePeriod } from '../types';

const STORAGE_KEY = 'energy-lens.document.v1';

export function readDocument(): EnergyDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isDocument(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDocument(document: EnergyDocument): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}

function isDocument(value: unknown): value is EnergyDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EnergyDocument>;
  return candidate.version === 1
    && typeof candidate.activeScenarioId === 'string'
    && Array.isArray(candidate.scenarios)
    && candidate.scenarios.length > 0
    && candidate.scenarios.every(isScenario)
    && candidate.scenarios.some((scenario) => scenario.id === candidate.activeScenarioId);
}

function isScenario(value: unknown): value is EnergyScenario {
  if (!value || typeof value !== 'object') return false;
  const scenario = value as Partial<EnergyScenario>;
  return typeof scenario.id === 'string'
    && typeof scenario.name === 'string'
    && typeof scenario.createdAt === 'string'
    && typeof scenario.pricePerKwh === 'number'
    && scenario.pricePerKwh >= 0
    && typeof scenario.daysPerMonth === 'number'
    && scenario.daysPerMonth >= 1
    && scenario.daysPerMonth <= 31
    && Array.isArray(scenario.devices)
    && scenario.devices.length > 0
    && scenario.devices.every(isDevice)
    && (scenario.timePeriods === undefined || (Array.isArray(scenario.timePeriods) && scenario.timePeriods.every(isTimePeriod)));
}

function isDevice(value: unknown): value is EnergyScenario['devices'][number] {
  if (!value || typeof value !== 'object') return false;
  const device = value as Partial<EnergyScenario['devices'][number]>;
  return typeof device.id === 'string'
    && typeof device.name === 'string'
    && typeof device.watts === 'number'
    && device.watts >= 0
    && typeof device.dailyHours === 'number'
    && device.dailyHours >= 0
    && device.dailyHours <= 24
    && (device.periodWeights === undefined || isPeriodWeights(device.periodWeights));
}

function isTimePeriod(value: unknown): value is TimePeriod {
  if (!value || typeof value !== 'object') return false;
  const period = value as Partial<TimePeriod>;
  return typeof period.id === 'string'
    && typeof period.name === 'string'
    && typeof period.startHour === 'number'
    && period.startHour >= 0
    && period.startHour < 24
    && typeof period.endHour === 'number'
    && period.endHour > 0
    && period.endHour <= 24
    && period.endHour > period.startHour
    && typeof period.pricePerKwh === 'number'
    && period.pricePerKwh >= 0;
}

function isPeriodWeights(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((hours) => typeof hours === 'number' && hours >= 0 && hours <= 24);
}

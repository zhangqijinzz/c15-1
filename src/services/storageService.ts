import { MAX_DAILY_HOURS, sortPeriods, validatePricePeriods } from '../domain';
import type { EnergyDocument, PricePeriod } from '../types';

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

function isScenario(value: unknown): value is EnergyDocument['scenarios'][number] {
  if (!value || typeof value !== 'object') return false;
  const scenario = value as Partial<EnergyDocument['scenarios'][number]>;
  return typeof scenario.id === 'string'
    && typeof scenario.name === 'string'
    && typeof scenario.createdAt === 'string'
    && typeof scenario.pricePerKwh === 'number'
    && scenario.pricePerKwh >= 0
    && typeof scenario.daysPerMonth === 'number'
    && scenario.daysPerMonth >= 1
    && scenario.daysPerMonth <= 31
    && (scenario.pricePeriods === undefined || isPricePeriodCollection(scenario.pricePeriods))
    && Array.isArray(scenario.devices)
    && scenario.devices.length > 0
    && scenario.devices.every((device) => isDevice(device, scenario.pricePeriods));
}

function isPricePeriodCollection(periods: unknown): periods is PricePeriod[] {
  if (!Array.isArray(periods)) return false;
  if (periods.length === 0) return true;
  return periods.every(isPricePeriod) && validatePricePeriods(sortPeriods(periods as PricePeriod[])) === null;
}

function isPricePeriod(value: unknown): value is PricePeriod {
  if (!value || typeof value !== 'object') return false;
  const period = value as Partial<PricePeriod>;
  return typeof period.id === 'string'
    && typeof period.name === 'string'
    && typeof period.startHour === 'number'
    && typeof period.endHour === 'number'
    && typeof period.pricePerKwh === 'number'
    && period.startHour >= 0
    && period.endHour <= MAX_DAILY_HOURS
    && period.startHour < period.endHour
    && period.pricePerKwh >= 0;
}

function isDevice(value: unknown, periods: PricePeriod[] | undefined): value is EnergyDocument['scenarios'][number]['devices'][number] {
  if (!value || typeof value !== 'object') return false;
  const device = value as Partial<EnergyDocument['scenarios'][number]['devices'][number]>;
  const validBase = typeof device.id === 'string'
    && typeof device.name === 'string'
    && typeof device.watts === 'number'
    && device.watts >= 0
    && typeof device.dailyHours === 'number'
    && device.dailyHours >= 0
    && device.dailyHours <= 24;
  if (!validBase) return false;
  if (device.periodHours === undefined) return true;
  if (!device.periodHours || typeof device.periodHours !== 'object') return false;
  return Object.entries(device.periodHours).every(([periodId, hours]) =>
    typeof hours === 'number'
    && Number.isFinite(hours)
    && hours >= 0
    && hours <= 24
    && (!periods || periods.some((period) => period.id === periodId)),
  );
}

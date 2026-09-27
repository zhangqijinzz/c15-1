export interface PricePeriod {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  pricePerKwh: number;
}

export interface EnergyDevice {
  id: string;
  name: string;
  watts: number;
  dailyHours: number;
  /** 在各计费时段登记的小时数；未登记时沿用统一电价。 */
  periodHours?: Record<string, number>;
}

export interface EnergyScenario {
  id: string;
  name: string;
  pricePerKwh: number;
  daysPerMonth: number;
  devices: EnergyDevice[];
  /** 缺省表示旧方案，继续只使用 pricePerKwh，保证打开后的结果不变。 */
  pricePeriods?: PricePeriod[];
  createdAt: string;
}

export interface EnergyDocument {
  version: 1;
  scenarios: EnergyScenario[];
  activeScenarioId: string;
}

export type ViewStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';

export interface Notice {
  kind: 'success' | 'error' | 'info';
  text: string;
}

export interface EnergyEstimate {
  dailyKwh: number;
  monthlyKwh: number;
  monthlyCost: number;
}

export interface PeriodEstimate extends EnergyEstimate {
  periodId: string;
  name: string;
  hours: number;
  pricePerKwh: number;
  share: number;
  costShare: number;
}

export type DeviceAllocationStatus = 'flat' | 'allocated' | 'mismatch';

export interface DeviceAllocationState {
  status: DeviceAllocationStatus;
  allocatedHours: number;
  difference: number;
  error: string | null;
}

export type ScenarioDeviceSummary = EnergyDevice & EnergyEstimate & {
  share: number;
  costShare: number;
  effectivePricePerKwh: number;
  allocation: DeviceAllocationState;
};

export interface ScenarioSummary {
  total: EnergyEstimate;
  devices: ScenarioDeviceSummary[];
  periods: PeriodEstimate[];
  periodValidationError: string | null;
}

export interface TimePeriod {
  id: string;
  name: string;
  /** 0–24 之间，小于 endHour */
  startHour: number;
  /** 0–24 之间，大于 startHour */
  endHour: number;
  pricePerKwh: number;
}

export interface EnergyDevice {
  id: string;
  name: string;
  watts: number;
  dailyHours: number;
  /** 时段 id → 每日落在该时段的小时数；未登记时整台设备按统一电价结算 */
  periodWeights?: Record<string, number>;
}

export interface EnergyScenario {
  id: string;
  name: string;
  pricePerKwh: number;
  daysPerMonth: number;
  devices: EnergyDevice[];
  createdAt: string;
  /** 分时（峰谷）时段定义；缺省时整单按统一电价结算 */
  timePeriods?: TimePeriod[];
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

export interface DeviceSummary extends EnergyDevice, EnergyEstimate {
  share: number;
  /** 已登记权重时，落在各时段上的每日小时数合计；未登记为 null */
  allocatedHours: number | null;
  /** 权重合计与每日总时长的偏差（allocatedHours - dailyHours）；未登记为 null */
  weightDeviation: number | null;
}

export interface PeriodSummary {
  period: TimePeriod;
  monthlyKwh: number;
  monthlyCost: number;
  /** 该时段费用占方案月度总电费的比例 */
  costShare: number;
}

export interface ScenarioSummary {
  total: EnergyEstimate;
  devices: DeviceSummary[];
  periods: PeriodSummary[];
  usesTimeOfUse: boolean;
}

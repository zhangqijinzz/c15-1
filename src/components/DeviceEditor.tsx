import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { formatClockHour, formatHour } from '../domain';
import type { DeviceAllocationState, EnergyDevice, PricePeriod } from '../types';

interface DeviceEditorProps {
  device: EnergyDevice;
  periods: PricePeriod[];
  periodValidationError: string | null;
  allocation: DeviceAllocationState;
  fallbackPricePerKwh: number;
  onChange: (patch: Partial<EnergyDevice>) => void;
  onPeriodHoursChange: (periodId: string, hours: number) => void;
  onClearPeriodHours: () => void;
  onRemove: () => void;
}

export function DeviceEditor({ device, periods, periodValidationError, allocation, fallbackPricePerKwh, onChange, onPeriodHoursChange, onClearPeriodHours, onRemove }: DeviceEditorProps) {
  const [expanded, setExpanded] = useState(() => Boolean(device.periodHours));
  const hasPeriodPricing = periods.length > 0;
  const numberChange = (key: 'watts' | 'dailyHours') => (event: ChangeEvent<HTMLInputElement>) => onChange({ [key]: Number(event.target.value) });
  const totalLabel = useMemo(() => `${formatHour(allocation.allocatedHours)} / ${formatHour(device.dailyHours)} h`, [allocation.allocatedHours, device.dailyHours]);

  return (
    <div className={`device-row ${allocation.status === 'mismatch' ? 'has-warning' : ''}`}>
      <div className="device-main">
        <div className="device-icon">{device.name.slice(0, 1) || '·'}</div>
        <label className="field device-name"><span>设备名称</span><input value={device.name} onChange={(event) => onChange({ name: event.target.value })} /></label>
        <label className="field"><span>功率 <em>W</em></span><input type="number" min="0" step="10" value={device.watts} onChange={numberChange('watts')} /></label>
        <label className="field"><span>每日使用 <em>小时</em></span><input type="number" min="0" max="24" step="0.5" value={device.dailyHours} onChange={numberChange('dailyHours')} /></label>
        {hasPeriodPricing && <button className="period-toggle" onClick={() => setExpanded((value) => !value)}>{expanded ? '收起权重' : '分配时段'}</button>}
        <button className="icon-button" onClick={onRemove} aria-label={`移除${device.name}`}>×</button>
      </div>

      {hasPeriodPricing && expanded && (
        <div className="period-allocation">
          <div className="allocation-head">
            <span>时段权重（小时 / 天）</span>
            <b className={allocation.status}>{totalLabel}</b>
            <button type="button" onClick={onClearPeriodHours}>恢复统一电价</button>
          </div>
          <div className="period-weight-grid">
            {periods.map((period) => (
              <label className="field" key={period.id}>
                <span>{period.name} <em>{formatClockHour(period.startHour)}–{formatClockHour(period.endHour)} · ¥{period.pricePerKwh}</em></span>
                <input
                  type="number"
                  min="0"
                  max="24"
                  step="0.5"
                  value={device.periodHours?.[period.id] ?? ''}
                  placeholder="0"
                  onChange={(event) => onPeriodHoursChange(period.id, event.target.value === '' ? 0 : Number(event.target.value))}
                />
              </label>
            ))}
          </div>
          {periodValidationError ? <p className="allocation-feedback invalid">{periodValidationError}</p>
            : allocation.status === 'mismatch' ? <p className="allocation-feedback invalid">{allocation.error}</p>
            : allocation.status === 'allocated' ? <p className="allocation-feedback valid">权重已与每日总时长对齐，费用按各时段单价结算。</p>
            : <p className="allocation-feedback muted">未登记权重，当前按统一电价 ¥{fallbackPricePerKwh} 兜底计算。</p>}
        </div>
      )}
    </div>
  );
}

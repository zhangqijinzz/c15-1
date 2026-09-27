import type { ChangeEvent } from 'react';
import { allocatedPeriodHours, formatClock, formatNumber, hasPeriodWeights, HOURS_MATCH_EPSILON } from '../domain';
import type { EnergyDevice, TimePeriod } from '../types';

interface DeviceEditorProps {
  device: EnergyDevice;
  periods: TimePeriod[];
  onChange: (patch: Partial<EnergyDevice>) => void;
  onWeightChange: (periodId: string, hours: number) => void;
  onEnableWeights: () => void;
  onClearWeights: () => void;
  onRemove: () => void;
}

export function DeviceEditor({ device, periods, onChange, onWeightChange, onEnableWeights, onClearWeights, onRemove }: DeviceEditorProps) {
  const numberChange = (key: 'watts' | 'dailyHours') => (event: ChangeEvent<HTMLInputElement>) => onChange({ [key]: Number(event.target.value) });
  const weighted = hasPeriodWeights(device);
  const allocated = allocatedPeriodHours(device, periods);
  const deviation = allocated - device.dailyHours;
  const matched = Math.abs(deviation) < HOURS_MATCH_EPSILON;
  return (
    <div className="device-row">
      <div className="device-icon">{device.name.slice(0, 1) || '·'}</div>
      <label className="field device-name"><span>设备名称</span><input value={device.name} onChange={(event) => onChange({ name: event.target.value })} /></label>
      <label className="field"><span>功率 <em>W</em></span><input type="number" min="0" step="10" value={device.watts} onChange={numberChange('watts')} /></label>
      <label className="field"><span>每日使用 <em>小时</em></span><input type="number" min="0" max="24" step="0.5" value={device.dailyHours} onChange={numberChange('dailyHours')} /></label>
      <button className="icon-button" onClick={onRemove} aria-label={`移除${device.name}`}>×</button>
      {periods.length > 0 && (
        <div className="weight-row">
          {weighted ? (
            <>
              {periods.map((period) => (
                <label className="field weight-field" key={period.id}>
                  <span>{period.name} <em>{formatClock(period.startHour)}–{formatClock(period.endHour)}</em></span>
                  <input type="number" min="0" max="24" step="0.5" value={device.periodWeights?.[period.id] ?? 0} onChange={(event) => onWeightChange(period.id, Number(event.target.value))} />
                </label>
              ))}
              <button className="weight-toggle" onClick={onClearWeights}>恢复统一电价</button>
              <span className={`weight-status ${matched ? 'ok' : 'off'}`} role="status">
                {matched
                  ? `已分配 ${formatNumber(allocated)} h，与每日总时长一致`
                  : `已分配 ${formatNumber(allocated)} h，与每日总时长 ${formatNumber(device.dailyHours)} h 相差 ${formatNumber(Math.abs(deviation))} h`}
              </span>
            </>
          ) : (
            <button className="weight-toggle" onClick={onEnableWeights}>按时段分配时长，参与峰谷计费 →</button>
          )}
        </div>
      )}
    </div>
  );
}

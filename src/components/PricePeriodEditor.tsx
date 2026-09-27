import { formatClockHour, formatNumber, sortPeriods } from '../domain';
import type { EnergyScenario, PricePeriod } from '../types';

interface PricePeriodEditorProps {
  scenario: EnergyScenario;
  periodError: string | null;
  onEnable: () => void;
  onDisable: () => void;
  onChange: (periodId: string, patch: Partial<PricePeriod>) => void;
  onSplit: (periodId: string) => void;
  onRemove: (periodId: string) => void;
}

export function PricePeriodEditor({ scenario, periodError, onEnable, onDisable, onChange, onSplit, onRemove }: PricePeriodEditorProps) {
  const periods = sortPeriods(scenario.pricePeriods ?? []);
  if (periods.length === 0) {
    return (
      <div className="price-period-editor disabled-state">
        <div className="period-intro"><strong>峰谷分时段计价</strong><p>旧方案默认不改变。添加时段后，可为每台设备按小时登记权重。</p></div>
        <button type="button" className="secondary-button" onClick={onEnable}>添加峰谷时段</button>
      </div>
    );
  }

  return (
    <div className="price-period-editor">
      <div className="period-intro">
        <strong>峰谷分时段计价</strong>
        <p>时段必须首尾相接覆盖 00:00–24:00；调整边界会同步相邻时段。</p>
      </div>
      {periodError && <p className="period-error">{periodError}</p>}
      <div className="period-editor-list">
        {periods.map((period, index) => (
          <div className="period-editor-row" key={period.id}>
            <label className="field period-name-field"><span>时段名称</span><input value={period.name} onChange={(event) => onChange(period.id, { name: event.target.value })} /></label>
            <label className="field compact"><span>开始</span><input type={index === 0 ? 'text' : 'time'} min="00:00" max="23:30" step="1800" value={formatClockHour(period.startHour)} disabled={index === 0} readOnly={index === 0} onChange={(event) => onChange(period.id, { startHour: parseClockHour(event.target.value) })} /></label>
            <span className="period-dash">—</span>
            <label className="field compact"><span>结束</span><input type={index === periods.length - 1 ? 'text' : 'time'} min="00:30" max="23:30" step="1800" value={formatClockHour(period.endHour)} disabled={index === periods.length - 1} readOnly={index === periods.length - 1} onChange={(event) => onChange(period.id, { endHour: parseClockHour(event.target.value) })} /></label>
            <label className="field price-field"><span>单价 <em>¥/kWh</em></span><input type="number" min="0" step="0.01" value={period.pricePerKwh} onChange={(event) => onChange(period.id, { pricePerKwh: Number(event.target.value) })} /></label>
            <div className="period-actions">
              <button type="button" onClick={() => onSplit(period.id)} title="拆成两个时段">拆分</button>
              <button type="button" onClick={() => onRemove(period.id)} disabled={periods.length <= 1} title="删除并让相邻时段补齐">删除</button>
            </div>
          </div>
        ))}
      </div>
      <div className="period-timeline" aria-label="一天时段分布">
        {periods.map((period) => <i key={period.id} title={`${period.name} ${formatClock(period.startHour)}–${formatClock(period.endHour)} ¥${formatNumber(period.pricePerKwh)}`} style={{ flexGrow: period.endHour - period.startHour }} />)}
      </div>
      <button type="button" className="text-button danger" onClick={onDisable}>关闭分时段，恢复统一电价</button>
    </div>
  );
}

function formatClock(hour: number): string {
  return formatClockHour(hour);
}

function parseClockHour(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) return Number.NaN;
  return hour + minute / 60;
}

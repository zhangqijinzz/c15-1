import { DeviceEditor } from './components/DeviceEditor';
import { PricePeriodEditor } from './components/PricePeriodEditor';
import { ScenarioCard } from './components/ScenarioCard';
import { formatNumber, summarizeScenario } from './domain';
import { useEnergyLens } from './hooks';

function App() {
  const { vm, state } = useEnergyLens();
  const active = vm.activeScenario;
  const summary = vm.activeSummary;
  if (state.status === 'loading' || !active || !summary) return <main className="loading-screen"><div className="pulse" /><p>正在恢复你的能耗方案…</p></main>;

  const devicesByCost = summary.devices.slice().sort((a, b) => b.monthlyCost - a.monthlyCost);
  const maxDeviceCost = Math.max(...devicesByCost.map((device) => device.monthlyCost), 1);
  const topDevice = devicesByCost[0];
  const periodsByCost = summary.periods.slice().sort((a, b) => b.monthlyCost - a.monthlyCost);
  const topPeriod = periodsByCost[0];
  const maxPeriodCost = Math.max(...periodsByCost.map((period) => period.monthlyCost), 1);
  const savingsPerHour = (topDevice.watts / 1000) * topDevice.effectivePricePerKwh * active.daysPerMonth;

  const comparisonScenarios = state.document?.scenarios.filter((item) => item.id !== active.id) ?? [];
  const baseline = comparisonScenarios[0];
  const baselineSummary = baseline ? summarizeScenario(baseline) : null;
  const deltaKwh = baselineSummary ? summary.total.monthlyKwh - baselineSummary.total.monthlyKwh : null;
  const deltaCost = baselineSummary ? summary.total.monthlyCost - baselineSummary.total.monthlyCost : null;
  const periodWarning = summary.periodValidationError ?? summary.devices.find((device) => device.allocation.error)?.allocation.error ?? null;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">⌁</span><span>Energy<span>Lens</span></span></div>
      <div className="topbar-right"><span className="save-state"><i /> {state.status === 'error' ? '需要注意' : '已自动保存'}</span><button className="help-button" aria-label="帮助">?</button></div>
    </header>

    <main className="page-wrap">
      <section className="hero">
        <div><p className="eyebrow">家庭能耗推演器 <span>·</span> 轻量决策工具</p><h1>让每一度电<br /><span>都看得见。</span></h1><p className="hero-copy">把设备、使用习惯和峰谷电价放进来，马上看见<br className="desktop-only" />它们如何影响你的月度账单。</p></div>
        <div className="hero-spark"><span>本月预计电费</span><strong>¥{formatNumber(summary.total.monthlyCost)} <small>/ 月</small></strong><div className="sparkline">{periodsByCost.map((period) => <i key={period.periodId} style={{ height: `${Math.max(18, period.costShare * 100)}%` }} />)}</div></div>
      </section>

      {state.notice && <div className={`notice ${state.notice.kind}`} role="status"><span>{state.notice.kind === 'error' ? '!' : '✓'}</span>{state.notice.text}</div>}

      <div className="workspace-grid">
        <section className="panel setup-panel">
          <div className="panel-heading"><div><span className="step">01</span><h2>设备配置</h2><p>输入设备的额定功率与每天使用时长</p></div><span className="count-pill">{active.devices.length} 台设备</span></div>
          <div className="device-list">
            {active.devices.map((device) => {
              const deviceSummary = summary.devices.find((item) => item.id === device.id);
              return <DeviceEditor
                key={device.id}
                device={device}
                periods={active.pricePeriods ?? []}
                periodValidationError={summary.periodValidationError}
                allocation={deviceSummary?.allocation ?? { status: 'flat', allocatedHours: 0, difference: 0, error: null }}
                fallbackPricePerKwh={active.pricePerKwh}
                onChange={(patch) => vm.updateDevice(device.id, patch)}
                onPeriodHoursChange={(periodId, hours) => vm.updateDevicePeriodHours(device.id, periodId, hours)}
                onClearPeriodHours={() => vm.clearDevicePeriodHours(device.id)}
                onRemove={() => vm.removeDevice(device.id)}
              />;
            })}
          </div>
          <button className="add-device" onClick={() => vm.addDevice()}><span>＋</span> 添加一台设备</button>
          <div className="tip"><span>✦</span><p><strong>小提示</strong> 不登记时段权重的设备继续按统一电价计算；登记后，各时段小时数必须合计等于每日总时长。</p></div>
        </section>

        <section className="panel settings-panel">
          <div className="panel-heading"><div><span className="step">02</span><h2>时间与价格</h2><p>调整计费周期，或按峰谷表把一天切成多个时段</p></div></div>
          <label className="big-field"><span>每月计费天数 <em>天</em></span><input type="number" min="1" max="31" value={active.daysPerMonth} onChange={(event) => vm.updateSettings({ daysPerMonth: Number(event.target.value) })} /></label>
          <label className="big-field"><span>未分配设备的统一电价 <em>元 / kWh</em></span><div className="input-prefix"><b>¥</b><input type="number" min="0" step="0.01" value={active.pricePerKwh} onChange={(event) => vm.updateSettings({ pricePerKwh: Number(event.target.value) })} /></div></label>
          <PricePeriodEditor
            scenario={active}
            periodError={summary.periodValidationError}
            onEnable={() => vm.enablePricePeriods()}
            onDisable={() => vm.disablePricePeriods()}
            onChange={(periodId, patch) => vm.updatePricePeriod(periodId, patch)}
            onSplit={(periodId) => vm.splitPricePeriod(periodId)}
            onRemove={(periodId) => vm.removePricePeriod(periodId)}
          />
          <div className="formula"><span>计算方式</span><code>Σ 功率(kW) × 时段小时 × 天数 × 时段单价</code><small>{periodWarning ?? '未登记权重的设备会明确归入“统一电价”，不做静默拆分。'}</small></div>
        </section>
      </div>

      <section className="results-section"><div className="section-title"><div><span className="step">03</span><h2>结果分析</h2><p>你的用电成本结构，一眼看清</p></div><div className="result-actions"><span className="updated">实时更新 · {state.status === 'completed' ? '已完成' : '编辑中'}</span><button className="primary-button" onClick={() => vm.complete()}>完成本次推演 <span>→</span></button></div></div>
        <div className="metrics"><div className="metric-card featured"><span>月度预计电费</span><strong>¥{formatNumber(summary.total.monthlyCost)}</strong><em>{formatNumber(summary.total.monthlyKwh)} kWh / 月</em></div><div className="metric-card"><span>日均用电</span><strong>{formatNumber(summary.total.dailyKwh)} <small>kWh</small></strong><em>平均每天</em></div><div className="metric-card"><span>设备数量</span><strong>{active.devices.length} <small>台</small></strong><em>{active.pricePeriods?.length ? `${active.pricePeriods.length} 个计费时段` : '统一电价计费'}</em></div></div>
        <div className="analysis-grid analysis-grid-three">
          <div className="chart-card"><div className="card-heading"><div><h3>设备费用占比</h3><p>按月度电费排序，已套用各设备实际单价</p></div><span className="legend"><i /> 月度费用</span></div><div className="bar-chart">{devicesByCost.map((device) => <div className="bar-row" key={device.id}><div className="bar-label"><span>{device.name}</span><b>¥{formatNumber(device.monthlyCost)}</b></div><div className="bar-track"><i style={{ width: `${(device.monthlyCost / maxDeviceCost) * 100}%` }} /><span>{Math.round(device.costShare * 100)}%</span></div></div>)}</div></div>
          <div className="chart-card period-cost-card"><div className="card-heading"><div><h3>时段费用去向</h3><p>看钱主要花在哪些时段</p></div><span className="legend"><i /> 月度费用</span></div><div className="bar-chart">{periodsByCost.map((period) => <div className="bar-row" key={period.periodId} data-period><div className="bar-label"><span>{period.name}</span><b>¥{formatNumber(period.monthlyCost)}</b></div><div className="bar-track"><i style={{ width: `${(period.monthlyCost / maxPeriodCost) * 100}%` }} /><span>{Math.round(period.costShare * 100)}%</span></div></div>)}</div></div>
          <div className="insight-card"><span className="insight-icon">◒</span><h3>费用最高时段</h3><strong>{topPeriod?.name ?? '统一电价'}</strong><p>{topPeriod ? <>花掉 <b>¥{formatNumber(topPeriod.monthlyCost)}</b>，占总电费的 <b>{Math.round(topPeriod.costShare * 100)}%</b>。</> : '登记设备时段权重后，这里会显示费用集中的时段。'}<br />设备费用最高的是 <b>{topDevice?.name}</b>；每天少用 1 小时，预计每月节省 <b>¥{formatNumber(savingsPerHour)}</b>。</p></div>
        </div>
      </section>

      <section className="scenario-section"><div className="section-title"><div><span className="step">04</span><h2>方案对比</h2><p>复制当前方案，试试另一种生活方式</p></div><button className="secondary-button" onClick={() => vm.duplicateActive()}>＋ 复制当前方案</button></div><div className="scenario-grid">{state.document?.scenarios.map((scenario) => {
        const itemSummary = scenario.id === active.id ? summary : summarizeScenario(scenario);
        return <ScenarioCard key={scenario.id} scenario={scenario} totalKwh={itemSummary.total.monthlyKwh} totalCost={itemSummary.total.monthlyCost} active={scenario.id === active.id} onSelect={() => vm.selectScenario(scenario.id)} />;
      })}</div>{baseline && baselineSummary && deltaKwh !== null && deltaCost !== null && <div className="comparison-note"><span>↕</span><p>当前方案相较于“{baseline.name}”每月 <b>{deltaKwh <= 0 ? '少' : '多'} {formatNumber(Math.abs(deltaKwh))} kWh</b>，电费 <b>{deltaCost <= 0 ? '少' : '多'} ¥{formatNumber(Math.abs(deltaCost))}</b>。</p></div>}</section>
    </main>
    <footer><span>EnergyLens · 用数据做出更好的能源选择</span><span>本地保存 · 数据只属于你</span></footer>
  </div>;
}

export default App;

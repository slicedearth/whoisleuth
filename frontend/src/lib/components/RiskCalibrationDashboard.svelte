<script lang="ts">
  import {
    calibrationIntervalLabel,
    calibrationRateLabel,
    calibrationStratumLabel,
    parseRiskCalibrationDashboard,
    RISK_CALIBRATION_SUMMARY_MAX_BYTES,
    type RiskCalibrationDashboard,
  } from '$lib/analysis/risk-calibration-dashboard.ts';

  let dashboard = $state<RiskCalibrationDashboard | null>(null);
  let error = $state('');
  let fileName = $state('');

  async function loadReport(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    dashboard = null;
    error = '';
    fileName = '';
    if (file.size < 1 || file.size > RISK_CALIBRATION_SUMMARY_MAX_BYTES) {
      error = `Choose a target-free calibration summary no larger than ${Math.round(RISK_CALIBRATION_SUMMARY_MAX_BYTES / 1024)} KiB.`;
      return;
    }
    try {
      dashboard = parseRiskCalibrationDashboard(await file.text());
      fileName = [...file.name].slice(0, 120).join('');
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'The Risk calibration summary could not be read.';
    }
  }

  function clearReport() {
    dashboard = null;
    error = '';
    fileName = '';
  }

  function modelMessage(value: RiskCalibrationDashboard): string {
    if (value.modelCompatibility === 'current') return `This report uses the current Risk model, version ${value.currentModelVersion}.`;
    if (value.modelCompatibility === 'older') return `This report uses older Risk model version ${value.report.riskModelVersion}; the current application uses version ${value.currentModelVersion}. Do not compare its metrics as current.`;
    return `This report uses newer Risk model version ${value.report.riskModelVersion}; this application knows version ${value.currentModelVersion}. Review it with a compatible release.`;
  }
</script>

<section class="calibration-dashboard card" aria-labelledby="risk-calibration-dashboard-title">
  <header class="dashboard-header">
    <div>
      <p class="eyebrow">Local diagnostics</p>
      <h2 id="risk-calibration-dashboard-title">Reviewed Risk calibration</h2>
      <p>Open a target-free summary produced by <code>whoisleuth risk-calibrate --summary-json</code>. It is checked and displayed only in this tab.</p>
    </div>
    <label class="btn report-picker">
      Open summary
      <input type="file" accept="application/json,.json" onchange={loadReport}>
    </label>
  </header>

  <p class="boundary">This review describes only the supplied analyst-labelled sample. It does not recommend a threshold, tune Risk, prove maliciousness or safety, make a request, or retain the file.</p>

  {#if error}
    <div class="report-message error" role="alert"><strong>Summary not loaded</strong><span>{error}</span></div>
  {:else if dashboard}
    {@const report = dashboard.report}
    <div class="report-meta" aria-live="polite">
      <span class="report-file">{fileName} · generated {new Date(report.generatedAt).toLocaleString('en-AU')}</span>
      <button class="btn small" type="button" onclick={clearReport}>Clear summary</button>
    </div>

    <p class="model-state" data-compatibility={dashboard.modelCompatibility}>{modelMessage(dashboard)}</p>

    <div class="summary-grid" aria-label="Calibration sample summary">
      <article><strong>{report.summary.total}</strong><span>Reviewed records</span></article>
      <article><strong>{dashboard.includedLabels}</strong><span>Metric labels</span></article>
      <article><strong>{report.summary.positive} / {report.summary.negative}</strong><span>Positive / negative</span></article>
      <article><strong>{report.summary.excluded}</strong><span>Excluded context</span></article>
    </div>
    <p class="sample-state" data-state={dashboard.sampleSufficiency}>
      {dashboard.sampleSufficiency === 'reviewed'
        ? 'Both metric classes contain at least 20 reviewed labels. This local sample can still be unrepresentative.'
        : 'Insufficient class balance: both positive and negative classes need at least 20 reviewed labels before treating this as more than a small local sample.'}
    </p>

    <h3>Threshold replay</h3>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable threshold table must be keyboard reachable -->
    <div class="threshold-table-shell" role="region" tabindex="0" aria-label="Scrollable threshold metrics">
      <table>
        <caption class="visually-hidden">Risk calibration metrics and Wilson 95 percent intervals by fixed threshold</caption>
        <thead><tr><th>Threshold</th><th>Counts</th><th>Precision</th><th>Recall</th><th>Specificity</th><th>F1</th><th>Balanced accuracy</th></tr></thead>
        <tbody>
          {#each report.thresholds as metric}
            <tr class:current={metric.threshold === report.currentReviewThreshold}>
              <th scope="row">{metric.threshold}+{metric.threshold === report.currentReviewThreshold ? ' · current review band' : ''}</th>
              <td>TP {metric.truePositive} · FP {metric.falsePositive} · TN {metric.trueNegative} · FN {metric.falseNegative}</td>
              <td>{calibrationRateLabel(metric.precision)}<small>{calibrationIntervalLabel(metric.confidence95.precision)}</small></td>
              <td>{calibrationRateLabel(metric.recall)}<small>{calibrationIntervalLabel(metric.confidence95.recall)}</small></td>
              <td>{calibrationRateLabel(metric.specificity)}<small>{calibrationIntervalLabel(metric.confidence95.specificity)}</small></td>
              <td>{calibrationRateLabel(metric.f1)}</td>
              <td>{calibrationRateLabel(metric.balancedAccuracy)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="threshold-cards" aria-label="Threshold metrics">
      {#each report.thresholds as metric}
        <article class:current={metric.threshold === report.currentReviewThreshold}>
          <h4>{metric.threshold}+{metric.threshold === report.currentReviewThreshold ? ' · current review band' : ''}</h4>
          <p>TP {metric.truePositive} · FP {metric.falsePositive} · TN {metric.trueNegative} · FN {metric.falseNegative}</p>
          <dl>
            <div><dt>Precision</dt><dd>{calibrationRateLabel(metric.precision)}<small>{calibrationIntervalLabel(metric.confidence95.precision)}</small></dd></div>
            <div><dt>Recall</dt><dd>{calibrationRateLabel(metric.recall)}<small>{calibrationIntervalLabel(metric.confidence95.recall)}</small></dd></div>
            <div><dt>Specificity</dt><dd>{calibrationRateLabel(metric.specificity)}<small>{calibrationIntervalLabel(metric.confidence95.specificity)}</small></dd></div>
            <div><dt>F1</dt><dd>{calibrationRateLabel(metric.f1)}</dd></div>
            <div><dt>Balanced accuracy</dt><dd>{calibrationRateLabel(metric.balancedAccuracy)}</dd></div>
          </dl>
        </article>
      {/each}
    </div>

    <details class="strata">
      <summary>Review {dashboard.strata.length} bounded strata</summary>
      <div class="strata-grid">
        {#each dashboard.strata as stratum}
          <article>
            <h4>{calibrationStratumLabel(stratum.dimension, stratum.value)}</h4>
            <p>{stratum.sampleCount} metric label{stratum.sampleCount === 1 ? '' : 's'} · {stratum.insufficientSample ? 'insufficient sample' : 'reviewed sample'}</p>
            <dl>
              <div><dt>Precision</dt><dd>{calibrationRateLabel(stratum.metrics.precision)}</dd></div>
              <div><dt>Recall</dt><dd>{calibrationRateLabel(stratum.metrics.recall)}</dd></div>
              <div><dt>Specificity</dt><dd>{calibrationRateLabel(stratum.metrics.specificity)}</dd></div>
            </dl>
          </article>
        {/each}
      </div>
    </details>

    {#if report.modelComparison.available}
      <div class="comparison">
        <h3>Model replay</h3>
        <p>Version {report.modelComparison.previousModelVersion} → {report.modelComparison.currentModelVersion} · {report.modelComparison.scoresChanged} score changes · {report.modelComparison.bandsChanged} band changes · {report.modelComparison.thresholdClassificationsChanged} current-threshold classification changes.</p>
      </div>
    {/if}
  {/if}
</section>

<style>
  .calibration-dashboard{margin:16px 0;padding:18px;min-width:0}
  .dashboard-header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
  .dashboard-header>div{min-width:0}.dashboard-header h2{margin:3px 0 7px}.dashboard-header p{margin:0;color:var(--muted);line-height:1.55;overflow-wrap:anywhere}
  .report-picker{position:relative;flex:none}.report-picker input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}.report-picker:focus-within{outline:2px solid var(--focus);outline-offset:3px}
  .boundary{margin:14px 0;padding:10px 12px;border-left:3px solid var(--border-strong);background:var(--panel);color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .report-message{display:flex;gap:8px;flex-wrap:wrap;padding:12px;border:1px solid var(--danger);border-radius:var(--radius-sm);color:var(--danger);overflow-wrap:anywhere}
  .report-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0;min-width:0}.report-file{min-width:0;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .model-state,.sample-state{padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);line-height:1.5;overflow-wrap:anywhere}
  .model-state[data-compatibility='older'],.model-state[data-compatibility='newer'],.sample-state[data-state='insufficient']{border-color:var(--amber);color:var(--amber)}
  .summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}.summary-grid article{min-width:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.summary-grid strong{display:block;font-size:var(--text-lg);overflow-wrap:anywhere}.summary-grid span{display:block;margin-top:4px;color:var(--muted);font-size:var(--text-2xs)}
  h3{margin:20px 0 10px}.threshold-table-shell{max-width:100%;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-sm)}table{width:100%;min-width:980px;border-collapse:collapse}th,td{padding:10px 12px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;font-size:var(--text-xs)}thead th{background:var(--panel);font-family:var(--mono)}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}tr.current{background:rgb(var(--accent-rgb) / .06)}td small{display:block;margin-top:4px;color:var(--muted)}
  .threshold-cards{display:none}.threshold-cards article,.strata-grid article{min-width:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.threshold-cards article.current{border-color:var(--accent)}h4{margin:0 0 8px;overflow-wrap:anywhere}.threshold-cards p,.strata-grid p{color:var(--muted);overflow-wrap:anywhere}dl{margin:0}dl>div{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--border)}dt{color:var(--muted)}dd{margin:0;text-align:right;overflow-wrap:anywhere}dd small{display:block;color:var(--muted)}
  .strata{margin-top:18px}.strata summary{cursor:pointer;font-weight:700}.strata-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}.comparison{margin-top:18px}.comparison p{overflow-wrap:anywhere}
  .visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
  @media(max-width:900px){.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.strata-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:640px){.calibration-dashboard{padding:14px}.dashboard-header{flex-direction:column}.report-picker{width:100%;text-align:center}.threshold-table-shell{display:none}.threshold-cards{display:grid;grid-template-columns:1fr;gap:10px}.strata-grid{grid-template-columns:1fr}.report-meta{align-items:flex-start;flex-direction:column}.summary-grid{grid-template-columns:1fr 1fr}}
</style>

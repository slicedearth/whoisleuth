<script lang="ts">
  import {
    parseSourceReliabilityDashboard,
    reliabilityDurationLabel,
    reliabilityRateLabel,
    SOURCE_RELIABILITY_DASHBOARD_MAX_BYTES,
    type SourceReliabilityDashboard,
  } from '$lib/analysis/source-reliability-dashboard.ts';

  let dashboard = $state<SourceReliabilityDashboard | null>(null);
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
    if (file.size < 1 || file.size > SOURCE_RELIABILITY_DASHBOARD_MAX_BYTES) {
      error = `Choose a source report no larger than ${Math.round(SOURCE_RELIABILITY_DASHBOARD_MAX_BYTES / 1024)} KiB.`;
      return;
    }
    try {
      dashboard = parseSourceReliabilityDashboard(await file.text());
      fileName = file.name.slice(0, 120);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'The source reliability report could not be read.';
    }
  }

  function rateWidth(value: number | null): string {
    return `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%`;
  }

  function clearReport() {
    dashboard = null;
    error = '';
    fileName = '';
  }

  function sourceLabel(value: string): string {
    return value.replaceAll('_', ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
  }

  function trendLabel(value: 'faster' | 'slower' | 'steady' | 'unmeasured'): string {
    return ({ faster: 'Faster', slower: 'Slower', steady: 'Steady', unmeasured: 'Unmeasured' })[value];
  }
</script>

<section class="reliability-section" aria-labelledby="source-reliability-title">
  <header class="section-intro reliability-intro">
    <div>
      <p class="eyebrow">Local diagnostics</p>
      <h2 id="source-reliability-title">Source reliability review</h2>
      <p>Open a target-free report produced by <code>whoisleuth source-report</code>. The file is analysed in this browser tab and is not uploaded or retained.</p>
    </div>
    <label class="btn report-picker">
      Open report
      <input type="file" accept="application/json,.json" onchange={loadReport}>
    </label>
  </header>

  <p class="reliability-boundary">Rates describe only the supplied sample. They do not rank providers, predict the next request, or turn missing evidence into a successful result.</p>

  {#if error}
    <div class="report-message error" role="alert"><strong>Report not loaded</strong><span>{error}</span></div>
  {:else if dashboard}
    <div class="report-meta" aria-live="polite">
      <span><strong>{dashboard.summary.sources}</strong> sources</span>
      <span><strong>{dashboard.summary.stateSamples}</strong> state samples</span>
      <span><strong>{dashboard.summary.attention}</strong> attention</span>
      <span><strong>{dashboard.summary.measuredDuration}</strong> timed</span>
      <span class="report-file">{fileName} · generated {new Date(dashboard.generatedAt).toLocaleString('en-AU')}</span>
      <button class="clear-report" type="button" onclick={clearReport}>Clear report</button>
    </div>

    {#if dashboard.rows.length}
      <div class="reliability-grid">
        {#each dashboard.rows as row}
          <article class="source-card" data-tone={row.tone}>
            <header>
              <div><h3>{sourceLabel(row.source)}</h3><span>{row.sampleLabel}</span></div>
              <span class="tone">{row.tone === 'attention' ? 'Review' : row.tone === 'limited' ? 'Limited sample' : row.tone === 'healthy' ? 'Healthy sample' : 'Mixed sample'}</span>
            </header>
            <dl>
              <div><dt>Failure</dt><dd>{reliabilityRateLabel(row.failureRate)}</dd></div>
              <div><dt>Partial</dt><dd>{reliabilityRateLabel(row.partialRate)}</dd></div>
              <div><dt>Truncated</dt><dd>{reliabilityRateLabel(row.truncatedRate)}</dd></div>
              <div><dt>Rate limited</dt><dd>{reliabilityRateLabel(row.rateLimitedRate)}</dd></div>
              <div><dt>p95 duration</dt><dd>{reliabilityDurationLabel(row.p95DurationMs)}</dd></div>
              <div><dt>Duration trend</dt><dd>{trendLabel(row.durationTrend)}</dd></div>
            </dl>
            <div class="rate-strip" aria-hidden="true">
              <span class="failure" style:width={rateWidth(row.failureRate)}></span>
              <span class="partial" style:width={rateWidth(row.partialRate)}></span>
              <span class="limited" style:width={rateWidth(row.rateLimitedRate)}></span>
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <div class="report-message"><strong>No source samples</strong><span>The report is valid but contains no measured source entries.</span></div>
    {/if}
  {:else}
    <div class="report-message"><strong>No report open</strong><span>Generate a target-free JSON report locally, then review its bounded source health here.</span></div>
  {/if}
</section>

<style>
  .reliability-section{margin-top:34px}.reliability-intro{display:flex;max-width:none;gap:18px;align-items:end;justify-content:space-between}.reliability-intro>div{max-width:820px}.reliability-intro code{color:var(--accent)}
  .report-picker{position:relative;flex:0 0 auto;overflow:hidden}.report-picker input{position:absolute;inset:0;opacity:0;cursor:pointer}
  .reliability-boundary{margin:0 0 12px;padding:11px 13px;border-left:2px solid var(--accent2);background:var(--panel);color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .report-meta{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:9px}.report-meta>span,.clear-report{border:1px solid var(--border);border-radius:999px;padding:5px 8px;background:var(--surface);color:var(--muted);font:600 var(--text-2xs) var(--mono)}.report-meta strong{color:var(--text)}.report-meta .report-file{min-width:0;max-width:100%;margin-left:auto;overflow-wrap:anywhere}.clear-report{cursor:pointer}.clear-report:hover,.clear-report:focus-visible{border-color:var(--accent);color:var(--text)}
  .reliability-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.source-card{position:relative;min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-md);padding:14px;background:var(--panel)}.source-card>header{display:flex;gap:10px;align-items:start;justify-content:space-between}.source-card h3{margin:0;color:var(--text);font:700 var(--text-sm) var(--mono)}.source-card header div>span{display:block;margin-top:3px;color:var(--muted);font-size:var(--text-2xs)}.tone{flex:0 0 auto;border:1px solid var(--border);border-radius:999px;padding:3px 6px;color:var(--muted);font:700 var(--text-2xs) var(--mono)}.source-card[data-tone='attention'] .tone{border-color:color-mix(in srgb,var(--danger) 48%,var(--border));color:var(--danger)}.source-card[data-tone='healthy'] .tone{border-color:color-mix(in srgb,var(--success) 42%,var(--border));color:var(--success)}
  .source-card dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:13px 0 10px}.source-card dl>div{min-width:0}.source-card dt{color:var(--muted);font:600 var(--text-2xs) var(--mono)}.source-card dd{margin:3px 0 0;color:var(--text);font-size:var(--text-xs);overflow-wrap:anywhere}.rate-strip{display:flex;height:3px;overflow:hidden;border-radius:3px;background:var(--surface)}.rate-strip span{display:block;min-width:0}.rate-strip .failure{background:var(--danger)}.rate-strip .partial{background:var(--amber)}.rate-strip .limited{background:var(--accent2)}
  .report-message{display:flex;gap:8px 18px;align-items:center;justify-content:space-between;border:1px dashed var(--border);border-radius:var(--radius-md);padding:14px;background:var(--panel)}.report-message strong{font:700 var(--text-xs) var(--mono)}.report-message span{color:var(--muted);font-size:var(--text-xs);line-height:1.45}.report-message.error{border-style:solid;border-color:color-mix(in srgb,var(--danger) 42%,var(--border))}.report-message.error strong{color:var(--danger)}
  @media(max-width:1050px){.reliability-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:650px){.reliability-intro{align-items:start;flex-direction:column}.report-picker{width:100%;justify-content:center}.report-meta .report-file{width:100%;margin-left:0}.clear-report{margin-left:auto}.reliability-grid{grid-template-columns:1fr}.source-card dl{grid-template-columns:repeat(2,minmax(0,1fr))}.report-message{align-items:start;flex-direction:column}}
</style>

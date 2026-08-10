<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import {
    brandProtectionOperationsReportFilename,
    buildBrandProtectionOperationsReport,
    serializeBrandProtectionOperationsReport,
    type OperationsReportSourceState,
    type OperationsReportWindow,
  } from '$lib/analysis/brand-protection-operations-report.ts';

  let {
    records,
    sourceState,
  }: {
    records: readonly CaseRecord[];
    sourceState: OperationsReportSourceState;
  } = $props();

  let audience = $state<'analyst' | 'operations' | 'executive'>('analyst');
  let window = $state<OperationsReportWindow>('30d');
  let reviewNow = $state(new Date().toISOString());
  let message = $state('');
  const report = $derived(buildBrandProtectionOperationsReport(records, { sourceState, window, now: reviewNow }));
  const counts = $derived(report.counts);

  function downloadReport() {
    try {
      reviewNow = new Date().toISOString();
      const current = buildBrandProtectionOperationsReport(records, { sourceState, window, now: reviewNow });
      const content = serializeBrandProtectionOperationsReport(current);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = brandProtectionOperationsReportFilename(current.generatedAt);
      anchor.click();
      URL.revokeObjectURL(url);
      message = 'Exported aggregate recorded-action counts. No response was submitted.';
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not export the operations report.';
    }
  }

  function windowLabel() {
    if (window === 'all') return 'all retained action updates';
    return `action updates from the last ${window.replace('d', '')} days`;
  }
</script>

<section class="operations-report card" aria-labelledby="operations-report-title" aria-busy={sourceState === 'loading'}>
  <header>
    <div>
      <p class="eyebrow">Recorded outcomes</p>
      <h2 id="operations-report-title">Brand-protection operations report</h2>
      <p>Review bounded aggregate counts derived only from explicit Case action states. Packet preparation, provider delivery, and outcome success are never inferred.</p>
    </div>
    <button class="btn" type="button" onclick={downloadReport} disabled={sourceState !== 'ready'}>Export aggregate JSON</button>
  </header>

  <fieldset class="report-controls">
    <legend>Report view</legend>
    <label class="field">Audience
      <select bind:value={audience}>
        <option value="analyst">Analyst follow-up</option>
        <option value="operations">Operations workload</option>
        <option value="executive">Executive summary</option>
      </select>
    </label>
    <label class="field">Time window
      <select bind:value={window} onchange={() => { reviewNow = new Date().toISOString(); }}>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="all">All retained time</option>
      </select>
    </label>
  </fieldset>

  {#if sourceState === 'loading'}
    <p class="source-state" role="status">Loading Case action records. Counts are withheld until the source settles.</p>
  {:else if sourceState === 'unavailable'}
    <p class="source-state unavailable" role="alert">Case action records are unavailable. No zero, absence, submission, or outcome conclusion is shown.</p>
  {:else if counts}
    <p class="scope"><strong>{counts.actions}</strong> current action record{counts.actions === 1 ? '' : 's'} across <strong>{counts.casesWithActions}</strong> of <strong>{counts.casesInspected}</strong> inspected Case{counts.casesInspected === 1 ? '' : 's'} · {windowLabel()}.</p>

    {#if audience === 'analyst'}
      <div class="metric-grid" role="group" aria-label="Analyst follow-up counts">
        <article class:attention={counts.overdue > 0}><strong>{counts.overdue}</strong><span>Overdue</span><small>Non-terminal actions with a past due date</small></article>
        <article class:attention={counts.followUpDue > 0}><strong>{counts.followUpDue}</strong><span>Follow-up due</span><small>Non-terminal actions with a reached follow-up date</small></article>
        <article><strong>{counts.prepared}</strong><span>Prepared</span><small>State recorded as ready for review</small></article>
        <article><strong>{counts.submitted}</strong><span>Submitted</span><small>State explicitly recorded as submitted</small></article>
      </div>
    {:else if audience === 'operations'}
      <div class="metric-grid" role="group" aria-label="Operations workload counts">
        <article><strong>{counts.planned}</strong><span>Planned</span><small>Current planned action records</small></article>
        <article><strong>{counts.prepared}</strong><span>Prepared</span><small>Ready-for-review action records</small></article>
        <article><strong>{counts.acknowledged}</strong><span>Acknowledged</span><small>Explicitly acknowledged records</small></article>
        <article><strong>{counts.reviewedRecipientRoute}</strong><span>Reviewed routes</span><small>Routes with a source and recorded limitation</small></article>
      </div>
    {:else}
      <div class="metric-grid" role="group" aria-label="Executive recorded outcome counts">
        <article><strong>{counts.casesWithActions}</strong><span>Cases with actions</span><small>Denominator: {counts.casesInspected} inspected Cases</small></article>
        <article><strong>{counts.resolved}</strong><span>Resolved</span><small>Current state explicitly recorded as resolved</small></article>
        <article><strong>{counts.closed}</strong><span>Closed</span><small>Current state explicitly recorded as closed</small></article>
        <article><strong>{counts.withOutcome}</strong><span>Recorded outcomes</span><small>Actions with analyst-entered outcome text</small></article>
      </div>
    {/if}

    <details>
      <summary>Exact current-state and action-type counts</summary>
      <div class="exact-grid">
        <section>
          <h3>Current states</h3>
          <dl>{#each Object.entries(report.states || {}) as [label, value]}<div><dt>{label.replaceAll('_', ' ')}</dt><dd>{value}</dd></div>{/each}</dl>
        </section>
        <section>
          <h3>Action types</h3>
          <dl>{#each Object.entries(report.actionTypes || {}) as [label, value]}<div><dt>{label.replaceAll('_', ' ')}</dt><dd>{value}</dd></div>{/each}</dl>
        </section>
      </div>
      <p class="omissions">Outside this view: {report.omissions.actionsOutsideWindow} action{report.omissions.actionsOutsideWindow === 1 ? '' : 's'} outside the selected window; {report.omissions.casesBeyondLimit} Case{report.omissions.casesBeyondLimit === 1 ? '' : 's'} beyond the cap; {report.omissions.actionsBeyondLimit} action{report.omissions.actionsBeyondLimit === 1 ? '' : 's'} beyond per-Case bounds; {report.omissions.actionsWithInvalidTime} invalid action time{report.omissions.actionsWithInvalidTime === 1 ? '' : 's'}.</p>
    </details>
  {/if}

  <details>
    <summary>Definitions and limitations</summary>
    <ul class="limitations">{#each report.limitations as limitation}<li>{limitation}</li>{/each}</ul>
  </details>
  {#if message}<p class="message" role="status">{message}</p>{/if}
</section>

<style>
  .operations-report{display:grid;gap:14px;margin-top:14px;padding:var(--card-pad)}
  header{display:flex;align-items:start;justify-content:space-between;gap:18px}h2,p{margin:0}header h2{margin-top:3px;font:700 var(--text-lg) var(--mono)}header p:last-child{max-width:760px;margin-top:7px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .report-controls{display:flex;flex-wrap:wrap;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md)}.report-controls legend{padding:0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}.report-controls label{min-width:min(220px,100%)}
  .source-state,.scope{padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font-size:var(--text-sm);line-height:1.5}.source-state{color:var(--muted)}.source-state.unavailable{border-color:var(--muted);border-style:dotted;color:var(--muted)}
  .metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.metric-grid article{display:grid;min-width:0;gap:4px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.metric-grid article.attention{border-color:rgb(var(--amber-rgb) / .45)}.metric-grid strong{font:750 var(--text-xl) var(--mono)}.metric-grid span{font:700 var(--text-xs) var(--mono)}.metric-grid small{color:var(--muted);font-size:var(--text-2xs);line-height:1.4;overflow-wrap:anywhere}
  details{border-top:1px solid var(--border);padding-top:11px}summary{cursor:pointer;font:650 var(--text-xs) var(--mono)}.exact-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:12px}.exact-grid h3{margin:0 0 7px;font:700 var(--text-sm) var(--mono)}dl{display:grid;gap:5px;margin:0}dl div{display:flex;justify-content:space-between;gap:10px;padding-bottom:4px;border-bottom:1px dotted var(--border);font-size:var(--text-xs)}dt{overflow-wrap:anywhere}dd{margin:0;font:700 var(--text-xs) var(--mono)}.omissions,.limitations,.message{margin-top:10px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.limitations{padding-left:20px}.message{color:var(--accent)}
  @media(max-width:850px){.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:560px){header,.report-controls,.exact-grid{display:grid}.metric-grid{grid-template-columns:1fr}header button,.report-controls select{width:100%}}
</style>

<script lang="ts">
  import {
    nextBulkReviewIndex,
    type BulkReviewCockpitRow,
  } from '$lib/analysis/bulk-review-cockpit.ts';
  import type { BulkRetryPlan } from '$lib/analysis/bulk-retry-plan.ts';

  let {
    rows,
    retryPlan,
    retryStatus,
    setReviewState,
    toggleSaved,
    trackCase,
    caseOptions,
    setDisposition,
    watchlistName,
    setWatchlistName,
    saveToWatchlist,
    actionStatus,
    inspectDomain,
    executeRetry,
  }: {
    rows: BulkReviewCockpitRow[];
    retryPlan: BulkRetryPlan;
    retryStatus: string;
    setReviewState: (resultIndex: number, state: string) => void;
    toggleSaved: (resultIndex: number) => void;
    trackCase: (resultIndex: number) => void | Promise<void>;
    caseOptions: readonly { value: string; label: string }[];
    setDisposition: (resultIndex: number, value: string) => void | Promise<void>;
    watchlistName: string;
    setWatchlistName: (value: string) => void;
    saveToWatchlist: (resultIndex: number) => void | Promise<void>;
    actionStatus: string;
    inspectDomain: (resultIndex: number) => void | Promise<void>;
    executeRetry: () => void | Promise<void>;
  } = $props();

  let enabled = $state(false);
  let cursor = $state(0);
  const current = $derived(rows[cursor] ?? null);
  const unresolved = $derived(rows.filter((row) => row.reviewState !== 'reviewed' && row.reviewState !== 'deferred').length);

  $effect(() => {
    if (!rows.length) cursor = 0;
    else if (cursor >= rows.length) cursor = rows.length - 1;
  });

  function move(direction: -1 | 1): void {
    const next = nextBulkReviewIndex(rows, cursor, direction);
    if (next >= 0) cursor = next;
  }

  function editableTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement
      && (target.matches('input, select, textarea, button, a') || target.isContentEditable);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!enabled || !event.altKey || editableTarget(event.target) || !current) return;
    if (event.key === 'ArrowRight') move(1);
    else if (event.key === 'ArrowLeft') move(-1);
    else if (event.key.toLowerCase() === 'r') setReviewState(current.resultIndex, 'reviewed');
    else if (event.key.toLowerCase() === 'd') setReviewState(current.resultIndex, 'deferred');
    else if (event.key.toLowerCase() === 's') toggleSaved(current.resultIndex);
    else if (event.key.toLowerCase() === 'i') void inspectDomain(current.resultIndex);
    else return;
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="cockpit card" aria-labelledby="review-cockpit-title">
  <header>
    <div>
      <p class="eyebrow">Focused review</p>
      <h2 id="review-cockpit-title">Bulk review cockpit</h2>
      <p>Review one filtered domain at a time while the full list remains available in this scan. Nothing advances or changes state automatically.</p>
    </div>
    <button class="btn" class:active={enabled} type="button" aria-pressed={enabled} onclick={() => enabled = !enabled}>{enabled ? 'Disable shortcuts' : 'Enable shortcuts'}</button>
  </header>

  {#if current}
    <div class="review-progress"><strong>{cursor + 1} of {rows.length}</strong><span>{unresolved} unresolved</span></div>
    <article class="current">
      <div class="identity">
        <div><small>Current domain</small><h3>{current.domain}</h3></div>
        <span class={`review-state state-${current.reviewState}`}>{current.reviewState}</span>
      </div>
      <dl>
        <div><dt>Registration</dt><dd>{current.availability} · {current.confidence} confidence</dd></div>
        <div><dt>Risk / opportunity</dt><dd>{current.risk ?? '—'} / {current.opportunity ?? '—'}</dd></div>
        <div><dt>Website</dt><dd>{current.activity}</dd></div>
        <div><dt>Registrar</dt><dd>{current.registrar}</dd></div>
        <div><dt>Source coverage</dt><dd>{current.sourceCoverage.map((item) => `${item.source}: ${item.state}`).join(' · ') || 'Not recorded'}</dd></div>
        {#if current.error}<div><dt>Collection error</dt><dd class="error">{current.error}</dd></div>{/if}
      </dl>
      <div class="navigation">
        <button class="btn" type="button" aria-keyshortcuts="Alt+ArrowLeft" onclick={() => move(-1)}>Previous unresolved</button>
        <button class="btn" type="button" aria-keyshortcuts="Alt+ArrowRight" onclick={() => move(1)}>Next unresolved</button>
      </div>
      <div class="actions">
        <button class="btn" type="button" onclick={() => setReviewState(current.resultIndex, 'reviewing')}>Mark reviewing</button>
        <button class="btn" type="button" aria-keyshortcuts="Alt+R" onclick={() => setReviewState(current.resultIndex, 'reviewed')}>Mark reviewed</button>
        <button class="btn" type="button" aria-keyshortcuts="Alt+D" onclick={() => setReviewState(current.resultIndex, 'deferred')}>Defer</button>
        <button class="btn" type="button" aria-keyshortcuts="Alt+S" aria-pressed={current.shortlisted} onclick={() => toggleSaved(current.resultIndex)}>{current.shortlisted ? 'Remove shortlist' : 'Shortlist'}</button>
        {#if current.caseRecord}<a class="btn" href={`/monitor?case=${encodeURIComponent(current.caseRecord.id)}`}>Open case</a>{:else}<button class="btn" type="button" onclick={() => trackCase(current.resultIndex)}>Create case</button>{/if}
        <button class="btn accent" type="button" aria-keyshortcuts="Alt+I" onclick={() => inspectDomain(current.resultIndex)}>Inspect in Lookup</button>
      </div>
      <div class="handoffs">
        <label>
          <span>Case disposition</span>
          <select
            aria-label="Case disposition"
            disabled={!current.caseRecord}
            value={current.caseRecord?.disposition ?? ''}
            onchange={(event) => setDisposition(current.resultIndex, event.currentTarget.value)}
          >
            {#if !current.caseRecord}<option value="">Create a case first</option>{/if}
            {#each caseOptions as option}<option value={option.value}>{option.label}</option>{/each}
          </select>
          <small>{current.caseRecord ? 'Updates this existing case only.' : 'Create a case before recording a disposition.'}</small>
        </label>
        <label>
          <span>Monitor list</span>
          <input
            aria-label="Current row monitor list"
            maxlength="100"
            placeholder="Focused review"
            value={watchlistName}
            oninput={(event) => setWatchlistName(event.currentTarget.value)}
          >
          <small>Saves only the current settled row. No scan is started.</small>
        </label>
        <button class="btn" type="button" disabled={!watchlistName.trim() || Boolean(current.trusted)} onclick={() => saveToWatchlist(current.resultIndex)}>
          Save current to Monitor
        </button>
      </div>
      {#if current.trusted}<p class="action-note">Domains trusted by the active Brand Profile are excluded from watchlists.</p>{/if}
      {#if actionStatus}<p class="action-status" role="status" aria-live="polite">{actionStatus}</p>{/if}
      {#if enabled}<p class="shortcut-note">Shortcuts: Alt + ←/→ moves between unresolved rows, Alt + R reviews, Alt + D defers, Alt + S toggles shortlist, and Alt + I opens Lookup. Shortcuts are ignored while editing controls.</p>{/if}
    </article>
  {:else}
    <p class="empty">No result matches the current view.</p>
  {/if}

  <div class="freshness" data-state={retryPlan.freshness.state}>
    <span>Evidence freshness</span>
    <strong>{retryPlan.freshness.state}</strong>
    <small>{retryPlan.freshness.observedAt
      ? `Observed ${retryPlan.freshness.ageDays} day${retryPlan.freshness.ageDays === 1 ? '' : 's'} ago`
      : 'No reliable observation timestamp is recorded'}</small>
  </div>

  {#if retryPlan.rows.length}
    <details class="retry-plan">
      <summary>Review retry plan · {retryPlan.lookupRequests} lookup{retryPlan.lookupRequests === 1 ? '' : 's'}</summary>
      <p>This repeats the <strong>{retryPlan.mode}</strong> profile for the incomplete or failed rows in the current explicit selection, or the filtered view when nothing is selected.</p>
      <dl>
        <div><dt>Upstream destinations</dt><dd>{retryPlan.destinations.join(', ')}</dd></div>
        <div><dt>Targets</dt><dd>{retryPlan.rows.map((row) => row.domain).join(', ')}</dd></div>
      </dl>
      <ul>{#each retryPlan.limitations as limitation}<li>{limitation}</li>{/each}</ul>
      {#if retryPlan.capped}<p class="warning">The plan is capped at the first {retryPlan.rows.length} eligible rows.</p>{/if}
      <button class="btn" type="button" onclick={executeRetry}>Run reviewed retry</button>
    </details>
  {/if}
  {#if retryStatus}<p class="retry-status" role="status">{retryStatus}</p>{/if}
</section>

<style>
  .cockpit{margin:16px 0;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  h2,p{margin:0}h2{margin-top:4px;font:700 var(--text-lg) var(--mono)}
  header p:not(.eyebrow){max-width:720px;margin-top:7px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  header .active{border-color:var(--accent);color:var(--accent)}
  .review-progress{display:flex;gap:9px;margin-top:14px;color:var(--muted);font:var(--text-xs) var(--mono)}
  .review-progress strong{color:var(--accent)}
  .current{margin-top:8px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .identity{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .identity small{color:var(--muted);font:var(--text-2xs) var(--mono);text-transform:uppercase}
  h3{margin:3px 0 0;font:700 var(--text-lg) var(--mono);overflow-wrap:anywhere}
  .review-state{padding:4px 7px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .state-reviewed{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));color:var(--accent)}
  .state-reviewing{border-color:color-mix(in srgb,var(--amber) 45%,var(--border));color:var(--amber)}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:13px 0 0}
  dl div{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  dt{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  dd{margin:3px 0 0;font-size:var(--text-xs);line-height:1.45;overflow-wrap:anywhere}
  dd.error{color:var(--danger)}
  .navigation,.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}
  .actions .accent{border-color:color-mix(in srgb,var(--accent) 50%,var(--border));color:var(--accent)}
  .handoffs{display:grid;grid-template-columns:minmax(180px,.75fr) minmax(220px,1fr) auto;gap:8px;align-items:end;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
  .handoffs label{display:grid;gap:5px;min-width:0}
  .handoffs label>span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .handoffs input,.handoffs select{width:100%;min-height:38px}
  .handoffs small{color:var(--muted);font-size:var(--text-2xs);line-height:1.35}
  .handoffs>.btn{min-height:38px}
  .shortcut-note,.action-note,.action-status,.empty,.retry-plan p,.retry-plan li,.retry-status{color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .action-note,.action-status{margin-top:8px}
  .action-status{color:var(--accent)}
  .shortcut-note{margin-top:10px}
  .freshness{display:flex;align-items:center;gap:8px;margin-top:12px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);font:var(--text-2xs) var(--mono)}
  .freshness span,.freshness small{color:var(--muted)}
  .freshness strong{color:var(--accent);text-transform:capitalize}
  .freshness[data-state="stale"] strong{color:var(--amber)}
  .freshness small{margin-left:auto;text-align:right}
  .retry-plan{margin-top:12px;border-top:1px solid var(--border)}
  .retry-plan>summary{padding:11px 0;color:var(--accent);font:700 var(--text-xs) var(--mono);cursor:pointer}
  .retry-plan>summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .retry-plan dl{margin:9px 0}
  .retry-plan ul{margin:8px 0;padding-left:18px}
  .retry-plan .warning{color:var(--amber)}
  .retry-status{margin-top:9px;color:var(--accent)}
  @media(max-width:700px){
    header{align-items:stretch;flex-direction:column}
    dl{grid-template-columns:1fr}
    .navigation,.actions{display:grid;grid-template-columns:1fr}
    .navigation>*,.actions>*{width:100%}
    .handoffs{grid-template-columns:1fr}
    .handoffs>.btn{width:100%}
    .freshness{align-items:flex-start;flex-wrap:wrap}
    .freshness small{width:100%;margin-left:0;text-align:left}
  }
</style>

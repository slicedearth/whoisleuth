<script lang="ts">
  import { describeBulkSourceCoverage } from '$lib/analysis/bulk-source-coverage.ts';
  import { officialRegistryLookupFor } from '$lib/analysis/registry-support.ts';
  import BulkRiskSummary from '$lib/components/BulkRiskSummary.svelte';
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
    profileContextLoading,
    shortlistAvailable = true,
    caseAvailable = true,
    reviewAvailable = true,
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
    profileContextLoading: boolean;
    shortlistAvailable?: boolean;
    caseAvailable?: boolean;
    reviewAvailable?: boolean;
  } = $props();

  let enabled = $state(false);
  let cursor = $state(0);
  const current = $derived(rows[cursor] ?? null);
  const officialLookupUrl = $derived(current ? officialRegistryLookupFor(current.domain) : null);
  const unresolved = $derived(reviewAvailable?rows.filter((row) => row.reviewState !== 'reviewed' && row.reviewState !== 'deferred').length:0);

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
    else if (event.key.toLowerCase() === 'r' && reviewAvailable) setReviewState(current.resultIndex, 'reviewed');
    else if (event.key.toLowerCase() === 'd' && reviewAvailable) setReviewState(current.resultIndex, 'deferred');
    else if (event.key.toLowerCase() === 's' && shortlistAvailable) toggleSaved(current.resultIndex);
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
    <div class="review-progress"><strong>{cursor + 1} of {rows.length}</strong><span>{reviewAvailable ? `${unresolved} unresolved` : 'Review state unavailable'}</span></div>
    {#if !shortlistAvailable || !caseAvailable || !reviewAvailable}<p class="source-warning">Some browser-local actions are unavailable. Review, shortlist, and Case controls are disabled independently while result inspection remains available.</p>{/if}
    <article class="current">
      <div class="identity">
        <div><small>Current domain</small><h3>{current.domain}</h3></div>
        {#if reviewAvailable}<span class={`review-state state-${current.reviewState}`}>{current.reviewState}</span>{:else}<span class="review-state state-unavailable">Review unavailable</span>{/if}
      </div>
      <dl>
        <div><dt>Registration</dt><dd>{current.availability} · {current.confidence} confidence</dd></div>
        <div><dt>Risk triage</dt><dd><BulkRiskSummary risk={current.riskPresentation} domain={current.domain} />{#if !current.profileContextReady}<small class="profile-limitation">Brand Profile context unevaluated. {current.profileContextLimitation}</small>{/if}</dd></div>
        <div><dt>Website</dt><dd>{current.activity}</dd></div>
        <div><dt>Registrar</dt><dd>{current.registrar}</dd></div>
        <div><dt>Source coverage</dt><dd>{current.sourceCoverage.map((item) => describeBulkSourceCoverage(current.domain, item)).join(' · ') || 'Not recorded'}</dd></div>
        {#if current.error}<div><dt>Collection error</dt><dd class="error">{current.error}</dd></div>{/if}
      </dl>
      {#if officialLookupUrl}
        <div class="manual-lookup">
          <a class="btn" href={officialLookupUrl} target="_blank" rel="noopener noreferrer">Open official registry lookup<span class="sr-only"> (opens in a new tab)</span></a>
          <span>The domain is not added to this link. Enter it on the registry site if you choose to continue.</span>
        </div>
      {/if}
      <div class="navigation">
        <button class="btn" type="button" aria-keyshortcuts="Alt+ArrowLeft" onclick={() => move(-1)}>Previous unresolved</button>
        <button class="btn" type="button" aria-keyshortcuts="Alt+ArrowRight" onclick={() => move(1)}>Next unresolved</button>
      </div>
      <div class="actions">
        <button class="btn" type="button" disabled={!reviewAvailable} onclick={() => setReviewState(current.resultIndex, 'reviewing')}>Mark reviewing</button>
        <button class="btn" type="button" disabled={!reviewAvailable} aria-keyshortcuts="Alt+R" onclick={() => setReviewState(current.resultIndex, 'reviewed')}>Mark reviewed</button>
        <button class="btn" type="button" disabled={!reviewAvailable} aria-keyshortcuts="Alt+D" onclick={() => setReviewState(current.resultIndex, 'deferred')}>Defer</button>
        <button class="btn" type="button" disabled={!shortlistAvailable} aria-keyshortcuts="Alt+S" aria-pressed={shortlistAvailable?current.shortlisted:undefined} onclick={() => toggleSaved(current.resultIndex)}>{shortlistAvailable?(current.shortlisted?'Remove shortlist':'Shortlist'):'Shortlist unavailable'}</button>
        {#if !caseAvailable}<span class="unavailable-action">Case unavailable</span>{:else if current.caseRecord}<a class="btn" href={`/monitor?case=${encodeURIComponent(current.caseRecord.id)}`}>Open case</a>{:else}<button class="btn" type="button" onclick={() => trackCase(current.resultIndex)}>Create case</button>{/if}
        <button class="btn accent" type="button" aria-keyshortcuts="Alt+I" onclick={() => inspectDomain(current.resultIndex)}>Inspect in Lookup</button>
      </div>
      <div class="handoffs">
        <label>
          <span>Case disposition</span>
          <select
            aria-label="Case disposition"
            disabled={!current.caseRecord || !caseAvailable}
            value={current.caseRecord?.disposition ?? ''}
            onchange={(event) => setDisposition(current.resultIndex, event.currentTarget.value)}
          >
            {#if !caseAvailable}<option value="">Case evidence unavailable</option>{:else if !current.caseRecord}<option value="">Create a case first</option>{/if}
            {#each caseOptions as option}<option value={option.value}>{option.label}</option>{/each}
          </select>
          <small>{!caseAvailable?'No absent Case state is inferred while the collection is unreadable.':current.caseRecord?'Updates this existing case only.':'Create a case before recording a disposition.'}</small>
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
        <button class="btn" type="button" disabled={!watchlistName.trim() || !current.profileContextReady || Boolean(current.trusted)} onclick={() => saveToWatchlist(current.resultIndex)}>
          Save current to Monitor
        </button>
      </div>
      {#if current.trusted}<p class="action-note">Domains trusted by the active Brand Profile are excluded from watchlists.</p>{:else if !current.profileContextReady}<p class="action-note">Monitor actions remain unavailable because Brand Profile trust and allowlist context is inconclusive.</p>{/if}
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
      <button class="btn" type="button" disabled={profileContextLoading} onclick={executeRetry}>Run reviewed retry</button>
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
  .state-reviewed{border-color:color-mix(in srgb,var(--success) 45%,var(--border));color:var(--success)}
  .state-reviewing{border-color:color-mix(in srgb,var(--amber) 45%,var(--border));color:var(--amber)}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:13px 0 0}
  dl div{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  dt{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  dd{margin:3px 0 0;font-size:var(--text-xs);line-height:1.45;overflow-wrap:anywhere}
  .profile-limitation{display:block;margin-top:4px;color:var(--amber);font-weight:400}
  dd.error{color:var(--danger)}
  .manual-lookup{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-top:11px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.manual-lookup>span{flex:1 1 260px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.manual-lookup .btn{flex:0 0 auto;text-decoration:none}.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
  .navigation,.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}
  .actions .accent{border-color:color-mix(in srgb,var(--accent) 50%,var(--border));color:var(--accent)}
  .unavailable-action{display:inline-flex;align-items:center;min-height:38px;padding:6px 10px;border:1px dotted var(--muted);border-radius:var(--radius-sm);color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .handoffs{display:grid;grid-template-columns:minmax(180px,.75fr) minmax(220px,1fr) auto;gap:8px;align-items:end;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
  .handoffs label{display:grid;gap:5px;min-width:0}
  .handoffs label>span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .handoffs input,.handoffs select{width:100%;min-height:38px}
  .handoffs small{color:var(--muted);font-size:var(--text-2xs);line-height:1.35}
  .handoffs>.btn{min-height:38px}
  .shortcut-note,.action-note,.action-status,.source-warning,.empty,.retry-plan p,.retry-plan li,.retry-status{color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .source-warning{padding:9px 11px;border:1px dotted var(--muted);border-radius:var(--radius-sm)}
  .action-note,.action-status{margin-top:8px}
  .action-status{color:var(--accent)}
  .shortcut-note{margin-top:10px}
  .freshness{display:flex;align-items:center;gap:8px;margin-top:12px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);font:var(--text-2xs) var(--mono)}
  .freshness span,.freshness small{color:var(--muted)}
  .freshness strong{color:var(--text);text-transform:capitalize}
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

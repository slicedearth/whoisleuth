<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import AnalystWorkbench from './AnalystWorkbench.svelte';
  import BrandCandidateEvidence from './BrandCandidateEvidence.svelte';
  import Pagination from './Pagination.svelte';
  import CopyButton from './CopyButton.svelte';
  import { createDraftRevision, restoreSubmittedFocus } from '#lib/controllers/submitted-draft.ts';
  import DomainFeedCandidateIntake from './DomainFeedCandidateIntake.svelte';
  import BrandKeywordCampaigns from './BrandKeywordCampaigns.svelte';
  import { keywordCampaignDefaultPriority } from '../../../../packages/workspace/brand-keyword-campaign.mts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { loadWatchlists, addCandidateWatchlist, type Watchlists } from '#lib/watchlists.ts';
  import { loadAnalystReviewState } from '#lib/analyst-review-state.ts';
  import {
    saveBrandCandidateDecision,
    saveBrandCandidateException,
    type BrandProfile,
  } from '#lib/brand-profiles.ts';
  import { setShortlistSelection } from '#lib/shortlist.ts';
  import {
    emptyAnalystReviewStateStore,
    type AnalystReviewStateStore,
  } from '#lib/analysis/analyst-review-state.ts';
  import { projectBrandCandidateReview } from '../../../../packages/monitoring/brand-candidate-review.mts';
  import {
    candidateMaterialFingerprint,
    MAX_CANDIDATE_TEXT,
    WATCH_PRIORITIES,
    type WatchPriority,
  } from '../../../../packages/workspace/brand-candidate-workflow.mts';
  import {
    planCandidateWatchHandoff,
    type CandidateWatchPlan,
  } from '../../../../packages/workspace/candidate-watch-handoff.mts';
  import { subscribeBrowserLocalData } from '#lib/browser-local-data-service.ts';
  import { failedLocalMutationOutcome } from '#lib/local-mutation-outcome.ts';

  let {
    active,
    onrefresh,
    disabled = false,
  }: { active: BrandProfile; onrefresh: () => Promise<unknown>; disabled?: boolean } = $props();
  let watchlists = $state<Watchlists>({}),
    reviewState = $state<AnalystReviewStateStore>(emptyAnalystReviewStateStore());
  let ready = $state(false),
    busy = $state(false),
    message = $state('');
  let commitUncertain = $state(false);
  let selected = $state<Set<string>>(new Set()),
    filter = $state('all'),
    name = $state(''),
    reason = $state(''),
    priority = $state<WatchPriority>('unassigned');
  let reviewDate = $state(''),
    preview = $state<CandidateWatchPlan | null>(null),
    exceptionDomain = $state(''),
    exceptionRule = $state(''),
    exceptionPurpose = $state<'irrelevant_match' | 'deferred_review' | 'accepted_temporary_change'>(
      'irrelevant_match',
    );
  let replaceExistingContext = $state(false);
  let priorityEdited = $state(false);
  let now = $state(new Date().toISOString());
  let actionStatus = $state<HTMLParagraphElement>();
  let reasonInput: HTMLTextAreaElement;
  let reasonSource = $state('');
  let inspected = $state<string | null>(null), search = $state(''), sort = $state('retained'), page = $state(1);
  let alive = true, readGeneration = 0;
  const lifetime = createDraftRevision(() => active.id);
  function ownsCompletion() { const unchanged = lifetime.capture(); return () => alive && unchanged(); }
  onDestroy(() => { alive = false; lifetime.changed(); readGeneration++; });
  const rows = $derived(projectBrandCandidateReview(active, watchlists, reviewState, now));
  const visible = $derived.by(() => {
    const matching = rows.filter(row => (filter === 'all' || row.status === filter)
      && row.candidate.domain.includes(search.trim().toLowerCase()));
    return sort === 'domain' ? [...matching].sort((a, b) => a.candidate.domain < b.candidate.domain ? -1 : a.candidate.domain > b.candidate.domain ? 1 : 0) : matching;
  });
  const pageCount = $derived(Math.max(1, Math.ceil(visible.length / 25)));
  const currentPage = $derived(Math.min(page, pageCount));
  const pageRows = $derived(visible.slice((currentPage - 1) * 25, currentPage * 25));
  const inspectedRow = $derived(rows.find(row => row.candidate.domain === inspected) ?? null);
  $effect(() => { if (inspected && !inspectedRow) inspected = null; });
  const chosen = $derived(rows.filter((row) => selected.has(row.candidate.domain)));
  const reasonSources = $derived(rows.filter(row => row.lifecycle.decision !== null));
  const reasonSourceRow = $derived(reasonSources.find(row => row.item.subjectKey === reasonSource));
  const campaignDefault = $derived(keywordCampaignDefaultPriority(chosen.map(row => row.candidate), active.id, active.keywordCampaigns ?? []));
  $effect(() => { if (!priorityEdited) priority = campaignDefault ?? 'unassigned'; });
  const exceptionRow = $derived(rows.find((row) => row.candidate.domain === exceptionDomain));
  const input = $derived({
    name,
    candidates: chosen.map((row) => row.candidate),
    brandProfileId: active.id,
    priority,
    reason,
    reviewDueAt: reviewDate ? `${reviewDate}T00:00:00Z` : null,
    replaceExistingContext,
  });
  const groups = $derived(
    [...new Set(visible.flatMap((row) => row.matches.map((match) => match.ruleKey)))].slice(0, 200),
  );
  async function refresh() {
    const current = ownsCompletion(), request = ++readGeneration;
    try {
      const loaded = await Promise.all([loadWatchlists(), loadAnalystReviewState()]);
      if (!current() || request !== readGeneration) return;
      [watchlists, reviewState] = loaded;
      ready = !commitUncertain;
    } catch (cause) {
      if (!current() || request !== readGeneration) return;
      ready = false;
      message =
        cause instanceof Error
          ? cause.message
          : 'Candidate review context could not be read. No empty state is inferred.';
    }
  }
  onMount(() => {
    const clock = setInterval(() => {
      now = new Date().toISOString();
    }, 60_000);
    const watch = subscribeBrowserLocalData('watchlists', () => void refresh()),
      review = subscribeBrowserLocalData('analyst_review_state', () => void refresh());
    return () => {
      watch();
      review();
      clearInterval(clock);
    };
  });
  let openedProfile = $state('');
  $effect(() => {
    if (openedProfile !== active.id) {
      if (openedProfile) lifetime.changed();
      openedProfile = active.id;
      inspected = null;
      search = '';
      filter = 'all';
      page = 1;
      name = '';
      busy = false;
      message = '';
      selected = new Set();
      preview = null;
      exceptionDomain = '';
      exceptionRule = '';
      reason = '';
      reasonSource = '';
      reviewDate = '';
      priorityEdited = false;
      priority = 'unassigned';
      ready = false;
      void refresh();
    }
  });
  function toggle(domain: string, checked: boolean) {
    const next = new Set(selected);
    checked ? next.add(domain) : next.delete(domain);
    selected = next;
    preview = null;
  }
  function reuseReason() {
    const text = reasonSourceRow?.lifecycle.decision?.rationale;
    if (busy || disabled || !ready || !chosen.length || !text || text.length > MAX_CANDIDATE_TEXT) return;
    reason = text;
    message = 'Earlier wording copied into the editable reason. No decision was saved.';
    reasonInput.focus();
  }
  function showPreview() {
    preview = null;
    try {
      preview = planCandidateWatchHandoff(watchlists, input);
      message = '';
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not preview the selected domains.';
    }
  }
  $effect(() => {
    if (!preview) return;
    try {
      if (JSON.stringify(planCandidateWatchHandoff(watchlists, input)) !== JSON.stringify(preview)) {
        preview = null;
        message = 'The selection, reason, review date or destination changed. Preview it again before adding.';
      }
    } catch (cause) {
      preview = null;
      message = cause instanceof Error ? cause.message : 'The handoff draft is invalid. Correct it and preview again; nothing was written.';
    }
  });
  async function addToWatch() {
    if (!preview || busy || disabled || !ready) return;
    const current = ownsCompletion();
    try {
      const submitted = input,
        reviewed = preview,
        profileId = active.id;
      if (JSON.stringify(planCandidateWatchHandoff(watchlists, submitted)) !== JSON.stringify(reviewed)) {
        preview = null;
        message = 'The selection or destination changed. Preview it again before adding; nothing was written.';
        return;
      }
      busy = true;
      const result = await addCandidateWatchlist(submitted, reviewed);
      if (!current() || active.id !== profileId) return;
      message = `${result.rows.filter((row) => row.state !== 'rejected').length} domains retained in ${result.destination}; ${result.rows.filter((row) => row.state === 'rejected').length} rejected. No collection or schedule was enabled.`;
      preview = null;
      await refresh();
    } catch (cause) {
      if (!current()) return;
      preview = null;
      message =
        cause instanceof Error
          ? cause.message
          : 'Watchlist handoff failed; the selection remains available.';
    } finally {
      if (current()) busy = false;
    }
  }
  async function review(disposition: 'suppressed' | 'expected') {
    if (busy || disabled || !ready || !chosen.length) return;
    if (!reason.trim() || !reviewDate) {
      message = 'A reason and future review/expiry date are required.';
      return;
    }
    const submitted = [...chosen],
      profileId = active.id,
      rationale = reason,
      expiresAt = new Date(`${reviewDate}T00:00:00Z`).toISOString();
    busy = true;
    const current = ownsCompletion();
    let committed = 0;
    try {
      for (const row of submitted) {
        if (!current()) return;
        await saveBrandCandidateDecision(profileId, row.item, {
          disposition,
          rationale,
          expiresAt,
          reviewDueAt: disposition === 'expected' ? expiresAt : null,
        });
        committed++;
      }
      if (!current() || active.id !== profileId) return;
      message = `${committed} exact Brand candidate decisions recorded. Expiry or changed material provenance returns them to review.`;
      await refresh();
    } catch (cause) {
      if (!current()) return;
      const unknown = failedLocalMutationOutcome(cause) === 'unknown';
      const unattempted = submitted.length - committed - 1;
      if (unknown) { commitUncertain = true; ready = false; }
      message = `${committed} ${committed === 1 ? 'decision' : 'decisions'} confirmed saved; ${unknown ? '1 decision may have been saved' : '1 decision was not saved'}; ${unattempted} ${unattempted === 1 ? 'candidate was' : 'candidates were'} not attempted. ${unknown
        ? 'Reload and review the saved decisions before making another change. Your current selection and reason remain here until you reload.'
        : cause instanceof Error ? cause.message : 'Review save failed.'}`;
    } finally {
      if (current()) busy = false;
    }
  }
  async function shortlist() {
    if (!chosen.length || busy || disabled || !ready) return;
    busy = true;
    const current = ownsCompletion();
    try {
      const result = await setShortlistSelection(
        chosen.map((row) => ({ domain: row.candidate.domain })),
        true,
        'retain',
      );
      if (!current()) return;
      message = `${result.added} domains added to Shortlist; ${result.retained} already present and unchanged; ${result.skipped} skipped. New candidates have unknown availability and no score.`;
    } catch (cause) {
      if (!current()) return;
      message = cause instanceof Error ? cause.message : 'Could not shortlist the selection.';
    } finally {
      if (current()) busy = false;
    }
  }
  async function saveException(enabled = true, existingId = '') {
    if (!exceptionRow || !exceptionRule || busy || disabled || !ready) return;
    const current = ownsCompletion();
    const origin = document.activeElement;
    const existing = existingId
      ? active.candidateExceptions.find((value) => value.id === existingId)
      : null;
    const reviewedAt = new Date().toISOString(),
      expiresAt = reviewDate ? `${reviewDate}T00:00:00Z` : '',
      profileId = active.id;
    busy = true;
    try {
      await saveBrandCandidateException(
        profileId,
        {
          id: existing?.id ?? crypto.randomUUID(),
          domain: exceptionRow.candidate.domain,
          ruleKey: exceptionRule,
          purpose: existing?.purpose ?? exceptionPurpose,
          reason: reason.trim() || existing?.reason || '',
          reviewedAt,
          expiresAt: expiresAt || existing?.expiresAt || '',
          reviewedFingerprint: candidateMaterialFingerprint(
            exceptionRow.candidate,
            profileId,
            exceptionRule,
          ),
          enabled,
        },
        existing?.revision ?? null,
      );
      if (!current() || active.id !== profileId) return;
      message = enabled
        ? 'The exact Brand/domain/rule exception was recorded; observations and monitored changes remain visible.'
        : 'Exception disabled. Its prior rationale and revision remain retained.';
      try {
        await onrefresh();
      } catch {
        if (!current()) return;
        message +=
          ' The write committed, but refreshing the visible Brand failed. Reload before another edit.';
      }
    } catch (cause) {
      if (!current()) return;
      message = cause instanceof Error ? cause.message : 'Could not save the scoped exception.';
    } finally {
      if (current()) busy = false;
      if (current() && active.id === profileId) {
        now = new Date().toISOString();
        await tick();
        if (current()) restoreSubmittedFocus(origin, actionStatus, actionStatus?.closest('#brand-candidate-review'));
      }
    }
  }
</script>

<section
  class="card candidate-review"
  id="brand-candidate-review"
  aria-labelledby="candidate-review-title"
>
  <h2 id="candidate-review-title">Candidate review for {active.name}</h2>
  <p>Inspect a nomination, then select the domains you want to review or monitor.</p>
  {#if message}<p bind:this={actionStatus} tabindex="-1" role="status" aria-label="Candidate review action status" aria-live="polite">{message}</p>{/if}
  {#if disabled}<p>The saved Brand context is being reconciled or is unavailable. This last-readable review and its drafts remain visible; mutations are disabled.</p>{/if}
  {#if commitUncertain}<button class="btn" onclick={() => window.location.reload()}>Reload saved decisions</button>
  {:else if !ready}<p
      >Saved watch and review context is unavailable or loading. Mutations remain disabled.</p
    >{/if}
  <BrandKeywordCampaigns {active} {onrefresh} disabled={disabled || busy || commitUncertain} />
  <DomainFeedCandidateIntake {active} {onrefresh} disabled={disabled || !ready || busy} />
  {#if !rows.length}<p
      >No candidate provenance retained. In Discover, explicitly select domains and choose “Retain
      selected for Brand review”, or import a supported Brand Profile export.</p
    ><a href="/discover">Open Discover</a>{/if}
  <AnalystWorkbench label="Brand candidate review" selected={inspected} detailTitle={inspectedRow?.candidate.domain ?? ''} onclose={() => inspected = null}>
    {#snippet queue()}
      <div class="queue-controls">
        <label>Candidate search<input type="search" bind:value={search} oninput={() => page = 1} maxlength="253" placeholder="Filter retained domains" /></label>
        <label>Candidate filter<select bind:value={filter} onchange={() => page = 1}><option value="all">All retained candidates</option><option value="new">New / needs review</option><option value="already_tracked">Already tracked for this Brand</option><option value="deferred">Deferred or dismissed until review</option><option value="excluded">Excluded exact matches</option></select></label>
        <label>Candidate order<select bind:value={sort} onchange={() => page = 1}><option value="retained">Retained order</option><option value="domain">Domain name</option></select></label>
      </div>
      <p>{visible.length} shown · {rows.length} retained · {chosen.length} selected across all filters.</p>
      <div class="candidate-queue">
        {#each pageRows as row (row.candidate.domain)}
          <article class:inspected={inspected === row.candidate.domain}>
            <label><input type="checkbox" checked={selected.has(row.candidate.domain)} onchange={(event) => toggle(row.candidate.domain, event.currentTarget.checked)} disabled={busy || disabled || !ready} /> <strong>{row.candidate.domain}</strong></label>
            <span>{row.status.replaceAll('_', ' ')}</span>
            <button class="btn small" type="button" aria-label={`Inspect ${row.candidate.domain}`} aria-pressed={inspected === row.candidate.domain} aria-keyshortcuts="P" onclick={() => inspected = row.candidate.domain} onkeydown={(event) => { if (event.key.toLowerCase() === 'p' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); inspected = row.candidate.domain; } }}>Inspect</button>
          </article>
        {/each}
      </div>
      {#if rows.length && !visible.length}<p>No retained candidate matches these filters.</p>{/if}
      <Pagination {currentPage} {pageCount} setPage={(value) => page = value} ariaLabel="Candidate pages" pageInputLabel="Candidate page" />
    {/snippet}
    {#snippet children()}
      {#if inspectedRow}
        <CopyButton value={inspectedRow.candidate.domain} label="Copy domain" />
        <h4>Review context</h4>
        <p>{inspectedRow.lifecycle.reason}</p>
        {#if inspectedRow.trackedIn.length}<p>Tracked for this Brand in: {inspectedRow.trackedIn.join(', ')}.</p>{/if}
        {#if inspectedRow.declaration}<p>{inspectedRow.declaration}; not a safety verdict.</p>{/if}
        <h4>Next step</h4>
        <p>Use the selection below to shortlist, record a review decision or preview a Watchlist handoff. Inspection makes no target request.</p>
        <button class="btn" type="button" onclick={() => inspectedRow && toggle(inspectedRow.candidate.domain, !selected.has(inspectedRow.candidate.domain))} disabled={busy || disabled || !ready}>{selected.has(inspectedRow.candidate.domain) ? 'Remove inspected domain from selection' : 'Select inspected domain for review'}</button>
        <p>{chosen.length} selected. The action form applies to that exact selection, not whichever item is open.</p>
      {/if}
    {/snippet}
    {#snippet inspector()}{#if inspectedRow}<BrandCandidateEvidence row={inspectedRow} />{/if}{/snippet}
  </AnalystWorkbench>
  {#if groups.length}<details
      ><summary>Explainable pattern groups ({groups.length})</summary
      >{#each groups as key}{@const contributors = visible.filter((row) =>
          row.matches.some((match) => match.ruleKey === key),
        )}<details
          ><summary
            >{contributors.length} contributing domains · {contributors[0]?.matches.find(
              (match) => match.ruleKey === key,
            )?.reason}</summary
          ><ul
            >{#each contributors as row}<li>{row.candidate.domain}</li>{/each}</ul
          ><p>Select individual visible rows above; this disclosure grants no bulk decision.</p
          ></details
        >{/each}</details
    >{/if}
  <fieldset disabled={busy || disabled || !ready}>
    <legend>Explicit selected-domain review</legend>
    <details>
      <summary>Reuse an earlier reason</summary>
      <p>Reason draft for {chosen.length} selected {chosen.length === 1 ? 'domain' : 'domains'} in {active.name}. Copy wording, then edit it for this selection.</p>
      {#if reasonSources.length}
        <label>Earlier candidate reason<select bind:value={reasonSource}>
          <option value="">Choose a saved reason for this Brand</option>
          {#each reasonSources as row (row.item.subjectKey)}<option value={row.item.subjectKey}>{row.candidate.domain}</option>{/each}
        </select></label>
        {#if reasonSourceRow?.lifecycle.decision}
          {@const previous = reasonSourceRow.lifecycle.decision}
          <p>Saved for <strong>{reasonSourceRow.candidate.domain}</strong> on {formatEvidenceDate(previous.reviewedAt)}. This is earlier wording, not a finding about the current selection.</p>
          <p class="saved-reason">{previous.rationale}</p>
          {#if previous.rationale.length > MAX_CANDIDATE_TEXT}<p>This reason is longer than the current {MAX_CANDIDATE_TEXT}-character field. It remains readable here; no shortened copy is substituted.</p>{/if}
          <button class="btn" type="button" onclick={reuseReason} disabled={!chosen.length || previous.rationale.length > MAX_CANDIDATE_TEXT}>{reason ? 'Replace draft reason with this text' : 'Use this reason'}</button>
          <p>Only text is copied. Selection, decisions, evidence, dates, priority and destination stay unchanged.</p>
        {/if}
      {:else}<p>No earlier reasons are retained for this Brand’s current candidates. A reason becomes reusable after you explicitly save a candidate review.</p>{/if}
    </details>
    <label>Reason<textarea bind:this={reasonInput} bind:value={reason} maxlength={MAX_CANDIDATE_TEXT} rows="2"></textarea></label>
    <label>Next review / expiry date (UTC)<input type="date" bind:value={reviewDate} /></label>
    <div class="toolbar"
      ><button class="btn" onclick={() => void shortlist()} disabled={!chosen.length}
        >Shortlist selected</button
      ><button class="btn" onclick={() => void review('suppressed')} disabled={!chosen.length}
        >Dismiss selected with reason and expiry</button
      ><button class="btn" onclick={() => void review('expected')} disabled={!chosen.length}
        >Defer selected until review</button
      ></div
    >
    <label>Destination watchlist<input bind:value={name} maxlength="100" /></label>
    <label
      >Analyst review priority<select bind:value={priority} onchange={() => { priorityEdited = true; }}
        >{#each WATCH_PRIORITIES as option}<option value={option.value}>{option.label}</option
          >{/each}</select
      ></label
    >
    {#if campaignDefault !== null}<p>Retained campaign revisions suggest {campaignDefault}; this is a draft default only. Manual Watchlist priorities stay unchanged unless explicitly replaced.</p>
      {#if priorityEdited}<button class="btn" onclick={() => { priorityEdited = false; }}>Use retained campaign default</button>{/if}
    {:else if chosen.length}<p>No single retained campaign default applies to this selection. Mixed, manual or unavailable revisions do not infer a priority.</p>{/if}
    <label
      ><input type="checkbox" bind:checked={replaceExistingContext} /> Explicitly replace priority/reason
      in existing selected Brand contexts</label
    >
    <p
      >Priority expresses review urgency, not Risk, confidence, Case severity or a response-time
      promise. It neither schedules nor deepens collection.</p
    >
    <button class="btn" onclick={showPreview} disabled={!chosen.length}
      >Preview exact watchlist handoff</button
    >
    {#if preview}<section aria-label="Watchlist handoff preview"
        ><h3
          >{preview.destination} · {WATCH_PRIORITIES.find(
            (value) => value.value === preview?.priority,
          )?.label}</h3
        ><p
          >Brand context: {active.name}. Reason: {preview.reason}. Additional requests: {preview.additionalRequests};
          collection authorised: no. Next review: {formatEvidenceDate(preview.reviewDueAt, 'Not set')}; explicit existing-context replacement: {preview.replaceExistingContext ? 'yes' : 'no'}.</p
        ><ul
          >{#each preview.rows as row}<li
              >{row.domain} — {row.state}: {row.reason}{#if row.previousContext}<p
                  >Existing reason: {row.previousContext.reason || 'Unassigned'} · changed {formatEvidenceDate(row.previousContext.changedAt, 'unknown')}</p
                >{/if}</li
            >{/each}</ul
        ><button
          class="btn"
          onclick={() => void addToWatch()}
          disabled={!preview.rows.some((row) => row.state !== 'rejected')}
          >Add reviewed domains without collection</button
        ></section
      >{/if}
  </fieldset>
  <details
    ><summary>Preview an exact scoped exception</summary><fieldset
      disabled={busy || disabled || !ready}
    >
      <label
        >Exact candidate domain<select bind:value={exceptionDomain}
          ><option value="">Choose a candidate</option>{#each rows as row}<option
              value={row.candidate.domain}>{row.candidate.domain}</option
            >{/each}</select
        ></label
      >
      <label
        >Exact matching rule<select bind:value={exceptionRule}
          ><option value="">Choose a rule</option
          >{#each exceptionRow?.matches ?? [] as match}<option value={match.ruleKey}
              >{match.reason}</option
            >{/each}</select
        ></label
      >
      <label
        >Exception purpose<select bind:value={exceptionPurpose}
          ><option value="irrelevant_match">Irrelevant matching pattern</option><option
            value="deferred_review">Deferred investigation</option
          ><option value="accepted_temporary_change">Accepted temporary change</option></select
        ></label
      >
      {#if exceptionRow && exceptionRule && exceptionRow.matches.some((match) => match.ruleKey === exceptionRule)}<p
          >Impact preview: only {exceptionDomain}, only {active.name}, only this exact rule. {exceptionRow
            .matches.length - 1} other matching rule(s) remain independently eligible. Reason and expiry
          are taken from the review fields above. This cannot suppress monitored material changes or change
          official/partner declarations.</p
        ><button
          class="btn"
          onclick={() => void saveException()}
          disabled={!reason.trim() || !reviewDate}>Record reviewed exact exception</button
        >{#each exceptionRow.exceptionStates.filter((row) => row.exception.ruleKey === exceptionRule && row.exception.enabled) as row}<button
            class="btn"
            onclick={() => void saveException(false, row.exception.id)}
            >Disable exception revision {row.exception.revision}</button
          >{/each}{/if}
    </fieldset></details
  >
</section>

<style>
  .candidate-review {
    min-width: 0;
    margin-top: 20px;
    padding: var(--card-pad);
    display: grid;
    gap: 12px;
  }
  .candidate-review p,
  .candidate-review li,
  .candidate-review summary {
    overflow-wrap: anywhere;
  }
  .candidate-review label {
    display: grid;
    gap: 6px;
    font-size: var(--text-sm);
  }
  .candidate-review label:has(input[type='checkbox']) {
    display: flex;
    align-items: flex-start;
  }
  .queue-controls { display: grid; gap: .75rem; }
  .candidate-queue { display: grid; }
  .candidate-queue article {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: .5rem;
    border-bottom: 1px solid var(--border);
    padding: .75rem .5rem;
  }
  .candidate-queue article.inspected { background: var(--panel-raised); box-shadow: inset 3px 0 var(--interface-accent); }
  .candidate-queue article label { grid-column: 1 / -1; }
  .candidate-queue article span { color: var(--muted); font-size: var(--text-xs); align-self: center; }
  .candidate-queue button { min-height: 44px; }
  .candidate-review fieldset {
    min-width: 0;
    display: grid;
    gap: 12px;
    border: 1px solid var(--border);
    padding: 12px;
  }
  .candidate-review input:not([type='checkbox']),
  .candidate-review textarea,
  .candidate-review select {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .candidate-review summary {
    cursor: pointer;
  }
  .saved-reason { padding: .75rem; background: var(--panel-raised); border-radius: var(--radius-sm); }
  .candidate-review .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>

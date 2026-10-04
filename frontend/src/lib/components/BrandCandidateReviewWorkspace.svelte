<script lang="ts">
  import { onMount, tick } from 'svelte';
  import DomainFeedCandidateIntake from './DomainFeedCandidateIntake.svelte';
  import BrandKeywordCampaigns from './BrandKeywordCampaigns.svelte';
  import { keywordCampaignDefaultPriority } from '../../../../packages/workspace/brand-keyword-campaign.mts';
  import { formatEvidenceDate } from '$lib/analysis/evidence-time';
  import { loadWatchlists, addCandidateWatchlist, type Watchlists } from '$lib/watchlists';
  import { loadAnalystReviewState } from '$lib/analyst-review-state';
  import {
    saveBrandCandidateDecision,
    saveBrandCandidateException,
    type BrandProfile,
  } from '$lib/brand-profiles';
  import { setShortlistSelection } from '$lib/shortlist';
  import {
    emptyAnalystReviewStateStore,
    type AnalystReviewStateStore,
  } from '$lib/analysis/analyst-review-state';
  import { projectBrandCandidateReview } from '../../../../packages/monitoring/brand-candidate-review.mts';
  import {
    candidateMaterialFingerprint,
    WATCH_PRIORITIES,
    type WatchPriority,
  } from '../../../../packages/workspace/brand-candidate-workflow.mts';
  import {
    planCandidateWatchHandoff,
    type CandidateWatchPlan,
  } from '../../../../packages/workspace/candidate-watch-handoff.mts';
  import { subscribeBrowserLocalData } from '$lib/browser-local-data-service';

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
  const rows = $derived(projectBrandCandidateReview(active, watchlists, reviewState, now));
  const visible = $derived(rows.filter((row) => filter === 'all' || row.status === filter));
  const chosen = $derived(rows.filter((row) => selected.has(row.candidate.domain)));
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
    try {
      [watchlists, reviewState] = await Promise.all([loadWatchlists(), loadAnalystReviewState()]);
      ready = true;
    } catch (cause) {
      ready = false;
      message =
        cause instanceof Error
          ? cause.message
          : 'Candidate review context could not be read. No empty state is inferred.';
    }
  }
  onMount(() => {
    void refresh();
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
      openedProfile = active.id;
      selected = new Set();
      preview = null;
      exceptionDomain = '';
      exceptionRule = '';
      reason = '';
      reviewDate = '';
      priorityEdited = false;
      priority = 'unassigned';
    }
  });
  function toggle(domain: string, checked: boolean) {
    const next = new Set(selected);
    checked ? next.add(domain) : next.delete(domain);
    selected = next;
    preview = null;
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
    if (!preview || busy) return;
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
      if (active.id !== profileId) return;
      message = `${result.rows.filter((row) => row.state !== 'rejected').length} domains retained in ${result.destination}; ${result.rows.filter((row) => row.state === 'rejected').length} rejected. No collection or schedule was enabled.`;
      preview = null;
      await refresh();
    } catch (cause) {
      preview = null;
      message =
        cause instanceof Error
          ? cause.message
          : 'Watchlist handoff failed; the selection remains available.';
    } finally {
      busy = false;
    }
  }
  async function review(disposition: 'suppressed' | 'expected') {
    if (busy || !chosen.length) return;
    if (!reason.trim() || !reviewDate) {
      message = 'A reason and future review/expiry date are required.';
      return;
    }
    const submitted = [...chosen],
      profileId = active.id,
      rationale = reason,
      expiresAt = new Date(`${reviewDate}T00:00:00Z`).toISOString();
    busy = true;
    let committed = 0;
    try {
      for (const row of submitted) {
        await saveBrandCandidateDecision(profileId, row.item, {
          disposition,
          rationale,
          expiresAt,
          reviewDueAt: disposition === 'expected' ? expiresAt : null,
        });
        committed++;
      }
      if (active.id !== profileId) return;
      message = `${committed} exact Brand candidate decisions recorded. Expiry or changed material provenance returns them to review.`;
      await refresh();
    } catch (cause) {
      message = `${committed} decisions committed; remaining candidates were not changed. ${cause instanceof Error ? cause.message : 'Review save failed.'}`;
    } finally {
      busy = false;
    }
  }
  async function shortlist() {
    if (!chosen.length || busy) return;
    busy = true;
    try {
      const result = await setShortlistSelection(
        chosen.map((row) => ({ domain: row.candidate.domain })),
        true,
        'retain',
      );
      message = `${result.added} domains added to Shortlist; ${result.retained} already present and unchanged; ${result.skipped} skipped. New candidates have unknown availability and no score.`;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not shortlist the selection.';
    } finally {
      busy = false;
    }
  }
  async function saveException(enabled = true, existingId = '') {
    if (!exceptionRow || !exceptionRule || busy) return;
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
      if (active.id !== profileId) return;
      message = enabled
        ? 'The exact Brand/domain/rule exception was recorded; observations and monitored changes remain visible.'
        : 'Exception disabled. Its prior rationale and revision remain retained.';
      try {
        await onrefresh();
      } catch {
        message +=
          ' The write committed, but refreshing the visible Brand failed. Reload before another edit.';
      }
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not save the scoped exception.';
    } finally {
      busy = false;
      if (active.id === profileId) {
        now = new Date().toISOString();
        await tick();
        actionStatus?.focus();
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
  <p
    >Review nominations before monitoring. Source observation, local retention, analyst urgency and
    any infringement assessment are separate. Opening or filtering this view makes no target
    request.</p
  >
  {#if message}<p bind:this={actionStatus} tabindex="-1" role="status" aria-label="Candidate review action status" aria-live="polite">{message}</p>{/if}
  {#if disabled}<p>The saved Brand context is being reconciled or is unavailable. This last-readable review and its drafts remain visible; mutations are disabled.</p>{/if}
  {#if !ready}<p
      >Saved watch and review context is unavailable or loading. Mutations remain disabled.</p
    >{/if}
  <BrandKeywordCampaigns {active} {onrefresh} disabled={disabled || busy} />
  <DomainFeedCandidateIntake {active} {onrefresh} disabled={disabled || !ready || busy} />
  <label
    >Candidate filter<select bind:value={filter}
      ><option value="all">All retained candidates</option><option value="new"
        >New / needs review</option
      ><option value="already_tracked">Already tracked for this Brand</option><option
        value="deferred">Deferred or dismissed until review</option
      ><option value="excluded">Excluded exact matches</option></select
    ></label
  >
  <p
    >{visible.length} shown · {rows.length} retained · {chosen.length} selected across all filters. Groups
    describe matching patterns, not common ownership.</p
  >
  {#if !rows.length}<p
      >No candidate provenance retained. In Discover, explicitly select domains and choose “Retain
      selected for Brand review”, or import a supported Brand Profile export.</p
    ><a href="/discover">Open Discover</a>{/if}
  <div class="candidate-grid">
    {#each visible as row (row.candidate.domain)}
      <article>
        <label
          ><input
            type="checkbox"
            checked={selected.has(row.candidate.domain)}
            onchange={(event) => toggle(row.candidate.domain, event.currentTarget.checked)}
            disabled={busy || disabled || !ready}
          /> <strong>{row.candidate.domain}</strong></label
        >
        <p
          >{row.status.replaceAll('_', ' ')}{row.trackedIn.length
            ? ` · ${row.trackedIn.join(', ')}`
            : ''}</p
        >
        <p>{row.lifecycle.reason}</p>
        {#if row.declaration}<p>{row.declaration}; not a safety verdict.</p>{/if}
        <details
          ><summary>Match reasons and source provenance</summary>
          <ul
            >{#each row.matches as match}<li
                >{match.term || 'Term not retained'} — {match.reason}<br />Exact rule: {match.ruleKey}</li
              >{/each}</ul
          >
          {#each row.candidate.sources as source}<dl
              ><div><dt>Observed hostname</dt><dd>{source.observedHostname}</dd></div><div
                ><dt>Source / revision</dt><dd
                  >{source.source} · {source.revision || 'Revision unknown'}</dd
                ></div
              ><div
                ><dt>Source-reported interval</dt><dd
                  >{formatEvidenceDate(source.sourceFirstObservedAt, 'Start unknown')} to {formatEvidenceDate(source.sourceLastObservedAt, 'End unknown')}</dd
                ></div
              ><div
                ><dt>First retained locally</dt><dd>{formatEvidenceDate(source.firstLocalObservedAt, 'Unknown')}</dd
                ></div
              ><div
                ><dt>Coverage</dt><dd
                  >{source.completeness}; {source.gap || 'No continuous coverage claim'}</dd
                ></div
              ></dl
            >{/each}
          {#each row.exceptionStates as state}<p
              >{state.exception.purpose.replaceAll('_', ' ')} · {state.state}: {state.exception
                .reason} · expires {formatEvidenceDate(state.exception.expiresAt)} · revision {state.exception
                .revision}</p
            ><details
              ><summary>Retained exception revisions ({state.exception.history.length})</summary><ul
                >{#each state.exception.history as revision}<li
                    >{formatEvidenceDate(revision.reviewedAt)}: {revision.reason} · {revision.enabled
                      ? 'enabled'
                      : 'disabled'} · expiry {formatEvidenceDate(revision.expiresAt)}</li
                  >{/each}</ul
              ><p>{state.exception.historyOmitted} older revisions omitted by the bound.</p
              ></details
            >{/each}
        </details>
      </article>
    {/each}
  </div>
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
    <label>Reason<textarea bind:value={reason} maxlength="300" rows="2"></textarea></label>
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
  .candidate-review dd,
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
  .candidate-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    gap: 12px;
  }
  .candidate-grid article {
    min-width: 0;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
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
  .candidate-review dl {
    display: grid;
    gap: 8px;
  }
  .candidate-review dt {
    color: var(--muted);
  }
  .candidate-review dd {
    margin: 0;
  }
  .candidate-review summary {
    cursor: pointer;
  }
  .candidate-review .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>

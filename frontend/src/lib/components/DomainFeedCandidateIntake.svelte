<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { formatEvidenceDate } from '$lib/analysis/evidence-time';
  import { retainBrandCandidates, type BrandProfile } from '$lib/brand-profiles';
  import { runDomainFeedWorker } from '$lib/domain-feed-worker';
  import { DomainFeedIntakeOperation } from '$lib/controllers/domain-feed-intake';
  import { loadDomainFeedServiceStatus, queryDomainFeedService, type DomainFeedServiceStatus, type PreparedDomainFeedReview } from '$lib/domain-feed-client';
  import { DOMAIN_FEED_CATALOGUE, DOMAIN_FEED_LIMITS, normalizeDomainFeedSelection } from '../../../../packages/monitoring/domain-feed.mts';
  import { attributeKeywordCampaignCandidate, brandKeywordCampaignState, keywordCampaignFeedSelection } from '../../../../packages/workspace/brand-keyword-campaign.mts';
  import { failedLocalMutationOutcome } from '$lib/local-mutation-outcome';
  import DomainFeedHistoryReview from './DomainFeedHistoryReview.svelte';
  import type { BrandKeywordCampaign } from '../../../../packages/workspace/brand-keyword-campaign.mts';

  let { active, disabled = false, onrefresh }: { active: BrandProfile; disabled?: boolean; onrefresh: () => Promise<unknown> } = $props();
  const operation = new DomainFeedIntakeOperation(), statusOperation = new DomainFeedIntakeOperation();
  let feedId = $state('tif-mini'), terms = $state(''), hosts = $state(''), negativeTerms = $state(''), campaignId = $state('');
  let file = $state.raw<Blob | null>(null), reviews = $state.raw<PreparedDomainFeedReview[]>([]);
  let resultOrigin = $state<'local' | 'service' | 'history'>('local');
  let selected = $state<Set<string>>(new Set()), busy = $state(false), writing = $state(false);
  let message = $state(''), openedProfile = $state(''), status = $state.raw<DomainFeedServiceStatus | null>(null);
  let serviceBusy = $state(false), serviceMessage = $state(''), serviceOpen = $state(false);
  let resultHeading = $state<HTMLHeadingElement>(), actionStatus = $state<HTMLParagraphElement>();
  let resultCampaign = $state<{ id: string; revision: number } | undefined>(), unavailable = $state(false);
  let now = $state(new Date().toISOString()), reviewedCampaignKey = $state('');
  let intakeGeneration = $state(0);
  const campaign = $derived((active.keywordCampaigns ?? []).find(value => value.id === campaignId));
  const campaignState = $derived(campaign ? brandKeywordCampaignState(campaign, now) : null);
  const matches = $derived(reviews.flatMap((review) => review.candidates));
  const chosen = $derived(matches.filter((match) => selected.has(match.domain)));
  const cached = $derived(status?.feeds.find((feed) => feed.feedId === feedId));
  const context = () => JSON.stringify([active.id, feedId, terms, negativeTerms, hosts, campaignId, campaign?.revision]);
  const historyContext = () => JSON.stringify([context(), intakeGeneration]);

  function invalidate(clearFile = false) {
    untrack(() => { intakeGeneration++; });
    operation.invalidate(); busy = false; reviews = []; selected = new Set(); resultCampaign = undefined; message = '';
    if (clearFile) file = null;
  }
  $effect(() => {
    if (openedProfile !== active.id) {
      openedProfile = active.id;
      invalidate(true); terms = ''; hosts = ''; negativeTerms = ''; campaignId = ''; unavailable = false;
      statusOperation.invalidate(); serviceBusy = false; status = null; serviceMessage = '';
    }
  });
  $effect(() => {
    const next = JSON.stringify([active.id, campaignId, campaign?.revision]);
    if (reviewedCampaignKey !== next) { reviewedCampaignKey = next; invalidate(); }
  });
  onMount(() => { const timer = setInterval(() => { now = new Date().toISOString(); }, 60_000); return () => clearInterval(timer); });
  onDestroy(() => { operation.invalidate(); statusOperation.invalidate(); });
  function selection() {
    if (campaignId) {
      if (!campaign) throw new Error('The selected campaign is unavailable. Choose saved matching intent again.');
      return normalizeDomainFeedSelection(keywordCampaignFeedSelection(campaign, active.id, new Date().toISOString()));
    }
    const negatives = negativeTerms.split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
    return normalizeDomainFeedSelection({ hosts: hosts.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean), terms: terms.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean),
      ...(negatives.length ? { negativeTerms: negatives } : {}), brandProfileId: active.id });
  }
  function chooseFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const chosenFile = input.files?.[0] ?? null;
    input.value = '';
    invalidate(true);
    file = chosenFile;
  }
  function prepareCampaignReviews(result: readonly PreparedDomainFeedReview[], value: BrandKeywordCampaign | undefined): PreparedDomainFeedReview[] {
    if (!value) return [...result];
    const reviewedAt = new Date().toISOString();
    // Admission is checked even when an edition has no matching candidates.
    keywordCampaignFeedSelection(value, active.id, reviewedAt);
    return result.map(row => ({ ...row, candidates: row.candidates.map(match => ({ ...match,
      candidate: attributeKeywordCampaignCandidate(match.candidate, value, active.id, reviewedAt) })) }));
  }
  function stageHistory(result: readonly PreparedDomainFeedReview[], submittedContext: string) {
    if (submittedContext !== historyContext() || disabled || writing || unavailable) throw new Error('The feed selection or saved Brand context changed. Review it again before staging.');
    const prepared = prepareCampaignReviews(result, campaign);
    operation.invalidate(); busy = false;
    reviews = prepared; resultOrigin = 'history'; selected = new Set(); file = null;
    resultCampaign = campaign ? { id: campaign.id, revision: campaign.revision } : undefined;
    message = result.length ? 'A retained source edition page is staged. Select individual nominations to retain.' : '';
  }
  async function scan(hosted = false) {
    if (writing || disabled || unavailable || (!hosted && !file)) return;
    invalidate();
    let selectedInput;
    try { selectedInput = selection(); }
    catch (cause) { message = cause instanceof Error ? cause.message : 'Enter explicit literal terms or exact hostnames within the stated limits.'; return; }
    if (!selectedInput.hosts.length && !selectedInput.terms.length) { message = 'Enter at least one explicit literal term or exact hostname.'; return; }
    if (!hosted && file!.size > DOMAIN_FEED_LIMITS.bytes) { file = null; message = 'The supplied feed exceeds the bounded file size. Choose a smaller supported feed.'; return; }
    const submittedFile = file, submittedContext = context(), submittedFeed = feedId, submittedCampaign = campaign;
    const started = operation.begin(submittedContext);
    busy = true;
    try {
      let result: PreparedDomainFeedReview[];
      if (hosted) result = await queryDomainFeedService(submittedFeed, selectedInput, started.signal);
      else {
        const review = await runDomainFeedWorker({ kind: 'scan', file: submittedFile!, feedId: submittedFeed, selection: selectedInput, importedAt: new Date().toISOString() }, { signal: started.signal });
        result = [{ review, candidates: review.matches, limitations: review.limitations, warnings: [] }];
      }
      if (!operation.current(started, context())) return;
      result = prepareCampaignReviews(result, submittedCampaign);
      resultCampaign = submittedCampaign ? { id: submittedCampaign.id, revision: submittedCampaign.revision } : undefined;
      reviews = result; resultOrigin = hosted ? 'service' : 'local'; file = null;
      message = `${result.reduce((count, review) => count + review.candidates.length, 0)} candidates found. Select those you want to retain.`;
      await tick();
      if (operation.current(started, context())) resultHeading?.focus();
    } catch (cause) {
      if (operation.current(started, context())) message = cause instanceof Error ? cause.message : 'Feed review failed. No candidates were retained.';
    } finally {
      if (operation.current(started, context())) busy = false;
      operation.finish(started);
    }
  }
  async function cancel() { invalidate(true); message = 'Feed review cancelled. No candidates were retained.'; await tick(); actionStatus?.focus(); }
  function toggle(domain: string, checked: boolean) {
    const next = new Set(selected); checked ? next.add(domain) : next.delete(domain); selected = next;
  }
  async function retain() {
    if (!chosen.length || writing || busy || disabled || unavailable) return;
    const profileId = active.id, submitted = chosen.map((match) => match.candidate), submittedContext = context();
    writing = true;
    let committed = false;
    try {
      const outcomes = await retainBrandCandidates(profileId, submitted, resultCampaign);
      committed = true;
      if (context() === submittedContext) {
        message = `${outcomes.filter((row) => row.state === 'retained').length} candidates retained; ${outcomes.filter((row) => row.state === 'rejected').length} rejected. Existing candidates were not evicted. Continue in candidate review below; no monitoring or collection was enabled.`;
        selected = new Set();
      }
      await onrefresh();
    } catch (cause) {
      if (context() === submittedContext) {
        unavailable = committed || failedLocalMutationOutcome(cause) === 'unknown';
        message = committed ? 'The candidate write committed, but refreshing the visible Brand failed. Reload before another edit.'
          : unavailable ? 'The retention outcome could not be confirmed. Reload the saved Brand before retrying.'
          : cause instanceof Error ? cause.message : 'The selection could not be retained.';
      }
    } finally {
      writing = false;
      if (context() === submittedContext) { await tick(); actionStatus?.focus(); }
    }
  }
  async function openService(event: Event) {
    serviceOpen = (event.currentTarget as HTMLDetailsElement).open;
    statusOperation.invalidate(); serviceBusy = false;
    if (!serviceOpen) return;
    const submittedProfile = active.id, started = statusOperation.begin(submittedProfile);
    serviceBusy = true; status = null; serviceMessage = '';
    try {
      const result = await loadDomainFeedServiceStatus(started.signal);
      if (serviceOpen && statusOperation.current(started, active.id)) status = result;
    } catch {
      if (serviceOpen && statusOperation.current(started, active.id)) serviceMessage = 'Optional service status is unavailable. Manual local import remains available.';
    } finally {
      if (statusOperation.current(started, active.id)) serviceBusy = false;
      statusOperation.finish(started);
    }
  }
</script>

<details class="feed-intake">
  <summary>Review domain feed candidates</summary>
  <p>Find candidates in a domain feed using literal terms or exact hostnames. A listing is a lead to review, not an infringement finding.</p>
  <fieldset disabled={writing || disabled || unavailable}>
    <legend>What to match</legend>
    <label>Domain feed source<select bind:value={feedId} onchange={() => invalidate()}>{#each DOMAIN_FEED_CATALOGUE as feed}<option value={feed.id}>{feed.label}</option>{/each}</select></label>
    <label>Matching intent<select bind:value={campaignId} onchange={() => invalidate()}><option value="">Manual selectors</option>{#each active.keywordCampaigns ?? [] as value}<option value={value.id}>{value.name} · revision {value.revision} · {brandKeywordCampaignState(value, now).replaceAll('_', ' ')}</option>{/each}</select></label>
    {#if campaign}<p>Campaign revision {campaign.revision}: positive {campaign.positiveTerms.join(', ')}; negative {campaign.negativeTerms.join(', ') || 'none'}. {campaignState?.replaceAll('_', ' ')}. Only an active revision can nominate candidates; existing nominations remain unchanged.</p>{:else}
    <div class="selection-fields">
      <label>Literal Brand terms<textarea bind:value={terms} oninput={() => invalidate()} maxlength="1620" rows="3" placeholder="One term per line"></textarea></label>
      <label>Negative feed literals<textarea bind:value={negativeTerms} oninput={() => invalidate()} maxlength="1620" rows="3" placeholder="One excluded literal per line"></textarea></label>
      <label>Exact hostnames<textarea bind:value={hosts} oninput={() => invalidate()} maxlength="51200" rows="3" placeholder="One hostname per line"></textarea></label>
    </div>
    {/if}
    <p class="muted">Up to 20 positive and 20 negative literals (3–80 characters), or 200 exact hostnames. Any negative match vetoes this review before the 200-candidate bound, including an exact hostname. Literal ASCII/punycode substrings only; no token, typo, confusable or parent-domain expansion.</p>
    <label>Local domain-only feed file<input type="file" accept=".txt,text/plain" onchange={chooseFile} /></label>
    {#if file}<p>{file.size.toLocaleString()} bytes selected for local scanning.</p>{/if}
    <p class="muted">The file stays on this device. Only candidates you choose to retain are saved.</p>
    <button class="btn" onclick={() => void scan()} disabled={!file || busy || Boolean(campaign && campaignState !== 'active')}>Scan local file</button>
    <details class="optional-service" ontoggle={(event) => void openService(event)}>
      <summary>Optional hosted feed cache</summary>
      <p>Querying shares only the selected positive and negative literals and exact hostnames with this application’s configured feed service. It does not send the Brand Profile, campaign identity or review window, and does not contact candidate targets.</p>
      {#if serviceBusy}<p role="status">Reading operator configuration…</p>
      {:else if serviceMessage}<p role="status">{serviceMessage}</p>
      {:else if status?.enabled === false}<p>Not enabled by the operator. Manual local import remains available.</p>
      {:else if status?.enabled}<p>{cached?.cached ? `Selected feed cache available${cached.stale ? ' (stale)' : ''}.` : 'No usable snapshot is available for this feed.'}</p>{#if cached?.error}<p>The latest refresh could not be confirmed. A retained snapshot, if available, can still be reviewed.</p>{/if}
      {:else}<p>Service configuration has not been read.</p>{/if}
      <button class="btn" onclick={() => void scan(true)} disabled={busy || serviceBusy || !status?.enabled || !cached?.cached || Boolean(campaign && campaignState !== 'active')}>Query selected feed cache</button>
      <DomainFeedHistoryReview {feedId} getselection={selection} getcontext={historyContext} onstage={stageHistory}
        onstart={() => { operation.invalidate(); busy = false; }} disabled={writing || disabled || unavailable || serviceBusy || !status?.enabled || !cached?.cached || Boolean(campaign && campaignState !== 'active')} />
    </details>
  </fieldset>
  {#if busy}<div class="scan-progress"><progress aria-label="Domain feed review in progress"></progress><p role="status">Reviewing the bounded feed. Nothing has been retained.</p><button class="btn" onclick={cancel}>Cancel feed review</button></div>{/if}
  {#if message}<p role="status" tabindex="-1" bind:this={actionStatus} aria-label="Domain feed review status">{message}</p>{/if}
  {#if reviews.length}
    <section aria-labelledby="domain-feed-result-title">
      <h3 id="domain-feed-result-title" tabindex="-1" bind:this={resultHeading}>Staged feed nominations</h3>
      {#if resultCampaign}<p>Attributed to campaign {campaign?.name ?? 'Name unavailable'}, revision {resultCampaign.revision}. Feed identity and publication clocks remain separate from the campaign’s review window. Editing, pausing or expiry cannot rewrite retained attribution.</p>{/if}
      {#each reviews as result}
        {@const review = result.review}
        {#each result.warnings as warning}<p class="source-warning">{warning}</p>{/each}
        {#if review.truncated}<p class="source-warning">Showing {review.matches.length} candidates; more matches were omitted from this page. {resultOrigin === 'history' ? 'Use “Continue after reviewing this page” to review the remaining matches without changing selectors.' : 'Narrow the terms to review another selection, or explicitly review retained editions with catch-up.'}</p>{/if}
        <details class="source-details">
          <summary>Source details and coverage</summary>
          <dl><div><dt>Source</dt><dd>{review.feedId}</dd></div><div><dt>Raw-file SHA-256</dt><dd>{review.revision}</dd></div><div><dt>Declared update / version</dt><dd>{formatEvidenceDate(review.declaredPublishedAt, 'Unknown')} · {review.declaredVersion || 'Unknown'}</dd></div><div><dt>{resultOrigin === 'local' ? 'Reviewed locally / acquired' : 'Cache imported / acquired'}</dt><dd>{formatEvidenceDate(review.importedAt)} · {formatEvidenceDate(review.acquiredAt, 'Unknown')}</dd></div><div><dt>Snapshot and match coverage</dt><dd>{review.bytes.toLocaleString()} bytes · {review.rows.toLocaleString()} source rows · {review.matches.length} distinct candidates returned · {review.matched ?? 'Unknown'} raw matching rows · {review.omitted ?? 'Unknown'} matching occurrences not separately retained; {review.truncated ? 'additional distinct candidates omitted by the bound' : resultOrigin === 'local' ? 'scan completed' : 'cache query completed'}</dd></div></dl>
          <ul>{#each result.limitations as limitation}<li>{limitation}</li>{/each}</ul>
        </details>
      {/each}
      <fieldset disabled={writing || disabled || busy || unavailable || Boolean(resultCampaign && campaignState !== 'active')}><legend>Select specific candidates to retain</legend>
        {#each matches as match (match.domain)}<label class="candidate"><input type="checkbox" checked={selected.has(match.domain)} onchange={(event) => toggle(match.domain, event.currentTarget.checked)} />{match.domain}<span class="muted">{match.terms.length ? `Literal matches: ${match.terms.join(', ')}` : 'Exact hostname selection'}</span></label>{/each}
        <button class="btn" onclick={() => void retain()} disabled={!chosen.length}>{writing ? 'Retaining reviewed candidates…' : 'Retain selected feed candidates'}</button>
      </fieldset>
    </section>
  {/if}
</details>

<style>
  .feed-intake { min-width: 0; margin-block: 16px; }
  summary { cursor: pointer; }
  p, li, dd, label, h3 { overflow-wrap: anywhere; }
  fieldset { min-width: 0; }
  label { display: block; margin-block: 10px; }
  input[type='file'], select, textarea { max-width: 100%; min-width: 0; width: 100%; }
  .selection-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .candidate { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; }
  .candidate span { grid-column: 2; }
  .optional-service, .source-details { margin-block: 16px; }
  .muted { color: var(--muted); }
  dl div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 12px; }
  dd { margin: 0; }
  progress { max-width: 100%; }
  @media (max-width: 600px) { .selection-fields, dl div { grid-template-columns: minmax(0, 1fr); gap: 0; } }
</style>

<script lang="ts">
  import type { KeywordCampaignComparison } from '#lib/controllers/brand-keyword-campaign.ts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import CopyButton from './CopyButton.svelte';
  import Pagination from './Pagination.svelte';

  let { comparison }: { comparison: KeywordCampaignComparison } = $props();
  const labels = {
    added: 'New literal match', removed: 'No longer a literal match',
    unchanged_match: 'Still matches', unchanged_nonmatch: 'Still does not match',
    no_baseline: 'No saved revision to compare',
  } as const;
  let filter = $state('all'), page = $state(1);
  const matching = $derived(comparison.rows.filter(row => filter === 'all' || row.change === filter));
  const pageCount = $derived(Math.max(1, Math.ceil(matching.length / 25)));
  const rows = $derived(matching.slice((page - 1) * 25, page * 25));
  $effect(() => { comparison; filter; page = 1; });
</script>

<section class="comparison" aria-label="Retained candidate comparison">
  <h4>Try this revision against retained candidates</h4>
  <p>{comparison.profileName} · {comparison.rows.length} retained candidates · proposed revision {comparison.afterRevision}</p>
  {#if comparison.beforeRevision !== null}
    <p>Compared with saved revision {comparison.beforeRevision}: {comparison.counts.added} newly match,
      {comparison.counts.removed} no longer match, {comparison.counts.unchanged_match} still match and
      {comparison.counts.unchanged_nonmatch} still do not match under the literal rules.</p>
  {:else}
    <p>No saved campaign revision exists. The proposal matches {comparison.afterMatches} of these
      {comparison.rows.length} candidates; match changes cannot be determined.</p>
  {/if}
  <details>
    <summary>Corpus identity and coverage</summary>
    <dl>
      <div><dt>Brand</dt><dd>{comparison.profileName} · <code>{comparison.profileId}</code></dd></div>
      <div><dt>Brand record updated</dt><dd>{formatEvidenceDate(comparison.profileUpdatedAt)}</dd></div>
      <div><dt>Compared</dt><dd>{formatEvidenceDate(comparison.comparedAt)}</dd></div>
      <div><dt>Local corpus fingerprint</dt><dd><code>{comparison.revision}</code>
        <CopyButton value={comparison.revision} description="Copy local corpus fingerprint" /></dd></div>
    </dl>
    <p>All {comparison.rows.length} candidates currently retained for this Brand were compared.
      The Brand can retain up to {comparison.maximum}. This is not a full feed: unretained or deleted
      candidates and earlier source omissions are unknown. Source coverage is shown with each candidate.</p>
    <p>Counts compare literal matches, not findings of infringement or false-positive rates.
      Review windows, Brand declarations and earlier analyst reviews stay separate. Nothing is saved
      or admitted to a Watchlist by this preview.</p>
    {#if comparison.beforeHistoryOmitted}<p>{comparison.beforeHistoryOmitted} older campaign revisions
      are no longer retained. This comparison uses the current saved revision only.</p>{/if}
  </details>
  {#if comparison.rows.length}
    <label>Show comparison results<select bind:value={filter}>
      <option value="all">All candidates ({comparison.rows.length})</option>
      {#each Object.entries(labels) as [key, label]}
        {#if comparison.counts[key as keyof typeof labels]}
          <option value={key}>{label} ({comparison.counts[key as keyof typeof labels]})</option>
        {/if}
      {/each}
    </select></label>
    <p role="status">Showing {rows.length} of {matching.length} matching comparison results.</p>
    <ul class="candidate-list" aria-label="Campaign comparison candidates">
      {#each rows as row (row.domain)}
        <li>
          <div class="candidate-title"><h5><code>{row.domain}</code></h5>
            <CopyButton value={row.domain} description={`Copy comparison hostname ${row.domain}`} /></div>
          <p>{labels[row.change]}</p>
          <dl class="match-pair">
            {#each [{ label: 'Saved revision', result: row.before }, { label: 'Proposed revision', result: row.after }] as side}
              <div><dt>{side.label}</dt><dd>
                {#if side.result}
                  <p>{side.result.outcome === 'vetoed' ? 'Negative literal veto'
                    : side.result.outcome === 'matched' ? 'Literal match' : 'No positive literal matched'}</p>
                  {#if side.result.terms.length}<p>Positive matches: {side.result.terms.join(', ')}.</p>{/if}
                  {#if side.result.excludedTerms.length}<p>Vetoing literals: {side.result.excludedTerms.join(', ')}.</p>{/if}
                  {#if side.result.missingTerms.length}<p>Positive literals not found: {side.result.missingTerms.join(', ')}.</p>{/if}
                  <p>Review window at preview: {side.result.state.replaceAll('_', ' ')}.</p>
                {:else}<p>No saved revision.</p>{/if}
              </dd></div>
            {/each}
          </dl>
          {#if row.declaration}<p>{row.declaration.reason}: {row.declaration.matchedDomain}. This does not change the literal comparison.</p>{/if}
          <details>
            <summary>Retained source evidence ({row.sources.length})</summary>
            {#each row.sources as source}
              <dl>
                <div><dt>Observed hostname</dt><dd><code>{source.observedHostname}</code></dd></div>
                <div><dt>Source / edition</dt><dd>{source.source} · <code>{source.revision ?? 'Edition unknown'}</code></dd></div>
                <div><dt>Source-reported interval</dt><dd>{formatEvidenceDate(source.sourceFirstObservedAt, 'Start unknown')}
                  to {formatEvidenceDate(source.sourceLastObservedAt, 'End unknown')}</dd></div>
                <div><dt>First retained locally</dt><dd>{formatEvidenceDate(source.firstLocalObservedAt, 'Unknown')}</dd></div>
                <div><dt>Coverage</dt><dd>{source.completeness}; {source.gap || 'No continuous coverage claim'}</dd></div>
              </dl>
            {/each}
          </details>
          {#if row.reviews.length}
            <details>
              <summary>Earlier analyst reviews ({row.reviews.length})</summary>
              <p>These decisions concern their original rule and source evidence. They are not new
                decisions about the proposed revision, or general claims that the domain is benign.</p>
              {#each row.reviews as review}
                <dl>
                  <div><dt>Decision / status at preview</dt><dd>{review.purpose.replaceAll('_', ' ')} · {review.state.replaceAll('_', ' ')}</dd></div>
                  <div><dt>Reason</dt><dd>{review.reason}</dd></div>
                  <div><dt>Exact original rule</dt><dd><code>{review.ruleKey}</code></dd></div>
                  <div><dt>Review revision</dt><dd>{review.revision}, reviewed {formatEvidenceDate(review.reviewedAt)};
                    expires {formatEvidenceDate(review.expiresAt)}</dd></div>
                </dl>
                <p>{review.previousRevisions} previous review revisions retained; {review.omittedRevisions} older revisions omitted.
                  Full retained review history remains in Candidate review.</p>
              {/each}
            </details>
          {/if}
        </li>
      {/each}
    </ul>
    <Pagination currentPage={page} {pageCount} setPage={(value) => { page = value; }}
      ariaLabel="Campaign comparison pages" pageInputLabel="Go to comparison page" />
  {:else}
    <p>No retained candidates are available for this Brand. A zero-row comparison does not establish
      that the proposed rule has no matches in a feed.</p>
  {/if}
</section>

<style>
  .comparison { min-width: 0; border-top: 1px solid var(--border); padding-top: 1rem; }
  h4, h5 { margin: 0 0 .5rem; font-size: var(--text-sm); }
  p, dt, dd, h4, h5, label { overflow-wrap: anywhere; }
  code { white-space: normal; overflow-wrap: anywhere; }
  label { display: grid; gap: .5rem; margin-block: 1rem; }
  select { width: 100%; min-width: 0; max-width: 100%; }
  .candidate-list { display: grid; gap: 1rem; list-style: none; padding: 0; }
  li { min-width: 0; border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
  .candidate-title { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: .5rem; }
  .candidate-title h5 { flex: 1 1 12rem; min-width: 0; margin: 0; }
  dl { display: grid; gap: .75rem; }
  .match-pair { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  dt { color: var(--muted); font-size: var(--text-xs); }
  dd { margin: .25rem 0 0; }
  dd p { margin: .3rem 0; }
  details { margin-block: .75rem; }
  summary { cursor: pointer; overflow-wrap: anywhere; }
  @media (max-width: 600px) { .match-pair { grid-template-columns: 1fr; } }
</style>

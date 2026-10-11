<script lang="ts">
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import type { projectBrandCandidateReview } from '../../../../packages/monitoring/brand-candidate-review.mts';
  import CopyButton from './CopyButton.svelte';
  let { row }: { row: ReturnType<typeof projectBrandCandidateReview>[number] } = $props();
</script>

<section aria-label="Candidate source provenance">
  <h4>Retained source evidence</h4>
  <p>These are nominations, not collected Lookup results.</p>
  {#each row.candidate.sources as source}
    <dl>
      <div><dt>Observed hostname</dt><dd><code>{source.observedHostname}</code> <CopyButton value={source.observedHostname} label="Copy" description={`Copy observed hostname ${source.observedHostname}`} /></dd></div>
      <div><dt>Source / revision</dt><dd>{source.source} · {source.revision || 'Revision unknown'}</dd></div>
      <div><dt>Source-reported interval</dt><dd>{formatEvidenceDate(source.sourceFirstObservedAt, 'Start unknown')} to {formatEvidenceDate(source.sourceLastObservedAt, 'End unknown')}</dd></div>
      <div><dt>First retained locally</dt><dd>{formatEvidenceDate(source.firstLocalObservedAt, 'Unknown')}</dd></div>
      <div><dt>Coverage</dt><dd>{source.completeness}; {source.gap || 'No continuous coverage claim'}</dd></div>
    </dl>
  {/each}
  <details><summary>Exact matching rules ({row.matches.length})</summary><ul>{#each row.matches as match}<li>{match.term || 'Term not retained'} — {match.reason}<br /><code>{match.ruleKey}</code></li>{/each}</ul></details>
  {#each row.exceptionStates as state}
    <p>{state.exception.purpose.replaceAll('_', ' ')} · {state.state}: {state.exception.reason} · expires {formatEvidenceDate(state.exception.expiresAt)} · revision {state.exception.revision}</p>
    <details><summary>Retained exception revisions ({state.exception.history.length})</summary><ul>{#each state.exception.history as revision}<li>{formatEvidenceDate(revision.reviewedAt)}: {revision.reason} · {revision.enabled ? 'enabled' : 'disabled'} · expiry {formatEvidenceDate(revision.expiresAt)}</li>{/each}</ul><p>{state.exception.historyOmitted} older revisions omitted by the bound.</p></details>
  {/each}
</section>

<style>
  h4 { margin: 0 0 .5rem; }
  dl { display: grid; gap: .75rem; padding-block: .75rem; border-bottom: 1px solid var(--border); }
  dt { color: var(--muted); font-size: var(--text-xs); }
  dd { margin: .25rem 0 0; overflow-wrap: anywhere; }
  code { white-space: normal; overflow-wrap: anywhere; }
  summary { cursor: pointer; }
</style>

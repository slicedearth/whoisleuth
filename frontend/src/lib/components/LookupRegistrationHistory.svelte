<script lang="ts">
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import WebArchiveHistory from './WebArchiveHistory.svelte';
  import CopyableCommand from './CopyableCommand.svelte';
  import type { LookupKeyFact } from '../../../../lib/lookup-key-facts.mts';
  import { EVIDENCE_INELIGIBLE_LABELS, sourceEligibility } from '../../../../packages/evidence/evidence-eligibility.mts';

  // Brings the dates that bear on an earlier registration together: the
  // creation date used for comparison, every source date that was not used and
  // why, the web archive comparison, and where certificate logs are compared.
  // Nothing here makes a request; the archive panel reads only on request.
  let { domain, creation, observations }: {
    domain: string;
    creation: Readonly<{ createdAt: string; source: string }> | null;
    observations: readonly LookupKeyFact[];
  } = $props();

  // The registration decision repeats a source's value, so identical source dates appear once.
  const unused = $derived([...new Map(observations.flatMap((item) => {
    if (item.value === null || (creation && item.source === creation.source)) return [];
    const eligibility = sourceEligibility({ state: item.sourceState, complete: item.complete });
    return [[`${item.source}\n${item.value}`, { key: `${item.source}\n${item.value}`, source: item.source, value: item.value,
      reason: eligibility.eligible ? 'an earlier source already supplied a date' : EVIDENCE_INELIGIBLE_LABELS[eligibility.reason] }] as const];
  })).values()]);
</script>

<section class="registration-history" aria-labelledby="registration-history-title">
  <h3 id="registration-history-title">Registration history</h3>
  <dl>
    <div data-fact="created">
      <dt>Current registration created</dt>
      <dd>
        {#if creation}
          <span><time datetime={creation.createdAt}>{formatEvidenceDate(creation.createdAt)}</time> · {creation.source}</span>
        {:else}
          <span>Not established from a successful, complete registration source</span>
        {/if}
        {#each unused as item (item.key)}<small>{item.source} reported {item.value}; not used because {item.reason}.</small>{/each}
      </dd>
    </div>
    <div data-fact="certificate-logs">
      <dt>Certificate logs</dt>
      <dd>
        <span>Not read in Lookup.</span>
        <small>A certificate search in Discover carries each candidate's earliest logged certificate to Bulk, which compares it with that candidate's creation date. Saved results can also be compared offline:</small>
        <CopyableCommand compact label="prior-registration command" command={`whoisleuth prior-registration lookup.json --ct-results ct.json --archive-history archive.json`} />
      </dd>
    </div>
  </dl>
  <WebArchiveHistory {domain} registrationCreatedAt={creation?.createdAt ?? null} />
</section>

<style>
  .registration-history { display: grid; gap: 10px; min-width: 0; margin-top: 12px; }
  h3 { margin: 0; font-size: var(--text-sm); }
  dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: 10px; margin: 0; }
  dl > div { min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  dt { color: var(--muted); font-size: var(--text-xs); }
  dd { display: grid; gap: 4px; min-width: 0; margin: 3px 0 0; font-size: var(--text-sm); overflow-wrap: anywhere; }
  dd > span { font-weight: 600; }
  small { color: var(--muted); font-size: var(--text-2xs); line-height: 1.5; }
  .registration-history :global(.web-archive-history) { margin-top: 0; }
</style>

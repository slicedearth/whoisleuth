<script lang="ts">
  import type { LookupProgressUpdate } from '../../../../lib/lookup-progress-http.mts';
  import type { LookupProgressState } from '../../../../lib/lookup-progress.mts';
  import { LOOKUP_SOURCE_LABELS } from '$lib/analysis/lookup-source-labels.ts';

  let { progress }: { progress: LookupProgressUpdate | null } = $props();
  const snapshot = $derived(progress?.snapshot);
  const states: Record<LookupProgressState, string> = {
    success: 'Received', partial: 'Partial', not_found: 'Not found at source', skipped: 'Not collected',
    error: 'Failed', unsupported: 'Unsupported', unavailable: 'Unavailable', rate_limited: 'Rate limited',
  };
  const last = $derived(snapshot?.settledSources.at(-1));
  const announcement = $derived(snapshot
    ? `${snapshot.settledSources.length} of ${snapshot.plannedSources.length} sources finished${last ? ` · ${LOOKUP_SOURCE_LABELS[last.source]}: ${states[last.state]}` : ''}`
    : '');
</script>

<section class="source-progress" aria-label="Lookup source progress">
  {#if snapshot}
    <p role="status">{announcement}</p>
    <ul>
      {#each snapshot.plannedSources as source}
        {@const settled = snapshot.settledSources.find(item => item.source === source)}
        <li><span>{LOOKUP_SOURCE_LABELS[source]}</span>{' '}<strong>{settled ? states[settled.state] : 'Waiting'}</strong></li>
      {/each}
    </ul>
  {:else}
    <p role="status">{progress?.transport === 'buffered' ? 'This connection returns sources together in the final response.' : 'Waiting for source updates…'}</p>
  {/if}
</section>

<style>
  .source-progress{min-width:0;margin-top:.75rem;padding:.85rem 1rem;border:1px solid var(--border);border-radius:var(--radius-sm,6px)}
  p{margin:0 0 .65rem;overflow-wrap:anywhere;font-size:.85rem}
  p:last-child{margin-bottom:0}
  ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:.4rem 1.5rem;list-style:none;margin:0;padding:0}
  li{display:flex;gap:1rem;justify-content:space-between;align-items:baseline;min-width:0;font-size:.8rem}
  li span{min-width:0;overflow-wrap:anywhere}
  strong{flex-shrink:0;font-weight:500}
</style>

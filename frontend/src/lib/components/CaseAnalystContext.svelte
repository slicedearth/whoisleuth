<script lang="ts">
  import type { CaseRecord } from '../cases.ts';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  import { CASE_POPULARITY_RANK_LIMITATION } from '../../../../packages/cases/case-analyst-context.mts';

  // Analyst-selected context recorded beside the Case, never part of its domain
  // evidence. Public packs leave it out.
  let { record }: { record: CaseRecord } = $props();
  const entries = $derived(record.analystContext ?? []);
</script>

{#if entries.length}
  <section class="analyst-context" aria-labelledby={`case-analyst-context-${record.id}`}>
    <h3 id={`case-analyst-context-${record.id}`}>Analyst context</h3>
    <ul>
      {#each entries as entry (entry.id)}
        <li>
          <strong>Ranked #{entry.rank.toLocaleString()} in a selected popularity list</strong>
          <small><span class="digest">sha256:{entry.listSha256.slice(0, 12)}</span> · recorded <EvidenceTimestamp value={entry.recordedAt} label="rank recording time" /></small>
        </li>
      {/each}
    </ul>
    <p>{CASE_POPULARITY_RANK_LIMITATION} Public packs leave these ranks out.</p>
  </section>
{/if}

<style>
  .analyst-context { display: grid; gap: 8px; min-width: 0; margin-top: 12px; padding: 13px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel-raised); }
  h3 { margin: 0; font: 700 var(--text-sm) var(--mono); }
  ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  li { display: grid; gap: 2px; min-width: 0; }
  small, p { color: var(--muted); font-size: var(--text-xs); line-height: 1.5; overflow-wrap: anywhere; }
  p { margin: 0; }
  .digest { font-family: var(--mono); }
</style>

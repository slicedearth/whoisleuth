<script lang="ts">
  import type { RelationshipContribution } from '../../../../packages/comparison/relationship-provenance.mts';

  let { sources }: { sources: readonly RelationshipContribution[] } = $props();
</script>

<details class="relationship-sources">
  <summary>Contributing observations ({sources.length})</summary>
  <ul>
    {#each sources as source}
      <li>
        <strong>{source.domain}</strong> · {source.source.replaceAll('_', ' ')} · {source.status.replaceAll('_', ' ')}
        <small>{source.observedAt ? new Date(source.observedAt).toLocaleString() : 'Source time not recorded'} · {source.complete ? 'Complete source' : 'Incomplete or unknown source'}{source.truncated === true ? ' · truncated' : source.truncated === null ? ' · truncation unknown' : ''}</small>
      </li>
    {/each}
  </ul>
</details>

<style>
  .relationship-sources{min-width:0;margin-block:12px;font-size:var(--text-xs)}
  ul{padding-inline-start:20px;margin-block:10px}
  li{margin-block:8px;overflow-wrap:anywhere}
  small{display:block;color:var(--muted)}
</style>

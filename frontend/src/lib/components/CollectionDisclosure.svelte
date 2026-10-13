<script lang="ts">
  import { onMount } from 'svelte';
  import type { CollectionDisclosure } from '#lib/analysis/collection-disclosure.ts';
  import { isLocalApplication } from '#lib/local-application-context.ts';
  let { disclosure, label = 'Data and recipients' }: { disclosure: CollectionDisclosure; label?: string } = $props();
  let localApplication = $state(false);
  onMount(() => { localApplication = isLocalApplication(); });
</script>

<details class="collection-disclosure">
  <summary>{label}</summary>
  <div>
    <p>{disclosure.status}</p>
    <dl>
      <dt>Request origin and first boundary</dt>
      <dd>{disclosure.offline ? 'This browser; no server request for this operation.' : localApplication
        ? 'If started, this browser sends the action to the local loopback application server. That server makes any downstream requests.'
        : 'If started, this browser sends the action to the current application server. That server makes any downstream requests; this view does not establish its operator or location.'}</dd>
      <dt>Declared data</dt><dd>{#if disclosure.data.length}<ul>{#each disclosure.data as value}<li>{value}</li>{/each}</ul>{:else}Unavailable{/if}</dd>
      <dt>Downstream recipients</dt><dd>{#if disclosure.recipients.length}<ul>{#each disclosure.recipients as value}<li>{value}</li>{/each}</ul>{:else}Unavailable{/if}</dd>
    </dl>
    <p>{disclosure.uncertainty}</p>
  </div>
</details>

<style>
  .collection-disclosure{min-width:0;margin-top:8px;border-top:1px solid var(--border);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}
  summary{padding:8px 0;cursor:pointer;font-weight:650}
  p{margin:0 0 8px;color:var(--muted)}
  dl{margin:0 0 8px}
  dt{font-weight:650;margin-top:8px}
  dd{margin:3px 0 0;color:var(--muted)}
  ul{margin:0;padding-left:18px}
</style>

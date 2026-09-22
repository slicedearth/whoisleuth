<script lang="ts">
  import { pageBehaviourRows, type PageBehaviour } from '../../../../packages/investigation/page-behaviour.mts';
  import Pagination from './Pagination.svelte';
  let { value }: { value: PageBehaviour | null } = $props();
  let page = $state(1);
  const rows = $derived(value ? pageBehaviourRows(value) : []);
  $effect(() => { value; page = 1; });
</script>

<details class="page-behaviour"><summary>Page behaviour and dependencies</summary><div class="body">
  {#if value}
    <p>{value.state === 'partial' ? 'Partial capture' : 'Observed capture'} · {value.requests.length} navigation, script and frame responses · {value.elements.length} page elements.</p>
    {#if value.clipboardWriteAttempts}<p>{value.clipboardWriteAttempts} Clipboard API write attempts were blocked on the final page.</p>{/if}
    <ol start={(page - 1) * 12 + 1}>{#each rows.slice((page - 1) * 12, page * 12) as row}<li><strong>{row.label}</strong>{#if row.origin}<span>{row.origin}</span>{/if}{#if row.digest}<code>SHA-256 {row.digest}</code>{/if}</li>{/each}</ol>
    <Pagination currentPage={page} pageCount={Math.ceil(rows.length / 12)} setPage={next => page = next} ariaLabel="Page observations" pageInputLabel="Page observation page" />
    <details><summary>What these observations cover</summary><p>Response order spans admitted requests; elements and wording describe the final top-level document. Default form destinations were read, not submitted; script-driven and submit-button overrides are not inferred. An integrity attribute or policy header is not a verification result. Wording matches do not establish execution or malicious intent. Paths, field values and commands are not retained here.</p></details>
  {:else}<p>This historical capture has no page-behaviour observations.</p>{/if}
</div></details>

<style>
  .page-behaviour{min-width:0;border-block:1px solid var(--border)}summary{cursor:pointer;min-height:40px;padding-block:10px;font-weight:650}.body{display:grid;gap:10px;padding-bottom:12px;min-width:0}ol{display:grid;gap:10px;padding-left:22px;margin:0}li{min-width:0}li span,li code{display:block}p,li{font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere;margin:0}code{font-size:var(--text-2xs);white-space:normal;color:var(--muted)}
</style>

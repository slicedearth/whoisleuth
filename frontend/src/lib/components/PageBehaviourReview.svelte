<script lang="ts">
  import { pageBehaviourRows, type PageBehaviour } from '../../../../packages/investigation/page-behaviour.mts';
  import Pagination from './Pagination.svelte';
  import { captureChannelSummary } from '../../../../packages/investigation/capture-coverage.mts';
  let { value }: { value: PageBehaviour | null } = $props();
  let page = $state(1);
  const rows = $derived(value ? pageBehaviourRows(value) : []);
  $effect(() => { value; page = 1; });
</script>

<details class="page-behaviour"><summary>Page behaviour and dependencies</summary><div class="body">
  {#if value}
    <p>{value.state === 'partial' ? 'Partial capture' : 'Observed capture'} · {value.requests.length} navigation, script and frame responses · {value.elements.length} page elements.</p>
    {#if value.clipboardWriteAttempts}<p>{value.clipboardWriteAttempts} Clipboard API write attempts were blocked on the final page.</p>{/if}
    <details><summary>Request-channel coverage</summary>
      <dl>{#each captureChannelSummary(value.coverage) as row}<div><dt>{row.channel.replaceAll('_', ' ')}</dt><dd>{row.coverage === 'recorded' ? `${row.observed} supplied · ${row.refused} refused · ${row.unavailable} unavailable` : row.coverage === 'unknown' ? 'Unknown — ledger truncated' : 'Not observed in this capture'}</dd></div>{/each}</dl>
      <p>Disabled: {value.coverage.disabledSurfaces.map(value => value.replaceAll('_', ' ')).join(', ')}. Interactions: not exercised.</p>
      {#if value.coverage.omittedAttempts}<p>Additional attempts not retained: {value.coverage.omittedAttempts === 1_000_000 ? 'at least ' : ''}{value.coverage.omittedAttempts}.</p>{/if}
      {#if value.coverage.websocketRefusals}<p>WebSocket attempts refused: {value.coverage.websocketRefusals === 1_000_000 ? 'at least ' : ''}{value.coverage.websocketRefusals}.</p>{/if}
      {#if value.coverage.directConnectionRefusals}<p>Unattributed direct connections refused: {value.coverage.directConnectionRefusals === 1_000_000 ? 'at least ' : ''}{value.coverage.directConnectionRefusals}.</p>{/if}
      <p>Supplied means a response reached the page. Refused responses may follow collection; each request records whether the collector started. No form submission, login or user interaction was exercised.</p>
    </details>
    <ol start={(page - 1) * 12 + 1}>{#each rows.slice((page - 1) * 12, page * 12) as row}<li><strong>{row.label}</strong>{#if row.origin}<span>{row.origin}</span>{/if}{#if row.digest}<code>SHA-256 {row.digest}</code>{/if}</li>{/each}</ol>
    <Pagination currentPage={page} pageCount={Math.ceil(rows.length / 12)} setPage={next => page = next} ariaLabel="Page observations" pageInputLabel="Page observation page" />
    <details><summary>What these observations cover</summary><p>Response order spans admitted requests; elements and wording describe the final top-level document. Default form destinations were read, not submitted; script-driven and submit-button overrides are not inferred. An integrity attribute or policy header is not a verification result. Wording matches do not establish execution or malicious intent. Paths, field values and commands are not retained here.</p></details>
  {:else}<p>This historical capture has no page-behaviour observations.</p>{/if}
</div></details>

<style>
  .page-behaviour{min-width:0;border-block:1px solid var(--border)}summary{cursor:pointer;min-height:40px;padding-block:10px;font-weight:650}.body{display:grid;gap:10px;padding-bottom:12px;min-width:0}ol{display:grid;gap:10px;padding-left:22px;margin:0}li{min-width:0}li span,li code{display:block}p,li{font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere;margin:0}code{font-size:var(--text-2xs);white-space:normal;color:var(--muted)}
  dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:10px;margin:8px 0;font-size:var(--text-xs)}dt{font-weight:650;text-transform:capitalize}dd{margin:2px 0 0;overflow-wrap:anywhere}
</style>

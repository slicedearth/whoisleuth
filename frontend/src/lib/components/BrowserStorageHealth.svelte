<script lang="ts">
  import { onMount } from 'svelte';
  import { readBrowserStorageHealth, requestBrowserPersistence, type BrowserStorageHealth } from '$lib/browser-storage-health.ts';
  let { preparedAt = null }: { preparedAt?: string | null } = $props();
  let health = $state<BrowserStorageHealth>({ persisted: null, usage: null, quota: null, persistenceAvailable: false });
  let busy = $state(false);
  let message = $state('');
  const formatBytes = (value: number | null) => value === null ? 'Unavailable' : `${(value / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
  onMount(() => { void refresh(); });
  async function refresh() {
    busy = true;
    try { health = await readBrowserStorageHealth(navigator.storage); }
    catch { health = { persisted: null, usage: null, quota: null, persistenceAvailable: false }; }
    finally { busy = false; }
  }
  async function request() {
    busy = true;
    let result: boolean | null = null;
    try { result = await requestBrowserPersistence(navigator.storage); } catch { /* Storage access is unavailable. */ }
    message = result === true ? 'Persistent storage granted by this browser. It is not a backup.'
      : result === false ? 'The browser did not grant persistent storage. You can still download a backup.'
        : 'Persistent storage could not be requested in this browser.';
    await refresh();
  }
</script>

<details class="storage-health">
  <summary>Storage and backup health</summary>
  <dl>
    <div><dt>Backup prepared during this visit</dt><dd>{preparedAt ? new Date(preparedAt).toLocaleString() : 'None recorded'}</dd></div>
    <div><dt>Browser retention</dt><dd>{health.persisted === true ? 'Persistent storage granted' : health.persisted === false ? 'Best effort; the browser may evict data' : 'Unavailable'}</dd></div>
    <div><dt>Estimated site usage</dt><dd>{formatBytes(health.usage)}</dd></div>
    <div><dt>Estimated site quota</dt><dd>{formatBytes(health.quota)}</dd></div>
  </dl>
  <p>Estimates cover this site's storage, including other workspaces and caches. The app cannot confirm that a download was kept or restored. Clearing site data can remove persistent storage too.</p>
  <div class="actions">
    <button class="btn" type="button" disabled={busy} onclick={() => void refresh()}>Refresh storage estimate</button>
    {#if health.persistenceAvailable && health.persisted !== true}<button class="btn" type="button" disabled={busy} onclick={() => void request()}>Request persistent storage</button>{/if}
  </div>
  {#if message}<p role="status">{message}</p>{/if}
</details>

<style>
  .storage-health{margin-block:12px;border-block:1px solid var(--border);padding-block:12px}summary{cursor:pointer;font-weight:650}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px}dt{color:var(--muted);font-size:var(--text-xs)}dd{margin:4px 0 0;overflow-wrap:anywhere}p{max-width:75ch;color:var(--muted);font-size:var(--text-xs);line-height:1.6}.actions{display:flex;flex-wrap:wrap;gap:8px}
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import {
    compareWebsiteSnapshots,
    deleteWebsiteSnapshot,
    exportWebsiteSnapshots,
    importWebsiteSnapshots,
    loadWebsiteSnapshots,
    MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES,
    retainWebsiteSnapshot,
    type WebsiteProfileSnapshot,
  } from '$lib/website-snapshots';

  let { domain, canSave, buildSnapshot }: {
    domain: string;
    canSave: boolean;
    buildSnapshot: () => unknown;
  } = $props();
  let snapshots = $state<WebsiteProfileSnapshot[]>([]);
  let beforeId = $state('');
  let afterId = $state('');
  let message = $state('');
  const domainSnapshots = $derived(snapshots.filter((item) => item.domain === domain));
  const before = $derived(domainSnapshots.find((item) => item.id === beforeId) || null);
  const after = $derived(domainSnapshots.find((item) => item.id === afterId) || null);
  const comparison = $derived(before && after ? compareWebsiteSnapshots(before, after) : null);

  onMount(() => { void refresh(); });
  async function refresh() {
    try {
      snapshots = await loadWebsiteSnapshots();
      const scoped = snapshots.filter((item) => item.domain === domain);
      if (!afterId && scoped[0]) afterId = scoped[0].id;
      if (!beforeId && scoped[1]) beforeId = scoped[1].id;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not load website snapshots.';
    }
  }
  async function save() {
    try {
      snapshots = await retainWebsiteSnapshot(buildSnapshot());
      afterId = snapshots.find((item) => item.domain === domain)?.id || '';
      const prior = snapshots.filter((item) => item.domain === domain && item.id !== afterId)[0];
      if (prior) beforeId = prior.id;
      message = `Saved a compact website-profile snapshot for ${domain}.`;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not save the website snapshot.';
    }
  }
  async function remove(id: string) {
    if (!confirm('Delete this compact website-profile snapshot?')) return;
    snapshots = await deleteWebsiteSnapshot(id);
    if (beforeId === id) beforeId = '';
    if (afterId === id) afterId = '';
    message = 'Deleted the selected website-profile snapshot.';
  }
  async function download() {
    try {
      await exportWebsiteSnapshots();
      message = 'Exported the website-profile snapshot collection.';
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not export website snapshots.';
    }
  }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES) throw new Error('Website-snapshot imports are limited to 768 KiB.');
      const result = await importWebsiteSnapshots(JSON.parse(await file.text()));
      snapshots = result.snapshots;
      message = `Imported ${result.added} new and ${result.updated} matching snapshot${result.added + result.updated === 1 ? '' : 's'}.`;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Website-snapshot import failed.';
    } finally {
      input.value = '';
    }
  }
  function when(value: string) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unknown time' : parsed.toLocaleString();
  }
</script>

<section class="snapshot-manager card" aria-labelledby="website-snapshot-title">
  <header>
    <div><p class="eyebrow">Analyst-selected history</p><h3 id="website-snapshot-title">Website profile snapshots</h3></div>
    <div class="toolbar">
      <button class="btn" type="button" onclick={save} disabled={!canSave}>Save current snapshot</button>
      <button class="btn" type="button" onclick={download} disabled={!snapshots.length}>Export</button>
      <label class="btn file-btn">Import<input type="file" accept="application/json,.json" onchange={importFile}></label>
    </div>
  </header>
  <p>Save only after reviewing a completed Deep Lookup. Snapshots retain curated technology identifiers, posture states, identity digests, source health, completeness, and timestamps. A change is a review lead, not evidence of compromise, ownership, intent, or maliciousness.</p>
  {#if domainSnapshots.length}
    <div class="comparison-controls">
      <label class="field">Earlier snapshot<select bind:value={beforeId}><option value="">Choose snapshot</option>{#each domainSnapshots as item}<option value={item.id}>{when(item.observedAt)}</option>{/each}</select></label>
      <label class="field">Later snapshot<select bind:value={afterId}><option value="">Choose snapshot</option>{#each domainSnapshots as item}<option value={item.id}>{when(item.observedAt)}</option>{/each}</select></label>
    </div>
    {#if comparison}
      <div class="comparison" class:incomparable={!comparison.compatible}>
        <strong>{comparison.compatible ? `${comparison.changes.length} material field change${comparison.changes.length === 1 ? '' : 's'}` : 'Snapshots are not comparable'}</strong>
        {#if comparison.changes.length}
          <ul>{#each comparison.changes as change}<li><span>{change.state}</span><code>{change.field}</code><small>{change.before || 'Unavailable'} → {change.after || 'Unavailable'}</small></li>{/each}</ul>
        {:else}<p>No curated field changed between these compatible snapshots.</p>{/if}
      </div>
    {/if}
    <details>
      <summary>Manage {domainSnapshots.length} saved snapshot{domainSnapshots.length === 1 ? '' : 's'}</summary>
      <ul class="saved-list">{#each domainSnapshots as item}<li><span>{when(item.observedAt)} · {item.complete ? 'Complete' : 'Partial'}{item.truncated ? ' · Truncated' : ''}</span><button class="btn small danger" type="button" onclick={() => remove(item.id)}>Delete</button></li>{/each}</ul>
    </details>
  {:else}
    <p>No website-profile snapshot is retained for this domain.</p>
  {/if}
  <p class="message" role="status">{message}</p>
</section>

<style>
  .snapshot-manager{margin:16px 0;padding:var(--card-pad)}
  header{display:flex;align-items:start;justify-content:space-between;gap:12px}
  h3,.eyebrow{margin:0}
  .snapshot-manager>p{color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .comparison-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}
  .comparison{margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  .comparison.incomparable{border-color:var(--warning)}
  .comparison ul,.saved-list{display:grid;gap:6px;margin:9px 0 0;padding:0;list-style:none}
  .comparison li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 8px}
  .comparison li span{color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .comparison li small{grid-column:2;overflow-wrap:anywhere;color:var(--muted)}
  details{margin-top:10px}
  summary{font:700 var(--text-xs) var(--mono)}
  .saved-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--border);font-size:var(--text-xs)}
  .message:empty{display:none}
  @media(max-width:700px){header{flex-direction:column}.comparison-controls{grid-template-columns:1fr}.toolbar{width:100%}.toolbar>*{flex:1}}
</style>

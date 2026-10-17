<script lang="ts">
  import { onMount } from 'svelte';
  import { readBrowserLocalDataCollections, subscribeBrowserLocalData } from '#lib/browser-local-data-service.ts';
  import { createCaseDraftInventory, type CaseDraftInventoryState } from '#lib/controllers/case-draft-inventory.ts';
  import { unconfirmedCaseDrafts, subscribeCaseDraftState, type UnconfirmedCaseDraft } from '#lib/controllers/case-draft-state.ts';
  import { caseWorkspaceHref } from '#lib/analysis/case-response-stage.ts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import Pagination from './Pagination.svelte';

  let inventoryState = $state.raw<CaseDraftInventoryState>({ state: 'idle', entries: [] });
  let warnings = $state.raw<readonly UnconfirmedCaseDraft[]>([]);
  let page = $state(1), preview = $state<string | null>(null);
  const id = $props.id();
  const pageSize = 25;
  const pageCount = $derived(Math.ceil(inventoryState.entries.length / pageSize));
  const currentPage = $derived(Math.min(page, Math.max(1, pageCount)));
  const entries = $derived(inventoryState.entries.slice((currentPage - 1) * pageSize, currentPage * pageSize));
  const missingCases = $derived(inventoryState.entries.filter(entry => entry.caseLabel === null).length);
  const inventory = createCaseDraftInventory(() => readBrowserLocalDataCollections(['cases', 'case_drafts']), next => {
    inventoryState = next; preview = null;
  });
  onMount(() => {
    const refreshWarnings = () => { warnings = unconfirmedCaseDrafts(); };
    refreshWarnings();
    const stops = [subscribeCaseDraftState(refreshWarnings),
      subscribeBrowserLocalData('cases', inventory.refreshIfRequested),
      subscribeBrowserLocalData('case_drafts', inventory.refreshIfRequested)];
    return () => { stops.forEach(stop => stop()); inventory.dispose(); };
  });
</script>

<section class="draft-inventory" aria-label="Draft inventory">
  <p>Review saved draft values, then open the matching Case form to restore a copy. Nothing is restored or submitted here.</p>
  {#if warnings.length}
    <div role="alert">
      <h3>Unconfirmed writes in open forms · {warnings.length}</h3>
      <p>Keep these forms open to copy later edits. Reading saved drafts does not confirm whether their writes succeeded or make repeating a submission safe.</p>
      <ul>{#each warnings as warning (warning.owner)}<li>{warning.form.replaceAll('-', ' ')} · Case <code>{warning.caseId}</code></li>{/each}</ul>
    </div>
  {/if}
  <button class="btn" type="button" disabled={inventoryState.state === 'loading'} onclick={() => void inventory.refresh()}>
    {inventoryState.state === 'loading' ? 'Reading saved drafts…' : inventoryState.state === 'idle' ? 'Read saved drafts' : 'Refresh saved drafts'}
  </button>
  <div role="status" aria-live="polite">
    {#if inventoryState.state === 'loading'}<p>Reading drafts and Case references from this workspace…</p>
    {:else if inventoryState.state === 'unavailable'}<p>Saved drafts could not be read. Their contents and count are unavailable; nothing was changed.</p>
    {:else if inventoryState.state === 'ready'}<p>{inventoryState.entries.length} saved draft{inventoryState.entries.length === 1 ? '' : 's'} · {missingCases} with an unavailable Case reference.</p>{/if}
  </div>
  {#if inventoryState.state === 'ready'}
    {#if entries.length}<ul class="draft-list">
      {#each entries as { draft, caseLabel } (draft.id)}
        <li>
          <strong>{caseLabel ?? 'Case unavailable'}</strong>
          <p>{draft.form.replaceAll('-', ' ')} · form version {draft.formVersion} · saved {formatEvidenceDate(draft.updatedAt)}</p>
          {#if caseLabel === null}<p>This Case is absent from the current readable snapshot; when and why are unknown. Its saved draft remains viewable.</p><code>{draft.caseId}</code>{/if}
          <div class="actions">
            {#if caseLabel !== null}<a class="btn small" href={caseWorkspaceHref(draft.caseId)}>Open Case</a>{/if}
            <button class="btn small" type="button" aria-expanded={preview === draft.id} aria-controls={`${id}-${draft.id}`}
              onclick={() => preview = preview === draft.id ? null : draft.id}>View saved values</button>
          </div>
          {#if preview === draft.id}<pre id={`${id}-${draft.id}`}>{JSON.stringify(draft.fields, null, 2)}</pre>{/if}
        </li>
      {/each}
    </ul>
    <Pagination {currentPage} {pageCount} setPage={value => { page = value; preview = null; }} ariaLabel="Saved draft pages" />
    {:else}<p>No saved recovery drafts were found in this workspace.</p>{/if}
    <p>Restore supported copies in the matching Case form. Unavailable Cases and changed forms remain inspectable without creating records. Drafts are excluded from exports and backups; copy text you need to keep.</p>
  {/if}
</section>

<style>
  .draft-inventory,.draft-list li{display:grid;gap:10px;min-width:0}.draft-inventory{padding-block:12px}.draft-list{list-style:none;padding:0;margin:0;display:grid;gap:14px}.draft-list li{padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  p,h3{margin:0}p,li,pre{font-size:var(--text-xs);line-height:1.6}p{color:var(--muted)}h3{font-size:var(--text-sm)}strong,p,code,pre{overflow-wrap:anywhere}pre{min-width:0;white-space:pre-wrap;margin:0;padding:10px;background:var(--bg);border-radius:var(--radius-sm)}
  .actions{display:flex;flex-wrap:wrap;gap:8px}.btn{justify-self:start;max-width:100%;white-space:normal}.actions .btn{min-height:44px}[role=alert]{display:grid;gap:8px;border-inline-start:2px solid var(--amber);padding-inline-start:12px}
</style>

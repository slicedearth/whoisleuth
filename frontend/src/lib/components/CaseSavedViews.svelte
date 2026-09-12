<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { loadCaseViews, saveCaseView, deleteCaseView } from '../case-views.ts';
  import { createDraftRevision, restoreSubmittedFocus } from '../controllers/submitted-draft.ts';
  import { failedLocalMutationOutcome } from '../local-mutation-outcome.ts';
  import { MAX_CASE_VIEW_NAME_LENGTH, type CaseViewFilters, type SavedCaseView } from '../../../../packages/contracts/case-views-contract.mts';

  let { filters, onapply }: { filters: CaseViewFilters; onapply: (filters: CaseViewFilters) => void } = $props();
  let views = $state<readonly SavedCaseView[]>([]);
  let selectedId = $state('');
  let expected = $state<SavedCaseView | null>(null);
  let name = $state('');
  let loaded = $state(false);
  let busy = $state(false);
  let uncertain = $state(false);
  let message = $state('');
  let section = $state<HTMLElement>();
  let picker = $state<HTMLSelectElement>();
  let status = $state<HTMLParagraphElement>();
  let generation = 0;
  let mounted = false;
  const draft = createDraftRevision(() => selectedId);
  $effect(() => { filters; draft.changed(); });
  const changed = $derived(Boolean(expected && JSON.stringify(views.find(view => view.id === expected?.id) ?? null) !== JSON.stringify(expected)));
  const sorted = $derived([...views].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)));

  function select(id: string) {
    draft.changed(); selectedId = id;
    expected = views.find(view => view.id === id) ?? null;
    name = expected?.name ?? '';
    message = '';
  }
  async function refresh() {
    if (busy || uncertain) return;
    const request = ++generation;
    busy = true;
    try {
      const store = await loadCaseViews();
      if (!mounted || request !== generation) return;
      views = store.views; loaded = true; uncertain = false;
      message = expected && JSON.stringify(views.find(view => view.id === expected?.id) ?? null) !== JSON.stringify(expected)
        ? 'The saved view changed elsewhere. Reselect it to review the current definition; your current filters have not changed.' : '';
    } catch (cause) {
      if (mounted && request === generation) { loaded = false; message = cause instanceof Error ? cause.message : 'Saved Case views could not be read.'; }
    } finally { if (mounted && request === generation) busy = false; }
  }
  async function mutate(action: 'new' | 'update' | 'delete') {
    if (!loaded || busy || uncertain || (action !== 'new' && (!expected || changed))) return;
    if (action === 'delete' && !window.confirm(`Delete the saved view “${expected!.name}”? Cases and current filters will not change.`)) return;
    const submitted = expected;
    const unchanged = draft.capture();
    const origin = section?.contains(document.activeElement) ? document.activeElement : null;
    let committed = false;
    busy = true; message = '';
    try {
      if (action === 'delete') {
        const store = await deleteCaseView(submitted!);
        if (!mounted) return;
        views = store.views;
        if (unchanged()) { selectedId = ''; expected = null; name = ''; }
        message = 'Deleted the saved view. Cases and current filters were not changed.';
      } else {
        const result = await saveCaseView({ name, filters }, action === 'update' ? submitted : null);
        if (!mounted) return;
        views = result.store.views;
        if (unchanged()) { selectedId = result.view.id; expected = result.view; name = result.view.name; }
        message = 'Saved the view in this workspace. Matching Cases are evaluated when you apply it.';
      }
      committed = true;
    } catch (cause) {
      if (!mounted) return;
      uncertain = failedLocalMutationOutcome(cause) === 'unknown';
      message = cause instanceof Error ? cause.message : 'The saved view could not be changed.';
    } finally {
      if (mounted) {
        busy = false; await tick();
        restoreSubmittedFocus(origin, uncertain ? status : committed ? picker : origin as HTMLElement | null, section);
      }
    }
  }
  onMount(() => { mounted = true; void refresh(); return () => { mounted = false; generation += 1; }; });
</script>

<details class="saved-views" bind:this={section}>
  <summary>Saved Case views</summary>
  <p>Save the filters above for this workspace. Backups include view names and search text.</p>
  <div class="toolbar">
    <label class="field">Saved view
      <select bind:this={picker} value={selectedId} disabled={!loaded || busy || uncertain} onchange={event => select(event.currentTarget.value)}>
        <option value="">Choose a view</option>
        {#each sorted as view (view.id)}<option value={view.id}>{view.name}</option>{/each}
      </select>
    </label>
    <button class="btn" type="button" disabled={!expected || changed || !loaded || busy || uncertain} onclick={() => expected && onapply({ ...expected.filters })}>Apply view</button>
    <button class="btn" type="button" disabled={busy || uncertain} onclick={refresh}>Refresh saved views</button>
  </div>
  <form class="toolbar" oninput={() => draft.changed()} onsubmit={event => { event.preventDefault(); void mutate('new'); }}>
    <label class="field">View name<input bind:value={name} required maxlength={MAX_CASE_VIEW_NAME_LENGTH} disabled={!loaded || busy || uncertain} autocomplete="off" /></label>
    <button class="btn" type="submit" disabled={!loaded || busy || uncertain || !name.trim()}>Save as new view</button>
    <button class="btn" type="button" disabled={!expected || changed || !loaded || busy || uncertain || !name.trim()} onclick={() => void mutate('update')}>Update selected view</button>
    <button class="btn" type="button" disabled={!expected || changed || !loaded || busy || uncertain} onclick={() => void mutate('delete')}>Delete selected view</button>
  </form>
  {#if uncertain}<button class="btn" type="button" onclick={() => { if (window.confirm('Reload to verify the saved view state? The unsaved view name and current filters will be cleared.')) window.location.reload(); }}>Reload workspace</button>{/if}
  {#if message}<p role="status" tabindex="-1" bind:this={status} aria-live="polite">{message}</p>{/if}
</details>

<style>
  .saved-views{min-width:0;margin:10px 2px 16px}.saved-views>summary{cursor:pointer;font-weight:650}
  p{margin:10px 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}
  .toolbar{margin-top:10px;align-items:end}.field{min-width:0;flex:1 1 15rem;max-width:30rem}
  select,input,button{min-width:0;max-width:100%}button:disabled{opacity:.55;cursor:not-allowed}
  summary:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  @media(max-width:640px){summary,button,select,input{min-height:44px}.field{max-width:none;flex-basis:100%}}
</style>

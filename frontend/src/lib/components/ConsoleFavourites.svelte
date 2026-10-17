<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { loadCases, type CaseRecord } from '#lib/cases.ts';
  import { subscribeBrowserLocalData } from '#lib/browser-local-data-service.ts';
  import {
    readConsoleReferenceView, subscribeConsoleReferenceView, readSelectedConsoleCase, subscribeSelectedConsoleCase,
    consoleFavouriteDestinations, consoleFavouriteKey, addConsoleFavourite, removeConsoleFavourite, clearConsoleFavourites,
    MAX_CONSOLE_FAVOURITES, type ConsoleFavourite,
  } from '#lib/console-workflow-state.ts';
  import { CASE_WORKSPACE_SECTIONS, caseWorkspaceHref, caseWorkspaceSection, type CaseWorkspaceSection } from '#lib/analysis/case-response-stage.ts';
  import { caseNumber } from '../../../../packages/cases/case-workflow-metadata.mts';
  import { isNavigationItemActive } from '#lib/workspaces.ts';
  import { page } from '$app/state';
  import { restoreSubmittedFocus } from '#lib/controllers/submitted-draft.ts';

  let { onnavigate }: { onnavigate: () => void } = $props();
  const destinations = consoleFavouriteDestinations();
  let view = $state(readConsoleReferenceView());
  let selectedCase = $state(readSelectedConsoleCase());
  let records = $state.raw<readonly CaseRecord[]>([]);
  let phase = $state<'empty' | 'loading' | 'ready' | 'unavailable'>('empty');
  let section = $state<CaseWorkspaceSection>('summary');
  let destination = $state(destinations[0]?.href ?? '');
  let message = $state('');
  let status = $state<HTMLParagraphElement>();
  let root = $state<HTMLElement>();
  let mounted = false, generation = 0;
  const readKey = () => JSON.stringify([view.workspaceId, selectedCase,
    view.favourites.filter(item => item.kind === 'case').map(item => item.caseId).sort()]);
  const active = $derived(records.filter(record => record.id === selectedCase));
  const rows = $derived(view.favourites.map(reference => {
    const matches = reference.kind === 'case' ? records.filter(record => record.id === reference.caseId) : [];
    return { reference, key: consoleFavouriteKey(reference), record: matches.length === 1 ? matches[0] : null,
      ambiguous: matches.length > 1, destination: reference.kind === 'destination' ? destinations.find(item => item.href === reference.href) : null };
  }));
  async function refresh() {
    const request = ++generation, requested = readKey();
    const wanted = new Set([selectedCase, ...view.favourites.flatMap(item => item.kind === 'case' ? [item.caseId] : [])].filter((id): id is string => Boolean(id)));
    records = [];
    if (!wanted.size) { phase = 'empty'; return; }
    phase = 'loading';
    try {
      const loaded = await loadCases();
      if (!mounted || request !== generation || requested !== readKey()) return;
      records = loaded.filter(record => wanted.has(record.id)); phase = 'ready';
    } catch { if (mounted && request === generation && requested === readKey()) phase = 'unavailable'; }
  }
  function changed() {
    const before = readKey(); view = readConsoleReferenceView();
    if (before !== readKey()) void refresh();
  }
  async function add(reference: ConsoleFavourite) {
    const origin = document.activeElement;
    try {
      const result = addConsoleFavourite(reference);
      message = result === 'added' ? 'Added to favourites in this tab.' : result === 'already-added' ? 'This exact destination is already a favourite.'
        : result === 'full' ? `All ${MAX_CONSOLE_FAVOURITES} spaces are used. Remove one before adding another; nothing was replaced.` : 'Tab favourites are unavailable.';
    } catch { message = 'Choose a supported destination or an available Case section. Nothing was added.'; }
    await tick(); restoreSubmittedFocus(origin, status, root);
  }
  async function remove(reference?: ConsoleFavourite) {
    const origin = document.activeElement;
    if (reference) removeConsoleFavourite(reference); else clearConsoleFavourites();
    message = reference ? 'Favourite removed. Saved evidence is unchanged.' : 'Favourites cleared. Saved evidence is unchanged.';
    await tick(); restoreSubmittedFocus(origin, status, root);
  }
  onMount(() => {
    mounted = true;
    const stopView = subscribeConsoleReferenceView(changed);
    const stopSelection = subscribeSelectedConsoleCase(id => { if (id !== selectedCase) { selectedCase = id; void refresh(); } });
    const stopCases = subscribeBrowserLocalData('cases', () => { void refresh(); });
    void refresh();
    return () => { mounted = false; generation++; records = []; stopView(); stopSelection(); stopCases(); };
  });
</script>

<section aria-label="Favourites in this tab" bind:this={root}>
  <p>Keep shortcuts to frequently used tools, views and Case sections while you work.</p>
  <p class="favourites-lifetime">These links last only in this tab. Reloading, locking, signing out or leaving the Console clears them; saved evidence stays unchanged.</p>
  <p class="favourites-count">{view.favourites.length} of {MAX_CONSOLE_FAVOURITES} shortcuts</p>
  {#if phase === 'loading'}<p role="status">Reading retained Case references…</p>{/if}
  {#if phase === 'unavailable'}<p role="alert">Cases could not be read. Existing references remain; no replacement was selected.</p><button class="btn" type="button" onclick={() => void refresh()}>Retry favourite Case read</button>{/if}
  {#if rows.length}
    <nav aria-label="Favourite destinations"><ul>
      {#each rows as row (row.key)}
        <li>
          {#if row.destination}
            <a class="favourite-link" href={row.destination.href} class:active={isNavigationItemActive(row.destination, page.url)} aria-current={isNavigationItemActive(row.destination, page.url) ? 'page' : undefined}
              target={row.destination.opensInNewTab ? '_blank' : undefined} rel={row.destination.opensInNewTab ? 'noopener noreferrer' : undefined} onclick={onnavigate}
              aria-label={row.destination.opensInNewTab ? `${row.destination.label}. Opens in a new tab.` : undefined}>{row.destination.label}</a>
          {:else if row.reference.kind === 'case'}
            {@const caseReference = row.reference}
            {#if phase === 'ready' && row.record}
              <a class="favourite-link" href={caseWorkspaceHref(caseReference.caseId, caseReference.section)} aria-current={page.url.pathname === '/cases' && page.url.searchParams.get('case') === caseReference.caseId && caseWorkspaceSection(page.url) === caseReference.section ? 'page' : undefined} onclick={onnavigate}>{row.record.title || row.record.domain} · {CASE_WORKSPACE_SECTIONS.find(item => item.id === caseReference.section)?.label}<small>{caseNumber(caseReference.caseId)}</small></a>
            {:else}<span>Case <code>{caseReference.caseId}</code> · {phase === 'ready' ? row.ambiguous ? 'ambiguous reference' : 'no longer retained' : 'availability not confirmed'}</span>{/if}
          {/if}
          <button class="btn" type="button" aria-label={`Remove favourite ${row.key}`} onclick={() => void remove(row.reference)}>Remove</button>
        </li>
      {/each}
    </ul></nav>
    <button class="btn" type="button" onclick={() => void remove()}>Clear favourites</button>
  {/if}
  <div class="favourite-add">
    <label>Tool, view or reference<select bind:value={destination}>{#each destinations as item}<option value={item.href}>{item.label}</option>{/each}</select></label>
    <button class="btn" type="button" disabled={!destination} onclick={() => add({ kind: 'destination', href: destination })}>Add destination favourite</button>
  </div>
  <div class="favourite-add">
    <label>Case section<select bind:value={section}>{#each CASE_WORKSPACE_SECTIONS as item}<option value={item.id}>{item.label}</option>{/each}</select></label>
    <button class="btn" type="button" disabled={phase !== 'ready' || active.length !== 1 || !selectedCase} onclick={() => { if (selectedCase && active.length === 1) add({ kind: 'case', caseId: selectedCase, section }); }}>Add selected Case favourite</button>
    {#if !selectedCase}<p>Open a saved Case to add a shortcut to one of its sections.</p>{/if}
  </div>
  <p role="status" tabindex="-1" bind:this={status}>{message}</p>
</section>

<style>
  section{min-width:0;display:grid;gap:12px;padding-top:8px;font:400 var(--text-xs)/1.5 var(--font-sans)}p{margin:0;color:var(--text);overflow-wrap:anywhere}.favourites-lifetime,.favourites-count{color:var(--muted)}.favourites-count{font-weight:600}.favourite-add{display:grid;gap:8px;min-width:0;padding-top:12px;border-top:1px solid var(--border)}label{display:grid;gap:6px;min-width:0;font-weight:600}select,button,a{min-height:44px;max-width:100%;font:inherit}select{width:100%;min-width:0;font-weight:400}button{padding:8px 10px;white-space:normal;overflow-wrap:anywhere}ul{list-style:none;padding:0;margin:0;display:grid;gap:12px}li{min-width:0;display:grid;gap:6px}a,span{overflow-wrap:anywhere;min-width:0}a.favourite-link{display:block;align-content:center;color:var(--text)}small{display:block;margin-top:4px;font-family:var(--mono);overflow-wrap:anywhere}a.active,[aria-current=page]{color:var(--accent);font-weight:650}code{white-space:normal;overflow-wrap:anywhere}[role=alert]{color:var(--danger)}[role=status]:empty{display:none}@media print{section{display:none!important}}
</style>

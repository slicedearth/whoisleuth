<script lang="ts">
  import { tick } from 'svelte';
  import { formatEvidenceDate } from '$lib/analysis/evidence-time.ts';
  import type { InvestigationInfrastructureRelationships } from '$lib/analysis/investigation-infrastructure.ts';
  import type { InvestigationSearchSession } from '$lib/investigation-search-session';
  import Pagination from './Pagination.svelte';
  import BoundedRelationshipMap from './BoundedRelationshipMap.svelte';
  import { INFRASTRUCTURE_RELATIONSHIP_LABELS as labels, projectInfrastructureTopology } from '$lib/analysis/infrastructure-topology.ts';
  let { session, entityId, onopen, onselect }: {
    session: InvestigationSearchSession;
    entityId: string;
    onopen: (event: MouseEvent, href: string) => void;
    onselect: (id: string, label: string) => void;
  } = $props();
  let page = $state(1), pending = $state(false), error = $state('');
  let response = $state.raw<InvestigationInfrastructureRelationships | null>(null);
  let heading = $state<HTMLHeadingElement>();
  let sourceList = $state<HTMLOListElement>();
  let view = $state<'list' | 'topology'>('list'), query = $state(''), focusedEntityId = $state(''), highlightedEntityId = $state('');
  const topology = $derived(response ? projectInfrastructureTopology(response, query, focusedEntityId) : null);
  let focusPage = false;
  let lastEntity = '';
  $effect(() => {
    const current = session, selected = entityId, requestedPage = page;
    let active = true;
    pending = true; error = '';
    if (lastEntity !== selected) { lastEntity = selected; response = null; query = ''; focusedEntityId = selected; highlightedEntityId = ''; }
    void current.infrastructureRelationships(selected, requestedPage, query).then(async value => {
      if (!active) return;
      response = value; pending = false;
      if (focusPage) { focusPage = false; await tick(); if (active) heading?.focus({ preventScroll: true }); }
      if (highlightedEntityId) { await tick(); if (active) focusSource(highlightedEntityId); }
    }).catch(cause => {
      if (!active) return;
      pending = false;
      error = cause instanceof DOMException && cause.name === 'AbortError'
        ? 'This relationship request was replaced by another saved-work operation. Close and reopen this detail to retry.'
        : 'Retained relationships could not be read. Close and reopen this detail to retry.';
    });
    return () => { active = false; };
  });
  function showSources(id: string) {
    highlightedEntityId = id;
    const target = response?.topologyRows?.find(row => row.from.id === id || row.to.id === id)?.sourcePage;
    if (target && target !== page) { page = target; return; }
    focusSource(id);
  }
  function focusSource(id: string) {
    const row = sourceList && [...sourceList.children].find(element => element instanceof HTMLLIElement
      && (element.dataset.from === id || element.dataset.to === id));
    if (row instanceof HTMLElement) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); }
  }
</script>

<section class="relationships" aria-label="Directly supported retained relationships" aria-busy={pending}>
  {#if error}<p role="alert">{error}</p>
  {:else if !response}<p role="status">Reading retained relationships…</p>
  {:else if response.state !== 'ready'}<p role="status">This retained identity is unavailable or ambiguous.</p>
  {:else}
    {#if pending}<p role="status">Updating retained relationships…</p>{/if}
    <h4 bind:this={heading} tabindex="-1">{response.relationshipCount} one-hop relationship{response.relationshipCount === 1 ? '' : 's'}</h4>
    <p>{response.total} retained relationship/source row{response.total === 1 ? '' : 's'}. Independent sources have separate rows.</p>
    <p>Source page {response.page} of {response.pageCount} · {response.rows.length} rows shown. The optional diagram searches the complete admitted one-hop relationship set, independently of this source page.</p>
    {#if response.partial}<p>Relationship or source coverage is incomplete.</p>{/if}
    {#if !response.total}<p>No supported one-hop relationship is admitted here. This does not establish absence elsewhere.</p>{/if}
    {#if response.total}
      <div class="view-controls" role="group" aria-label="Retained relationship view">
        <button class="btn small" type="button" aria-pressed={view === 'list'} onclick={() => { view = 'list'; highlightedEntityId = ''; }}>List only</button>
        <button class="btn small" type="button" aria-pressed={view === 'topology'} onclick={() => view = 'topology'}>Topology and list</button>
      </div>
    {/if}
    {#if view === 'topology' && topology}
      <section class="topology-controls" aria-label="Retained topology controls">
        <label>Search complete retained topology<input type="search" bind:value={query} oninput={() => highlightedEntityId = ''} maxlength="200" autocomplete="off" spellcheck="false"></label>
        <p role="status">{topology.rows.length} of {response.topologyTotal ?? response.rows.length} matching relationships shown. The diagram is bounded to 50 relationships; search narrows the full admitted set. All admitted relationship/source rows remain accessible through the source pages below.</p>
        {#if topology.focusEntity}
          <label>Focus diagram identity<select value={topology.focusEntity.id} onchange={event => { focusedEntityId = event.currentTarget.value; highlightedEntityId = ''; }}>{#each topology.diagramEntities as entity (entity.id)}<option value={entity.id}>[{entity.diagramReference}] {entity.canonical} · {entity.type.replaceAll('_', ' ')}</option>{/each}</select></label>
          <p>Focused identity [{topology.focusEntity.diagramReference}]: {topology.focusEntity.canonical} · {topology.focusEntity.type.replaceAll('_', ' ')}</p>
          <div class="actions"><button class="btn small" type="button" onclick={() => showSources(topology!.focusEntity!.id)}>Show exact source rows for {topology.focusEntity.canonical}</button>
            {#if topology.focusEntity.id !== entityId}<button class="btn small" type="button" onclick={() => onselect(topology!.focusEntity!.id, topology!.focusEntity!.label)}>Inspect retained evidence for {topology.focusEntity.canonical}</button>{/if}
          </div>
          {#key query}
            <BoundedRelationshipMap title="Retained one-hop topology" description="Groups organise identity types; arrows follow From → To. Diagram references distinguish abbreviated labels." nodes={topology.nodes} links={topology.links} focusNodeId={topology.focusNodeId} layout="grouped" directed observedLabel="Retained direct or normalised" limitation="One diagram link represents one admitted relationship; independent supporting sources remain separate in the paginated source list. Paths across different dates do not establish a contemporaneous alias chain." />
          {/key}
        {:else}<p>No admitted relationships match this diagram search. Use the unchanged source list or clear the search.</p>{/if}
      </section>
    {/if}
    <ol bind:this={sourceList} aria-label="Retained relationship sources">
      {#each response.rows as row (row.id)}
        {@const related = row.from.id === entityId ? row.to : row.from}
        <li tabindex="-1" data-from={row.from.id} data-to={row.to.id} class:highlighted={highlightedEntityId === row.from.id || highlightedEntityId === row.to.id}>
          {#if highlightedEntityId === row.from.id || highlightedEntityId === row.to.id}<small>Source row for the focused diagram identity</small>{/if}
          <h5>{labels[row.type]}</h5>
          <dl>
            <div><dt>From</dt><dd>{row.from.canonical} <small>({row.from.type.replaceAll('_', ' ')}) · identity {row.from.id}</small></dd></div>
            <div><dt>To</dt><dd>{row.to.canonical} <small>({row.to.type.replaceAll('_', ' ')}) · identity {row.to.id}</small></dd></div>
            <div><dt>Classification</dt><dd>{row.classification} · {row.partial ? 'Partial or unknown completeness' : 'Complete retained evidence'}</dd></div>
            <div><dt>Method</dt><dd>{row.method}</dd></div>
            <div><dt>Admitted source observations</dt><dd>{row.sourceCount}</dd></div>
            {#if row.source}
              <div><dt>Supporting source</dt><dd>{row.source.source} · {row.source.recordId}</dd></div>
              <div><dt>Source identity</dt><dd>{row.source.id}</dd></div>
              <div><dt>Observed</dt><dd>{formatEvidenceDate(row.source.observedAt, 'Unknown time')}</dd></div>
            {:else}<div><dt>Supporting source</dt><dd>Unavailable; the retained link is not independently attributable from this source row.</dd></div>{/if}
          </dl>
          <div class="actions">
            {#if row.source?.href}<a href={row.source.href} onclick={event => onopen(event, row.source!.href)}>{row.source.action}</a>{/if}
            {#if related.id !== entityId}<button class="btn small" type="button" onclick={() => onselect(related.id, related.label)}>Inspect retained evidence for {related.label}</button>{/if}
          </div>
          {#if row.limitations.length || row.source?.limitations.length}
            <details><summary>Relationship and source limitations</summary><ul>
              {#each row.limitations as limitation}<li>{limitation}</li>{/each}
              {#each row.source?.limitations ?? [] as limitation}<li>{limitation}</li>{/each}
            </ul></details>
          {/if}
        </li>
      {/each}
    </ol>
    <Pagination currentPage={response.page} pageCount={response.pageCount} setPage={value => { if (!pending) { focusPage = true; page = value; } }} ariaLabel="Retained relationship pages" />
    <details><summary>Retained topology scope and missing evidence</summary><ul>{#each response.limitations as limitation}<li>{limitation}</li>{/each}</ul><p>Grouping and namespace similarity add no observed connections. Inspecting a related identity opens its own retained sources and one-hop relationships. It does not discover additional hosts or establish an observed multi-hop chain.</p></details>
  {/if}
</section>

<style>
  .relationships{min-width:0;margin-top:20px;font-size:var(--text-xs);line-height:1.55}
  h4{margin:0;font:700 var(--text-sm) var(--mono)}h5{margin:0;font:650 var(--text-sm) var(--font-sans)}
  p{margin:8px 0;overflow-wrap:anywhere}ol{list-style:none;margin:12px 0;padding:0;display:grid;gap:14px}
  li{min-width:0;border-top:1px solid var(--border);padding-top:12px}dl{display:grid;gap:5px;margin:10px 0}
  dl>div{display:grid;grid-template-columns:8rem minmax(0,1fr);gap:8px}dt,small{color:var(--muted)}dd{margin:0;min-width:0;overflow-wrap:anywhere}
  .actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.actions>*{max-width:100%;white-space:normal;overflow-wrap:anywhere}
  .view-controls{display:flex;flex-wrap:wrap;gap:8px;margin-block:12px}.view-controls [aria-pressed="true"]{border-color:var(--accent);color:var(--text)}.topology-controls{min-width:0}.topology-controls label{display:grid;gap:6px;max-width:100%;min-width:0;margin-block:12px}.topology-controls input,.topology-controls select{min-width:0;width:100%;min-height:44px}.highlighted{background:var(--panel-raised)}li:focus-visible{outline:2px solid var(--focus);outline-offset:4px}
  a{color:var(--accent);padding-block:6px}details{margin-top:8px}summary{cursor:pointer}ul{padding-left:20px;overflow-wrap:anywhere}
  @media(max-width:640px){dl>div{grid-template-columns:minmax(0,1fr);gap:0}.actions>*{min-height:44px}}
</style>

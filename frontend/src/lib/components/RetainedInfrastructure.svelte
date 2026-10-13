<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { INFRASTRUCTURE_ENTITY_TYPES, type InfrastructureEntityType, type InvestigationInfrastructure } from '#lib/analysis/investigation-infrastructure.ts';
  import { MAX_INVESTIGATION_SEARCH_QUERY_LENGTH } from '#lib/analysis/investigation-search.ts';
  import type { InvestigationStoreName } from '#lib/analysis/investigation-projection.ts';
  import type { InvestigationSearchSession } from '#lib/investigation-search-session.ts';
  import type { InvestigationHistory as RetainedHistory } from '#lib/analysis/investigation-search.ts';
  import { initialInfrastructureNavigationState, recordVisitedConsoleInfrastructure, updateVisitedConsoleInfrastructure,
    consoleInfrastructureHref, setCaseNavigationContext, captureConsoleReferenceScope, readConsoleReferenceView,
    type VisitedConsoleInfrastructure } from '#lib/console-workflow-state.ts';
  import Pagination from './Pagination.svelte';
  import InvestigationHistory from './InvestigationHistory.svelte';
  import InfrastructureRelationships from './InfrastructureRelationships.svelte';
  import InfrastructureSnapshotReview from './InfrastructureSnapshotReview.svelte';
  let { session, onopen, initialVisit }: { session: InvestigationSearchSession; onopen?: (href: string) => void | Promise<void>; initialVisit?: VisitedConsoleInfrastructure } = $props();
  let navigation = $state(untrack(() => initialVisit ? { ...initialVisit.view } : initialInfrastructureNavigationState()));
  let visitId = $state<number | null>(untrack(() => initialVisit?.id ?? null));
  let selectionScope = untrack(captureConsoleReferenceScope);
  let pending = $state(false), error = $state('');
  let completed = $state.raw<{ session: InvestigationSearchSession; response: InvestigationInfrastructure } | null>(null);
  let selected = $state<{ id: string; label: string } | null>(untrack(() => initialVisit ? { id: initialVisit.entityId, label: initialVisit.label } : null));
  let historySettled = $state(false);
  let heading = $state<HTMLHeadingElement>(), detailHeading = $state<HTMLHeadingElement>();
  let returnFocus: HTMLElement | undefined, focusPage = false, restoreFocus = untrack(() => Boolean(initialVisit));
  const instanceId = $props.id();
  const response = $derived(completed?.session === session ? completed.response : null);
  const typeLabels: Record<InfrastructureEntityType, string> = { domain: 'Domain / hostname', ip_address: 'IP address', certificate: 'Certificate', nameserver_set: 'Nameserver set', http_origin: 'HTTP origin', certificate_pattern: 'Certificate wildcard pattern', provider: 'Source-qualified provider role', routing_asn: 'Independently sourced routing ASN' };
  const fieldLabels: Record<NonNullable<InvestigationInfrastructure['rows'][number]['matchedField']>, string> = {
    canonical: 'Canonical value', label: 'Label', domain: 'Domain', name: 'Name', nameserver: 'Nameserver',
    origin: 'HTTP origin', sha256: 'SHA-256', ip: 'IP address', identifier: 'Identifier', value: 'Relationship value',
  };
  const storeLabels: Record<InvestigationStoreName, string> = { cases: 'Cases', campaigns: 'Campaigns', brandProfiles: 'Brand profiles', relationshipRows: 'Scan relationship evidence', relationshipObservations: 'Retained relationship observations' };
  $effect(() => {
    const { query, page, type, store, since } = navigation;
    const current = session, options = { query, page, ...(type ? { type } : {}), ...(store ? { store } : {}), ...(since ? { observedSince: `${since}T00:00:00.000Z` } : {}) };
    let active = true;
    pending = true; completed = null; error = '';
    void current.infrastructure(options).then(async value => {
      if (!active) return;
      completed = { session: current, response: value }; pending = false;
      if (focusPage) { focusPage = false; await tick(); if (active) revealFocus(heading, 'start'); }
    }).catch(cause => {
      if (!active) return;
      pending = false;
      error = cause instanceof DOMException && cause.name === 'AbortError'
        ? 'This inventory request was replaced by another saved-work operation. Change a filter or reopen this view to retry.'
        : 'Retained infrastructure could not be read. Close and reopen this view to retry.';
    });
    return () => { active = false; };
  });
  $effect(() => {
    const id = visitId, state = { ...navigation };
    if (id !== null) untrack(() => updateVisitedConsoleInfrastructure(id, state));
  });
  function changed() { navigation.page = 1; selected = null; visitId = null; focusPage = false; }
  function revealFocus(target: HTMLElement | undefined, block: ScrollLogicalPosition = 'nearest') {
    target?.scrollIntoView({ block, behavior: 'instant' });
    target?.focus({ preventScroll: true });
  }
  async function inspect(id: string, label: string, origin?: HTMLElement) {
    if (origin) returnFocus = origin;
    if (selected?.id !== id) {
      historySettled = false; visitId = null;
      selectionScope = captureConsoleReferenceScope();
      navigation.historyPage = 1; navigation.relationshipPage = 1; navigation.relationshipView = 'list';
      navigation.relationshipQuery = ''; navigation.focusedEntityId = ''; navigation.highlightedEntityId = '';
    }
    selected = { id, label };
    await tick();
    revealFocus(detailHeading, 'start');
  }
  async function closeDetail() {
    selected = null; visitId = null;
    await tick();
    revealFocus(returnFocus?.isConnected ? returnFocus : heading);
  }
  function openSource(event: MouseEvent, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const destination = new URL(href, 'https://console.invalid');
    const caseId = destination.searchParams.get('case');
    if (visitId !== null && readConsoleReferenceView().visits.some(visit => visit.kind === 'infrastructure' && visit.id === visitId)
      && destination.origin === 'https://console.invalid' && ['/cases', '/monitor'].includes(destination.pathname) && caseId)
      setCaseNavigationContext(caseId, consoleInfrastructureHref(visitId), 'retained infrastructure');
    if (onopen) { event.preventDefault(); void onopen(href); }
  }
  async function historyReady(value: RetainedHistory | null) {
    historySettled = true;
    if (value?.state === 'ready' && selected?.id === value.entityId) {
      if (visitId === null) visitId = recordVisitedConsoleInfrastructure(value.entityId, value.label, { ...navigation }, selectionScope);
      selected.label = value.label;
    }
    if (restoreFocus) { restoreFocus = false; await tick(); revealFocus(detailHeading, 'start'); }
  }
</script>

<section class="infrastructure" aria-labelledby={`${instanceId}-title`} aria-busy={pending}>
  <h3 id={`${instanceId}-title`} bind:this={heading} tabindex="-1">Retained infrastructure inventory</h3>
  <p>Browse retained identities, dated sources and one-hop relationships without collecting new evidence.</p>
  <div class="filters">
    <label>Search retained infrastructure<input type="search" bind:value={navigation.query} oninput={changed} maxlength={MAX_INVESTIGATION_SEARCH_QUERY_LENGTH} autocomplete="off" autocapitalize="none" spellcheck="false"></label>
    <label>Infrastructure type<select bind:value={navigation.type} onchange={changed}><option value="">All infrastructure types</option>{#each INFRASTRUCTURE_ENTITY_TYPES as value}<option value={value}>{typeLabels[value]}</option>{/each}</select></label>
    <label>Retained source<select bind:value={navigation.store} onchange={changed}><option value="">All retained sources</option>{#each Object.entries(storeLabels) as [value, label]}<option value={value}>{label}</option>{/each}</select></label>
    <label>Observed on or after (UTC)<input type="date" bind:value={navigation.since} onchange={changed}></label>
  </div>
  {#if error}<p role="alert">{error}</p>
  {:else if pending}<p role="status">Reading retained infrastructure…</p>
  {:else if response}
    <p role="status" aria-live="polite">{response.detail}</p>
    {#if response.state === 'ready'}
      <p>{response.admittedCount} admitted infrastructure identit{response.admittedCount === 1 ? 'y' : 'ies'} before filters.{response.partial ? ' Coverage is incomplete; review the scope below.' : ''}</p>
      <ol class="inventory" aria-label="Retained infrastructure identities">
        {#each response.rows as row (row.entityId)}
          <li>
            <h4>{row.label}</h4><p class="meta">{typeLabels[row.type]} · {row.partial ? 'Partial or unknown completeness' : 'Complete retained sources'}</p>
            <dl>
              <div><dt>Exact identity</dt><dd>{row.canonical}</dd></div>
              <div><dt>Retained evidence</dt><dd>{row.observationCount} observations · {row.relationshipCount} one-hop relationships</dd></div>
              <div><dt>Observation interval</dt><dd>{formatEvidenceDate(row.firstObservedAt, 'Unknown first observation')} – {formatEvidenceDate(row.lastObservedAt, 'Unknown last observation')}</dd></div>
              <div><dt>Sources</dt><dd>{row.sourceStores.map(value => storeLabels[value]).join(', ') || 'No usable dated source admitted'}</dd></div>
              {#if row.matchedField}<div><dt>Why shown</dt><dd>{fieldLabels[row.matchedField]}: {row.matchedValue}</dd></div>{/if}
            </dl>
            {#if !row.searchable}<p>No usable source is available for text search.</p>{/if}
            <button type="button" class="btn small" onclick={event => void inspect(row.entityId, row.label, event.currentTarget)}>Inspect retained evidence for {row.label}</button>
            {#if row.type === 'domain' || row.type === 'ip_address' || row.type === 'routing_asn'}
              <a class="btn small" href={`/lookup?q=${encodeURIComponent(row.canonical)}#query`}>Prepare Lookup for {row.canonical}</a>
            {/if}
          </li>
        {/each}
      </ol>
      <Pagination currentPage={response.page} pageCount={response.pageCount} setPage={value => { if (!pending) { navigation.page = value; selected = null; visitId = null; focusPage = true; } }} ariaLabel="Retained infrastructure pages" pageInputLabel="Retained infrastructure page number" />
      <details><summary>Inventory scope and missing evidence</summary><ul>{#each response.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
    {/if}
  {/if}
  {#if selected}
    <section class="selected" aria-label="Selected retained infrastructure evidence">
      <button type="button" class="btn small" onclick={() => void closeDetail()}>Return to inventory results</button>
      <h3 bind:this={detailHeading} tabindex="-1">Retained evidence for {selected.label}</h3>
      <p>Inspect this identity's own retained sources. Related rows remain separately attributed.</p>
      {#key `${selected.id}:${session.summary.entityCount}`}
        <InvestigationHistory {session} entityId={selected.id} bind:page={navigation.historyPage} onopen={openSource} onsettled={historyReady} />
        {#if historySettled}
          <InfrastructureRelationships {session} entityId={selected.id} bind:page={navigation.relationshipPage}
            bind:view={navigation.relationshipView} bind:query={navigation.relationshipQuery}
            bind:focusedEntityId={navigation.focusedEntityId} bind:highlightedEntityId={navigation.highlightedEntityId}
            onopen={openSource} onselect={(id, label) => void inspect(id, label)} />
        {/if}
      {/key}
    </section>
  {/if}
  <InfrastructureSnapshotReview {session} />
</section>

<style>
  .infrastructure{min-width:0;margin-top:16px;font-size:var(--text-sm);line-height:1.6}h3,h4{margin:0;overflow-wrap:anywhere}
  p{margin:8px 0;overflow-wrap:anywhere}.meta,dt{color:var(--muted)}.filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}
  label{min-width:0;display:grid;gap:5px;font-size:var(--text-xs)}input,select{min-width:0;width:100%;min-height:44px}
  .inventory{list-style:none;margin:16px 0;padding:0;display:grid;gap:14px}.inventory>li{min-width:0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  dl{display:grid;gap:5px;margin:10px 0;font-size:var(--text-xs)}dl>div{display:grid;grid-template-columns:9rem minmax(0,1fr);gap:8px}dd{min-width:0;margin:0;overflow-wrap:anywhere}
  button{max-width:100%;white-space:normal;overflow-wrap:anywhere}details{margin-top:12px}summary{cursor:pointer}ul{padding-left:20px;overflow-wrap:anywhere}
  .selected{min-width:0;margin-top:22px;padding-top:18px;border-top:1px solid var(--border)}.selected h3{margin-top:14px}
  h3,.inventory button{scroll-margin-block:calc(var(--console-toolbar-height,54px) + 12px)}
  @media(max-width:640px){.filters{grid-template-columns:minmax(0,1fr)}dl>div{grid-template-columns:minmax(0,1fr);gap:0}.inventory>li{padding:12px}}
</style>

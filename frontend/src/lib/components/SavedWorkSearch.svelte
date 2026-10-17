<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import InvestigationSearch from './InvestigationSearch.svelte';
  import RetainedInfrastructure from './RetainedInfrastructure.svelte';
  import { readBrowserLocalData, subscribeBrowserLocalData } from '#lib/browser-local-data-service.ts';
  import { createInvestigationSearchSession, type InvestigationSearchSession } from '#lib/investigation-search-session.ts';
  import type { InvestigationStoreName } from '#lib/analysis/investigation-projection.ts';
  import { readConsoleReferenceView, subscribeConsoleReferenceView, type VisitedConsoleInfrastructure } from '#lib/console-workflow-state.ts';

  let { compact = false, onopen }: { compact?: boolean; onopen?: (href: string) => void | Promise<void> } = $props();
  let session = $state.raw<InvestigationSearchSession | null>(null);
  let loadError = $state('');
  let infrastructureOpen = $state(false);
  let references = $state(readConsoleReferenceView());
  const requestedVisit = $derived(!compact ? page.url.searchParams.get('infrastructure') : null);
  const restored = $derived(references.visits.find((visit): visit is VisitedConsoleInfrastructure => visit.kind === 'infrastructure' && String(visit.id) === requestedVisit));
  $effect(() => { if (requestedVisit !== null || !compact && page.url.hash === '#retained-infrastructure') infrastructureOpen = true; });
  let controller: AbortController | undefined;
  const collections = ['cases', 'campaigns', 'brand_profiles', 'relationship_observations'] as const;

  async function refresh() {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    session?.dispose();
    session = null;
    loadError = '';
    const results = await Promise.allSettled([
      readBrowserLocalData('cases'), readBrowserLocalData('campaigns'),
      readBrowserLocalData('brand_profiles'), readBrowserLocalData('relationship_observations'),
    ]);
    if (request.signal.aborted) return;
    if (results.every(result => result.status === 'rejected')) {
      loadError = 'Saved work could not be loaded. Try searching again.';
      return;
    }
    const [cases, campaigns, profiles, relationships] = results;
    const unavailable: InvestigationStoreName[] = [];
    if (cases.status === 'rejected') unavailable.push('cases');
    if (campaigns.status === 'rejected') unavailable.push('campaigns');
    if (profiles.status === 'rejected') unavailable.push('brandProfiles');
    if (relationships.status === 'rejected') unavailable.push('relationshipObservations');
    try {
      const loaded = await createInvestigationSearchSession({
        cases: cases.status === 'fulfilled' ? cases.value : undefined,
        campaigns: campaigns.status === 'fulfilled' ? campaigns.value : undefined,
        brandProfiles: profiles.status === 'fulfilled' ? profiles.value : undefined,
        relationshipObservations: relationships.status === 'fulfilled' ? relationships.value : undefined,
      }, unavailable, { signal: request.signal });
      if (request.signal.aborted) { loaded.dispose(); return; }
      session = loaded;
    } catch {
      if (!request.signal.aborted) loadError = 'Saved-work search could not be prepared. No saved records were changed.';
    }
  }

  onMount(() => {
    void refresh();
    const stopReferences = subscribeConsoleReferenceView(() => { references = readConsoleReferenceView(); });
    const subscriptions = collections.map(collection => subscribeBrowserLocalData(collection, () => void refresh()));
    return () => { stopReferences(); controller?.abort(); session?.dispose(); subscriptions.forEach(unsubscribe => unsubscribe()); };
  });
</script>

<InvestigationSearch {session} {loadError} {compact} {...(onopen ? {onopen} : {})} />
{#if !compact}
  <details id="retained-infrastructure" class="infrastructure-disclosure card" open={infrastructureOpen} ontoggle={event => { if (event.currentTarget.isConnected) infrastructureOpen = event.currentTarget.open; }}>
    <summary>Browse retained infrastructure</summary>
    {#if infrastructureOpen && requestedVisit !== null && !restored}<p role="status">This tab navigation reference is no longer available. Clear the return link to browse current saved work.</p><a href="/dashboard#retained-infrastructure">Browse current saved work</a>{/if}
    {#if infrastructureOpen && session && (requestedVisit === null || restored)}
      {#key requestedVisit}<RetainedInfrastructure {session} {...(restored ? {initialVisit:restored} : {})} {...(onopen ? {onopen} : {})} />{/key}
    {:else if infrastructureOpen && (requestedVisit === null || restored)}<p role="status">{loadError || 'Preparing retained infrastructure.'}</p>{/if}
  </details>
{/if}

<style>
  .infrastructure-disclosure{min-width:0;padding:var(--card-pad);margin-top:14px}
  summary{cursor:pointer;overflow-wrap:anywhere}p{overflow-wrap:anywhere}
</style>

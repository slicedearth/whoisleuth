<script lang="ts">
  import { onMount } from 'svelte';
  import InvestigationSearch from './InvestigationSearch.svelte';
  import { readBrowserLocalData, subscribeBrowserLocalData } from '$lib/browser-local-data-service.ts';
  import { createInvestigationSearchSession, type InvestigationSearchSession } from '$lib/investigation-search-session.ts';
  import type { InvestigationStoreName } from '$lib/analysis/investigation-projection.ts';

  let { compact = false, onopen }: { compact?: boolean; onopen?: (href: string) => void | Promise<void> } = $props();
  let session = $state.raw<InvestigationSearchSession | null>(null);
  let loadError = $state('');
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
      loadError = 'Saved work could not be read. No empty-workspace conclusion has been drawn.';
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
    const subscriptions = collections.map(collection => subscribeBrowserLocalData(collection, () => void refresh()));
    return () => { controller?.abort(); session?.dispose(); subscriptions.forEach(unsubscribe => unsubscribe()); };
  });
</script>

<InvestigationSearch {session} {loadError} {compact} {...(onopen ? {onopen} : {})} />

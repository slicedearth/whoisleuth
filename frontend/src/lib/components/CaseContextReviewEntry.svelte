<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseOperation } from '$lib/analysis/case-response-stage.ts';
  import DeferredSurface from './DeferredSurface.svelte';
  import { loadDeferredModule } from '$lib/deferred-module';
  let { record, mutationBusy, persistOperation }: { record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation } = $props();
  let activated = $state(false);
  const load = () => import('./CaseContextReviews.svelte');
  function prepare() { void loadDeferredModule(load).catch(() => {}); }
</script>
<details class="context-entry" onpointerenter={prepare} onfocusin={prepare} ontoggle={event => { if (event.currentTarget.open) activated = true; }}><summary>Specialist evidence reviews</summary>
  {#if activated}<DeferredSurface {load} props={{ record, mutationBusy, persistOperation }} loadingLabel="Opening contextual reviews…" unavailableLabel="Contextual reviews could not load." />{/if}
</details>
<style>.context-entry{min-width:0;border-block:1px solid var(--border);padding-block:12px}.context-entry>summary{cursor:pointer;min-height:44px;padding-block:12px;overflow-wrap:anywhere}</style>

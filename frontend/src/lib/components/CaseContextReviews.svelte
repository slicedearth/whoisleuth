<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseOperation } from '$lib/analysis/case-response-stage.ts';
  import DomainHistoryReview from './DomainHistoryReview.svelte';
  import PlatformContinuityReview from './PlatformContinuityReview.svelte';
  import StorefrontReview from './StorefrontReview.svelte';
  import ConnectorProvenanceReview from './ConnectorProvenanceReview.svelte';
  import IncidentSequenceReview from './IncidentSequenceReview.svelte';
  let { record, mutationBusy, persistOperation }: { record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation } = $props();
  const tasks = [
    { id: 'incident', label: 'Trace an incident', component: IncidentSequenceReview },
    { id: 'history', label: 'Check domain history', component: DomainHistoryReview },
    { id: 'platform', label: 'Track platform objects', component: PlatformContinuityReview },
    { id: 'storefront', label: 'Compare a storefront', component: StorefrontReview },
    { id: 'connector', label: 'Review connector configuration', component: ConnectorProvenanceReview },
  ] as const;
  let selected = $state('');
  let visited = $state<readonly string[]>([]);
  const caseId = $derived(record.id);
  $effect(() => { caseId; selected = ''; visited = []; });
  function select(id: string) { selected = id; if (!visited.includes(id)) visited = [...visited, id]; }
</script>
<div class="reviews">
  <div class="review-tasks" role="group" aria-label="Choose an evidence review">{#each tasks as task}<button class="btn" type="button" aria-pressed={selected === task.id} onclick={() => select(task.id)}>{task.label}</button>{/each}</div>
  {#if !selected}<p>Select a task. Switching tasks keeps opened drafts until you leave this Case.</p>{/if}
  {#each tasks as task}{#if visited.includes(task.id)}<div hidden={selected !== task.id}><task.component {record} {mutationBusy} {persistOperation} /></div>{/if}{/each}
</div>
<style>.reviews{display:grid;gap:18px;min-width:0}.review-tasks{display:flex;flex-wrap:wrap;gap:8px}.review-tasks button{min-height:44px;font:600 var(--text-sm)/1.4 var(--font-sans);padding:8px 12px}.review-tasks [aria-pressed=true]{border-color:var(--interface-accent);background:var(--panel-raised);color:var(--interface-accent)}[hidden]{display:none}p{font-size:var(--text-sm);color:var(--muted)}@media print{.review-tasks{display:none}}</style>

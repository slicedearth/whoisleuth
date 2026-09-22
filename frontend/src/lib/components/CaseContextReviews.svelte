<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseOperation } from '$lib/analysis/case-response-stage.ts';
  import DomainHistoryReview from './DomainHistoryReview.svelte';
  import PlatformContinuityReview from './PlatformContinuityReview.svelte';
  import StorefrontReview from './StorefrontReview.svelte';
  import ConnectorProvenanceReview from './ConnectorProvenanceReview.svelte';
  import IncidentSequenceReview from './IncidentSequenceReview.svelte';
  let { record, mutationBusy, persistOperation }: { record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation } = $props();
</script>
<div class="reviews"><IncidentSequenceReview {record} {mutationBusy} {persistOperation} /><DomainHistoryReview {record} {mutationBusy} {persistOperation} /><PlatformContinuityReview {record} {mutationBusy} {persistOperation} /><StorefrontReview {record} {mutationBusy} {persistOperation} /><ConnectorProvenanceReview {record} {mutationBusy} {persistOperation} /></div>
<style>.reviews{display:grid;gap:18px;min-width:0}</style>

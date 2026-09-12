<script lang="ts">
  import type { CaseEvidencePin } from '$lib/cases';
  let { pin }: { pin: CaseEvidencePin } = $props();
</script>

<span class="evidence-fact">
  <strong>{pin.label}</strong>
  <span class="value">{pin.value}</span>
  <span class="provenance">{pin.source}</span>
  {#if pin.observationHostname}<span class="provenance">Observation hostname: {pin.observationHostname}</span>{/if}
  {#if pin.webObservationMode}<span class="provenance">Selected URL observation; path and query are not retained in this fact.</span>{/if}
  <span class="provenance">{#if pin.observedAt}Observed <time datetime={pin.observedAt}>{pin.observedAt}</time>{:else}Observation time unavailable{/if}</span>
  <span class="provenance">Completeness: {pin.completeness}{pin.truncated ? ' · truncated' : ''}{pin.sourceState ? ` · source state: ${pin.sourceState}` : ''}</span>
  {#each pin.limitations as limitation}<span class="provenance">{limitation}</span>{/each}
</span>

<style>
  .evidence-fact{display:grid;gap:4px;min-width:0;font-size:var(--text-sm);line-height:1.5;overflow-wrap:anywhere}
  strong{color:var(--text);font-weight:650}
  .value{color:var(--text);white-space:pre-wrap}
  .provenance{color:var(--muted);font-size:var(--text-xs)}
</style>

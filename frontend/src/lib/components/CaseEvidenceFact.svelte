<script lang="ts">
  import type { CaseEvidencePin } from '#lib/cases.ts';
  import CopyButton from './CopyButton.svelte';
  import { evidenceFactCitation } from '#lib/analysis/evidence-copy.ts';
  // Opt in only outside labels and other interactive controls.
  let { pin, copyable = false }: { pin: CaseEvidencePin; copyable?: boolean } = $props();
</script>

<span class="evidence-fact">
  <strong>{pin.label}</strong>
  <span class="value">{pin.value}</span>
  <span class="source-strip">
    <span class="provenance"><span class="metadata-label">Source</span>{pin.source}</span>
    <span class="provenance"><span class="metadata-label">Observation time</span>{#if pin.observedAt}<span>Observed <time datetime={pin.observedAt}>{pin.observedAt}</time></span>{:else}Observation time unavailable{/if}</span>
    {#if pin.observationHostname}<span class="provenance"><span class="metadata-label">Observation hostname:</span><span class="identifier">{pin.observationHostname}</span></span>{/if}
  </span>
  {#if pin.webObservationMode}<span class="provenance">Selected URL observation; path and query are not retained in this fact.</span>{/if}
  <span class="provenance">Completeness: {pin.completeness}{pin.truncated ? ' · truncated' : ''}{pin.sourceState ? ` · source state: ${pin.sourceState}` : ''}</span>
  {#if pin.limitations.length}<span class="limitations"><span class="metadata-label">Limitations</span>{#each pin.limitations as limitation}<span>{limitation}</span>{/each}</span>{/if}
  {#if copyable}<CopyButton value={evidenceFactCitation(pin)} label="Copy citation" description={`Copy citation for ${pin.label}`} />{/if}
</span>

<style>
  .evidence-fact{display:grid;gap:8px;min-width:0;font-size:var(--text-sm);line-height:1.6;overflow-wrap:anywhere}
  strong{color:var(--text);font-weight:650}
  .value{max-width:80ch;color:var(--text);white-space:pre-wrap}
  .source-strip{display:flex;flex-wrap:wrap;gap:10px 24px;padding-block:8px;border-block:1px solid var(--border)}
  .source-strip>.provenance{display:grid;align-content:start;gap:2px;min-width:0;max-width:100%}
  .metadata-label{display:block;font-size:var(--text-2xs);font-weight:650;color:var(--muted)}
  time,.identifier{font-family:var(--mono);font-size:var(--type-data-size)}
  .provenance{color:var(--muted);font-size:var(--text-xs)}
  .limitations{display:grid;gap:2px;color:var(--muted);font-size:var(--text-xs)}
</style>

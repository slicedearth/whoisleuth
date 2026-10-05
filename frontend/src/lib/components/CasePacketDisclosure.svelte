<script lang="ts">
  import type { buildCaseResponseReviewInputs } from '../../../../packages/cases/case-response-packet.mts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  let { material, retainedPinCount }: {
    material: ReturnType<typeof buildCaseResponseReviewInputs>;
    retainedPinCount: number;
  } = $props();
  const queryUrls = $derived(material.incident.abusiveUrls.filter(value => {
    try { const url = new URL(value); return Boolean(url.search || url.hash); } catch { return false; }
  }));
  const correction = $derived(material.escalationHistory.find(action => action.actionId === material.actionBinding.selectedActionId)?.correction);
</script>

<section class="packet-disclosure" aria-label="Recipient copy review">
  <h4>What this recipient will receive</h4>
  <p>{material.recipientRoute?.contact ?? 'No recipient selected'} · {material.profile.label}</p>
  {#if correction}<section aria-label="Correction fields disclosed"><h4>{correction.purpose === 'correction' ? 'Correction request' : 'Retraction request'}</h4><p>Original delivery {correction.deliveryEventId} · packet v{correction.packetVersion} · SHA-256 {correction.packetDigestSha256}</p><p>Analyst reason: {correction.reason}</p><p>Previous statement: {correction.previousStatement}</p><p>Corrected statement: {correction.correctedStatement || 'Request to retract the previous statement'}</p><p>These private correction fields are included in this exact recipient copy. Preparing it is not sending, acceptance or restoration.</p></section>{/if}
  {#each material.sourceQualifications as limitation}<p>{limitation}</p>{/each}
  <dl>
    <div><dt>Incident</dt><dd>{material.incident.category} · {material.incident.affectedParty}</dd></div>
    <div><dt>Observation</dt><dd>{formatEvidenceDate(material.incident.observedAt)}<p>{material.incident.observedHarm}</p></dd></div>
    <div><dt>Exact URLs</dt><dd><ul>{#each material.incident.abusiveUrls as url}<li><code>{url}</code></li>{/each}</ul></dd></div>
    <div><dt>Evidence references</dt><dd>{material.selectedEvidence.length} selected of {retainedPinCount} retained pins. Pin values and file contents are not attached.</dd></div>
    <div><dt>Response history</dt><dd>{material.escalationHistory.length} action record{material.escalationHistory.length === 1 ? '' : 's'} in the selected lineage; {material.escalationHistoryOmitted} other records omitted.</dd></div>
  </dl>
  {#if queryUrls.length}<p class="query-note">{queryUrls.length} selected URL{queryUrls.length === 1 ? ' contains' : 's contain'} a query or fragment. It can be needed to reproduce the page, but may also identify a person or session. Edit the selected URL deliberately if it should not be shared.</p>{/if}
  <details><summary>Selected evidence and file references</summary>
    <ul>{#each material.selectedEvidence as pin (pin.id)}<li><strong>{pin.label}</strong> · {pin.source} · {formatEvidenceDate(pin.observedAt)} · {pin.completeness}<p>Reference: <code>{pin.id}</code></p>{#if pin.limitations.length}<p>{pin.limitations.join(' ')}</p>{/if}</li>{/each}
    {#each material.artefactReferences as file}<li><strong>{file.label}</strong> · {file.mediaType}<p>SHA-256: <code>{file.digestSha256}</code></p></li>{/each}</ul>
  </details>
  <details><summary>Exact reviewed fields</summary><p>These are the material fields used by the packet writer. Export also adds its creation time, authorisation, provenance and integrity envelope.</p><pre>{JSON.stringify(material, null, 2)}</pre></details>
  <details><summary>Kept out of this copy</summary><ul>{#each material.profile.excludedEvidence as excluded}<li>{excluded}</li>{/each}</ul><p>Private Case originals remain unchanged. Review any free-text evidence, request references and contact details included above before authorising this copy.</p></details>
</section>

<style>
  .packet-disclosure{min-width:0;display:grid;gap:10px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  h4,p{margin:0}h4{font-size:var(--text-sm)}p,dd,li{font-size:var(--text-xs);line-height:1.55;overflow-wrap:anywhere}
  dl{display:grid;gap:10px;margin:0}dl>div{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,3fr);gap:12px}dt{font-size:var(--text-xs);font-weight:700;color:var(--muted)}dd{margin:0;min-width:0}dd p{margin-top:4px}
  ul{padding-left:20px;margin:6px 0;display:grid;gap:8px}code{overflow-wrap:anywhere;font-size:inherit}summary{cursor:pointer;min-height:32px;align-content:center;font-size:var(--text-xs)}pre{max-height:420px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--text-xs)}
  .query-note{padding:10px;border-inline-start:2px solid var(--amber)}
  @media(max-width:600px){dl>div{grid-template-columns:1fr;gap:4px}}
</style>

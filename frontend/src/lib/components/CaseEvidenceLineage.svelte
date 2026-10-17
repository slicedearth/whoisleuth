<script lang="ts">
  import { untrack } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import { caseEvidenceChoiceName, caseEvidenceOrigin } from '#lib/analysis/case-evidence-presentation.ts';
  import { caseEvidenceReferenceResolver } from '../../../../packages/cases/case-evidence-references.mts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  import CollectionReceiptReview from './CollectionReceiptReview.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';

  let { record, pinIds, packet = false }: { record: CaseRecord; pinIds: readonly string[]; packet?: boolean } = $props();
  let expanded = $state(false), selectedId = $state('');
  const identity = $derived(JSON.stringify([record.id, pinIds]));
  const references = $derived(expanded ? caseEvidenceReferenceResolver(record.evidencePins)(pinIds) : []);
  const origin = $derived(selectedId && references.some(reference => reference.id === selectedId)
    ? caseEvidenceOrigin(record, selectedId) : null);
  $effect(() => { identity; untrack(() => { expanded = false; selectedId = ''; }); });
</script>

<details class="evidence-lineage" bind:open={expanded}>
  <summary>{packet ? 'Trace selected evidence to its source' : 'Collection context for selected checkpoints'}</summary>
  {#if expanded}
    <p>{packet
      ? 'Local Case context for the pins selected above. It is not added to the recipient copy; use What this recipient will receive to inspect that copy.'
      : 'Follow one retained pin to its exact checkpoint and collection choices. This does not collect or save evidence.'}</p>
    {#if references.length}
      <label>Evidence reference to trace
        <select bind:value={selectedId}>
          <option value="">Choose a retained reference</option>
          {#each references as reference, index (reference.id)}
            <option value={reference.id}>{reference.pin ? caseEvidenceChoiceName(reference.pin, index) : `Unavailable reference · ${reference.id}`}</option>
          {/each}
        </select>
      </label>
      {#if origin}
        <section aria-label="Selected checkpoint collection context">
          {#if origin.pin}
            <h5>Retained observation</h5>
            <CaseEvidenceFact pin={origin.pin} copyable />
            <dl>
              <div><dt>Case reference</dt><dd><code>{record.id}</code></dd></div>
              <div><dt>Pin reference</dt><dd><code>{origin.pin.id}</code></dd></div>
              <div><dt>Saved to Case</dt><dd><EvidenceTimestamp value={origin.pin.createdAt} copyable={false} /></dd></div>
              <div><dt>Exact object scope</dt><dd>{#if origin.pin.responseObject}{origin.pin.responseObject.kind.replaceAll('_', ' ')} · <code>{origin.pin.responseObject.identifier}</code>{:else}Not recorded; the Case domain is not substituted.{/if}</dd></div>
              <div><dt>Checkpoint reference</dt><dd>{#if origin.pin.checkpointId}<code>{origin.pin.checkpointId}</code>{:else}Not recorded{/if}</dd></div>
              {#if origin.pin.importContentSha256}<div><dt>Imported finding identity</dt><dd><code>{origin.pin.importContentSha256}</code></dd></div>{/if}
            </dl>
            <p>Observation and saving times are separate. A checkpoint groups selected facts; it is not a complete saved Lookup or an independent observation.</p>
            {#if origin.receipt}<CollectionReceiptReview receipt={origin.receipt} />
            {:else}<p>Collection context is unavailable for this exact reference. It is not reconstructed from matching labels, timestamps, values or the collection depth.</p>{/if}
          {:else}<p>This exact evidence reference is unavailable or ambiguous in the current Case: <code>{selectedId}</code>. No other pin or collection context was substituted.</p>{/if}
        </section>
      {/if}
    {:else}<p>{packet ? 'No evidence pins are selected for this packet.' : 'No evidence pins are retained in this Case.'}</p>{/if}
  {/if}
</details>

<style>
  .evidence-lineage{min-width:0;overflow-wrap:anywhere;margin-block:12px}
  summary{cursor:pointer;min-height:44px;align-content:center;font-weight:600}
  label{display:grid;gap:6px;max-width:100%;font-size:var(--text-sm)}
  select{width:100%;max-width:100%;min-width:0}
  section{min-width:0;padding-block:12px}h5{font-size:var(--text-sm);margin:8px 0}
  p,dt,dd{font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}dt{color:var(--muted)}dd{margin:4px 0 0}
  code{white-space:normal;overflow-wrap:anywhere;font-size:inherit}
  @media(max-width:600px){dl{grid-template-columns:minmax(0,1fr)}}
  @media print{.evidence-lineage{display:none}}
</style>

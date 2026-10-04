<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import type { PersistCaseOperation } from '#lib/analysis/case-response-stage.ts';
  import { MAX_CONTEXT_RECORDS, MAX_CONTEXT_INPUT_BYTES, type ContextReview } from '../../../../packages/contracts/context-review.mts';
  import { incidentPresentation, type ContextReviewPresentation } from '#lib/analysis/context-review-presentation.ts';
  import LocalFileInput from './LocalFileInput.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  import { MAX_RESPONSE_VALUE_LENGTH, MAX_RESPONSE_LABEL_LENGTH, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH } from '../../../../packages/contracts/case-portability.mts';
  import { CASE_PIN_COMPLETENESS } from '../../../../packages/cases/case-response-records.mts';
  import { INCIDENT_SEQUENCE_INPUT_SCHEMA, INCIDENT_SEQUENCE_INPUT_VERSION, INCIDENT_STAGE_KINDS, INCIDENT_STAGE_BASES, readIncidentStages, incidentStageFromPin, reviewIncidentSequence, type IncidentStage } from '../../../../packages/investigation/incident-sequence-review.mts';
  import { readContextFile, readContextEvidence } from '#lib/context-review-input.ts';
  import CaseContextReport from './CaseContextReport.svelte';
  import Pagination from './Pagination.svelte';
  import './context-review.css';
  let { record, mutationBusy, persistOperation }: { record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation } = $props();
  let stages = $state<IncidentStage[]>([]), kind = $state<IncidentStage['kind']>('message'), basis = $state<IncidentStage['basis']>('reported_action'), selectedPin = $state('');
  let description = $state(''), occurredAt = $state(''), hostname = $state(''), source = $state(''), reference = $state(''), referenceSha256 = $state(''), completeness = $state<IncidentStage['completeness']>('unknown'), limitations = $state('');
  let report = $state.raw<ContextReview | null>(null), input = $state.raw<unknown>(null), error = $state(''), loading = $state(false), page = $state(1), generation = 0;
  let orderHeading = $state<HTMLHeadingElement>();
  let reviewButton = $state<HTMLButtonElement>();
  let presentation = $state<ContextReviewPresentation | null>(null);
  onDestroy(() => { generation++; });
  function add(event: SubmitEvent) {
    event.preventDefault(); error = '';
    try {
      let stage: IncidentStage;
      if (basis === 'retained_observation') {
        const pin = record.evidencePins.find(pin => pin.id === selectedPin);
        if (!pin) throw new TypeError('Select a retained observation from this Case.');
        stage = incidentStageFromPin(pin, kind, crypto.randomUUID());
      } else {
        stage = readIncidentStages([{ id: crypto.randomUUID(), kind, basis, description: description.trim().replace(/[\r\n]+/gu, ' '),
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null, hostname: hostname.trim().toLowerCase() || null, source: source.trim(), reference: reference.trim(),
          referenceSha256: referenceSha256.trim() || null, completeness, limitations: limitations.split('\n').map(value => value.trim()).filter(Boolean) }])[0]!;
      }
      stages = readIncidentStages([...stages, stage]); report = null; description = ''; page = Math.ceil(stages.length / 10);
    } catch (cause) { error = cause instanceof Error ? cause.message : 'The stage could not be added. The draft was preserved.'; }
  }
  async function load(file: File | null) {
    if (!file) { generation++; loading = false; return; }
    const request = ++generation; loading = true; error = '';
    try { const next = readIncidentStages(readContextEvidence(await readContextFile(file), INCIDENT_SEQUENCE_INPUT_SCHEMA));
      if (request === generation) { stages = next; report = null; page = 1; } }
    catch { if (request === generation) error = 'Select a supported incident-sequence input. The current draft was preserved.'; }
    finally { if (request === generation) loading = false; }
  }
  async function changeOrder(index: number, offset: number) {
    const next = [...stages], destination = index + offset;
    if (!next[index] || !next[destination]) return;
    [next[index], next[destination]] = [next[destination]!, next[index]!];
    stages = next; report = null; page = Math.floor(destination / 10) + 1;
    await tick(); orderHeading?.focus();
  }
  function review() { report = reviewIncidentSequence(stages, new Date().toISOString()); presentation = incidentPresentation(stages); input = { schema: INCIDENT_SEQUENCE_INPUT_SCHEMA, version: INCIDENT_SEQUENCE_INPUT_VERSION, evidence: stages }; }
</script>
<section class="context-review" aria-label="Incident sequence and reported actions"><h3>Incident sequence and reported actions</h3><div class="body">
  <p>Arrange sourced message, page and account events in the order you want to review.</p>
  <LocalFileInput label="Load an earlier incident-sequence input" accept=".json,application/json" maximumBytes={MAX_CONTEXT_INPUT_BYTES} disabled={loading || mutationBusy} onselect={load} />
  {#if stages.length >= MAX_CONTEXT_RECORDS}<p role="status">The {MAX_CONTEXT_RECORDS}-stage limit is reached. Remove a stage from the list below before adding another.</p>{/if}
  <form onsubmit={add}><fieldset disabled={loading || mutationBusy || stages.length >= MAX_CONTEXT_RECORDS}><legend>Add a stage</legend>
    <div class="fields"><label>Stage kind<select bind:value={kind}>{#each INCIDENT_STAGE_KINDS as value}<option value={value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
      <label>Evidence basis<select bind:value={basis}>{#each INCIDENT_STAGE_BASES as value}<option value={value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label></div>
    {#if basis === 'retained_observation'}
      <label>Retained Case observation<select required bind:value={selectedPin}><option value="">Select an observation</option>{#each record.evidencePins as pin}<option value={pin.id}>{pin.label} · {pin.source}</option>{/each}</select></label>
      <p class="meta">Source, time and collection state come from the selected observation.</p>
    {:else}
      <label>Stage description<textarea required rows="3" maxlength={MAX_RESPONSE_VALUE_LENGTH} bind:value={description}></textarea></label>
      <div class="fields"><label>Source or reporter reference<input required maxlength={MAX_RESPONSE_LABEL_LENGTH} bind:value={source}></label><label>Record reference<input required maxlength="500" bind:value={reference}></label>
        <label>Occurred at (local time, if known)<input type="datetime-local" step="0.001" bind:value={occurredAt}></label><label>Related hostname (if known)<input maxlength="253" bind:value={hostname} placeholder="example.test"></label>
        <label>Source completeness<select bind:value={completeness}>{#each CASE_PIN_COMPLETENESS as value}<option value={value}>{value}</option>{/each}</select></label><label>Reference SHA-256 (if supplied)<input maxlength="64" bind:value={referenceSha256}></label></div>
      <label>Source limitations (one per line)<textarea rows="2" maxlength={MAX_RESPONSE_LIMITATIONS * (MAX_RESPONSE_LIMITATION_LENGTH + 1)} bind:value={limitations}></textarea></label>
    {/if}
    <button class="btn" type="submit">Add incident stage</button>
  </fieldset></form>
  {#if stages.length}<h4 tabindex="-1" bind:this={orderHeading}>Selected stage order</h4><ol aria-label="Incident stage draft" start={(page - 1) * 10 + 1}>{#each stages.slice((page - 1) * 10, page * 10) as stage, index (stage.id)}{@const position = (page - 1) * 10 + index}<li><strong>{stage.kind.replaceAll('_', ' ')} · {stage.basis.replaceAll('_', ' ')}</strong><p>{stage.description}</p><p class="meta">{stage.source}</p><EvidenceTimestamp value={stage.occurredAt} label="draft event time" unavailable="Time unknown" /><div class="actions">
    <button class="btn small" type="button" disabled={position === 0} onclick={() => void changeOrder(position, -1)}>Move stage {position + 1} earlier</button><button class="btn small" type="button" disabled={position === stages.length - 1} onclick={() => void changeOrder(position, 1)}>Move stage {position + 1} later</button>
    <button class="btn small" type="button" onclick={async () => { stages = stages.filter(row => row.id !== stage.id); report = null; page = Math.max(1, Math.min(page, Math.ceil(stages.length / 10))); await tick(); (orderHeading ?? reviewButton)?.focus(); }}>Remove stage {position + 1}</button>
  </div></li>{/each}</ol><Pagination currentPage={page} pageCount={Math.ceil(stages.length / 10)} setPage={next => page = next} ariaLabel="Incident stages" />{/if}
  <button class="btn" type="button" disabled={loading || mutationBusy} bind:this={reviewButton} onclick={review}>Review incident sequence</button>
  {#if error}<p role="alert">{error}</p>{/if}{#if report}<CaseContextReport {report} {record} {mutationBusy} {persistOperation} {presentation} reusableInput={input} />{/if}
</div></section>

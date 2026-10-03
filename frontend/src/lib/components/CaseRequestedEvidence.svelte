<script lang="ts">
  import { tick } from 'svelte';
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import { submittedPacketReceipts, latestEvidenceRequests, evidenceRequestDelivery, type CaseEvidenceRequest } from '../../../../packages/cases/case-requested-evidence.mts';
  import { MAX_RESPONSE_VALUE_LENGTH, MAX_RESPONSE_RATIONALE_LENGTH } from '../../../../packages/contracts/case-portability.mts';
  import { isoFromUtcInput, utcDateTimeInputAttributes } from '$lib/analysis/case-response-form-values.ts';
  import { reviewClock } from '$lib/review-clock';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import CaseLinkedEvidence from './CaseLinkedEvidence.svelte';

  let { record, persist, mutationBusy, onamendment }: {
    record: CaseRecord; persist: PersistCaseResponse; mutationBusy: boolean; onamendment: (id: string) => void | Promise<void>;
  } = $props();
  const draft = createCaseDraft(() => record.id, 'requested-evidence', {
    actionId: '', packetDigest: '', summary: '', dueAt: '', reference: '',
    requestId: '', state: 'prepared', rationale: '', pinIds: [] as string[],
  });
  const eligible = $derived(record.actions.filter(action => ['submitted', 'acknowledged'].includes(action.state) && submittedPacketReceipts(action).length));
  const action = $derived(record.actions.find(item => item.id === draft.value.actionId));
  const requests = $derived(record.actions.flatMap(owner => latestEvidenceRequests(owner).map(event => ({ owner, event }))));
  const selected = $derived(action && latestEvidenceRequests(action).find(event => event.evidenceRequest.id === draft.value.requestId));
  const receipts = $derived(action ? submittedPacketReceipts(action) : []);
  const amendmentDraft = createCaseDraft(() => record.id, 'packet-amendment', { actionId: '', eventId: '' });
  let preparationControl = $state<HTMLSelectElement>();
  let expanded = $state(false);

  async function chooseAction(id: string) {
    if (!await draft.leaveForm()) return;
    draft.value.actionId = id;
    draft.value.packetDigest = '';
  }

  export async function prepareRequest(actionId: string, id: string): Promise<boolean> {
    let owner = record.actions.find(item => item.id === actionId);
    if (!owner || !['submitted', 'acknowledged'].includes(owner.state)) return false;
    if (!latestEvidenceRequests(owner).some(event => event.evidenceRequest.id === id) || !await draft.leaveForm()) return false;
    // The parent can replace the Case while draft recovery awaits storage.
    // Initialise from the current leaves, not those captured before that await.
    owner = record.actions.find(item => item.id === actionId);
    if (!owner || !['submitted', 'acknowledged'].includes(owner.state)) return false;
    const current = latestEvidenceRequests(owner).filter(event => event.evidenceRequest.id === id);
    if (!current.length) return false;
    draft.value.actionId = actionId; draft.value.requestId = id;
    const request = current.length === 1 ? current[0]?.evidenceRequest : undefined;
    draft.value.pinIds = [...(request?.evidencePinIds ?? [])];
    draft.value.rationale = request?.rationale ?? '';
    draft.value.state = request?.state === 'unavailable' ? 'unavailable' : 'prepared';
    expanded = true;
    await tick();
    preparationControl?.focus();
    return true;
  }

  async function save() {
    if (!action || mutationBusy) return;
    const unchanged = draft.capture();
    const evidenceRequest: CaseEvidenceRequest = selected ? {
      ...selected.evidenceRequest, state: draft.value.state === 'unavailable' ? 'unavailable' : 'prepared',
      evidencePinIds: [...draft.value.pinIds], rationale: draft.value.rationale.trim(),
      previousEventIds: latestEvidenceRequests(action).filter(event => event.evidenceRequest.id === selected.evidenceRequest.id).map(event => event.id),
    } : {
      id: crypto.randomUUID(), packetDigestSha256: draft.value.packetDigest, summary: draft.value.summary.trim(),
      dueAt: isoFromUtcInput(draft.value.dueAt), state: 'requested', evidencePinIds: [], rationale: '', previousEventIds: [],
    };
    if (await draft.persist(persist, { actionUpdate: { id: action.id, transition: {
      nextState: 'acknowledged', sourceClass: selected ? 'analyst' : 'provider',
      provenance: selected ? 'analyst prepared requested evidence' : 'provider evidence request recorded by analyst',
      providerOutcome: selected ? null : 'more_information_requested', reference: draft.value.reference || null, evidenceRequest,
    } } }, selected ? 'Recorded the requested-evidence review.' : 'Recorded the provider evidence request.') && unchanged()) {
      draft.value.summary = ''; draft.value.requestId = ''; draft.value.reference = ''; draft.value.dueAt = '';
      draft.value.pinIds = []; draft.value.rationale = '';
    }
  }

  async function createAmendment(actionId: string, eventId: string) {
    if (mutationBusy || amendmentDraft.state.busy) return;
    const original = record.actions.find(item => item.id === actionId);
    const request = original && latestEvidenceRequests(original).find(event => event.id === eventId)?.evidenceRequest;
    if (!original || !request) return;
    amendmentDraft.value.actionId = actionId; amendmentDraft.value.eventId = eventId; amendmentDraft.changed();
    await amendmentDraft.persist(persist, { action: {
      type: original.type, recipient: original.recipient, contactSource: original.contactSource,
      routeObservedAt: original.routeObservedAt, routeReviewAfter: original.routeReviewAfter,
      contactLimitations: original.contactLimitations, originActionId: original.id,
      amendment: { packetDigestSha256: request.packetDigestSha256, requestEventIds: [eventId] },
    } }, 'Created a drafting amendment. Review its recipient, evidence and authorisation before sending.');
  }
</script>

<details class="requested-evidence" bind:open={expanded}>
  <summary>Requested evidence and amendments</summary>
  {#if !eligible.length}<p>Record a packet delivery digest on a submitted action to track a provider's evidence requests.</p>{/if}
  {#if requests.length}
    <ul class="requests" aria-label="Requested evidence">
      {#each requests as { owner, event }}
        {@const request = event.evidenceRequest}
        {@const deliveries = evidenceRequestDelivery(record.actions, owner.id, event.id)}
        {@const amendments = record.actions.filter(item => item.originActionId === owner.id && item.amendment?.requestEventIds.includes(event.id))}
        {@const concurrent = latestEvidenceRequests(owner).filter(item => item.evidenceRequest.id === request.id).length > 1}
        <li>
          <strong>{request.summary}</strong>
          <p>{owner.recipient} · {deliveries.length ? 'Delivery recorded' : request.state.replaceAll('_', ' ')}</p>
          {#if concurrent}<p>Concurrent preparations remain. Review their evidence together before creating an amendment.</p>{/if}
          {#if request.dueAt}<p>Provider deadline: {request.dueAt}{!deliveries.length && Date.parse(request.dueAt) < $reviewClock ? ' · overdue' : ''}</p>{:else}<p>No provider deadline recorded.</p>{/if}
          <details><summary>Request source and packet</summary><p>Event {event.id} · recorded {event.occurredAt}</p><p>Original packet SHA-256: <code>{request.packetDigestSha256}</code></p>{#if event.reference}<p>{event.reference}</p>{/if}<p>Recorded by the analyst; a digest links the receipt, not proof of provider acceptance.</p></details>
          {#if request.rationale}<p>{request.rationale}</p>{/if}
          {#if request.evidencePinIds.length}<CaseLinkedEvidence pins={record.evidencePins} ids={request.evidencePinIds} />{/if}
          {#if ['submitted', 'acknowledged'].includes(owner.state)}<button class="btn small" type="button" onclick={() => prepareRequest(owner.id, request.id)} disabled={mutationBusy}>Review requested evidence</button>{/if}
          {#if request.state === 'prepared' && !concurrent && !amendments.length}<button class="btn small" type="button" onclick={() => createAmendment(owner.id, event.id)} disabled={mutationBusy || amendmentDraft.state.busy}>Create drafting amendment</button>{/if}
          {#each amendments as amendment}<button class="btn small" type="button" onclick={() => onamendment(amendment.id)} disabled={mutationBusy}>Review amendment · {amendment.state.replaceAll('_', ' ')}</button>{/each}
          {#each deliveries as delivery}<p>Amendment delivery: {delivery.occurredAt} · SHA-256 <code>{delivery.digestSha256}</code></p>{/each}
        </li>
      {/each}
    </ul>
  {/if}
  {#if record.actions.some(item => item.historyOmitted || item.historyLimitations.length)}<p>Retained action history may be incomplete. Missing earlier requests do not mean none were made.</p>{/if}
  {#if eligible.length}
    <form class="stack" aria-label="Requested evidence review" data-recovery-form={draft.form} oninput={draft.changed} onsubmit={event => { event.preventDefault(); void save(); }}>
      <label class="field">Submitted action<select value={draft.value.actionId} oninput={event => event.stopPropagation()} onchange={async event => { const control = event.currentTarget; await chooseAction(control.value); control.value = draft.value.actionId; }} required><option value="">Select an action</option>{#each eligible as candidate}<option value={candidate.id}>{candidate.recipient}</option>{/each}</select></label>
      {#if selected}
        <p><strong>{selected.evidenceRequest.summary}</strong></p>
        <label class="field">Evidence preparation<select bind:this={preparationControl} bind:value={draft.value.state}><option value="prepared">Prepared for review</option><option value="unavailable">Cannot provide</option></select></label>
        <fieldset><legend>Retained evidence pins</legend>{#each record.evidencePins as pin}<label class="pin-choice"><input type="checkbox" bind:group={draft.value.pinIds} value={pin.id}>{pin.label} · {pin.source}</label>{/each}{#if !record.evidencePins.length}<p>Add evidence pins in Evidence before marking this prepared.</p>{/if}</fieldset>
        <label class="field">Preparation or unavailability reason<textarea bind:value={draft.value.rationale} maxlength={MAX_RESPONSE_RATIONALE_LENGTH} required={draft.value.state === 'unavailable'} rows="2"></textarea></label>
      {:else if action}
        <label class="field">Original submitted packet<select bind:value={draft.value.packetDigest} required><option value="">Select the delivery receipt</option>{#each receipts as receipt}<option value={receipt.digestSha256}>{receipt.occurredAt} · {receipt.digestSha256.slice(0, 16)}…</option>{/each}</select></label>
        <label class="field">Evidence requested<textarea bind:value={draft.value.summary} maxlength={MAX_RESPONSE_VALUE_LENGTH} rows="2" required></textarea></label>
        <label class="field">Provider deadline <small>UTC; leave blank if not stated</small><input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={draft.value.dueAt}></label>
        <label class="field">Provider request reference<input bind:value={draft.value.reference} maxlength="500"></label>
      {/if}
      <button class="btn" type="submit" disabled={!action || mutationBusy || draft.state.busy}>{selected ? 'Save evidence preparation' : 'Record evidence request'}</button>
      <CaseDraftRecovery {draft} />
    </form>
  {/if}
  <CaseDraftRecovery draft={amendmentDraft} />
</details>

<style>
  .requested-evidence{margin-top:16px;min-width:0;overflow-wrap:anywhere}.requested-evidence>summary{padding:12px 0}
  .requests{list-style:none;padding:0;display:grid;gap:12px}.requests>li{padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);min-width:0}
  .requests p{margin:8px 0}.requests button{margin:4px 6px 4px 0}code{overflow-wrap:anywhere;word-break:break-all}
  fieldset{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm)}.pin-choice{display:flex;align-items:flex-start;gap:8px;padding:6px 0}
  .stack{display:grid;gap:12px}.field{display:grid;gap:5px}select,input,textarea{min-width:0;width:100%}.pin-choice input{width:auto;flex-shrink:0}
</style>

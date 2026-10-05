<script lang="ts">
  import { tick } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import type { PersistCaseResponse } from '#lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '#lib/controllers/case-draft.svelte.ts';
  import { readCasePacketCorrection, correctionDelivery, CASE_DELIVERY_RECEIPT_LIMITATION } from '../../../../packages/cases/case-packet-correction.mts';
  import { readCaseResponseObjects } from '../../../../packages/cases/case-response-object.mts';
  import { submittedPacketReceipts } from '../../../../packages/cases/case-requested-evidence.mts';
  import { MAX_RESPONSE_RATIONALE_LENGTH } from '../../../../packages/contracts/case-portability.mts';
  import { isoFromUtcInput, utcDateTimeInputAttributes } from '#lib/analysis/case-response-form-values.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';

  let { record, persist, mutationBusy, oncreated }: { record: CaseRecord; persist: PersistCaseResponse; mutationBusy: boolean; oncreated: (id: string) => void | Promise<void> } = $props();
  const draft = createCaseDraft(() => record.id, 'packet-correction', {
    delivery: '', purpose: 'correction', reason: '', previousStatement: '', correctedStatement: '', pinIds: [] as string[],
    objects: [] as string[], routeSource: '', routeObservedAt: '', routeReviewAfter: '',
  });
  const deliveries = $derived(record.actions.flatMap(action => action.history.filter(event => event.applied && event.packetReceipt)
    .map(event => ({ action, event, receipt: event.packetReceipt!, key: `${action.id}|${event.id}` }))));
  const selected = $derived(deliveries.find(delivery => delivery.key === draft.value.delivery));
  const legacyCount = $derived(record.actions.reduce((count, action) => count + submittedPacketReceipts(action).filter(receipt => !action.history.find(event => event.id === receipt.eventId)?.packetReceipt).length, 0));
  let preview = $state.raw<{ sourceSignature: string; draftSignature: string; action: Record<string, unknown> } | null>(null);
  let error = $state('');
  let heading = $state<HTMLHeadingElement>();
  const current = $derived(Boolean(preview && preview.sourceSignature === JSON.stringify(record) && preview.draftSignature === JSON.stringify(draft.value)));

  async function selectDelivery(key: string) {
    if (!await draft.leaveForm()) return;
    draft.value.delivery = deliveries.some(delivery => delivery.key === key) ? key : '';
    draft.value.objects = []; preview = null; error = ''; draft.changed();
  }
  async function prepare() {
    if (mutationBusy || draft.state.busy) return;
    error = ''; preview = null;
    try {
      if (!selected) throw new Error('Select an exact delivery with a retained local packet receipt.');
      const fields = $state.snapshot(draft.value), sourceSignature = JSON.stringify(record);
      const correction = readCasePacketCorrection({ version: 1, purpose: fields.purpose, deliveryEventId: selected.event.id,
        packetDigestSha256: selected.receipt.packetDigestSha256, packetVersion: selected.receipt.packetVersion,
        reason: fields.reason, previousStatement: fields.previousStatement, correctedStatement: fields.correctedStatement,
        evidencePinIds: fields.pinIds, profile: selected.receipt.profile })!;
      const action = { type: selected.action.type, recipient: selected.receipt.recipient,
        contactSource: fields.routeSource.trim() || 'analyst supplied; current route not yet reviewed',
        routeObservedAt: isoFromUtcInput(fields.routeObservedAt), routeReviewAfter: isoFromUtcInput(fields.routeReviewAfter),
        contactLimitations: ['Recipient identity is bound to the prior local receipt; current route and authority require a fresh packet review.'],
        originActionId: selected.action.id, correction, responseObjects: readCaseResponseObjects(fields.objects.map(value => JSON.parse(value))) };
      correctionDelivery(record.actions, action, { caseId: record.id, target: record.domain,
        selectedPinIds: new Set(record.evidencePins.map(pin => pin.id)) });
      preview = { sourceSignature, draftSignature: JSON.stringify(fields), action };
      await tick(); heading?.focus();
    } catch (cause) { error = cause instanceof Error ? cause.message : 'The linked correction could not be prepared.'; }
  }
  async function create() {
    if (!preview || !current || mutationBusy || draft.state.busy) return;
    const prepared = preview, unchanged = draft.capture(), previousIds = new Set(record.actions.map(action => action.id));
    if (await draft.persist(persist, { action: prepared.action, expectedResponseContext: prepared.sourceSignature },
      'Created an unreviewed linked draft. The original delivery is unchanged; review current recipient, evidence, privacy and authority before any separate delivery.') && unchanged()) {
      preview = null;
      const created = record.actions.find(action => !previousIds.has(action.id) && action.correction);
      if (created) await oncreated(created.id);
    }
  }
  function cancel() { preview = null; error = ''; }
</script>

<details class="correction">
  <summary>Correct or request retraction of a recorded delivery</summary>
  <p>Prepare a new linked draft for a self-discovered mistake, without inventing a provider request. Original evidence, packets, delivery and outcomes remain unchanged. Nothing is sent or reversed.</p>
  <p>{CASE_DELIVERY_RECEIPT_LIMITATION}</p>
  {#if legacyCount}<p>{legacyCount} digest-only delivery record{legacyCount === 1 ? ' lacks' : 's lack'} an exact packet receipt. Use a general Case note for these records; an exact-linked correction is unavailable.</p>{/if}
  {#if !deliveries.length}<p>No exact delivery receipt is available. Future deliveries can retain one when you prepare an action-bound packet with explicit object scope.</p>{:else}
    <form aria-label="Linked correction preparation" data-recovery-form={draft.form} oninput={draft.changed} onsubmit={event => { event.preventDefault(); void prepare(); }}>
      <label>Original delivery<select value={draft.value.delivery} oninput={event => event.stopPropagation()} onchange={async event => { const control = event.currentTarget; await selectDelivery(control.value); control.value = draft.value.delivery; }} required disabled={mutationBusy || draft.state.busy}><option value="">Select one exact delivery</option>{#each deliveries as delivery}<option value={delivery.key}>{delivery.receipt.recipient} · {delivery.event.occurredAt} · packet v{delivery.receipt.packetVersion} · {delivery.receipt.packetDigestSha256} · event {delivery.event.id}</option>{/each}</select></label>
      {#if selected}
        <p>Recipient {selected.receipt.recipient} · audience {selected.receipt.profile} · original packet v{selected.receipt.packetVersion} SHA-256 <code>{selected.receipt.packetDigestSha256}</code>. Generated {selected.receipt.packetGeneratedAt}; analyst-recorded delivery {selected.event.occurredAt}.</p>
        <label>Purpose<select bind:value={draft.value.purpose}><option value="correction">Correction request</option><option value="retraction_request">Request to retract or withdraw</option></select></label>
        <label>Analyst reason<textarea bind:value={draft.value.reason} maxlength={MAX_RESPONSE_RATIONALE_LENGTH} required rows="2"></textarea></label>
        <label>Precise previous statement<textarea bind:value={draft.value.previousStatement} maxlength={MAX_RESPONSE_RATIONALE_LENGTH} required rows="2"></textarea></label>
        <label>Corrected statement<textarea bind:value={draft.value.correctedStatement} maxlength={MAX_RESPONSE_RATIONALE_LENGTH} required={draft.value.purpose === 'correction'} rows="2"></textarea></label>
        <fieldset><legend>Affected subset of the delivered objects</legend>{#each selected.receipt.responseObjects as object}<label class="choice"><input type="checkbox" bind:group={draft.value.objects} value={JSON.stringify(object)}>{object.kind} · {object.identifier}</label>{/each}</fieldset>
        <fieldset><legend>Corrected retained evidence references</legend>{#each record.evidencePins as pin}<label class="choice"><input type="checkbox" bind:group={draft.value.pinIds} value={pin.id}>{pin.label} · {pin.source}</label>{/each}</fieldset>
        <details><summary>Current recipient route review</summary><p>The recipient stays bound to this delivery. Route freshness, authority, privacy, contradictions and packet readiness must be reviewed anew in the existing packet workflow; old permission is not inherited.</p><label>Current route source<input bind:value={draft.value.routeSource} maxlength="120"></label><label>Current route observed at (UTC)<input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={draft.value.routeObservedAt}></label><label>Current route review after (UTC)<input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={draft.value.routeReviewAfter}></label></details>
        <button class="btn" type="submit" disabled={mutationBusy || draft.state.busy}>Preview linked correction</button>
      {/if}
      <CaseDraftRecovery {draft} />
    </form>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if preview}<section aria-label="Linked correction preview"><h4 bind:this={heading} tabindex="-1">Review the new linked draft</h4>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named scroll region provides keyboard access to the complete draft -->
    <div class="draft-json" role="region" tabindex="0" aria-label="Correction draft JSON"><pre>{JSON.stringify(preview.action, null, 2)}</pre></div>
    <p>Creating the draft does not send it. Review a fresh packet before delivery.</p>{#if !current}<p role="alert">The delivery, Case scope or draft changed. Prepare a fresh preview; the original delivery remains unchanged.</p>{/if}<div class="actions"><button class="btn" type="button" disabled={!current || mutationBusy || draft.state.busy} onclick={() => void create()}>Create linked draft</button><button class="btn" type="button" disabled={draft.state.busy} onclick={cancel}>Cancel correction preview</button></div></section>{/if}
</details>

<style>
  .correction{margin-top:16px;min-width:0;overflow-wrap:anywhere}summary{cursor:pointer;padding:12px 0}p,label,legend{font-size:var(--text-xs);line-height:1.55}form,label{display:grid;gap:8px;min-width:0}form{gap:14px}input,select,textarea{min-width:0;width:100%;max-width:100%}fieldset{min-width:0}.choice{display:flex;align-items:flex-start;gap:8px}.choice input{width:auto;flex-shrink:0}code{overflow-wrap:anywhere}.draft-json{max-height:420px;overflow:auto}.draft-json:focus-visible{outline:2px solid var(--focus);outline-offset:3px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--text-xs)}.actions{display:flex;flex-wrap:wrap;gap:8px}[role=alert]{color:var(--danger)}button{white-space:normal}
</style>

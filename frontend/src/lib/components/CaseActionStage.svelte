<script lang="ts">
  import { tick } from 'svelte';
  import {
    CASE_ACTION_EVENT_SOURCE_CLASSES, CASE_ACTION_STATES, CASE_ACTION_TYPES, CASE_PROVIDER_OUTCOMES,
    type CaseRecord, type CaseActionRecord, type CaseActionState,
  } from '$lib/cases';
  import { isLegalCaseActionTransition, type CaseActionEventSourceClass } from '$lib/analysis/case-response-model.ts';
  import { isoFromUtcInput, utcInputFromIso, utcDateTimeInputAttributes, list } from '$lib/analysis/case-response-form-values.ts';
  import type { CaseResponsePresentation, PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import CaseEvidencePinSelect from './CaseEvidencePinSelect.svelte';
  import CaseLinkedEvidence from './CaseLinkedEvidence.svelte';
  import CaseActionReceipt from './CaseActionReceipt.svelte';

  let { record, mode, mutationBusy, persist, onadvanced }: {
    record: CaseRecord;
    mode: CaseResponsePresentation;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
    onadvanced: () => void;
  } = $props();

  let expanded = $state(false);
  $effect(() => { expanded = mode === 'quick'; });

  let receipt = $state<ReturnType<typeof CaseActionReceipt>>();
  let metadataExpanded = $state(false);

  async function reviewRecipient(actionId: string) {
    if (!await selectAction(actionId)) return;
    metadataExpanded = true;
    await tick();
    document.getElementById(`case-action-route-time-${record.id}`)?.focus();
  }

  export async function prepareDeliveryRecord(actionId: string, digestSha256: string): Promise<boolean> {
    return await receipt?.prepareDeliveryRecord(actionId, digestSha256) ?? false;
  }

  export async function selectReceipt(actionId: string): Promise<boolean> {
    return await receipt?.selectReceipt(actionId) ?? false;
  }
  const actionDraft = createCaseDraft(() => record.id, 'action-details', {
    actionType: 'internal_review',
    actionRecipient: '',
    actionContactSource: 'analyst supplied',
    actionRouteObservedAt: '',
    actionRouteReviewAfter: '',
    actionLimitations: '',
    actionDueAt: '',
    actionFollowUpAt: '',
    actionOriginId: '',
    selectedActionId: ''
  });
  const transitionDraft = createCaseDraft(() => record.id, 'action-transition', {
    transitionActionId: '',
    transitionNextState: 'ready_for_review' as CaseActionState,
    transitionOccurredAt: '',
    transitionSourceClass: 'analyst' as CaseActionEventSourceClass,
    transitionProvenance: 'analyst recorded event',
    transitionReference: '',
    transitionEvidencePinId: '',
    transitionLimitations: '',
    transitionProviderOutcome: '',
    transitionOutcomeDetail: ''
  });
  const selectedAction = $derived(record.actions.find((action) => action.id === actionDraft.value.selectedActionId) ?? null);
  const selectedActionIdentityLocked = $derived(Boolean(selectedAction
    && ['submitted', 'acknowledged', 'terminal'].includes(selectedAction.state)));
  const transitionAction = $derived(record.actions.find(action => action.id === transitionDraft.value.transitionActionId) ?? null);
  const userActionEventSourceClasses = $derived(CASE_ACTION_EVENT_SOURCE_CLASSES.filter((value) => value === 'analyst'
    || value === 'provider' && Boolean(transitionAction && ['submitted', 'acknowledged'].includes(transitionAction.state))));
  const legalTransitionStates = $derived(transitionAction
    ? CASE_ACTION_STATES.filter((nextState) => isLegalCaseActionTransition(transitionAction.state, nextState, transitionDraft.value.transitionSourceClass)
      && (!['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState) || transitionDraft.value.transitionSourceClass === 'analyst')
      && (!(nextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(transitionAction.state))
        || transitionDraft.value.transitionSourceClass === 'analyst'))
    : []);
  const availableTransitionProviderOutcomes = $derived(
    transitionAction && transitionDraft.value.transitionNextState === 'terminal'
      && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(transitionAction.state)
      ? ['withdrawn']
      : transitionAction && transitionDraft.value.transitionNextState === 'submitted' && transitionAction.state === 'authorised'
        ? []
      : ['submitted', 'acknowledged', 'terminal'].includes(transitionDraft.value.transitionNextState)
        ? CASE_PROVIDER_OUTCOMES.filter((value) => value !== 'withdrawn'
          && !(value === 'no_response' && transitionDraft.value.transitionSourceClass === 'provider'))
        : [],
  );
  function actionInput() {
    return {
      type: actionDraft.value.actionType,
      recipient: actionDraft.value.actionRecipient,
      contactSource: actionDraft.value.actionContactSource,
      routeObservedAt: isoFromUtcInput(actionDraft.value.actionRouteObservedAt),
      routeReviewAfter: isoFromUtcInput(actionDraft.value.actionRouteReviewAfter),
      contactLimitations: list(actionDraft.value.actionLimitations),
      dueAt: isoFromUtcInput(actionDraft.value.actionDueAt),
      followUpAt: isoFromUtcInput(actionDraft.value.actionFollowUpAt),
      originActionId: actionDraft.value.actionOriginId || null,
    };
  }

  function clearAction() {
    actionDraft.value.selectedActionId = '';
    actionDraft.value.actionType = 'internal_review';
    actionDraft.value.actionRecipient = '';
    actionDraft.value.actionContactSource = 'analyst supplied';
    actionDraft.value.actionRouteObservedAt = '';
    actionDraft.value.actionRouteReviewAfter = '';
    actionDraft.value.actionLimitations = '';
    actionDraft.value.actionDueAt = '';
    actionDraft.value.actionFollowUpAt = '';
    actionDraft.value.actionOriginId = '';
  }

  async function selectAction(id: string): Promise<boolean> {
    if (!await actionDraft.leaveForm()) return false;
    actionDraft.value.selectedActionId = id;
    const action = record.actions.find((item) => item.id === id);
    if (!action) {
      clearAction();
      return true;
    }
    actionDraft.value.actionType = action.type;
    actionDraft.value.actionRecipient = action.recipient;
    actionDraft.value.actionContactSource = action.contactSource;
    actionDraft.value.actionRouteObservedAt = utcInputFromIso(action.routeObservedAt);
    actionDraft.value.actionRouteReviewAfter = utcInputFromIso(action.routeReviewAfter);
    actionDraft.value.actionLimitations = action.contactLimitations.join('\n');
    actionDraft.value.actionDueAt = utcInputFromIso(action.dueAt);
    actionDraft.value.actionFollowUpAt = utcInputFromIso(action.followUpAt);
    actionDraft.value.actionOriginId = action.originActionId || '';
    return true;
  }

  async function selectTransitionAction(id: string): Promise<boolean> {
    if (!await transitionDraft.leaveForm()) return false;
    transitionDraft.value.transitionActionId = id;
    const action = record.actions.find(item => item.id === id);
    if (action) transitionDraft.value.transitionNextState = nextTransitionState(action, transitionDraft.value.transitionSourceClass);
    return true;
  }

  async function saveAction() {
    const unchanged = actionDraft.capture();
    const patch = actionDraft.value.selectedActionId
      ? { actionUpdate: { id: actionDraft.value.selectedActionId, ...actionInput() } }
      : { action: actionInput() };
    if (!await actionDraft.persist(persist, patch, `${actionDraft.value.selectedActionId ? 'Updated' : 'Recorded'} a case action for ${record.domain}.`, () => document.getElementById(`quick-action-advance-${record.id}`)) || !unchanged()) return;
    clearAction();
  }

  function nextTransitionState(action: CaseActionRecord, sourceClass: CaseActionEventSourceClass): CaseActionState {
    return CASE_ACTION_STATES.find((nextState) => isLegalCaseActionTransition(action.state, nextState, sourceClass)
      && (!['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState) || sourceClass === 'analyst')
      && (!(nextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(action.state))
        || sourceClass === 'analyst')) ?? action.state;
  }

  function clearTransition() {
    transitionDraft.value.transitionOccurredAt = '';
    transitionDraft.value.transitionSourceClass = 'analyst';
    transitionDraft.value.transitionProvenance = 'analyst recorded event';
    transitionDraft.value.transitionReference = '';
    transitionDraft.value.transitionEvidencePinId = '';
    transitionDraft.value.transitionLimitations = '';
    transitionDraft.value.transitionProviderOutcome = '';
    transitionDraft.value.transitionOutcomeDetail = '';
  }

  function setTransitionSourceClass(value: string) {
    transitionDraft.value.transitionSourceClass = value === 'provider' ? 'provider' : 'analyst';
    if (transitionAction) transitionDraft.value.transitionNextState = nextTransitionState(transitionAction, transitionDraft.value.transitionSourceClass);
    transitionDraft.value.transitionProviderOutcome = '';
  }

  function setTransitionNextState(value: string) {
    if (CASE_ACTION_STATES.includes(value as CaseActionState)) transitionDraft.value.transitionNextState = value as CaseActionState;
    transitionDraft.value.transitionProviderOutcome = '';
  }

  async function addActionTransition() {
    if (!transitionAction) return;
    const unchanged = transitionDraft.capture();
    if (!await transitionDraft.persist(persist, {
      actionUpdate: {
        id: transitionAction.id,
        transition: {
          nextState: transitionDraft.value.transitionNextState,
          occurredAt: isoFromUtcInput(transitionDraft.value.transitionOccurredAt) || new Date().toISOString(),
          sourceClass: transitionDraft.value.transitionSourceClass,
          provenance: transitionDraft.value.transitionProvenance,
          reference: transitionDraft.value.transitionReference || null,
          evidencePinId: transitionDraft.value.transitionEvidencePinId || null,
          limitations: list(transitionDraft.value.transitionLimitations),
          providerOutcome: transitionDraft.value.transitionProviderOutcome || null,
          outcomeDetail: transitionDraft.value.transitionOutcomeDetail || null,
          originActionId: transitionAction.originActionId,
        },
      },
    }, `Appended a ${transitionDraft.value.transitionNextState.replaceAll('_', ' ')} action event for ${record.domain}.`) || !unchanged()) return;
    clearTransition();
    await tick();
    if (unchanged() && transitionAction) transitionDraft.value.transitionNextState = nextTransitionState(transitionAction, 'analyst');
  }

</script>

{#snippet metadataForm()}
  <form class="stack" data-recovery-form={actionDraft.form} oninput={actionDraft.changed} onsubmit={(event) => { event.preventDefault(); void saveAction(); }}>
    <p class="notice">Date and time fields use UTC.</p>
    {#if record.actions.length}
      <label class="field">Action metadata<select value={actionDraft.value.selectedActionId} oninput={(event) => event.stopPropagation()} onchange={async (event) => { const select = event.currentTarget; await selectAction(select.value); select.value = actionDraft.value.selectedActionId; }}><option value="">Create a new action</option>{#each record.actions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient}</option>{/each}</select></label>
    {/if}
    {#if selectedActionIdentityLocked}<p class="notice">Submitted, acknowledged, and terminal action identity and recipient metadata are immutable. Update scheduling only, or create a linked follow-on action.</p>{/if}
    <div class="two-columns">
      <label class="field">Action type<select bind:value={actionDraft.value.actionType} disabled={selectedActionIdentityLocked}>{#each CASE_ACTION_TYPES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
      <label class="field">{mode === 'quick' ? 'Recipient or owner' : 'Recipient or internal owner'}<input bind:value={actionDraft.value.actionRecipient} maxlength="320" required disabled={selectedActionIdentityLocked}></label>
      <label class="field">{mode === 'quick' ? 'How this route was found' : 'Contact source'}<input bind:value={actionDraft.value.actionContactSource} maxlength="80" required disabled={selectedActionIdentityLocked}></label>
      <label class="field">Route observed at<input id={`case-action-route-time-${record.id}`} type="datetime-local" {...utcDateTimeInputAttributes} bind:value={actionDraft.value.actionRouteObservedAt} disabled={selectedActionIdentityLocked}></label>
      <label class="field">Route review after<input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={actionDraft.value.actionRouteReviewAfter} disabled={selectedActionIdentityLocked}></label>
      <label class="field">Originating action<select bind:value={actionDraft.value.actionOriginId} disabled={selectedActionIdentityLocked}><option value="">No originating action</option>{#each record.actions.filter((action) => action.id !== actionDraft.value.selectedActionId) as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient}</option>{/each}</select></label>
      <label class="field">Due at<input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={actionDraft.value.actionDueAt}></label>
      <label class="field">Follow-up at<input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={actionDraft.value.actionFollowUpAt}></label>
    </div>
    {#if !selectedActionIdentityLocked}<p class="notice">Record the source observation and its review deadline or published expiry after checking the route. Changing recipient evidence invalidates prior review and authorisation; follow-up dates do not refresh it.</p>{/if}
    <label class="field">Contact limitations <small>one per line</small><textarea bind:value={actionDraft.value.actionLimitations} maxlength="2000" rows="2" disabled={selectedActionIdentityLocked}></textarea></label>
    <div class="actions"><button class="btn" type="submit" disabled={actionDraft.state.busy || mutationBusy}>{mutationBusy ? 'Saving…' : actionDraft.value.selectedActionId ? 'Update metadata' : 'Create drafting action'}</button>{#if actionDraft.value.selectedActionId}<button class="btn" type="button" disabled={mutationBusy} onclick={() => void actionDraft.leaveForm()}>Cancel edit</button>{/if}</div>
    <CaseDraftRecovery draft={actionDraft} />
  </form>

{/snippet}

{#snippet receiptMetadata(inDisclosure: boolean)}
  {#if inDisclosure}
    <details class="action-metadata" bind:open={metadataExpanded}>
      <summary>Create an action or update scheduling</summary>
      {@render metadataForm()}
    </details>
  {:else}
    {@render metadataForm()}
  {/if}
{/snippet}

{#snippet actionHistory()}
  {#if record.actions.length}
    <ol class="records action-records" aria-label="Response action transition timelines">
      {#each [...record.actions].reverse() as action}
        <li id={`case-action-${record.id}-${action.id}`} tabindex="-1">
          <strong>{action.type.replaceAll('_', ' ')} · {action.state.replaceAll('_', ' ')}</strong>
          <p>{action.recipient}</p>
          <small>Action ID {action.id} · {action.contactSource} · created {action.createdAt}</small>
          <small>Route observed {action.routeObservedAt ?? 'time unavailable'}</small>
          <small>Route review after {action.routeReviewAfter ?? 'not recorded'} · follow-up {action.followUpAt ?? 'not scheduled'}</small>
          {#if action.originActionId}<small>Originating action: {action.originActionId}</small>{/if}
          {#if action.reference}<p>Latest reference: {action.reference}</p>{/if}
          {#if action.providerOutcome}<p>Latest typed provider outcome: {action.providerOutcome.replaceAll('_', ' ')}{action.outcome ? ` · ${action.outcome}` : ''}</p>{:else if action.outcome}<p>Recorded legacy outcome detail: {action.outcome}</p>{/if}
          <ol class="transition-timeline" aria-label={`Transitions for ${action.recipient}`}>
            {#each action.history as event}
              <li data-applied={event.applied}>
                <strong>{event.previousState ?? 'none'} → {event.nextState.replaceAll('_', ' ')}</strong>
                <span>{event.occurredAt} · {event.sourceClass.replaceAll('_', ' ')} · {event.provenance}</span>
                <small>Event ID {event.id} · {event.applied ? 'applied to projection' : 'retained concurrent conflict'}</small>
                {#if event.providerOutcome}<p>Provider outcome: {event.providerOutcome.replaceAll('_', ' ')}{event.outcomeDetail ? ` · ${event.outcomeDetail}` : ''}</p>{:else if event.outcomeDetail}<p>Recorded outcome detail: {event.outcomeDetail}</p>{/if}
                {#if event.reference}<p>Reference: {event.reference}</p>{/if}
                {#if event.evidencePinId}<CaseLinkedEvidence pins={record.evidencePins} ids={[event.evidencePinId]} />{/if}
                {#if event.originActionId}<small>Originating action: {event.originActionId}</small>{/if}
                {#if event.limitations.length}<small>Limitations: {event.limitations.join('; ')}</small>{/if}
              </li>
            {/each}
          </ol>
          {#if action.historyOmitted}<p class="history-warning">{action.historyOmitted} earlier or invalid transition event{action.historyOmitted === 1 ? '' : 's'} omitted by bounded retention.</p>{/if}
          {#if action.historyLimitations.length}<small>History limitations: {action.historyLimitations.join('; ')}</small>{/if}
          <button class="btn small" type="button" onclick={async () => { if (await selectTransitionAction(action.id)) onadvanced(); }}>Review or append event</button>
        </li>
      {/each}
    </ol>
  {/if}

{/snippet}

<section class="case-response-stage" aria-label="Case response actions">
  <details id={`case-response-decision-${record.id}`} bind:open={expanded}>
    <summary>{mode === 'quick' ? 'Prepare and track response' : 'Track append-only response actions'}</summary>
    <div class="response-form">
      <CaseActionReceipt bind:this={receipt} {record} {mode} {mutationBusy} {persist} onreviewrecipient={reviewRecipient} metadata={receiptMetadata} />
      {#if mode === 'advanced'}
        <CaseDraftRecovery draft={transitionDraft} />
        {#if record.actions.length}<label class="field">Action for transition<select value={transitionDraft.value.transitionActionId} onchange={async (event) => { const select = event.currentTarget; await selectTransitionAction(select.value); select.value = transitionDraft.value.transitionActionId; }}><option value="">Select an action</option>{#each record.actions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient}</option>{/each}</select></label>{/if}
        {#if transitionAction}
          <form class="transition-form" data-recovery-form={transitionDraft.form} aria-labelledby={`transition-title-${record.id}`} oninput={transitionDraft.changed} onsubmit={(event) => { event.preventDefault(); void addActionTransition(); }}>
            <p class="notice">Date and time fields use UTC.</p>
            <div><strong id={`transition-title-${record.id}`}>Append transition for {transitionAction.recipient}</strong><span>Current projection: {transitionAction.state.replaceAll('_', ' ')}</span></div>
            {#if legalTransitionStates.length}
              <div class="two-columns">
                <label class="field">Event source<select value={transitionDraft.value.transitionSourceClass} onchange={(event) => setTransitionSourceClass(event.currentTarget.value)}>{#each userActionEventSourceClasses as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
                <label class="field">Next state<select value={transitionDraft.value.transitionNextState} onchange={(event) => setTransitionNextState(event.currentTarget.value)}>{#each legalTransitionStates as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
                <label class="field">Original event time<input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={transitionDraft.value.transitionOccurredAt}></label>
                <label class="field">Provenance<input bind:value={transitionDraft.value.transitionProvenance} maxlength="80" required></label>
                <label class="field">Bounded reference<input id={`case-action-transition-reference-${record.id}`} bind:value={transitionDraft.value.transitionReference} maxlength="500"></label>
                <CaseEvidencePinSelect label="Evidence pin" pins={record.evidencePins} bind:value={transitionDraft.value.transitionEvidencePinId} />
                <label class="field">Typed provider outcome<select bind:value={transitionDraft.value.transitionProviderOutcome} required={transitionDraft.value.transitionNextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(transitionAction.state)}><option value="">No provider outcome</option>{#each availableTransitionProviderOutcomes as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
              </div>
              {#if transitionDraft.value.transitionNextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(transitionAction.state)}
                <p class="notice">Ending a pre-authorisation action requires an analyst-sourced withdrawn outcome. It does not authorise or submit the action.</p>
              {/if}
              <label class="field">Provider outcome detail<textarea bind:value={transitionDraft.value.transitionOutcomeDetail} maxlength="2000" rows="2"></textarea></label>
              <label class="field">Event limitations <small>one per line</small><textarea bind:value={transitionDraft.value.transitionLimitations} maxlength="2000" rows="2"></textarea></label>
              <button class="btn" type="submit" disabled={transitionDraft.state.busy || mutationBusy}>Append transition</button>
            {:else}
              <p class="notice">This action is terminal. Its retained transition history cannot be rewritten or extended.</p>
            {/if}
          </form>
        {/if}

      {/if}
    </div>
    {#if mode === 'quick' && record.actions.length}
      <details class="stage-history"><summary>Response action history ({record.actions.length})</summary>{@render actionHistory()}</details>
    {:else}
      {@render actionHistory()}
    {/if}
  </details>
</section>

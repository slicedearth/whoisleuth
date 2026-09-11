<script lang="ts">
  import { tick } from 'svelte';
  import {
    CASE_ACTION_EVENT_SOURCE_CLASSES, CASE_ACTION_STATES, CASE_ACTION_TYPES, CASE_PROVIDER_OUTCOMES,
    type CaseRecord, type CaseActionRecord, type CaseActionState,
  } from '$lib/cases';
  import { isLegalCaseActionTransition, type CaseActionEventSourceClass } from '$lib/analysis/case-response-model.ts';
  import { isoFromUtcInput, utcInputFromIso, utcDateTimeInputAttributes, list } from '$lib/analysis/case-response-form-values.ts';
  import { responseRouteFreshness } from '../../../../packages/cases/response-route-freshness.mts';
  import type { CaseResponsePresentation, PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createDraftRevision } from '$lib/controllers/submitted-draft';
  import CaseEvidencePinSelect from './CaseEvidencePinSelect.svelte';
  import CaseLinkedEvidence from './CaseLinkedEvidence.svelte';

  let { record, mode, mutationBusy, persist, onadvanced }: {
    record: CaseRecord;
    mode: CaseResponsePresentation;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
    onadvanced: () => void;
  } = $props();

  let expanded = $state(false);
  $effect(() => { expanded = mode === 'quick'; });

  let actionType = $state('internal_review');
  let actionRecipient = $state('');
  let actionContactSource = $state('analyst supplied');
  let actionRouteObservedAt = $state('');
  let actionRouteReviewAfter = $state('');
  let actionLimitations = $state('');
  let actionDueAt = $state('');
  let actionFollowUpAt = $state('');
  let actionOriginId = $state('');
  let selectedActionId = $state('');
  let transitionNextState = $state<CaseActionState>('ready_for_review');
  let transitionOccurredAt = $state('');
  let transitionSourceClass = $state<CaseActionEventSourceClass>('analyst');
  let transitionProvenance = $state('analyst recorded event');
  let transitionReference = $state('');
  let transitionEvidencePinId = $state('');
  let transitionLimitations = $state('');
  let transitionProviderOutcome = $state('');
  let transitionOutcomeDetail = $state('');
  let quickActionId = $state('');
  let quickActionReference = $state('');
  let quickProviderOutcome = $state('');
  let quickOutcomeDetail = $state('');
  let quickOccurredAt = $state('');
  let quickEvidencePinId = $state('');
  let quickLimitations = $state('');
  let metadataExpanded = $state(false);
  const actionDraft = createDraftRevision(() => record.id);
  const transitionDraft = createDraftRevision(() => `${record.id}:${selectedActionId}`);
  const quickActionDraft = createDraftRevision(() => `${record.id}:${quickAction?.id ?? ''}`);
  const selectedAction = $derived(record.actions.find((action) => action.id === selectedActionId) ?? null);
  const selectedActionIdentityLocked = $derived(Boolean(selectedAction
    && ['submitted', 'acknowledged', 'terminal'].includes(selectedAction.state)));
  const userActionEventSourceClasses = $derived(CASE_ACTION_EVENT_SOURCE_CLASSES.filter((value) => value === 'analyst'
    || value === 'provider' && Boolean(selectedAction && ['submitted', 'acknowledged'].includes(selectedAction.state))));
  const legalTransitionStates = $derived(selectedAction
    ? CASE_ACTION_STATES.filter((nextState) => isLegalCaseActionTransition(selectedAction.state, nextState, transitionSourceClass)
      && (!['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState) || transitionSourceClass === 'analyst')
      && (!(nextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(selectedAction.state))
        || transitionSourceClass === 'analyst'))
    : []);
  const availableTransitionProviderOutcomes = $derived(
    selectedAction && transitionNextState === 'terminal'
      && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(selectedAction.state)
      ? ['withdrawn']
      : selectedAction && transitionNextState === 'submitted' && selectedAction.state === 'authorised'
        ? []
      : ['submitted', 'acknowledged', 'terminal'].includes(transitionNextState)
        ? CASE_PROVIDER_OUTCOMES.filter((value) => value !== 'withdrawn'
          && !(value === 'no_response' && transitionSourceClass === 'provider'))
        : [],
  );
  const quickAction = $derived(record.actions.find((action) => action.id === quickActionId)
    ?? (quickActionId ? null : record.actions.find((action) => action.state !== 'terminal') ?? record.actions.at(-1))
    ?? null);
  $effect(() => { if (!quickActionId && quickAction) quickActionId = quickAction.id; });

  let routeReviewClock = $state(new Date().toISOString());
  $effect(() => { record; routeReviewClock = new Date().toISOString(); });
  const quickRouteFreshness = $derived(quickAction
    ? responseRouteFreshness(quickAction.routeObservedAt, quickAction.routeReviewAfter, routeReviewClock) : 'unknown');

  function actionInput() {
    return {
      type: actionType,
      recipient: actionRecipient,
      contactSource: actionContactSource,
      routeObservedAt: isoFromUtcInput(actionRouteObservedAt),
      routeReviewAfter: isoFromUtcInput(actionRouteReviewAfter),
      contactLimitations: list(actionLimitations),
      dueAt: isoFromUtcInput(actionDueAt),
      followUpAt: isoFromUtcInput(actionFollowUpAt),
      originActionId: actionOriginId || null,
    };
  }

  function clearAction() {
    selectedActionId = '';
    actionType = 'internal_review';
    actionRecipient = '';
    actionContactSource = 'analyst supplied';
    actionRouteObservedAt = '';
    actionRouteReviewAfter = '';
    actionLimitations = '';
    actionDueAt = '';
    actionFollowUpAt = '';
    actionOriginId = '';
    clearTransition();
  }

  function selectAction(id: string) {
    actionDraft.changed();
    transitionDraft.changed();
    selectedActionId = id;
    const action = record.actions.find((item) => item.id === id);
    if (!action) {
      clearAction();
      return;
    }
    actionType = action.type;
    actionRecipient = action.recipient;
    actionContactSource = action.contactSource;
    actionRouteObservedAt = utcInputFromIso(action.routeObservedAt);
    actionRouteReviewAfter = utcInputFromIso(action.routeReviewAfter);
    actionLimitations = action.contactLimitations.join('\n');
    actionDueAt = utcInputFromIso(action.dueAt);
    actionFollowUpAt = utcInputFromIso(action.followUpAt);
    actionOriginId = action.originActionId || '';
    clearTransition();
    transitionNextState = nextTransitionState(action, transitionSourceClass);
  }

  async function reviewQuickRecipient() {
    if (!quickAction) return;
    routeReviewClock = new Date().toISOString();
    selectAction(quickAction.id);
    metadataExpanded = true;
    await tick();
    document.getElementById(`case-action-route-time-${record.id}`)?.focus();
  }

  function clearQuickEvent() {
    quickActionReference = '';
    quickProviderOutcome = '';
    quickOutcomeDetail = '';
    quickOccurredAt = '';
    quickEvidencePinId = '';
    quickLimitations = '';
  }

  function selectQuickAction(id: string) {
    quickActionDraft.changed();
    quickActionId = id;
    clearQuickEvent();
  }

  async function saveAction() {
    const unchanged = actionDraft.capture();
    const patch = selectedActionId
      ? { actionUpdate: { id: selectedActionId, ...actionInput() } }
      : { action: actionInput() };
    if (!await persist(patch, `${selectedActionId ? 'Updated' : 'Recorded'} a case action for ${record.domain}.`, () => document.getElementById(`quick-action-advance-${record.id}`)) || !unchanged()) return;
    clearAction();
  }

  function nextTransitionState(action: CaseActionRecord, sourceClass: CaseActionEventSourceClass): CaseActionState {
    return CASE_ACTION_STATES.find((nextState) => isLegalCaseActionTransition(action.state, nextState, sourceClass)
      && (!['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState) || sourceClass === 'analyst')
      && (!(nextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(action.state))
        || sourceClass === 'analyst')) ?? action.state;
  }

  function clearTransition() {
    transitionOccurredAt = '';
    transitionSourceClass = 'analyst';
    transitionProvenance = 'analyst recorded event';
    transitionReference = '';
    transitionEvidencePinId = '';
    transitionLimitations = '';
    transitionProviderOutcome = '';
    transitionOutcomeDetail = '';
  }

  function setTransitionSourceClass(value: string) {
    transitionSourceClass = value === 'provider' ? 'provider' : 'analyst';
    if (selectedAction) transitionNextState = nextTransitionState(selectedAction, transitionSourceClass);
    transitionProviderOutcome = '';
  }

  function setTransitionNextState(value: string) {
    if (CASE_ACTION_STATES.includes(value as CaseActionState)) transitionNextState = value as CaseActionState;
    transitionProviderOutcome = '';
  }

  async function addActionTransition() {
    if (!selectedAction) return;
    const unchanged = transitionDraft.capture();
    if (!await persist({
      actionUpdate: {
        id: selectedAction.id,
        transition: {
          nextState: transitionNextState,
          occurredAt: isoFromUtcInput(transitionOccurredAt) || new Date().toISOString(),
          sourceClass: transitionSourceClass,
          provenance: transitionProvenance,
          reference: transitionReference || null,
          evidencePinId: transitionEvidencePinId || null,
          limitations: list(transitionLimitations),
          providerOutcome: transitionProviderOutcome || null,
          outcomeDetail: transitionOutcomeDetail || null,
          originActionId: selectedAction.originActionId,
        },
      },
    }, `Appended a ${transitionNextState.replaceAll('_', ' ')} action event for ${record.domain}.`) || !unchanged()) return;
    clearTransition();
    await tick();
    if (unchanged() && selectedAction) transitionNextState = nextTransitionState(selectedAction, 'analyst');
  }

  function quickActionVerb(action: CaseActionRecord): string {
    if (action.state === 'drafting') return 'Ready for review';
    if (action.state === 'ready_for_review') return 'Mark reviewed';
    if (action.state === 'reviewed') return 'Authorise';
    if (action.state === 'authorised') return 'Mark sent';
    if (action.state === 'submitted') return quickProviderOutcome === 'no_response' ? 'Record no response' : 'Record provider response';
    if (action.state === 'acknowledged') return 'Record final provider outcome';
    return 'Action complete';
  }

  async function advanceQuickAction(action: CaseActionRecord) {
    if (action.state === 'terminal') return;
    const unchanged = quickActionDraft.capture();
    const nextState: CaseActionState = action.state === 'drafting' ? 'ready_for_review'
      : action.state === 'ready_for_review' ? 'reviewed'
        : action.state === 'reviewed' ? 'authorised'
          : action.state === 'authorised' ? 'submitted'
            : action.state === 'submitted' && quickProviderOutcome !== 'no_response' ? 'acknowledged'
              : 'terminal';
    const recordsProviderOutcome = action.state === 'submitted' || action.state === 'acknowledged';
    const sourceClass: CaseActionEventSourceClass = recordsProviderOutcome && quickProviderOutcome !== 'no_response'
      ? 'provider'
      : 'analyst';
    const provenance = nextState === 'ready_for_review' ? 'analyst prepared action'
      : nextState === 'reviewed' ? 'analyst reviewed action'
        : nextState === 'authorised' ? 'analyst authorised action'
          : nextState === 'submitted' ? 'analyst recorded delivery'
            : sourceClass === 'provider' ? 'provider response recorded by analyst'
              : 'analyst follow-up review';
    if (!await persist({
      actionUpdate: {
        id: action.id,
        transition: {
          nextState,
          occurredAt: isoFromUtcInput(quickOccurredAt) || new Date().toISOString(),
          sourceClass,
          provenance,
          reference: quickActionReference || null,
          evidencePinId: quickEvidencePinId || null,
          limitations: list(quickLimitations),
          providerOutcome: recordsProviderOutcome ? quickProviderOutcome || null : null,
          outcomeDetail: recordsProviderOutcome ? quickOutcomeDetail || null : null,
          originActionId: action.originActionId,
        },
      },
    }, `${quickActionVerb(action)} recorded for ${record.domain}.`) || !unchanged()) return;
    clearQuickEvent();
  }

  export function prepareDeliveryRecord(actionId: string, digestSha256: string): void {
    selectQuickAction(actionId);
    quickActionReference = `response-packet-sha256:${digestSha256}`;
  }
</script>

{#snippet metadataForm()}
  <form class="stack" oninput={actionDraft.changed} onchange={actionDraft.changed} onsubmit={(event) => { event.preventDefault(); void saveAction(); }}>
    <p class="notice">Date and time fields use UTC.</p>
    {#if record.actions.length}
      <label class="field">Action metadata<select value={selectedActionId} onchange={(event) => selectAction(event.currentTarget.value)}><option value="">Create a new action</option>{#each record.actions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient}</option>{/each}</select></label>
    {/if}
    {#if selectedActionIdentityLocked}<p class="notice">Submitted, acknowledged, and terminal action identity and recipient metadata are immutable. Update scheduling only, or create a linked follow-on action.</p>{/if}
    <div class="two-columns">
      <label class="field">Action type<select bind:value={actionType} disabled={selectedActionIdentityLocked}>{#each CASE_ACTION_TYPES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
      <label class="field">{mode === 'quick' ? 'Recipient or owner' : 'Recipient or internal owner'}<input bind:value={actionRecipient} maxlength="320" required disabled={selectedActionIdentityLocked}></label>
      <label class="field">{mode === 'quick' ? 'How this route was found' : 'Contact source'}<input bind:value={actionContactSource} maxlength="80" required disabled={selectedActionIdentityLocked}></label>
      <label class="field">Route observed at<input id={`case-action-route-time-${record.id}`} type="datetime-local" {...utcDateTimeInputAttributes} bind:value={actionRouteObservedAt} disabled={selectedActionIdentityLocked}></label>
      <label class="field">Route review after<input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={actionRouteReviewAfter} disabled={selectedActionIdentityLocked}></label>
      <label class="field">Originating action<select bind:value={actionOriginId} disabled={selectedActionIdentityLocked}><option value="">No originating action</option>{#each record.actions.filter((action) => action.id !== selectedActionId) as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient}</option>{/each}</select></label>
      <label class="field">Due at<input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={actionDueAt}></label>
      <label class="field">Follow-up at<input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={actionFollowUpAt}></label>
    </div>
    {#if !selectedActionIdentityLocked}<p class="notice">Record the source observation and its review deadline or published expiry after checking the route. Changing recipient evidence invalidates prior review and authorisation; follow-up dates do not refresh it.</p>{/if}
    <label class="field">Contact limitations <small>one per line</small><textarea bind:value={actionLimitations} maxlength="2000" rows="2" disabled={selectedActionIdentityLocked}></textarea></label>
    <div class="actions"><button class="btn" type="submit" disabled={mutationBusy}>{mutationBusy ? 'Saving…' : selectedActionId ? 'Update metadata' : 'Create drafting action'}</button>{#if selectedActionId}<button class="btn" type="button" disabled={mutationBusy} onclick={clearAction}>Cancel edit</button>{/if}</div>
  </form>

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
          <button class="btn small" type="button" onclick={() => { selectAction(action.id); onadvanced(); }}>Review or append event</button>
        </li>
      {/each}
    </ol>
  {/if}

{/snippet}

<section class="case-response-stage" aria-label="Case response actions">
  <details id={`case-response-decision-${record.id}`} bind:open={expanded}>
    <summary>{mode === 'quick' ? 'Prepare and track response' : 'Track append-only response actions'}</summary>
    <div class="response-form">
      {#if mode === 'quick' && quickAction}
        <form class="quick-form" oninput={quickActionDraft.changed} onchange={quickActionDraft.changed} onsubmit={(event) => { event.preventDefault(); void advanceQuickAction(quickAction); }}>
          {#if record.actions.length > 1}<label class="field">Action<select value={quickAction.id} onchange={(event) => selectQuickAction(event.currentTarget.value)}>{#each record.actions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient}</option>{/each}</select></label>{/if}
          <div class="retained-summary"><strong>{quickAction.type.replaceAll('_', ' ')} · {quickAction.state.replaceAll('_', ' ')}</strong><p>{quickAction.recipient}</p><small>Route source: {quickAction.contactSource} · freshness {quickRouteFreshness} at {routeReviewClock}</small><small>Observed {quickAction.routeObservedAt ?? 'time unavailable'} · review after {quickAction.routeReviewAfter ?? 'not recorded'}</small><small>Follow-up {quickAction.followUpAt ?? 'not scheduled'}</small></div>
          {#if !['submitted', 'acknowledged', 'terminal'].includes(quickAction.state)}<button class="btn" type="button" onclick={() => void reviewQuickRecipient()} disabled={mutationBusy}>Review recipient and schedule</button>{/if}
          {#if quickAction.state === 'authorised'}
            <label class="field">Delivery reference<input bind:value={quickActionReference} maxlength="500" placeholder="Provider reference, ticket, or response-packet digest"></label>
          {:else if quickAction.state === 'submitted' || quickAction.state === 'acknowledged'}
            <label class="field">Provider outcome<select bind:value={quickProviderOutcome}><option value="">Select the observed response</option>{#each CASE_PROVIDER_OUTCOMES.filter((value) => value !== 'withdrawn' && !(quickAction.state === 'acknowledged' && value === 'no_response')) as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
            <label class="field">Reference<input bind:value={quickActionReference} maxlength="500" placeholder="Ticket, message, or provider reference"></label>
            <label class="field">Outcome detail<textarea bind:value={quickOutcomeDetail} maxlength="2000" rows="2"></textarea></label>
          {/if}
          {#if ['authorised', 'submitted', 'acknowledged'].includes(quickAction.state)}
            <label class="field">Event time <small>UTC; leave blank only when recording the event as it happens</small><input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={quickOccurredAt}></label>
            <details><summary>Event evidence and limitations</summary><div class="stack"><CaseEvidencePinSelect label="Receipt evidence" pins={record.evidencePins} bind:value={quickEvidencePinId} /><label class="field">Receipt limitations <small>one per line</small><textarea bind:value={quickLimitations} maxlength="2000" rows="2"></textarea></label></div></details>
          {/if}
          {#if quickAction.state !== 'terminal'}
            <button id={`quick-action-advance-${record.id}`} class="primary" type="submit" disabled={mutationBusy || quickAction.state === 'authorised' && !quickActionReference.trim() || ['submitted', 'acknowledged'].includes(quickAction.state) && !quickProviderOutcome}>{quickActionVerb(quickAction)}</button>
          {:else}
            <p class="notice">This action is terminal. Its retained history is immutable.</p>
          {/if}
        </form>

        <details class="action-metadata" bind:open={metadataExpanded}>
          <summary>Create an action or update scheduling</summary>
          {@render metadataForm()}
        </details>
      {:else}
        {@render metadataForm()}
      {/if}
      {#if mode === 'advanced'}
        {#if selectedAction}
          <form class="transition-form" aria-labelledby={`transition-title-${record.id}`} oninput={transitionDraft.changed} onchange={transitionDraft.changed} onsubmit={(event) => { event.preventDefault(); void addActionTransition(); }}>
            <p class="notice">Date and time fields use UTC.</p>
            <div><strong id={`transition-title-${record.id}`}>Append transition for {selectedAction.recipient}</strong><span>Current projection: {selectedAction.state.replaceAll('_', ' ')}</span></div>
            {#if legalTransitionStates.length}
              <div class="two-columns">
                <label class="field">Event source<select value={transitionSourceClass} onchange={(event) => setTransitionSourceClass(event.currentTarget.value)}>{#each userActionEventSourceClasses as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
                <label class="field">Next state<select value={transitionNextState} onchange={(event) => setTransitionNextState(event.currentTarget.value)}>{#each legalTransitionStates as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
                <label class="field">Original event time<input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={transitionOccurredAt}></label>
                <label class="field">Provenance<input bind:value={transitionProvenance} maxlength="80" required></label>
                <label class="field">Bounded reference<input id={`case-action-transition-reference-${record.id}`} bind:value={transitionReference} maxlength="500"></label>
                <CaseEvidencePinSelect label="Evidence pin" pins={record.evidencePins} bind:value={transitionEvidencePinId} />
                <label class="field">Typed provider outcome<select bind:value={transitionProviderOutcome} required={transitionNextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(selectedAction.state)}><option value="">No provider outcome</option>{#each availableTransitionProviderOutcomes as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
              </div>
              {#if transitionNextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(selectedAction.state)}
                <p class="notice">Ending a pre-authorisation action requires an analyst-sourced withdrawn outcome. It does not authorise or submit the action.</p>
              {/if}
              <label class="field">Provider outcome detail<textarea bind:value={transitionOutcomeDetail} maxlength="2000" rows="2"></textarea></label>
              <label class="field">Event limitations <small>one per line</small><textarea bind:value={transitionLimitations} maxlength="2000" rows="2"></textarea></label>
              <button class="btn" type="submit" disabled={mutationBusy}>Append transition</button>
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

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { CASE_PROVIDER_OUTCOMES, type CaseRecord, type CaseActionRecord, type CaseActionState } from '$lib/cases';
  import type { CaseActionEventSourceClass } from '$lib/analysis/case-response-model.ts';
  import { isoFromUtcInput, utcDateTimeInputAttributes, list } from '$lib/analysis/case-response-form-values.ts';
  import type { CaseResponsePresentation, PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { responseRouteFreshness } from '../../../../packages/cases/response-route-freshness.mts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import { reviewClock } from '$lib/review-clock.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import CaseEvidencePinSelect from './CaseEvidencePinSelect.svelte';

  let { record, mode, mutationBusy, persist, onreviewrecipient, metadata }: {
    record: CaseRecord;
    mode: CaseResponsePresentation;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
    onreviewrecipient: (actionId: string) => void | Promise<void>;
    metadata: Snippet<[boolean]>;
  } = $props();

  const quickActionDraft = createCaseDraft(() => record.id, 'action-receipt', {
    quickActionId: '',
    quickActionReference: '',
    quickProviderOutcome: '',
    quickOutcomeDetail: '',
    quickOccurredAt: '',
    quickEvidencePinId: '',
    quickLimitations: ''
  });
  const quickAction = $derived(record.actions.find((action) => action.id === quickActionDraft.value.quickActionId)
    ?? (quickActionDraft.value.quickActionId ? null : record.actions.find((action) => action.state !== 'terminal') ?? record.actions.at(-1))
    ?? null);
  $effect(() => { if (!quickActionDraft.value.quickActionId && quickAction) quickActionDraft.value.quickActionId = quickAction.id; });

  const routeReviewClock = $derived(new Date($reviewClock).toISOString());
  const quickRouteFreshness = $derived(quickAction
    ? responseRouteFreshness(quickAction.routeObservedAt, quickAction.routeReviewAfter, routeReviewClock) : 'unknown');
  function clearQuickEvent() {
    quickActionDraft.value.quickActionReference = '';
    quickActionDraft.value.quickProviderOutcome = '';
    quickActionDraft.value.quickOutcomeDetail = '';
    quickActionDraft.value.quickOccurredAt = '';
    quickActionDraft.value.quickEvidencePinId = '';
    quickActionDraft.value.quickLimitations = '';
  }

  async function selectQuickAction(id: string): Promise<boolean> {
    if (!await quickActionDraft.leaveForm()) return false;
    if (!record.actions.some(action => action.id === id)) return false;
    quickActionDraft.value.quickActionId = id;
    clearQuickEvent();
    return true;
  }

  function quickActionVerb(action: CaseActionRecord): string {
    if (action.state === 'drafting') return 'Ready for review';
    if (action.state === 'ready_for_review') return 'Mark reviewed';
    if (action.state === 'reviewed') return 'Authorise';
    if (action.state === 'authorised') return 'Mark sent';
    if (action.state === 'submitted') return quickActionDraft.value.quickProviderOutcome === 'no_response' ? 'Record no response' : 'Record provider response';
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
            : action.state === 'submitted' && quickActionDraft.value.quickProviderOutcome !== 'no_response' ? 'acknowledged'
              : 'terminal';
    const recordsProviderOutcome = action.state === 'submitted' || action.state === 'acknowledged';
    const sourceClass: CaseActionEventSourceClass = recordsProviderOutcome && quickActionDraft.value.quickProviderOutcome !== 'no_response'
      ? 'provider'
      : 'analyst';
    const provenance = nextState === 'ready_for_review' ? 'analyst prepared action'
      : nextState === 'reviewed' ? 'analyst reviewed action'
        : nextState === 'authorised' ? 'analyst authorised action'
          : nextState === 'submitted' ? 'analyst recorded delivery'
            : sourceClass === 'provider' ? 'provider response recorded by analyst'
              : 'analyst follow-up review';
    if (!await quickActionDraft.persist(persist, {
      actionUpdate: {
        id: action.id,
        transition: {
          nextState,
          occurredAt: isoFromUtcInput(quickActionDraft.value.quickOccurredAt) || new Date().toISOString(),
          sourceClass,
          provenance,
          reference: quickActionDraft.value.quickActionReference || null,
          evidencePinId: quickActionDraft.value.quickEvidencePinId || null,
          limitations: list(quickActionDraft.value.quickLimitations),
          providerOutcome: recordsProviderOutcome ? quickActionDraft.value.quickProviderOutcome || null : null,
          outcomeDetail: recordsProviderOutcome ? quickActionDraft.value.quickOutcomeDetail || null : null,
          originActionId: action.originActionId,
        },
      },
    }, `${quickActionVerb(action)} recorded for ${record.domain}.`) || !unchanged()) return;
    clearQuickEvent();
  }

  export async function prepareDeliveryRecord(actionId: string, digestSha256: string): Promise<boolean> {
    if (!await selectQuickAction(actionId)) return false;
    quickActionDraft.changed();
    quickActionDraft.value.quickActionReference = `response-packet-sha256:${digestSha256}`;
    return true;
  }

  export async function selectReceipt(actionId: string): Promise<boolean> {
    return quickAction?.id === actionId || await selectQuickAction(actionId);
  }
</script>

<CaseDraftRecovery draft={quickActionDraft} />
{#if mode === 'quick' && quickAction}
  <form class="quick-form" aria-label="Record response event" data-recovery-form={quickActionDraft.form} oninput={quickActionDraft.changed} onsubmit={(event) => { event.preventDefault(); void advanceQuickAction(quickAction); }}>
    {#if record.actions.length > 1}<label class="field">Action<select value={quickAction.id} oninput={(event) => event.stopPropagation()} onchange={async (event) => { const select = event.currentTarget; await selectQuickAction(select.value); select.value = quickActionDraft.value.quickActionId; }}>{#each record.actions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient}</option>{/each}</select></label>{/if}
    <div class="retained-summary"><strong>{quickAction.type.replaceAll('_', ' ')} · {quickAction.state.replaceAll('_', ' ')}</strong><p>{quickAction.recipient}</p><small>Route source: {quickAction.contactSource} · freshness {quickRouteFreshness} at {routeReviewClock}</small><small>Observed {quickAction.routeObservedAt ?? 'time unavailable'} · review after {quickAction.routeReviewAfter ?? 'not recorded'}</small><small>Follow-up {quickAction.followUpAt ?? 'not scheduled'}</small></div>
    {#if !['submitted', 'acknowledged', 'terminal'].includes(quickAction.state)}<button class="btn" type="button" onclick={() => void onreviewrecipient(quickAction.id)} disabled={mutationBusy}>Review recipient and schedule</button>{/if}
    {#if quickAction.state === 'authorised'}
      <label class="field">Delivery reference<input bind:value={quickActionDraft.value.quickActionReference} maxlength="500" placeholder="Provider reference, ticket, or response-packet digest"></label>
    {:else if quickAction.state === 'submitted' || quickAction.state === 'acknowledged'}
      <label class="field">Provider outcome<select bind:value={quickActionDraft.value.quickProviderOutcome}><option value="">Select the observed response</option>{#each CASE_PROVIDER_OUTCOMES.filter((value) => value !== 'withdrawn' && !(quickAction.state === 'acknowledged' && value === 'no_response')) as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
      <label class="field">Reference<input bind:value={quickActionDraft.value.quickActionReference} maxlength="500" placeholder="Ticket, message, or provider reference"></label>
      <label class="field">Outcome detail<textarea bind:value={quickActionDraft.value.quickOutcomeDetail} maxlength="2000" rows="2"></textarea></label>
    {/if}
    {#if ['authorised', 'submitted', 'acknowledged'].includes(quickAction.state)}
      <label class="field">Event time <small>UTC; leave blank only when recording the event as it happens</small><input type="datetime-local" {...utcDateTimeInputAttributes} bind:value={quickActionDraft.value.quickOccurredAt}></label>
      <details><summary>Event evidence and limitations</summary><div class="stack"><CaseEvidencePinSelect label="Receipt evidence" pins={record.evidencePins} bind:value={quickActionDraft.value.quickEvidencePinId} /><label class="field">Receipt limitations <small>one per line</small><textarea bind:value={quickActionDraft.value.quickLimitations} maxlength="2000" rows="2"></textarea></label></div></details>
    {/if}
    {#if quickAction.state !== 'terminal'}
      <button id={`quick-action-advance-${record.id}`} class="primary" type="submit" disabled={quickActionDraft.state.busy || mutationBusy || quickAction.state === 'authorised' && !quickActionDraft.value.quickActionReference.trim() || ['submitted', 'acknowledged'].includes(quickAction.state) && !quickActionDraft.value.quickProviderOutcome}>{quickActionVerb(quickAction)}</button>
    {:else}
      <p class="notice">This action is terminal. Its retained history is immutable.</p>
    {/if}
  </form>

{/if}
{@render metadata(mode === 'quick' && Boolean(quickAction))}

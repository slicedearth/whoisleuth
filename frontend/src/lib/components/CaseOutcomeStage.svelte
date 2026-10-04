<script lang="ts">
  import { CASE_CLOSURE_REASONS } from '../../../../packages/cases/case-response-records.mts';
  import { caseLookupTarget } from '../../../../packages/cases/case-evidence-model.mts';
  import type { CaseRecord } from '../cases.ts';
  import { buildCaseResponseLifecycleSummary } from '$lib/analysis/case-response-model.ts';
  import { list } from '$lib/analysis/case-response-form-values.ts';
  import type { CaseResponsePresentation, PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import CaseRecheckReview from './CaseRecheckReview.svelte';
  import CaseRecheckQuestions from './CaseRecheckQuestions.svelte';
  import CaseResponseObjectSelect from './CaseResponseObjectSelect.svelte';
  import { selectedCaseResponseObject, caseResponseObjectChoices } from '../../../../packages/cases/case-response-object.mts';
  import CaseLinkedEvidence from './CaseLinkedEvidence.svelte';
  import { CASE_RECHECK_CONDITIONS } from '../../../../packages/cases/case-recheck-model.mts';
  import { caseClosureReviewBlocker, caseClosureActionBlocker, caseClosureHistoryQualification } from '../../../../packages/cases/case-response-outcomes.mts';

  let { record, mode, mutationBusy, persist }: {
    record: CaseRecord;
    mode: CaseResponsePresentation;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
  } = $props();

  let expanded = $state(false);
  $effect(() => { expanded = mode === 'quick'; });
  let recheckReview = $state<ReturnType<typeof CaseRecheckReview>>();
  export async function selectQuestion(id: string): Promise<boolean> {
    return await recheckReview?.selectQuestion(id) ?? false;
  }

  const closureDraft = createCaseDraft(() => record.id, 'closure', {
    closureReason: 'unable_to_proceed' as typeof CASE_CLOSURE_REASONS[number],
    closureSummary: '',
    closureReviewId: '',
    closureActionId: '',
    closureLimitations: '', responseObject: ''
  });
  const responseLifecycle = $derived(buildCaseResponseLifecycleSummary(record));
  const closureNeedsReview = $derived(closureDraft.value.closureReason === 'independently_not_reproduced' || closureDraft.value.closureReason === 'infrastructure_changed');
  const closureNeedsAction = $derived(closureDraft.value.closureReason === 'provider_reported_resolution_not_independently_checked');
  const closureObject = $derived(caseResponseObjectChoices(record).find(choice => choice.value === closureDraft.value.responseObject)?.object);
  const eligibleClosureReviews = $derived(record.observedEffects.reviews.filter((review) =>
    (!closureDraft.value.responseObject || closureObject)
    && caseClosureReviewBlocker(closureDraft.value.closureReason, review, new Date().toISOString(), closureObject, record.evidencePins) === null));
  const eligibleClosureActions = $derived(record.actions.filter((action) =>
    (!closureDraft.value.responseObject || closureObject)
    && caseClosureActionBlocker(closureDraft.value.closureReason, action, closureObject, new Date().toISOString()) === null));

  async function closeCaseDeliberately() {
    selectionError = '';
    let responseObject;
    try { responseObject = selectedCaseResponseObject(record, closureDraft.value.responseObject); }
    catch (cause) { selectionError = cause instanceof Error ? cause.message : 'Review the selected object.'; return; }
    const unchanged = closureDraft.capture();
    if (!await closureDraft.persist(persist, {
      closure: {
        reason: closureDraft.value.closureReason,
        summary: closureDraft.value.closureSummary,
        observedEffectReviewId: closureDraft.value.closureReviewId || null,
        actionId: closureDraft.value.closureActionId || null,
        limitations: list(closureDraft.value.closureLimitations),
        ...(responseObject ? { responseObject } : {}),
      },
    }, `Recorded a deliberate closure for ${record.domain}.`) || !unchanged()) return;
    closureDraft.value.closureSummary = '';
    closureDraft.value.closureReviewId = '';
    closureDraft.value.closureActionId = '';
    closureDraft.value.closureLimitations = '';
  }
  let selectionError = $state('');
</script>

{#if selectionError}<p role="alert">{selectionError} The draft remains available.</p>{/if}

<section class="case-response-stage" aria-label="Case independent review and closure">
  <details id={`case-response-outcome-${record.id}`} bind:open={expanded}>
    <summary>{mode === 'quick' ? 'Record recheck outcome and closure' : 'Verify remediation independently and close deliberately'}</summary>
    <div class="response-form remediation-review">
      <p class="notice">Provider responses, independent observations and analyst closure are separate records.</p>
      <a class="btn" href={`/lookup?q=${encodeURIComponent(caseLookupTarget(record))}&case=${encodeURIComponent(record.id)}`}>Prepare a recheck for {caseLookupTarget(record)}</a>
      <dl class="separate-times">
        <div><dt>Provider outcome time</dt><dd>{responseLifecycle.latestProviderOutcome ? `${responseLifecycle.latestProviderOutcome.occurredAt} · ${responseLifecycle.latestProviderOutcome.outcome.replaceAll('_', ' ')}` : `Withheld — ${responseLifecycle.providerOutcomeState}`}</dd></div>
        <div><dt>Independently observed change time</dt><dd>{responseLifecycle.latestObservedChangeAt ?? `Withheld — ${responseLifecycle.observedChangeState}`}</dd></div>
      </dl>
      {#if record.observedEffects.reviews.length && !responseLifecycle.latestObservedEffect}
        <p class="history-warning">A single latest independent review cannot be selected from the retained observation times. Review the individual records before drawing a conclusion.</p>
      {/if}
      {#if record.observedEffects.preV13HistoryUnavailable || record.closures.preV13HistoryUnavailable}
        <p class="history-warning">This Case predates v13. Earlier independent review or deliberate closure history is unavailable and was not reconstructed.</p>
      {/if}
      <CaseRecheckQuestions {record} {mutationBusy} {persist} />
      <CaseRecheckReview bind:this={recheckReview} {record} {mode} {mutationBusy} {persist} />
      {#if record.observedEffects.reviews.length}
        <ol class="records embedded-records" aria-label="Independent observed-effect reviews">
          {#each [...record.observedEffects.reviews].reverse() as review}
            <li><strong>{review.state.replaceAll('_', ' ')}</strong><p>{review.source}</p><p>Object: {review.responseObject ? `${review.responseObject.kind.replaceAll('_', ' ')} · ${review.responseObject.identifier}` : 'Unknown binding'}{review.objectOutcome ? ` · observed ${review.objectOutcome.replaceAll('_', ' ')}` : ''}</p>
              {#if review.recheck}<p><strong>{review.recheck.question}</strong><br>{review.recheck.targetHostname} · {review.recheck.conditions}<br><small>Conditions: {CASE_RECHECK_CONDITIONS[review.recheck.conditionsMatch]} · question {review.recheck.questionId}</small></p>{/if}
              <small>Review ID {review.id} · {review.observedAt} · {review.sourceClass} · {review.completeness}</small>{#if review.evidencePinId}<CaseLinkedEvidence pins={record.evidencePins} ids={[review.evidencePinId]} />{/if}{#if review.sightingId}<small>Sighting: {review.sightingId}</small>{/if}{#if review.followUpAt}<small>Scheduled follow-up: {review.followUpAt}</small>{/if}{#if review.limitations.length}<small>Limitations: {review.limitations.join('; ')}</small>{/if}</li>
          {/each}
        </ol>
      {/if}
      {#if record.observedEffects.omitted}<p class="history-warning">{record.observedEffects.omitted} earlier independent review{record.observedEffects.omitted === 1 ? '' : 's'} omitted by bounded retention.</p>{/if}

      <form class="stack closure-form" data-recovery-form={closureDraft.form} aria-labelledby={`closure-title-${record.id}`} oninput={closureDraft.changed} onsubmit={(event) => { event.preventDefault(); void closeCaseDeliberately(); }}>
        <strong id={`closure-title-${record.id}`}>Deliberate analyst closure</strong>
        <CaseResponseObjectSelect {record} label="Closure scope" emptyLabel="Whole Case analyst decision" bind:value={closureDraft.value.responseObject} />
        <p class="notice">A selected object closure leaves Case status and other incident links unchanged. Whole-Case closure is a separate deliberate decision; one scoped review cannot close it.</p>
        <p class="notice">Select the reason that the retained evidence supports. A timeout or failure to reproduce does not establish removal.</p>
        {#if closureDraft.value.closureReason === 'independently_not_reproduced' && !eligibleClosureReviews.length}
          <p role="status">No complete not-reproduced review is available for this closure. Limited reviews remain in the history; record a complete recheck or choose another reason.</p>
        {/if}
        <div class="two-columns">
          <label class="field">{mode === 'quick' ? 'Reason' : 'Closure reason'}<select bind:value={closureDraft.value.closureReason}>{#each CASE_CLOSURE_REASONS as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label class="field">Independent review<select bind:value={closureDraft.value.closureReviewId} required={closureNeedsReview}><option value="">{closureNeedsReview ? 'Select the required typed review' : 'No linked review'}</option>{#each eligibleClosureReviews as review}<option value={review.id}>{review.state.replaceAll('_', ' ')} · {review.observedAt}</option>{/each}</select></label>
          <label class="field">Provider action<select bind:value={closureDraft.value.closureActionId} required={closureNeedsAction}><option value="">{closureNeedsAction ? 'Select the required provider-resolution action' : 'No linked provider action'}</option>{#each eligibleClosureActions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {closureNeedsAction ? 'provider reported resolution' : action.providerOutcome?.replaceAll('_', ' ') ?? action.state.replaceAll('_', ' ')}</option>{/each}</select></label>
        </div>
        <label class="field">Closure summary<textarea bind:value={closureDraft.value.closureSummary} maxlength="2000" rows="2" required></textarea></label>
        <label class="field">Closure limitations <small>one per line</small><textarea bind:value={closureDraft.value.closureLimitations} maxlength="2000" rows="2"></textarea></label>
        <button class="btn" type="submit" disabled={closureDraft.state.busy || mutationBusy}>{closureDraft.value.responseObject ? 'Record object closure' : 'Close case with reason'}</button>
        <CaseDraftRecovery draft={closureDraft} />
      </form>
      {#if record.closures.records.length}
        <ol class="records embedded-records" aria-label="Deliberate case closures">
          {#each [...record.closures.records].reverse() as closure}
            {@const qualification = caseClosureHistoryQualification(closure, record.actions)}
            <li><strong>{closure.reason.replaceAll('_', ' ')}</strong><p>{closure.summary}</p><p>Scope: {closure.responseObject ? `${closure.responseObject.kind.replaceAll('_', ' ')} · ${closure.responseObject.identifier}` : 'Whole Case analyst decision'}</p><small>Closure ID {closure.id} · {closure.createdAt}</small>{#if closure.observedEffectReviewId}<small>Independent review: {closure.observedEffectReviewId}</small>{/if}{#if closure.actionId}<small>Provider action: {closure.actionId}</small>{/if}{#if qualification}<p class="inline-warning">{qualification}</p>{/if}{#if closure.limitations.length}<small>Limitations: {closure.limitations.join('; ')}</small>{/if}</li>
          {/each}
        </ol>
      {/if}
      {#if record.closures.omitted}<p class="inline-warning">{record.closures.omitted} closure records could not be retained. {record.closures.limitations.join(' ')}</p>{/if}
    </div>
  </details>

</section>

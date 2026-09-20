<script lang="ts">
  import { CASE_OBSERVED_EFFECT_SOURCE_CLASSES, CASE_OBSERVED_EFFECT_STATES, CASE_PIN_COMPLETENESS, type CaseRecord } from '$lib/cases';
  import { caseRecheckEvidence } from '$lib/analysis/case-evidence-presentation.ts';
  import { isoFromUtcInput, utcDateTimeInputAttributes, list } from '$lib/analysis/case-response-form-values.ts';
  import type { CaseResponsePresentation, PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import CaseEvidencePinSelect from './CaseEvidencePinSelect.svelte';
  import { CASE_RECHECK_CONDITIONS, caseRecheckQuestions, caseRecheckAnswerContext, caseRecheckComparisonWarnings, assertRecheckNonReproduction, type CaseRecheckAnswerContext } from '../../../../packages/cases/case-recheck-model.mts';

  let { record, mode, mutationBusy, persist }: {
    record: CaseRecord;
    mode: CaseResponsePresentation;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
  } = $props();

  const draft = createCaseDraft(() => record.id, 'observed-effect', {
    effectState: 'not_checked', effectObservedAt: '', effectSourceClass: 'analyst',
    effectSource: 'Analyst review', effectCompleteness: 'unknown', effectEvidencePinId: '',
    effectSightingId: '', effectFollowUpAt: '', effectLimitations: '',
    effectUsePinMetadata: false,
    questionId: '', questionUpdatedAt: '', conditionsMatch: 'unknown',
  });
  const sourceClasses = CASE_OBSERVED_EFFECT_SOURCE_CLASSES.filter(value => value !== 'import');
  const selected = $derived(record.evidencePins.find(pin => pin.id === draft.value.effectEvidencePinId));
  const retained = $derived(selected && draft.value.effectUsePinMetadata ? caseRecheckEvidence(selected) : null);
  const questions = $derived(caseRecheckQuestions(record.assertions));
  const question = $derived(questions.find(item => item.id === draft.value.questionId));
  const recheck = $derived(question ? caseRecheckAnswerContext(question, draft.value.conditionsMatch as CaseRecheckAnswerContext['conditionsMatch']) : undefined);
  const comparisonWarnings = $derived(recheck ? caseRecheckComparisonWarnings(recheck, record.evidencePins, retained ? selected : undefined) : []);
  const evidenceProblem = $derived(!draft.value.effectEvidencePinId ? null
    : !selected ? 'The selected evidence is no longer available. Choose another pin or record a manual observation.'
    : retained && !retained.observedAt ? 'This evidence has no observation time. It cannot date a recheck. Keep the pin as evidence, or record a separate dated observation.' : null);
  let error = $state('');

  export async function selectQuestion(id: string): Promise<boolean> {
    if (draft.value.questionId === id) return true;
    if (!await draft.leaveForm()) return false;
    const selectedQuestion = questions.find(item => item.id === id);
    if (id && !selectedQuestion) { error = 'The selected question changed or was resolved. Choose a current question.'; return false; }
    draft.value.questionId = id;
    draft.value.questionUpdatedAt = selectedQuestion?.updatedAt ?? '';
    draft.changed();
    return true;
  }

  async function save() {
    error = '';
    if (draft.value.questionId && (!question || question.updatedAt !== draft.value.questionUpdatedAt)) { error = 'The selected question changed or was resolved. Choose a current question.'; return; }
    if (evidenceProblem) { error = evidenceProblem; return; }
    if (recheck) {
      try { assertRecheckNonReproduction(draft.value.effectState as import('$lib/analysis/case-response-model.ts').CaseObservedEffectState, recheck,
        retained?.completeness ?? draft.value.effectCompleteness, record.evidencePins, retained ? selected : undefined, retained?.observedAt ?? isoFromUtcInput(draft.value.effectObservedAt) ?? new Date().toISOString()); }
      catch (cause) { error = cause instanceof Error ? cause.message : 'Review the comparison conditions.'; return; }
    }
    const manualTime = isoFromUtcInput(draft.value.effectObservedAt);
    const followUpAt = isoFromUtcInput(draft.value.effectFollowUpAt);
    if ((!retained && draft.value.effectObservedAt && !manualTime) || (draft.value.effectFollowUpAt && !followUpAt)) {
      error = 'Enter a valid UTC date and time.';
      return;
    }
    const unchanged = draft.capture();
    if (!await draft.persist(persist, {
      observedEffectReview: {
        state: draft.value.effectState,
        observedAt: retained?.observedAt ?? manualTime ?? new Date().toISOString(),
        sourceClass: retained?.sourceClass ?? draft.value.effectSourceClass,
        source: retained?.source ?? draft.value.effectSource,
        completeness: retained?.completeness ?? draft.value.effectCompleteness,
        evidencePinId: draft.value.effectEvidencePinId || null,
        sightingId: draft.value.effectSightingId || null,
        followUpAt,
        // Source limitations remain on the linked pin; this field records the analyst's additional qualifications.
        limitations: list(draft.value.effectLimitations),
        ...(recheck ? { recheck } : {}),
      },
    }, `Recorded an independent observed-effect review for ${record.domain}.`) || !unchanged()) return;
    draft.value.effectLimitations = '';
    draft.value.effectEvidencePinId = '';
    draft.value.effectSightingId = '';
    draft.value.effectUsePinMetadata = false;
  }
</script>

<form class="stack" data-recovery-form={draft.form} aria-labelledby={`effect-review-title-${record.id}`}
  oninput={() => { error = ''; draft.changed(); }} onsubmit={event => { event.preventDefault(); void save(); }}>
  <strong id={`effect-review-title-${record.id}`}>Record a recheck</strong>
  {#if questions.length || draft.value.questionId}
    <label class="field">Saved question<select bind:value={draft.value.questionId} onchange={event => { draft.value.questionUpdatedAt = questions.find(item => item.id === event.currentTarget.value)?.updatedAt ?? ''; draft.changed(); }}><option value="">Independent review without a saved question</option>{#each questions as item}<option value={item.id}>{item.statement}</option>{/each}</select></label>
    {#if recheck}
      <p class="notice"><strong>{recheck.question}</strong><br>Target: {recheck.targetHostname}<br>Compare: {recheck.conditions}</p>
      <label class="field">Comparison conditions<select bind:value={draft.value.conditionsMatch}>{#each Object.entries(CASE_RECHECK_CONDITIONS) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
      {#if comparisonWarnings.length}<ul class="notice" aria-label="Recheck comparison limitations">{#each comparisonWarnings as warning}<li>{warning}</li>{/each}</ul>{/if}
    {/if}
  {/if}
  <CaseEvidencePinSelect label={mode === 'quick' ? 'Current evidence' : 'Evidence pin'}
    pins={record.evidencePins} bind:value={draft.value.effectEvidencePinId} emptyLabel="Enter a manual observation"
    onselect={id => { draft.value.effectUsePinMetadata = Boolean(id); draft.changed(); }} />
  {#if selected}
    <label class="choice source-choice"><input type="checkbox" bind:checked={draft.value.effectUsePinMetadata}>Use selected source details</label>
  {/if}
  {#if evidenceProblem}<p class="notice" role="status">{evidenceProblem}</p>{/if}
  {#if retained}
    <p class="notice">Source, observation time and completeness come from the selected evidence. This records your review, not a new collection.</p>
  {/if}
  <div class="two-columns">
    <label class="field">Observed effect<select bind:value={draft.value.effectState}>{#each CASE_OBSERVED_EFFECT_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
    {#if !retained}
      <div class="field"><label for={`effect-observation-time-${record.id}`}>{mode === 'quick' ? 'Observed at' : 'Observation time'}</label><input id={`effect-observation-time-${record.id}`} type="datetime-local" {...utcDateTimeInputAttributes} bind:value={draft.value.effectObservedAt} aria-describedby={`effect-time-${record.id}`}><small id={`effect-time-${record.id}`}>UTC. Leave blank to record an observation made now.</small></div>
      <label class="field">Source class<select bind:value={draft.value.effectSourceClass}>{#each sourceClasses as value}<option {value}>{value}</option>{/each}</select></label>
      <label class="field">{mode === 'quick' ? 'Source' : 'Separately attributed source'}<input bind:value={draft.value.effectSource} maxlength="80" required></label>
      <label class="field">Completeness<select bind:value={draft.value.effectCompleteness}>{#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}</select></label>
    {/if}
    <div class="field"><label for={`effect-follow-up-${record.id}`}>{mode === 'quick' ? 'Follow up at' : 'Scheduled local follow-up'}</label><input id={`effect-follow-up-${record.id}`} type="datetime-local" {...utcDateTimeInputAttributes} bind:value={draft.value.effectFollowUpAt} aria-describedby={`effect-follow-up-timezone-${record.id}`}><small id={`effect-follow-up-timezone-${record.id}`}>UTC</small></div>
  </div>
  <details>
    <summary>Additional context</summary>
    <div class="stack">
      <label class="field">Existing sighting<select bind:value={draft.value.effectSightingId}><option value="">No sighting</option>{#each record.sightings as sighting}<option value={sighting.id}>{sighting.state.replaceAll('_', ' ')} · {sighting.source}</option>{/each}</select></label>
    </div>
  </details>
  <label class="field">Limitations <small>one per line</small><textarea bind:value={draft.value.effectLimitations} maxlength="2000" rows="2"></textarea></label>
  {#if error}<p class="notice" role="alert">{error}</p>{/if}
  <button class="btn" type="submit" disabled={draft.state.busy || mutationBusy || Boolean(evidenceProblem) || mode === 'quick' && draft.value.effectState === 'not_checked'}>{mode === 'quick' ? 'Record independent outcome' : 'Record independent review'}</button>
  <CaseDraftRecovery {draft} />
</form>

<style>
  .source-choice { min-height: 44px; }
</style>

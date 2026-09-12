<script lang="ts">
  import { tick } from 'svelte';
  import { CASE_OBSERVED_EFFECT_STATES, CASE_PIN_COMPLETENESS, type CaseRecord } from '$lib/cases';
  import type { LookupRecheckComparison, LookupRecheckOutcomeInput } from '$lib/controllers/lookup-case-controller.ts';
  import { clearsLocalMutationDraft, type LocalMutationOutcome } from '$lib/local-mutation-outcome.ts';
  import { restoreSubmittedFocus } from '$lib/controllers/submitted-draft';
  import { isoFromUtcInput, utcDateTimeInputAttributes } from '$lib/analysis/case-response-form-values.ts';
  import { CASE_RECHECK_CONDITIONS, caseRecheckQuestions, caseRecheckAnswerContext, type CaseRecheckAnswerContext } from '../../../../packages/cases/case-recheck-model.mts';

  let { record, comparison, busy, save, changed }: {
    record: CaseRecord; comparison: LookupRecheckComparison; busy: boolean;
    save: (input: LookupRecheckOutcomeInput) => Promise<LocalMutationOutcome>;
    changed: (edited: boolean) => void;
  } = $props();
  let outcomeState = $state('not_checked'), completeness = $state('unknown'), source = $state('Analyst-reviewed Lookup recheck');
  let followUpAt = $state(''), limitations = $state(''), questionId = $state(''), questionUpdatedAt = $state('');
  let conditionsMatch = $state<CaseRecheckAnswerContext['conditionsMatch']>('unknown'), error = $state('');
  let form = $state<HTMLFormElement>();
  const questions = $derived(caseRecheckQuestions(record.assertions));
  const question = $derived(questions.find(item => item.id === questionId));
  const recheck = $derived(question ? caseRecheckAnswerContext(question, conditionsMatch) : undefined);

  function display(value: unknown): string {
    if (Array.isArray(value)) return value.map(String).join(', ') || 'none';
    return value === null || value === undefined || value === '' ? 'unavailable' : String(value);
  }
  async function submit() {
    error = '';
    if (!comparison.available || outcomeState === 'not_checked' || busy) return;
    if (questionId && (!question || question.updatedAt !== questionUpdatedAt)) { error = 'The saved question changed or was resolved. Select it again after reviewing its conditions.'; return; }
    const followUp = isoFromUtcInput(followUpAt);
    if (followUpAt && !followUp) { error = 'Enter a valid UTC follow-up time.'; return; }
    const comparisonSummary = comparison.changes.length ? comparison.changes.map(change => `${change.label}: ${display(change.before)} to ${display(change.after)}`).join('; ').slice(0, 1000)
      : 'No comparable material field change was found between the retained Case observations.';
    const input: LookupRecheckOutcomeInput = { state: outcomeState, completeness, source: source.trim(), followUpAt: followUp,
      limitations: limitations.split(/\r?\n/u).map(item => item.trim()).filter(Boolean), comparisonSummary, ...(recheck ? { recheck } : {}) };
    // Later form edits remain a draft even when this submitted input succeeds.
    const captured = JSON.stringify({ outcomeState, completeness, source, followUpAt, limitations, questionId, questionUpdatedAt, conditionsMatch });
    const origin = form?.contains(document.activeElement) && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      const outcome = await save(input);
      if (clearsLocalMutationDraft(outcome) && captured === JSON.stringify({ outcomeState, completeness, source, followUpAt, limitations, questionId, questionUpdatedAt, conditionsMatch })) changed(false);
    } catch { error = 'The recheck could not be recorded. Your draft remains available.'; }
    finally { await tick(); restoreSubmittedFocus(origin, origin, form); }
  }
</script>

<section class="recheck-comparison" aria-labelledby="lookup-recheck-comparison-title">
  <header><strong id="lookup-recheck-comparison-title">Recheck comparison</strong><span>{comparison.observedAt || 'Time unavailable'}</span></header>
  <p>{comparison.detail}</p>
  {#if comparison.changes.length}<ul>{#each comparison.changes as change}<li data-tone={change.tone}><strong>{change.label}</strong><span>{display(change.before)} → {display(change.after)}</span></li>{/each}</ul>{/if}
  {#if comparison.available}
    <form bind:this={form} aria-label="Record Lookup recheck" oninput={() => { error = ''; changed(true); }} onsubmit={event => { event.preventDefault(); void submit(); }}>
      {#if questions.length || questionId}
        <label class="field">Saved question<select bind:value={questionId} onchange={event => { questionUpdatedAt = questions.find(item => item.id === event.currentTarget.value)?.updatedAt ?? ''; changed(true); }}><option value="">Independent review without a saved question</option>{#each questions as item}<option value={item.id}>{item.statement}</option>{/each}</select></label>
        {#if recheck}<p><strong>{recheck.question}</strong><br>Target: {recheck.targetHostname}<br>Compare: {recheck.conditions}</p>
          <label class="field">Comparison conditions<select bind:value={conditionsMatch}>{#each Object.entries(CASE_RECHECK_CONDITIONS) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
        {/if}
      {/if}
      <div class="classification-fields responsive-grid">
        <label class="field">Observed outcome<select bind:value={outcomeState}>{#each CASE_OBSERVED_EFFECT_STATES as value}<option {value}>{value === 'not_checked' ? 'Select the supported outcome' : value.replaceAll('_', ' ')}</option>{/each}</select></label>
        <label class="field">Completeness<select bind:value={completeness}>{#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}</select></label>
      </div>
      <div class="classification-fields responsive-grid">
        <label class="field">Review source<input bind:value={source} maxlength="80" required></label>
        <div class="field"><label for="lookup-recheck-follow-up">Follow up at (UTC)</label><input id="lookup-recheck-follow-up" type="datetime-local" {...utcDateTimeInputAttributes} bind:value={followUpAt}></div>
      </div>
      <label class="field">Limitations <small>one per line</small><textarea bind:value={limitations} maxlength="2000" rows="2"></textarea></label>
      {#if error}<p class="notice" role="alert">{error}</p>{/if}
      <button class="btn small" type="submit" disabled={busy || outcomeState === 'not_checked' || !source.trim()}>Record reviewed recheck outcome</button>
    </form>
  {/if}
</section>

<style>
  .recheck-comparison { display: grid; gap: 12px; min-width: 0; padding-block: 12px; border-block: 1px solid var(--border); }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; }
  header strong { font-size: var(--text-sm); }
  header span, p { color: var(--muted); font-size: var(--text-xs); overflow-wrap: anywhere; }
  p { margin: 0; line-height: 1.55; }
  ul { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: minmax(100px, .35fr) minmax(0, 1fr); gap: 8px; padding-block: 6px; border-bottom: 1px solid var(--border); font-size: var(--text-xs); overflow-wrap: anywhere; }
  form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; }
  .classification-fields { --grid-min: 18rem; --grid-gap: 12px; }
  .field, input, select, textarea { min-width: 0; }
  input, select, textarea { width: 100%; }
  @media (max-width: 700px) { li { grid-template-columns: 1fr; } }
</style>

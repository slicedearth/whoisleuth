<script lang="ts">
  import { caseLookupTarget, type CaseRecord } from '$lib/cases';
  import { caseRecheckQuestions, readCaseRecheckContext } from '../../../../packages/cases/case-recheck-model.mts';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import CaseEvidencePinSelect from './CaseEvidencePinSelect.svelte';
  import { MAX_RESPONSE_RATIONALE_LENGTH } from '../../../../packages/contracts/case-portability.mts';

  let { record, mutationBusy, persist }: { record: CaseRecord; mutationBusy: boolean; persist: PersistCaseResponse } = $props();
  const draft = createCaseDraft(() => record.id, 'recheck-question', { question: '', targetHostname: '', baselinePinId: '', conditions: '' });
  const questions = $derived(caseRecheckQuestions(record.assertions));
  let error = $state('');
  async function save() {
    error = '';
    try {
      const recheck = readCaseRecheckContext({ targetHostname: (draft.value.targetHostname || caseLookupTarget(record)).trim().toLowerCase(),
        baselinePinId: draft.value.baselinePinId || null, conditions: draft.value.conditions.trim() });
      const unchanged = draft.capture();
      if (!await draft.persist(persist, { assertion: { kind: 'next_step', statement: draft.value.question.trim(), state: 'open',
        evidencePinIds: recheck?.baselinePinId ? [recheck.baselinePinId] : [], recheck } }, 'Saved the recheck question. No collection was started.') || !unchanged()) return;
      draft.value.question = ''; draft.value.conditions = ''; draft.value.baselinePinId = '';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'The recheck question could not be saved.'; }
  }
</script>

<details class="recheck-questions">
  <summary>Recheck questions{#if questions.length} · {questions.length} open{/if}</summary>
  <div class="stack">
    {#if questions.length}
      <ul class="records" aria-label="Saved recheck questions">
        {#each questions as question (question.id)}
          <li>
            <strong>{question.statement}</strong>
            <p>{question.recheck!.targetHostname} · {question.recheck!.conditions}</p>
            <div class="button-row">
              <a class="btn" href={`/lookup?q=${encodeURIComponent(question.recheck!.targetHostname)}&case=${encodeURIComponent(record.id)}`}>Prepare recheck</a>
              <button class="btn" type="button" disabled={mutationBusy} aria-label={`Resolve question: ${question.statement}`}
                onclick={() => void persist({ assertionUpdate: { id: question.id, state: 'resolved', expectedUpdatedAt: question.updatedAt } }, 'Resolved the recheck question. Its retained answers are unchanged.')}>Resolve question</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
    <form class="stack" data-recovery-form={draft.form} aria-label="Save a recheck question" oninput={() => { error = ''; draft.changed(); }} onsubmit={event => { event.preventDefault(); void save(); }}>
      <label class="field">Question<textarea bind:value={draft.value.question} maxlength={MAX_RESPONSE_RATIONALE_LENGTH} rows="2" required placeholder="Is the reported page still being served?"></textarea></label>
      <label class="field">Target hostname<input bind:value={draft.value.targetHostname} placeholder={caseLookupTarget(record)} maxlength="253" autocapitalize="none" spellcheck="false" /></label>
      <CaseEvidencePinSelect label="Baseline evidence" pins={record.evidencePins} bind:value={draft.value.baselinePinId} emptyLabel="No retained baseline" />
      <label class="field">Comparison conditions<textarea bind:value={draft.value.conditions} maxlength={MAX_RESPONSE_RATIONALE_LENGTH} rows="2" required placeholder="Page or evidence to compare, collection method and relevant viewport or location. Do not include credentials."></textarea></label>
      {#if error}<p class="notice" role="alert">{error}</p>{/if}
      <button class="btn" type="submit" disabled={mutationBusy || draft.state.busy}>Save recheck question</button>
      <CaseDraftRecovery {draft} />
    </form>
  </div>
</details>

<style>
  .recheck-questions > summary { min-height: 44px; cursor: pointer; padding-block: 12px; }
  .recheck-questions .records { padding: 0; list-style: none; }
  .recheck-questions li { padding-block: 12px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
  .button-row { display: flex; flex-wrap: wrap; gap: 8px; }
</style>

<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import { buildCaseAfterActionNote, CASE_AFTER_ACTION_FIELDS } from '../../../../packages/cases/case-after-action.mts';
  import { MAX_NOTE_LENGTH } from '../../../../packages/contracts/case-portability.mts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';

  let { record, mutationBusy, persist }: { record: CaseRecord; mutationBusy: boolean; persist: PersistCaseResponse } = $props();
  const draft = createCaseDraft(() => record.id, 'after-action', {
    delay: '', usefulEvidence: '', misleadingEvidence: '', returnedComplaint: '', nextTime: '',
  });
  let error = $state('');
  async function save() {
    error = '';
    let note: string;
    try { note = buildCaseAfterActionNote(draft.value); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not prepare the review.'; return; }
    const unchanged = draft.capture();
    if (!await draft.persist(persist, { note }, `Recorded an after-action review for ${record.domain}.`) || !unchanged()) return;
    for (const { id } of CASE_AFTER_ACTION_FIELDS) draft.value[id] = '';
  }
</script>

<section class="case-response-stage" aria-label="Case after-action review">
  <details>
    <summary>Record lessons from this investigation</summary>
    <p class="notice">Answer only what is useful. This saves one ordinary Case note and does not change the assessment or provider outcome.</p>
    <form class="stack" data-recovery-form={draft.form} oninput={() => { error = ''; draft.changed(); }} onsubmit={(event) => { event.preventDefault(); void save(); }}>
      {#each CASE_AFTER_ACTION_FIELDS as field}
        <label class="field">{field.label}<textarea bind:value={draft.value[field.id]} maxlength={MAX_NOTE_LENGTH} rows="2"></textarea></label>
      {/each}
      {#if error}<p role="alert">{error}</p>{/if}
      <button class="btn" type="submit" disabled={mutationBusy || draft.state.busy}>Save review as a note</button>
      <CaseDraftRecovery {draft} />
    </form>
  </details>
</section>

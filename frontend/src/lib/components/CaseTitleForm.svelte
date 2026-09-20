<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { MAX_CASE_OBJECTIVE_LENGTH } from '../../../../packages/contracts/case-portability.mts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  let { record, mutationBusy, persist }: { record: CaseRecord; mutationBusy: boolean; persist: PersistCaseResponse } = $props();
  const draft = createCaseDraft(() => record.id, 'incident-title', { title: '', baseTitle: '' });
  const changedSinceDraft = $derived(draft.state.edited && draft.value.baseTitle !== (record.title ?? ''));
  $effect(() => { if (!draft.state.edited && !draft.state.busy && !mutationBusy) {
    draft.value.title = record.title ?? ''; draft.value.baseTitle = record.title ?? '';
  } });
</script>

<details class="case-response-stage title-editor">
  <summary>Edit incident title</summary>
  <form data-recovery-form={draft.form} oninput={draft.changed} onsubmit={(event) => {
    event.preventDefault();
    void draft.persist(persist, { title: draft.value.title, expectedTitle: draft.value.baseTitle }, 'Updated the incident title.', () => document.getElementById(`case-title-${record.id}`));
  }}>
    <label for={`case-title-${record.id}`}>Incident title</label>
    <input id={`case-title-${record.id}`} bind:value={draft.value.title} maxlength={MAX_CASE_OBJECTIVE_LENGTH} disabled={mutationBusy || draft.state.busy} autocomplete="off">
    {#if changedSinceDraft}
      <p role="status">The saved title changed. Current title: {record.title || 'Untitled Case'}. Your draft is preserved.</p>
      <button class="btn" type="button" disabled={mutationBusy || draft.state.busy} onclick={() => { draft.value.baseTitle = record.title ?? ''; draft.changed(); }}>Use current title as review baseline</button>
    {/if}
    <button class="btn" type="submit" disabled={mutationBusy || draft.state.busy || !draft.state.edited || changedSinceDraft}>Save title</button>
  </form>
  <CaseDraftRecovery {draft} />
</details>

<style>
  .title-editor { min-width: 0; padding-block: 12px; border-bottom: 1px solid var(--border); }
  summary { cursor: pointer; font-weight: 650; }
  form { display: grid; gap: 8px; margin-block: 12px; }
  input { min-width: 0; width: 100%; min-height: 44px; }
  button { justify-self: start; }
  p { margin: 0; overflow-wrap: anywhere; }
</style>

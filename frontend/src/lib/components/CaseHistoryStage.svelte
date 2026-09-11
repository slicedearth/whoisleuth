<script lang="ts">
  import { CASE_MANUAL_TRAIL_KINDS, type CaseRecord } from '$lib/cases';
  import { buildCaseInvestigationTrail } from '$lib/analysis/case-response-model.ts';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';

  let { record, mutationBusy, persist }: {
    record: CaseRecord;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
  } = $props();
  const trailDraft = createCaseDraft(() => record.id, 'manual-step', {
    trailKind: 'pivot',
    trailSummary: '',
    trailTarget: ''
  });
  const investigationTrail = $derived(buildCaseInvestigationTrail(record));

  async function addTrailEvent() {
    const unchanged = trailDraft.capture();
    if (!await trailDraft.persist(persist, { trailEvent: { kind: trailDraft.value.trailKind, summary: trailDraft.value.trailSummary, target: trailDraft.value.trailTarget } },
      `Recorded a manual investigation step for ${record.domain}.`) || !unchanged()) return;
    trailDraft.value.trailKind = 'pivot';
    trailDraft.value.trailSummary = '';
    trailDraft.value.trailTarget = '';
  }
</script>

<section class="case-response-stage" aria-label="Case investigation history">
  <details open>
    <summary>Record and review the investigation trail</summary>
    <form class="stack" data-recovery-form={trailDraft.form} oninput={trailDraft.changed} onsubmit={(event) => { event.preventDefault(); void addTrailEvent(); }}>
      <label class="field">Manual step type<select bind:value={trailDraft.value.trailKind}>{#each CASE_MANUAL_TRAIL_KINDS as value}<option {value}>{value}</option>{/each}</select></label>
      <label class="field">What did you do or decide?<textarea bind:value={trailDraft.value.trailSummary} maxlength="2000" rows="2" required></textarea></label>
      <label class="field">Target or destination <small>optional; do not paste credentials or sensitive query strings</small><input bind:value={trailDraft.value.trailTarget} maxlength="500"></label>
      <button class="btn" type="submit" disabled={trailDraft.state.busy || mutationBusy}>Record manual step</button>
      <CaseDraftRecovery draft={trailDraft} />
    </form>
    {#if investigationTrail.length}
      <ol class="records trail">{#each investigationTrail as item}<li><strong>{item.label}</strong><p>{item.detail}</p><small>{item.createdAt}</small></li>{/each}</ol>
    {:else}
      <p class="notice">No reasoning, actions or manual steps recorded. Browser navigation is not tracked.</p>
    {/if}
  </details>
</section>

<script lang="ts">
  import { CASE_MANUAL_TRAIL_KINDS, type CaseRecord } from '$lib/cases';
  import { buildCaseInvestigationTrail } from '$lib/analysis/case-response-model.ts';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createDraftRevision } from '$lib/controllers/submitted-draft';

  let { record, mutationBusy, persist }: {
    record: CaseRecord;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
  } = $props();
  let trailKind = $state('pivot');
  let trailSummary = $state('');
  let trailTarget = $state('');
  const trailDraft = createDraftRevision(() => record.id);
  const investigationTrail = $derived(buildCaseInvestigationTrail(record));

  async function addTrailEvent() {
    const unchanged = trailDraft.capture();
    if (!await persist({ trailEvent: { kind: trailKind, summary: trailSummary, target: trailTarget } },
      `Recorded a manual investigation step for ${record.domain}.`) || !unchanged()) return;
    trailKind = 'pivot';
    trailSummary = '';
    trailTarget = '';
  }
</script>

<section class="case-response-stage" aria-label="Case investigation history">
  <details open>
    <summary>Record and review the investigation trail</summary>
    <form class="stack" oninput={trailDraft.changed} onchange={trailDraft.changed} onsubmit={(event) => { event.preventDefault(); void addTrailEvent(); }}>
      <label class="field">Manual step type<select bind:value={trailKind}>{#each CASE_MANUAL_TRAIL_KINDS as value}<option {value}>{value}</option>{/each}</select></label>
      <label class="field">What did you do or decide?<textarea bind:value={trailSummary} maxlength="2000" rows="2" required></textarea></label>
      <label class="field">Target or destination <small>optional; do not paste credentials or sensitive query strings</small><input bind:value={trailTarget} maxlength="500"></label>
      <button class="btn" type="submit" disabled={mutationBusy}>Record manual step</button>
    </form>
    {#if investigationTrail.length}
      <ol class="records trail">{#each investigationTrail as item}<li><strong>{item.label}</strong><p>{item.detail}</p><small>{item.createdAt}</small></li>{/each}</ol>
    {:else}
      <p class="notice">No reasoning, actions or manual steps recorded. Browser navigation is not tracked.</p>
    {/if}
  </details>
</section>

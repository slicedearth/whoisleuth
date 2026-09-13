<script lang="ts">
  import {
    CASE_ASSERTION_KINDS, CASE_ASSERTION_STATES, CASE_DECISION_CONFIDENCE_LEVELS,
    CASE_DISPOSITIONS, CASE_EVIDENCE_RELATION_STANCES,
    CASE_REVIEW_REASONS, isReviewedCaseDisposition, type CaseRecord, type CaseEvidenceRelationStance,
  } from '$lib/cases';
  import type { CaseResponsePresentation, PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import CaseInvestigationBranches from '$lib/components/CaseInvestigationBranches.svelte';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  import CaseLinkedEvidence from './CaseLinkedEvidence.svelte';
  import CaseAssessmentComparison from './CaseAssessmentComparison.svelte';
  import { caseEvidenceChoiceName } from '$lib/analysis/case-evidence-presentation.ts';

  let { record, mode, mutationBusy, persist, onmessage }: {
    record: CaseRecord;
    mode: CaseResponsePresentation;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
    onmessage: (message: string) => void;
  } = $props();

  let expanded = $state(false);
  $effect(() => { expanded = mode === 'quick'; });

  const decisionDraft = createCaseDraft(() => record.id, 'decision', {
    decisionSummary: '',
    decisionRationale: '',
    decisionConfidence: 'unknown',
    decisionConfidenceBasis: '',
    decisionPinIds: [] as string[],
    decisionDisposition: 'unreviewed',
    decisionReviewReason: '',
    decisionClassificationDirty: false
  });
  const assertionDraft = createCaseDraft(() => record.id, 'assertion', {
    assertionKind: 'hypothesis',
    assertionStatement: '',
    assertionRationale: '',
    assertionEvidenceRelations: [] as Array<{ evidencePinId: string; stance: CaseEvidenceRelationStance }>,
    assertionState: 'open'
  }, { assertionEvidenceRelations: { evidencePinId: '', stance: '' } });
  $effect(() => {
    record.updatedAt;
    if (!decisionDraft.value.decisionClassificationDirty && !mutationBusy) {
      decisionDraft.value.decisionDisposition = record.disposition;
      decisionDraft.value.decisionReviewReason = record.reviewReasonCode ?? '';
    }
  });

  function assertionItemId(id: string): string {
    return `case-assertion-${record.id}-${id}`;
  }

  async function addDecision() {
    const unchanged = decisionDraft.capture();
    if (decisionDraft.value.decisionDisposition === 'unreviewed' || !decisionDraft.value.decisionReviewReason) {
      onmessage('Select a reviewed disposition and review reason before recording a conclusion.');
      return;
    }
    if (!decisionDraft.value.decisionPinIds.length) {
      onmessage('Select at least one retained evidence pin before recording a conclusion. Use an assertion for an unsupported hypothesis or unknown.');
      return;
    }
    if (!await decisionDraft.persist(persist, {
      disposition: decisionDraft.value.decisionDisposition,
      reviewReasonCode: decisionDraft.value.decisionReviewReason,
      decision: {
        summary: decisionDraft.value.decisionSummary,
        rationale: decisionDraft.value.decisionRationale,
        confidence: decisionDraft.value.decisionConfidence,
        confidenceBasis: decisionDraft.value.decisionConfidenceBasis,
        evidencePinIds: decisionDraft.value.decisionPinIds,
      },
    }, `Recorded an analyst decision for ${record.domain}.`) || !unchanged()) return;
    decisionDraft.value.decisionSummary = '';
    decisionDraft.value.decisionRationale = '';
    decisionDraft.value.decisionConfidence = 'unknown';
    decisionDraft.value.decisionConfidenceBasis = '';
    decisionDraft.value.decisionPinIds = [];
    decisionDraft.value.decisionClassificationDirty = false;
  }

  async function addAssertion() {
    const unchanged = assertionDraft.capture();
    if (!await assertionDraft.persist(persist, {
      assertion: {
        kind: assertionDraft.value.assertionKind,
        statement: assertionDraft.value.assertionStatement,
        rationale: assertionDraft.value.assertionRationale,
        evidenceRelations: assertionDraft.value.assertionEvidenceRelations,
        state: assertionDraft.value.assertionState,
      },
    }, `Recorded a structured analyst assertion for ${record.domain}.`) || !unchanged()) return;
    assertionDraft.value.assertionKind = 'hypothesis';
    assertionDraft.value.assertionStatement = '';
    assertionDraft.value.assertionRationale = '';
    assertionDraft.value.assertionEvidenceRelations = [];
    assertionDraft.value.assertionState = 'open';
  }

  function assertionEvidenceStance(evidencePinId: string): string {
    return assertionDraft.value.assertionEvidenceRelations.find((item) => item.evidencePinId === evidencePinId)?.stance ?? '';
  }

  function setAssertionEvidenceStance(evidencePinId: string, stance: string) {
    assertionDraft.value.assertionEvidenceRelations = assertionDraft.value.assertionEvidenceRelations.filter((item) => item.evidencePinId !== evidencePinId);
    if (CASE_EVIDENCE_RELATION_STANCES.includes(stance as CaseEvidenceRelationStance)) {
      assertionDraft.value.assertionEvidenceRelations = [...assertionDraft.value.assertionEvidenceRelations, { evidencePinId, stance: stance as CaseEvidenceRelationStance }];
    }
  }

  async function setAssertionState(id: string, state: string) {
    await persist(
      { assertionUpdate: { id, state } },
      `Updated the analyst assertion for ${record.domain}.`,
      () => document.getElementById(assertionItemId(id)),
    );
  }

</script>

<section class="case-response-stage" aria-label="Case assessment">
  <details id={`case-response-assessment-${record.id}`} bind:open={expanded}>
    <summary>{mode === 'quick' ? 'Record conclusion' : 'Record an analyst decision'}</summary>
    <form class="response-form" data-recovery-form={decisionDraft.form} oninput={decisionDraft.changed} onsubmit={(event) => { event.preventDefault(); void addDecision(); }}>
      <div class="assessment-review">
      <div class="assessment-draft">
      <div class="two-columns">
        <label class="field">Disposition<select value={decisionDraft.value.decisionDisposition} onchange={(event) => { decisionDraft.value.decisionDisposition = event.currentTarget.value; decisionDraft.value.decisionClassificationDirty = true; if (!isReviewedCaseDisposition(decisionDraft.value.decisionDisposition)) decisionDraft.value.decisionReviewReason = ''; }}>{#each CASE_DISPOSITIONS as option}<option value={option.value}>{isReviewedCaseDisposition(option.value) ? option.label : 'Select a reviewed disposition'}</option>{/each}</select></label>
        <label class="field">Review reason<select value={decisionDraft.value.decisionReviewReason} onchange={(event) => { decisionDraft.value.decisionReviewReason = event.currentTarget.value; decisionDraft.value.decisionClassificationDirty = true; }} disabled={decisionDraft.value.decisionDisposition === 'unreviewed'}>{#each CASE_REVIEW_REASONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
      </div>
      <label class="field">{mode === 'quick' ? 'Conclusion summary' : 'Decision summary'}<input bind:value={decisionDraft.value.decisionSummary} maxlength="80" required></label>
      <label class="field">{mode === 'quick' ? 'Evidence-based rationale' : 'Rationale'}<textarea bind:value={decisionDraft.value.decisionRationale} maxlength="2000" rows="3" required></textarea></label>
      <div class="two-columns">
        <label class="field">Analyst confidence<select bind:value={decisionDraft.value.decisionConfidence}>{#each CASE_DECISION_CONFIDENCE_LEVELS as value}<option {value}>{value[0]?.toUpperCase()}{value.slice(1)}</option>{/each}</select><small>Separate from Risk, source health and evidence completeness.</small></label>
        <label class="field">Confidence basis<textarea bind:value={decisionDraft.value.decisionConfidenceBasis} maxlength="2000" rows="2" required={decisionDraft.value.decisionConfidence !== 'unknown'}></textarea></label>
      </div>
      </div>
      {#if record.evidencePins.length}
        <fieldset class="pin-references"><legend>{mode === 'quick' ? 'Evidence considered' : 'Supporting evidence pins'}</legend>{#each record.evidencePins as pin, index}<label class="choice"><input type="checkbox" aria-label={caseEvidenceChoiceName(pin, index)} checked={decisionDraft.value.decisionPinIds.includes(pin.id)} onchange={(event) => decisionDraft.value.decisionPinIds = event.currentTarget.checked ? [...decisionDraft.value.decisionPinIds, pin.id] : decisionDraft.value.decisionPinIds.filter((id) => id !== pin.id)}><CaseEvidenceFact {pin} /></label>{/each}</fieldset>
      {:else}
        <p class="notice">Pin an observation in Evidence before recording a conclusion. An unsupported hypothesis can be retained separately as an assertion.</p>
      {/if}
      </div>
      <button class="btn" type="submit" disabled={decisionDraft.state.busy || mutationBusy || decisionDraft.value.decisionDisposition === 'unreviewed' || !decisionDraft.value.decisionReviewReason || !decisionDraft.value.decisionSummary.trim() || !decisionDraft.value.decisionRationale.trim() || !decisionDraft.value.decisionPinIds.length || (decisionDraft.value.decisionConfidence !== 'unknown' && !decisionDraft.value.decisionConfidenceBasis.trim())}>{mode === 'quick' ? 'Record conclusion' : 'Record decision'}</button>
      <CaseDraftRecovery draft={decisionDraft} />
    </form>
    {#if record.decisions.length}
      <ol class="records">{#each [...record.decisions].reverse() as decision}<li><strong>{decision.summary}</strong><p>{decision.rationale}</p><small>Confidence: {decision.confidence}{decision.confidenceBasis ? ` — ${decision.confidenceBasis}` : ''} · {decision.createdAt}</small><CaseLinkedEvidence pins={record.evidencePins} ids={decision.evidencePinIds} /></li>{/each}</ol>
    {/if}
  </details>

  {#if mode === 'advanced'}
    <CaseAssessmentComparison {record} />
    <details id={`case-response-assessment-assertions-${record.id}`}>
      <summary>Structure facts, hypotheses, unknowns, and next steps</summary>
      <form class="stack" data-recovery-form={assertionDraft.form} oninput={assertionDraft.changed} onsubmit={(event) => { event.preventDefault(); void addAssertion(); }}>
        <div class="two-columns">
          <label class="field">Assertion type<select bind:value={assertionDraft.value.assertionKind}>{#each CASE_ASSERTION_KINDS as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label class="field">State<select bind:value={assertionDraft.value.assertionState}>{#each CASE_ASSERTION_STATES as value}<option {value}>{value}</option>{/each}</select></label>
        </div>
        <label class="field">Statement<textarea bind:value={assertionDraft.value.assertionStatement} maxlength="2000" rows="3" required></textarea></label>
        <label class="field">Reasoning or limitation<textarea bind:value={assertionDraft.value.assertionRationale} maxlength="2000" rows="2"></textarea></label>
        {#if record.evidencePins.length}
          <fieldset class="pin-references"><legend>Evidence relationship matrix</legend><p class="notice">Classify how each selected observation relates to this assertion. Unlinked evidence remains available in the Case.</p>{#each record.evidencePins as pin, index}<label class="field"><CaseEvidenceFact {pin} /><select aria-label={`Relationship for ${caseEvidenceChoiceName(pin, index)}`} value={assertionEvidenceStance(pin.id)} onchange={(event) => setAssertionEvidenceStance(pin.id, event.currentTarget.value)}><option value="">Not linked</option>{#each CASE_EVIDENCE_RELATION_STANCES as value}<option {value}>{value}</option>{/each}</select></label>{/each}</fieldset>
        {/if}
        <button class="btn" type="submit" disabled={assertionDraft.state.busy || mutationBusy}>Record assertion</button>
        <CaseDraftRecovery draft={assertionDraft} />
      </form>
      {#if record.assertions.length}
        <ol class="records">
          {#each [...record.assertions].reverse() as assertion}
            <li id={assertionItemId(assertion.id)} tabindex="-1">
              <strong>{assertion.provenance ? 'external import' : assertion.kind.replaceAll('_', ' ')} · {assertion.state}</strong>
              <p>{assertion.statement}</p>
              {#if assertion.rationale}<p>{assertion.rationale}</p>{/if}
              {#if assertion.provenance}
                <small>{assertion.provenance.format.toUpperCase()} · {assertion.provenance.sourceName}{assertion.provenance.publisher ? ` · ${assertion.provenance.publisher}` : ''}{assertion.provenance.externalId ? ` · ${assertion.provenance.externalId}` : ''}</small>
                <small>File SHA-256 {assertion.provenance.sourceDigestSha256} · {assertion.provenance.observedAt ? `observed ${assertion.provenance.observedAt}` : 'observation time not declared'}{assertion.provenance.createdAt ? ` · created ${assertion.provenance.createdAt}` : ''}{assertion.provenance.modifiedAt ? ` · modified ${assertion.provenance.modifiedAt}` : ''}</small>
                {#if assertion.provenance.labels.length || assertion.provenance.markings.length}<small>{[...assertion.provenance.labels, ...assertion.provenance.markings].join(' · ')}</small>{/if}
              {/if}
              <small>Updated {assertion.updatedAt}</small>
              <CaseLinkedEvidence pins={record.evidencePins} ids={assertion.evidencePinIds} relations={assertion.evidenceRelations ?? []} />
              {#if assertion.state === 'open'}<button class="btn small" type="button" disabled={mutationBusy} onclick={() => void setAssertionState(assertion.id, 'resolved')}>Mark resolved</button>{/if}
            </li>
          {/each}
        </ol>
      {/if}
    </details>

  {/if}
  <CaseInvestigationBranches {record} {mutationBusy} {persist} visible={mode === 'advanced'} />
</section>

<style>
  .assessment-review { display: grid; align-items: start; gap: 24px; min-width: 0; }
  .assessment-draft { display: grid; gap: 14px; min-width: 0; }
  .assessment-review > :global(.pin-references) { border: 0; border-inline-start: 1px solid var(--border); padding: 0 0 0 20px; }
  .assessment-review > :global(.pin-references legend) { padding: 0 0 12px; font-weight: 650; }
  @media(min-width: 1200px) { .assessment-review { grid-template-columns: minmax(0, 1.2fr) minmax(19rem, 1fr); } }
  @media(max-width: 1199px) { .assessment-review > :global(.pin-references) { border-inline-start: 0; border-top: 1px solid var(--border); padding: 16px 0 0; } }
</style>

<script lang="ts">
  import {
    CASE_ASSERTION_KINDS, CASE_ASSERTION_STATES, CASE_DECISION_CONFIDENCE_LEVELS,
    CASE_DISPOSITIONS, CASE_EVIDENCE_RELATION_STANCES, CASE_MANUAL_TRAIL_KINDS,
    CASE_REVIEW_REASONS, isReviewedCaseDisposition, type CaseRecord, type CaseEvidenceRelationStance,
  } from '$lib/cases';
  import { buildCaseInvestigationTrail } from '$lib/analysis/case-response-model.ts';
  import type { CaseResponsePresentation, PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createDraftRevision } from '$lib/controllers/submitted-draft';
  import CaseInvestigationBranches from '$lib/components/CaseInvestigationBranches.svelte';

  let { record, mode, mutationBusy, persist, onmessage }: {
    record: CaseRecord;
    mode: CaseResponsePresentation;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
    onmessage: (message: string) => void;
  } = $props();

  let expanded = $state(false);
  $effect(() => { expanded = mode === 'quick'; });

  let decisionSummary = $state('');
  let decisionRationale = $state('');
  let decisionConfidence = $state('unknown');
  let decisionConfidenceBasis = $state('');
  let decisionPinIds = $state<string[]>([]);
  let decisionDisposition = $state('unreviewed');
  let decisionReviewReason = $state('');
  let decisionClassificationDirty = $state(false);
  let assertionKind = $state('hypothesis');
  let assertionStatement = $state('');
  let assertionRationale = $state('');
  let assertionEvidenceRelations = $state<Array<{ evidencePinId: string; stance: CaseEvidenceRelationStance }>>([]);
  let assertionState = $state('open');
  let trailKind = $state('pivot');
  let trailSummary = $state('');
  let trailTarget = $state('');
  const decisionDraft = createDraftRevision(() => record.id);
  const assertionDraft = createDraftRevision(() => record.id);
  const trailDraft = createDraftRevision(() => record.id);
  const investigationTrail = $derived(buildCaseInvestigationTrail(record));
  $effect(() => {
    record.updatedAt;
    if (!decisionClassificationDirty && !mutationBusy) {
      decisionDisposition = record.disposition;
      decisionReviewReason = record.reviewReasonCode ?? '';
    }
  });

  function assertionItemId(id: string): string {
    return `case-assertion-${record.id}-${id}`;
  }

  async function addDecision() {
    const unchanged = decisionDraft.capture();
    if (decisionDisposition === 'unreviewed' || !decisionReviewReason) {
      onmessage('Select a reviewed disposition and review reason before recording a conclusion.');
      return;
    }
    if (!decisionPinIds.length) {
      onmessage('Select at least one retained evidence pin before recording a conclusion. Use an assertion for an unsupported hypothesis or unknown.');
      return;
    }
    if (!await persist({
      disposition: decisionDisposition,
      reviewReasonCode: decisionReviewReason,
      decision: {
        summary: decisionSummary,
        rationale: decisionRationale,
        confidence: decisionConfidence,
        confidenceBasis: decisionConfidenceBasis,
        evidencePinIds: decisionPinIds,
      },
    }, `Recorded an analyst decision for ${record.domain}.`) || !unchanged()) return;
    decisionSummary = '';
    decisionRationale = '';
    decisionConfidence = 'unknown';
    decisionConfidenceBasis = '';
    decisionPinIds = [];
    decisionClassificationDirty = false;
  }

  async function addAssertion() {
    const unchanged = assertionDraft.capture();
    if (!await persist({
      assertion: {
        kind: assertionKind,
        statement: assertionStatement,
        rationale: assertionRationale,
        evidenceRelations: assertionEvidenceRelations,
        state: assertionState,
      },
    }, `Recorded a structured analyst assertion for ${record.domain}.`) || !unchanged()) return;
    assertionKind = 'hypothesis';
    assertionStatement = '';
    assertionRationale = '';
    assertionEvidenceRelations = [];
    assertionState = 'open';
  }

  function assertionEvidenceStance(evidencePinId: string): string {
    return assertionEvidenceRelations.find((item) => item.evidencePinId === evidencePinId)?.stance ?? '';
  }

  function setAssertionEvidenceStance(evidencePinId: string, stance: string) {
    assertionEvidenceRelations = assertionEvidenceRelations.filter((item) => item.evidencePinId !== evidencePinId);
    if (CASE_EVIDENCE_RELATION_STANCES.includes(stance as CaseEvidenceRelationStance)) {
      assertionEvidenceRelations = [...assertionEvidenceRelations, { evidencePinId, stance: stance as CaseEvidenceRelationStance }];
    }
  }

  async function setAssertionState(id: string, state: string) {
    await persist(
      { assertionUpdate: { id, state } },
      `Updated the analyst assertion for ${record.domain}.`,
      () => document.getElementById(assertionItemId(id)),
    );
  }

  async function addTrailEvent() {
    const unchanged = trailDraft.capture();
    if (!await persist({
      trailEvent: {
        kind: trailKind,
        summary: trailSummary,
        target: trailTarget,
      },
    }, `Recorded a manual investigation step for ${record.domain}.`) || !unchanged()) return;
    trailKind = 'pivot';
    trailSummary = '';
    trailTarget = '';
  }
</script>

<section class="case-response-stage" aria-label="Case assessment">
  <details id={`case-response-assessment-${record.id}`} bind:open={expanded}>
    <summary>{mode === 'quick' ? 'Record conclusion' : 'Record an analyst decision'}</summary>
    <form class="response-form" oninput={decisionDraft.changed} onchange={decisionDraft.changed} onsubmit={(event) => { event.preventDefault(); void addDecision(); }}>
      <div class="two-columns">
        <label class="field">Disposition<select value={decisionDisposition} onchange={(event) => { decisionDisposition = event.currentTarget.value; decisionClassificationDirty = true; if (!isReviewedCaseDisposition(decisionDisposition)) decisionReviewReason = ''; }}>{#each CASE_DISPOSITIONS as option}<option value={option.value}>{isReviewedCaseDisposition(option.value) ? option.label : 'Select a reviewed disposition'}</option>{/each}</select></label>
        <label class="field">Review reason<select value={decisionReviewReason} onchange={(event) => { decisionReviewReason = event.currentTarget.value; decisionClassificationDirty = true; }} disabled={decisionDisposition === 'unreviewed'}>{#each CASE_REVIEW_REASONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
      </div>
      <label class="field">{mode === 'quick' ? 'Conclusion summary' : 'Decision summary'}<input bind:value={decisionSummary} maxlength="80" required></label>
      <label class="field">{mode === 'quick' ? 'Evidence-based rationale' : 'Rationale'}<textarea bind:value={decisionRationale} maxlength="2000" rows="3" required></textarea></label>
      <div class="two-columns">
        <label class="field">Analyst confidence<select bind:value={decisionConfidence}>{#each CASE_DECISION_CONFIDENCE_LEVELS as value}<option {value}>{value[0]?.toUpperCase()}{value.slice(1)}</option>{/each}</select><small>Separate from Risk, source health and evidence completeness.</small></label>
        <label class="field">Confidence basis<textarea bind:value={decisionConfidenceBasis} maxlength="2000" rows="2" required={decisionConfidence !== 'unknown'}></textarea></label>
      </div>
      {#if record.evidencePins.length}
        <fieldset class="pin-references"><legend>{mode === 'quick' ? 'Evidence considered' : 'Supporting evidence pins'}</legend>{#each record.evidencePins as pin}<label class="choice"><input type="checkbox" checked={decisionPinIds.includes(pin.id)} onchange={(event) => decisionPinIds = event.currentTarget.checked ? [...decisionPinIds, pin.id] : decisionPinIds.filter((id) => id !== pin.id)}><span>{pin.label}</span></label>{/each}</fieldset>
      {:else}
        <p class="notice">Pin an observation above before recording an evidence-linked conclusion. An unsupported hypothesis can be retained separately as an assertion.</p>
      {/if}
      <button class="btn" type="submit" disabled={mutationBusy || decisionDisposition === 'unreviewed' || !decisionReviewReason || !decisionSummary.trim() || !decisionRationale.trim() || !decisionPinIds.length || (decisionConfidence !== 'unknown' && !decisionConfidenceBasis.trim())}>{mode === 'quick' ? 'Record conclusion' : 'Record decision'}</button>
    </form>
    {#if record.decisions.length}
      <ol class="records">{#each [...record.decisions].reverse() as decision}<li><strong>{decision.summary}</strong><p>{decision.rationale}</p><small>Confidence: {decision.confidence}{decision.confidenceBasis ? ` — ${decision.confidenceBasis}` : ''} · {decision.createdAt}{decision.evidencePinIds.length ? ` · ${decision.evidencePinIds.length} supporting pin${decision.evidencePinIds.length === 1 ? '' : 's'}` : ''}</small></li>{/each}</ol>
    {/if}
  </details>

  {#if mode === 'advanced'}
    <details id={`case-response-assessment-assertions-${record.id}`}>
      <summary>Structure facts, hypotheses, unknowns, and next steps</summary>
      <form class="stack" oninput={assertionDraft.changed} onchange={assertionDraft.changed} onsubmit={(event) => { event.preventDefault(); void addAssertion(); }}>
        <div class="two-columns">
          <label class="field">Assertion type<select bind:value={assertionKind}>{#each CASE_ASSERTION_KINDS as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label class="field">State<select bind:value={assertionState}>{#each CASE_ASSERTION_STATES as value}<option {value}>{value}</option>{/each}</select></label>
        </div>
        <label class="field">Statement<textarea bind:value={assertionStatement} maxlength="2000" rows="3" required></textarea></label>
        <label class="field">Reasoning or limitation<textarea bind:value={assertionRationale} maxlength="2000" rows="2"></textarea></label>
        {#if record.evidencePins.length}
          <fieldset class="pin-references"><legend>Evidence relationship matrix</legend><p class="notice">Classify how each selected observation relates to this assertion. Unlinked evidence remains available in the case.</p>{#each record.evidencePins as pin}<label class="field"><span>{pin.label}</span><select value={assertionEvidenceStance(pin.id)} onchange={(event) => setAssertionEvidenceStance(pin.id, event.currentTarget.value)}><option value="">Not linked</option>{#each CASE_EVIDENCE_RELATION_STANCES as value}<option {value}>{value}</option>{/each}</select></label>{/each}</fieldset>
        {/if}
        <button class="btn" type="submit" disabled={mutationBusy}>Record assertion</button>
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
              {#if assertion.evidenceRelations?.length}
                <small>{assertion.evidenceRelations.filter((item) => item.stance === 'supports').length} supporting · {assertion.evidenceRelations.filter((item) => item.stance === 'contradicts').length} contradicting · {assertion.evidenceRelations.filter((item) => item.stance === 'unresolved').length} unresolved evidence relationship{assertion.evidenceRelations.length === 1 ? '' : 's'}</small>
              {:else}
                <small>updated {assertion.updatedAt}{assertion.evidencePinIds.length ? ` · ${assertion.evidencePinIds.length} linked pin${assertion.evidencePinIds.length === 1 ? '' : 's'}` : ''}</small>
              {/if}
              {#if assertion.state === 'open'}<button class="btn small" type="button" disabled={mutationBusy} onclick={() => void setAssertionState(assertion.id, 'resolved')}>Mark resolved</button>{/if}
            </li>
          {/each}
        </ol>
      {/if}
    </details>

  {/if}
  <CaseInvestigationBranches {record} {mutationBusy} {persist} visible={mode === 'advanced'} />
  {#if mode === 'advanced'}
    <details>
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
        <p class="notice">No explicit case reasoning, actions, or manual pivots have been recorded. Browser navigation is not tracked.</p>
      {/if}
    </details>

  {/if}
</section>

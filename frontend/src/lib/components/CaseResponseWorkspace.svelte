<script lang="ts">
  import { tick, type ComponentProps, type Snippet } from 'svelte';
  import { caseInvestigationContext, caseTypeSummary, dispositionLabel, editCase, type CaseRecord } from '$lib/cases';
  import { handlesLocalLink } from '$lib/link-activation';
  import { buildCaseActionOutcomeSummary } from '$lib/analysis/case-response-model.ts';
  import CaseObservationStage from '$lib/components/CaseObservationStage.svelte';
  import CaseAssessmentStage from '$lib/components/CaseAssessmentStage.svelte';
  import CaseHistoryStage from '$lib/components/CaseHistoryStage.svelte';
  import CaseActionStage from '$lib/components/CaseActionStage.svelte';
  import CaseOutcomeStage from '$lib/components/CaseOutcomeStage.svelte';
  import CaseRenderedCapture from '$lib/components/CaseRenderedCapture.svelte';
  import CaseWorkflowDetails from '$lib/components/CaseWorkflowDetails.svelte';
  import CaseTitleForm from '$lib/components/CaseTitleForm.svelte';
  import CaseResponsePacketWorkspace from '$lib/components/CaseResponsePacketWorkspace.svelte';
  import {
    CASE_RESPONSE_STAGE_DEFINITIONS,
    CASE_STAGE_SECTION,
    caseWorkspaceHref,
    type CaseWorkspaceSection,
    type CaseResponsePresentation,
    type CaseResponseStage,
    type CaseResponseStageId,
  } from '$lib/analysis/case-response-stage.ts';
  import '$lib/components/case-response-stage.css';
  import type { CaseDraftReceipt } from '../../../../packages/contracts/case-drafts.mts';

  let {
    record,
    onsaved,
    oncommitted,
    onmessage,
    sectionId,
    advancedInitially = false,
    activeSection,
    selectSection,
    summary,
    evidence,
    history,
    exports,
  }: {
    record: CaseRecord;
    onsaved: () => void | Promise<void>;
    oncommitted: (cases: CaseRecord[]) => void;
    onmessage: (message: string) => void;
    sectionId?: string;
    advancedInitially?: boolean;
    activeSection: CaseWorkspaceSection;
    selectSection: (section: CaseWorkspaceSection) => void | Promise<void>;
    summary: Snippet;
    evidence: Snippet;
    history: Snippet;
    exports: Snippet;
  } = $props();

  let presentationMode = $state<CaseResponsePresentation>('quick');
  $effect(() => { if (advancedInitially) presentationMode = 'advanced'; });

  let mutationBusy = $state(false);
  let actionStage = $state<ReturnType<typeof CaseActionStage>>();
  const investigationContext = $derived(caseInvestigationContext(record));
  const evidenceLinkedDecisionCount = $derived(record.decisions.filter((decision) =>
    decision.evidencePinIds.some((evidencePinId) => record.evidencePins.some((pin) => pin.id === evidencePinId))).length);
  const reviewNow = new Date().toISOString();
  let evidenceHandoffStage = $state<CaseResponseStage>({
    id: 'evidence_handoff',
    ...CASE_RESPONSE_STAGE_DEFINITIONS.evidence_handoff,
    status: 'not_started',
    summary: 'Packet review has not started.',
    nextRequirement: 'Open the evidence handoff to review recipient, evidence, privacy, readiness, and authorisation inputs.',
  });
  const actionSummary = $derived(buildCaseActionOutcomeSummary(record.actions, reviewNow));

  const responseStages = $derived<CaseResponseStage[]>([
    {
      id: 'observation', ...CASE_RESPONSE_STAGE_DEFINITIONS.observation,
      status: record.evidencePins.length || record.sightings.length ? 'complete' : 'not_started',
      summary: `${countLabel(record.evidencePins.length, 'retained evidence pin')} and ${countLabel(record.sightings.length, 'source-qualified sighting')}.`,
      nextRequirement: record.evidencePins.length || record.sightings.length
        ? 'Review the retained observation, its source, completeness, and limitations before assessment.'
        : 'Pin an observed fact or record a source-qualified sighting with completeness and limitations.',
    },
    {
      id: 'assessment', ...CASE_RESPONSE_STAGE_DEFINITIONS.assessment,
      status: evidenceLinkedDecisionCount ? 'complete' : record.decisions.length || record.assertions.length || record.manualTrail.length ? 'in_progress' : 'not_started',
      summary: `${countLabel(record.decisions.length, 'decision')} (${evidenceLinkedDecisionCount} linked to retained evidence), ${countLabel(record.assertions.length, 'optional assertion')}, and ${countLabel(record.branches?.length ?? 0, 'investigation branch', 'investigation branches')}.`,
      nextRequirement: !record.decisions.length
        ? 'Record a bounded analyst decision and rationale linked to retained evidence.'
        : !evidenceLinkedDecisionCount
          ? 'Link at least one analyst decision to a retained evidence pin.'
          : 'Review the decision rationale and any unresolved assertions or branches.',
    },
    {
      id: 'response_decision', ...CASE_RESPONSE_STAGE_DEFINITIONS.response_decision,
      status: record.actions.some((action) => ['reviewed', 'authorised', 'submitted', 'acknowledged', 'terminal'].includes(action.state)) ? 'complete' : record.actions.length ? 'in_progress' : 'not_started',
      summary: `${countLabel(record.actions.length, 'append-only response action')}; ${actionSummary.overdue} overdue and ${actionSummary.followUpDue} follow-up due.`,
      nextRequirement: !record.actions.length ? 'Create a drafting action with recipient provenance and due dates.' : 'Review the next legal action transition without rewriting earlier events.',
    },
    evidenceHandoffStage,
    {
      id: 'outcome_tracking', ...CASE_RESPONSE_STAGE_DEFINITIONS.outcome_tracking,
      status: record.closures.records.length ? 'complete' : record.observedEffects.reviews.length || record.actions.some((action) => ['submitted', 'acknowledged', 'terminal'].includes(action.state)) ? 'in_progress' : 'not_started',
      summary: `${countLabel(record.observedEffects.reviews.length, 'independent effect review')} and ${countLabel(record.closures.records.length, 'deliberate closure')}.`,
      nextRequirement: !record.observedEffects.reviews.length ? 'Keep provider outcomes separate and record an independently observed effect when reviewed.' : !record.closures.records.length ? 'Review follow-up and, when justified, record a deliberate closure reason.' : 'Review whether follow-up remains due.',
    },
  ]);
  const currentResponseStage = $derived(responseStages.find((stage) => stage.status !== 'complete') ?? responseStages.at(-1));

  function updateEvidenceHandoffStage(stage: CaseResponseStage): void {
    evidenceHandoffStage = stage;
  }

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function prunedNote(pruned: number): string {
    return pruned ? ` Pruned ${pruned} old evidence snapshot${pruned === 1 ? '' : 's'} to stay within storage.` : '';
  }

  async function reconcileCommitted(
    committed: Awaited<ReturnType<typeof editCase>>,
    success: string,
  ): Promise<void> {
    try {
      await onsaved();
    } catch {
      try {
        oncommitted(committed.cases);
      } catch {
        onmessage(`${success} The change was saved, but Cases could not be reread or reconciled in the current view. Reload before recording another response.${prunedNote(committed.pruned)}`);
        return;
      }
      onmessage(`${success} The change was saved, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.${prunedNote(committed.pruned)}`);
      return;
    }
    onmessage(`${success}${prunedNote(committed.pruned)}`);
  }

  async function persist(
    patch: Parameters<typeof editCase>[1],
    success: string,
    focusFallback: (() => HTMLElement | null) | null = null,
    draft?: CaseDraftReceipt,
  ): Promise<boolean> {
    if (mutationBusy) return false;
    const focusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    mutationBusy = true;
    try {
      let committed: Awaited<ReturnType<typeof editCase>>;
      try {
        committed = await editCase(record.id, patch, draft);
      } catch (cause) {
        onmessage(cause instanceof Error ? cause.message : 'Could not update the case response record.');
        return false;
      }
      await reconcileCommitted(committed, success);
      return true;
    } finally {
      mutationBusy = false;
      await tick();
      const activeTarget = document.activeElement;
      const focusWasDisplaced = activeTarget === null
        || activeTarget === document.body
        || activeTarget === document.documentElement;
      if (activeTarget === focusTarget || focusWasDisplaced) {
        const restoreTarget = focusFallback?.() ?? (focusTarget?.isConnected ? focusTarget : null);
        if (restoreTarget?.isConnected && !restoreTarget.matches(':disabled')) {
          restoreTarget.focus({ preventScroll: true });
        }
      }
    }
  }

  async function openStage(stage: CaseResponseStageId) {
    await selectSection(CASE_STAGE_SECTION[stage]);
    await tick();
    const targets: Record<CaseResponseStageId, string> = {
      observation: `case-response-observation-${record.id}`,
      assessment: `case-response-assessment-${record.id}`,
      response_decision: `case-response-decision-${record.id}`,
      outcome_tracking: `case-response-outcome-${record.id}`,
      evidence_handoff: `case-response-preflight-${record.id}`,
    };
    const target = document.getElementById(targets[stage]) as HTMLDetailsElement | null;
    if (!target) return;
    target.open = true;
    const heading = target.querySelector<HTMLElement>(':scope > summary');
    heading?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    heading?.focus({ preventScroll: true });
  }

  async function openAdvancedStage(stage: CaseResponseStageId) {
    presentationMode = 'advanced';
    await openStage(stage);
  }

  async function preparePacketDeliveryRecord(exported: Parameters<ComponentProps<typeof CaseResponsePacketWorkspace>['onpacketexported']>[0]) {
    const action = record.actions.find((item) => item.id === exported.actionId);
    if (record.id !== exported.caseId || !action || !actionStage || JSON.stringify(action) !== exported.actionSignature) {
      onmessage('The packet was exported, but its Case action has changed or is no longer available. Review and export the current packet before recording delivery.');
      return;
    }
    if (!await actionStage.prepareDeliveryRecord(action.id, exported.digestSha256)) {
      onmessage('The packet was exported, but the current receipt draft could not be saved for recovery. Keep this form open and retry its recovery save before preparing another receipt.');
      return;
    }
    presentationMode = 'quick';
    await selectSection('response');
    await tick();
    document.getElementById(`quick-action-advance-${record.id}`)?.focus({ preventScroll: true });
    onmessage(action.state === 'authorised'
      ? 'Prepared the delivery record with the exported packet digest. Select Mark sent only after actual delivery.'
      : `Selected the packet action and prepared its export digest. Its current state is ${action.state.replaceAll('_', ' ')}; complete each review state only after it occurs.`);
  }
</script>

<section id={sectionId || `case-response-${record.id}`} class="response-workspace" aria-labelledby={`response-title-${record.id}`} tabindex="-1">
  <h2 id={`response-title-${record.id}`} class="visually-hidden">Case evidence, reasoning and actions</h2>
  <div class="presentation-switch" role="group" aria-label="Case response presentation" hidden={activeSection === 'summary' || activeSection === 'history'}>
    <button type="button" aria-pressed={presentationMode === 'quick'} onclick={() => presentationMode = 'quick'}>Quick</button>
    <button type="button" aria-pressed={presentationMode === 'advanced'} onclick={() => presentationMode = 'advanced'}>Advanced</button>
  </div>
  <div class="case-section" role="group" hidden={activeSection !== 'summary'} aria-label="Case summary">
  {#if investigationContext}
    <dl class="case-context" aria-label="Current Case context">
      <div class="context-objective"><dt>Objective</dt><dd>{investigationContext.objective}</dd></div>
      <div><dt>Incident URL</dt><dd>{investigationContext.urlRetention === 'exact' ? investigationContext.incidentUrl : `${investigationContext.incidentUrl} (origin only)`}</dd></div>
      <div><dt>Disposition</dt><dd>{dispositionLabel(record.disposition)}</dd></div>
      <div><dt>Evidence</dt><dd>{evidenceLinkedDecisionCount ? `${evidenceLinkedDecisionCount} linked conclusion${evidenceLinkedDecisionCount === 1 ? '' : 's'}` : 'Conclusion link needed'}</dd></div>
      <div><dt>Next action</dt><dd>{currentResponseStage?.label ?? 'Review Case'}</dd></div>
    </dl>
  {/if}
  {#if actionSummary.total}
    <div class="action-summary" role="group" aria-label="Case action outcome summary">
      <span><strong>{actionSummary.active}</strong> active</span>
      <span><strong>{actionSummary.drafting}</strong> drafting</span>
      <span><strong>{actionSummary.readyForReview}</strong> ready</span>
      <span><strong>{actionSummary.reviewed}</strong> reviewed</span>
      <span><strong>{actionSummary.authorised}</strong> authorised</span>
      <span><strong>{actionSummary.submitted}</strong> submitted</span>
      <span><strong>{actionSummary.acknowledged}</strong> acknowledged</span>
      <span><strong>{actionSummary.terminal}</strong> terminal</span>
      <span class:attention={actionSummary.overdue > 0}><strong>{actionSummary.overdue}</strong> overdue</span>
      <span class:attention={actionSummary.followUpDue > 0}><strong>{actionSummary.followUpDue}</strong> follow-up due</span>
    </div>
  {/if}

    {#if currentResponseStage}
      <div class="next-action-summary" data-status={currentResponseStage.status} role="status" aria-label="Next Case requirement">
        <strong>{currentResponseStage.label}</strong>
        <span>{currentResponseStage.status.replaceAll('_', ' ')}</span>
        <p>{currentResponseStage.nextRequirement}</p>
        <button class="btn" type="button" onclick={() => void openStage(currentResponseStage!.id)}>Open {currentResponseStage.label.toLowerCase()}</button>
      </div>
    {/if}
    <div class="summary-links" role="group" aria-label="Retained Case records">
      {#each [
        { section: 'evidence', label: 'Evidence', detail: `${countLabel(record.evidenceHistory.length, 'snapshot')} · ${countLabel(record.evidencePins.length, 'pin')} · ${countLabel(record.sightings.length, 'sighting')}` },
        { section: 'assessment', label: 'Assessment', detail: `${countLabel(record.decisions.length, 'decision')} · ${countLabel(record.assertions.length, 'assertion')}` },
        { section: 'response', label: 'Response', detail: `${countLabel(record.actions.length, 'action')} · ${countLabel(actionSummary.followUpDue, 'follow-up')} due` },
        { section: 'history', label: 'History', detail: `${countLabel(record.notes.length, 'note')} · ${countLabel(record.manualTrail.length, 'manual step')}` },
      ] as item}
        <a href={caseWorkspaceHref(record.id, item.section as CaseWorkspaceSection)} onclick={(event) => {
          if (handlesLocalLink(event)) { event.preventDefault(); void selectSection(item.section as CaseWorkspaceSection); }
        }}><strong>{item.label}</strong><span>{item.detail}</span></a>
      {/each}
    </div>
    <details class="summary-editor">
      <summary>Classification and incident links <span>{caseTypeSummary(record.tags)}</span></summary>
      <CaseWorkflowDetails {record} {onsaved} {oncommitted} {onmessage} />
    </details>
    <CaseTitleForm {record} {mutationBusy} {persist} />
    {@render summary()}
  </div>

  <div class="response-stages" class:quick-workspace={presentationMode === 'quick'}>
    {#key record.id}
      <div class="case-section" role="group" hidden={activeSection !== 'evidence'} aria-label="Case evidence">
      {@render evidence()}
      <CaseObservationStage {record} {mutationBusy} {persist} mode={presentationMode} />
      <CaseRenderedCapture
        {record}
        exactIncidentUrl={investigationContext?.urlRetention === 'exact' ? investigationContext.incidentUrl : null}
        {onsaved}
        {oncommitted}
        {onmessage}
      />
      </div>
      <div class="case-section" role="group" hidden={activeSection !== 'assessment'} aria-label="Case assessment workspace">
        <CaseAssessmentStage {record} {mutationBusy} {persist} {onmessage} mode={presentationMode} />
      </div>
      <div class="case-section" role="group" hidden={activeSection !== 'response'} aria-label="Case response workspace">
      <CaseActionStage bind:this={actionStage} {record} {mutationBusy} {persist} mode={presentationMode} onadvanced={() => void openAdvancedStage('response_decision')} />
      <CaseResponsePacketWorkspace
        {record}
        visible
        {onmessage}
        onstagechange={updateEvidenceHandoffStage}
        onpacketexported={preparePacketDeliveryRecord}
      />

      <CaseOutcomeStage {record} {mutationBusy} {persist} mode={presentationMode} />
      {@render exports()}
      </div>
      <div class="case-section" role="group" hidden={activeSection !== 'history'} aria-label="Case history">
        {@render history()}
        <CaseHistoryStage {record} {mutationBusy} {persist} />
      </div>
    {/key}
  </div>
</section>

<style>
  .response-workspace, .response-stages, .case-section { display: grid; gap: 16px; min-width: 0; }
  .response-workspace { padding-block: 16px; }
  .case-section[hidden], .presentation-switch[hidden] { display: none; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .presentation-switch { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .presentation-switch button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel); color: var(--text); cursor: pointer; font: 650 var(--text-xs) var(--mono); }
  .presentation-switch button[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); background: rgb(var(--accent-rgb) / .06); }
  .case-context { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px 20px; margin: 0; padding-block: 12px; border-block: 1px solid var(--border); }
  .case-context > div { min-width: 0; }
  .case-context .context-objective { grid-column: 1/-1; }
  .case-context dt { color: var(--muted); font-size: var(--text-xs); }
  .case-context dd { margin: 4px 0 0; font-size: var(--text-sm); line-height: 1.5; overflow-wrap: anywhere; }
  .action-summary { display: flex; flex-wrap: wrap; gap: 6px 12px; }
  .action-summary span { color: var(--muted); font-size: var(--text-xs); }
  .action-summary strong { color: var(--text); }
  .action-summary .attention, .action-summary .attention strong { color: var(--amber); }
  .summary-links { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
  .summary-links a { display: grid; gap: 6px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); text-decoration: none; color: var(--text); min-width: 0; }
  .summary-links a:hover { background: var(--panel-raised); }
  .summary-links span { color: var(--muted); font-size: var(--text-xs); overflow-wrap: anywhere; }
  .summary-editor { min-width: 0; border-block: 1px solid var(--border); }
  .summary-editor > summary { padding-block: 14px; cursor: pointer; font-weight: 650; }
  .summary-editor > summary > span { margin-left: 10px; color: var(--muted); font-size: var(--text-xs); font-weight: 400; }
  .next-action-summary { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 12px; padding: 10px 14px; border-left: 3px solid var(--accent); }
  .next-action-summary[data-status='attention'] { border-color: var(--amber); }
  .next-action-summary[data-status='complete'] { border-color: var(--success); }
  .next-action-summary span { color: var(--muted); font-size: var(--text-xs); }
  .next-action-summary p { grid-column: 1/-1; margin: 2px 0 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.5; }
  .next-action-summary .btn { justify-self: start; }
  @media (max-width: 480px) {
    .case-context { grid-template-columns: minmax(0,1fr); }
    .summary-links { grid-template-columns: minmax(0,1fr); }
    .next-action-summary { grid-template-columns: minmax(0,1fr); }
  }
</style>

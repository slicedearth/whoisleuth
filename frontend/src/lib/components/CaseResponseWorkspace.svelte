<script lang="ts">
  import { tick } from 'svelte';
  import {
    CASE_ACTION_EVENT_SOURCE_CLASSES,
    CASE_ACTION_STATES,
    CASE_ACTION_TYPES,
    CASE_ASSERTION_KINDS,
    CASE_ASSERTION_STATES,
    CASE_CLOSURE_REASONS,
    CASE_EVIDENCE_RELATION_STANCES,
    CASE_MANUAL_TRAIL_KINDS,
    CASE_OBSERVED_EFFECT_SOURCE_CLASSES,
    CASE_OBSERVED_EFFECT_STATES,
    CASE_PIN_COMPLETENESS,
    CASE_PROVIDER_OUTCOMES,
    CASE_SIGHTING_CATEGORIES,
    CASE_SIGHTING_STATES,
    editCase,
    type CaseActionRecord,
    type CaseActionState,
    type CaseEvidenceRelationStance,
    type CaseRecord,
  } from '$lib/cases';
  import {
    buildCaseActionOutcomeSummary,
    buildCaseInvestigationTrail,
    buildCaseResponseLifecycleSummary,
    isLegalCaseActionTransition,
    type CaseActionEventSourceClass,
  } from '$lib/analysis/case-response-model.ts';
  import { buildCaseSightingChronology } from '$lib/analysis/case-sighting-chronology.ts';
  import {
    buildCaseResponsePacket,
    buildCaseResponsePreflight,
    buildCaseResponseReadiness,
    buildCaseResponseReviewDigest,
    buildResponsePacketProfilePreview,
    CASE_RESPONSE_PREFLIGHT_EVIDENCE_SCOPE,
    caseResponsePacketFilename,
    RESPONSE_CONTACT_KINDS,
    RESPONSE_AUTHORISATION_CONFIRMATION_IDS,
    RESPONSE_PACKET_PROFILES,
    RESPONSE_READINESS_STATES,
    type CaseResponsePacketInput,
    type ResponseContactKind,
    type ResponseAuthorisationConfirmationId,
    type ResponsePacketProfileId,
    type ResponseReadinessState,
  } from '$lib/analysis/case-response-packet.ts';
  import CaseInvestigationBranches from '$lib/components/CaseInvestigationBranches.svelte';

  let {
    record,
    onsaved,
    oncommitted,
    onmessage,
  }: {
    record: CaseRecord;
    onsaved: () => void | Promise<void>;
    oncommitted: (cases: CaseRecord[]) => void;
    onmessage: (message: string) => void;
  } = $props();

  let pinLabel = $state('');
  let pinValue = $state('');
  let pinSource = $state('lookup evidence');
  let pinObservedAt = $state('');
  let pinCompleteness = $state('complete');
  let pinLimitations = $state('');
  let decisionSummary = $state('');
  let decisionRationale = $state('');
  let decisionPinIds = $state<string[]>([]);
  let actionType = $state('internal_review');
  let actionRecipient = $state('');
  let actionContactSource = $state('analyst supplied');
  let actionLimitations = $state('');
  let actionDueAt = $state('');
  let actionFollowUpAt = $state('');
  let actionOriginId = $state('');
  let selectedActionId = $state('');
  let transitionNextState = $state<CaseActionState>('ready_for_review');
  let transitionOccurredAt = $state('');
  let transitionSourceClass = $state<CaseActionEventSourceClass>('analyst');
  let transitionProvenance = $state('analyst recorded event');
  let transitionReference = $state('');
  let transitionEvidencePinId = $state('');
  let transitionLimitations = $state('');
  let transitionProviderOutcome = $state('');
  let transitionOutcomeDetail = $state('');
  let assertionKind = $state('hypothesis');
  let assertionStatement = $state('');
  let assertionRationale = $state('');
  let assertionEvidenceRelations = $state<Array<{ evidencePinId: string; stance: CaseEvidenceRelationStance }>>([]);
  let assertionState = $state('open');
  let trailKind = $state('pivot');
  let trailSummary = $state('');
  let trailTarget = $state('');
  let sightingState = $state('observed_by_deployment');
  let sightingCategory = $state('website');
  let sightingSource = $state('WHOISleuth deep lookup');
  let sightingObservedAt = $state('');
  let sightingCompleteness = $state('complete');
  let sightingEvidencePinId = $state('');
  let sightingLimitations = $state('');
  let effectState = $state('not_checked');
  let effectObservedAt = $state('');
  let effectSourceClass = $state('analyst');
  let effectSource = $state('Analyst review');
  let effectCompleteness = $state('unknown');
  let effectEvidencePinId = $state('');
  let effectSightingId = $state('');
  let effectFollowUpAt = $state('');
  let effectLimitations = $state('');
  let closureReason = $state('unable_to_proceed');
  let closureSummary = $state('');
  let closureReviewId = $state('');
  let closureActionId = $state('');
  let closureLimitations = $state('');
  const investigationTrail = $derived(buildCaseInvestigationTrail(record));
  const responseLifecycle = $derived(buildCaseResponseLifecycleSummary(record));
  const sightingChronology = $derived(buildCaseSightingChronology(record.sightings));
  const sightingReviewConclusionCount = $derived(
    record.sightings.filter((sighting) =>
      sighting.state === 'not_reproduced' || sighting.state === 'expired').length,
  );
  const userObservedEffectSourceClasses = CASE_OBSERVED_EFFECT_SOURCE_CLASSES.filter((value) => value !== 'import');

  let packetCategory = $state('');
  let packetProfile = $state<ResponsePacketProfileId>('internal_soc');
  let packetAffectedParty = $state('');
  let packetUrls = $state('');
  let packetHarm = $state('');
  let packetObservedAt = $state('');
  let packetContacts = $state<Record<ResponseContactKind, string>>({
    registrar: '',
    registry: '',
    network_hosting: '',
    security_txt: '',
  });
  let packetContactSources = $state<Record<ResponseContactKind, string>>({
    registrar: 'RDAP or WHOIS',
    registry: 'registry evidence',
    network_hosting: 'network or hosting evidence',
    security_txt: 'security.txt',
  });
  let packetContactLimitations = $state<Record<ResponseContactKind, string>>({
    registrar: '',
    registry: '',
    network_hosting: '',
    security_txt: '',
  });
  let packetContactObservedAt = $state<Record<ResponseContactKind, string>>({
    registrar: '',
    registry: '',
    network_hosting: '',
    security_txt: '',
  });
  let packetSelectedEvidenceIds = $state<string[]>([]);
  let packetInfrastructureState = $state<ResponseReadinessState>('not_provided');
  let packetInfrastructureDetail = $state('');
  let packetInfrastructureLimitations = $state('');
  let packetAuthorityState = $state<ResponseReadinessState>('not_provided');
  let packetAuthorityDetail = $state('');
  let packetAuthorityLimitations = $state('');
  let packetContradictionsState = $state<ResponseReadinessState>('not_provided');
  let packetContradictionsDetail = $state('');
  let packetContradictionsLimitations = $state('');
  let packetSourceLimitationsState = $state<ResponseReadinessState>('not_provided');
  let packetSourceLimitationsDetail = $state('');
  let packetSourceLimitations = $state('');
  let packetArtefactLabel = $state('');
  let packetArtefactMediaType = $state('image/png');
  let packetArtefactCapturedAt = $state('');
  let packetArtefactSource = $state('Analyst-supplied capture metadata');
  let packetArtefactDigest = $state('');
  let packetArtefactByteLength = $state('');
  let packetArtefactLimitations = $state('');
  let packetReviewDigest = $state('');
  let packetReviewSignature = $state('');
  let packetAuthorisationConfirmedAt = $state('');
  let packetConfirmations = $state<Record<ResponseAuthorisationConfirmationId, boolean>>({
    selectedEvidence: false,
    recipientScope: false,
    privacyRedactions: false,
    analystAuthority: false,
    evidenceFreshness: false,
  });
  let packetBusy = $state(false);
  let mutationBusy = $state(false);
  const reviewNow = new Date().toISOString();
  const actionSummary = $derived(buildCaseActionOutcomeSummary(record.actions, reviewNow));
  const selectedAction = $derived(record.actions.find((action) => action.id === selectedActionId) ?? null);
  const selectedActionIdentityLocked = $derived(Boolean(selectedAction
    && ['submitted', 'acknowledged', 'terminal'].includes(selectedAction.state)));
  const userActionEventSourceClasses = $derived(CASE_ACTION_EVENT_SOURCE_CLASSES.filter((value) => value === 'analyst'
    || value === 'provider' && Boolean(selectedAction && ['submitted', 'acknowledged'].includes(selectedAction.state))));
  const legalTransitionStates = $derived(selectedAction
    ? CASE_ACTION_STATES.filter((nextState) => isLegalCaseActionTransition(selectedAction.state, nextState, transitionSourceClass)
      && (!['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState) || transitionSourceClass === 'analyst')
      && (!(nextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(selectedAction.state))
        || transitionSourceClass === 'analyst'))
    : []);
  const availableTransitionProviderOutcomes = $derived(
    selectedAction && transitionNextState === 'terminal'
      && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(selectedAction.state)
      ? ['withdrawn']
      : selectedAction && transitionNextState === 'submitted' && selectedAction.state === 'authorised'
        ? []
      : ['submitted', 'acknowledged', 'terminal'].includes(transitionNextState)
        ? CASE_PROVIDER_OUTCOMES.filter((value) => value !== 'withdrawn'
          && !(value === 'no_response' && transitionSourceClass === 'provider'))
        : [],
  );
  const packetPreflight = $derived(buildCaseResponsePreflight(record, packetInput(), reviewNow));
  const packetProfilePreview = $derived(buildResponsePacketProfilePreview(record, packetInput()));
  const packetReadiness = $derived(buildCaseResponseReadiness(record, packetInput(), reviewNow));
  const packetReviewIsCurrent = $derived(Boolean(packetReviewDigest) && packetReviewSignature === packetMaterialSignature());
  const packetConfirmationsComplete = $derived(RESPONSE_AUTHORISATION_CONFIRMATION_IDS.every((id) => packetConfirmations[id]));
  const packetAuthorisationReadinessComplete = $derived(
    packetReadiness.rows.every((row) => !row.requiredForAuthorisation || !['not_provided', 'unavailable'].includes(row.state))
      && packetReadiness.rows.find((row) => row.id === 'authority_review')?.state === 'complete',
  );
  const closureNeedsReview = $derived(closureReason === 'independently_not_reproduced' || closureReason === 'infrastructure_changed');
  const closureNeedsAction = $derived(closureReason === 'provider_reported_resolution_not_independently_checked');
  const eligibleClosureReviews = $derived(record.observedEffects.reviews.filter((review) =>
    closureReason === 'independently_not_reproduced'
      ? review.state === 'not_reproduced'
      : closureReason === 'infrastructure_changed' ? review.state === 'changed' : true));
  const eligibleClosureActions = $derived(record.actions.filter((action) =>
    closureNeedsAction ? action.providerOutcome === 'provider_reports_resolved' : true));

  function isoFromLocal(value: string): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  function localFromIso(value: string | null): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const adjusted = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
    return adjusted.toISOString().slice(0, 16);
  }

  function list(value: string): string[] {
    return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  }

  function countLabel(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
  }

  function assertionItemId(id: string): string {
    return `case-assertion-${record.id}-${id}`;
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
  ): Promise<boolean> {
    if (mutationBusy) return false;
    const focusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    mutationBusy = true;
    try {
      let committed: Awaited<ReturnType<typeof editCase>>;
      try {
        committed = await editCase(record.id, patch);
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
        const restoreTarget = focusTarget?.isConnected ? focusTarget : focusFallback?.();
        if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
      }
    }
  }

  async function addPin() {
    if (!await persist({
      evidencePin: {
        label: pinLabel,
        value: pinValue,
        source: pinSource,
        observedAt: isoFromLocal(pinObservedAt) || new Date().toISOString(),
        completeness: pinCompleteness,
        limitations: list(pinLimitations),
      },
    }, `Pinned analyst-selected evidence for ${record.domain}.`)) return;
    pinLabel = '';
    pinValue = '';
    pinLimitations = '';
  }

  async function addDecision() {
    if (!await persist({
      decision: {
        summary: decisionSummary,
        rationale: decisionRationale,
        evidencePinIds: decisionPinIds,
      },
    }, `Recorded an analyst decision for ${record.domain}.`)) return;
    decisionSummary = '';
    decisionRationale = '';
    decisionPinIds = [];
  }

  async function addAssertion() {
    if (!await persist({
      assertion: {
        kind: assertionKind,
        statement: assertionStatement,
        rationale: assertionRationale,
        evidenceRelations: assertionEvidenceRelations,
        state: assertionState,
      },
    }, `Recorded a structured analyst assertion for ${record.domain}.`)) return;
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
    if (!await persist({
      trailEvent: {
        kind: trailKind,
        summary: trailSummary,
        target: trailTarget,
      },
    }, `Recorded a manual investigation step for ${record.domain}.`)) return;
    trailKind = 'pivot';
    trailSummary = '';
    trailTarget = '';
  }

  async function addSighting() {
    if (!await persist({
      sighting: {
        state: sightingState,
        category: sightingCategory,
        source: sightingSource,
        observedAt: isoFromLocal(sightingObservedAt) || new Date().toISOString(),
        completeness: sightingCompleteness,
        evidencePinId: sightingEvidencePinId || null,
        limitations: list(sightingLimitations),
      },
    }, `Recorded a source-qualified sighting for ${record.domain}.`)) return;
    sightingLimitations = '';
  }

  function actionInput() {
    return {
      type: actionType,
      recipient: actionRecipient,
      contactSource: actionContactSource,
      contactLimitations: list(actionLimitations),
      dueAt: isoFromLocal(actionDueAt),
      followUpAt: isoFromLocal(actionFollowUpAt),
      originActionId: actionOriginId || null,
    };
  }

  function clearAction() {
    selectedActionId = '';
    actionType = 'internal_review';
    actionRecipient = '';
    actionContactSource = 'analyst supplied';
    actionLimitations = '';
    actionDueAt = '';
    actionFollowUpAt = '';
    actionOriginId = '';
    clearTransition();
  }

  function selectAction(id: string) {
    selectedActionId = id;
    const action = record.actions.find((item) => item.id === id);
    if (!action) {
      clearAction();
      return;
    }
    actionType = action.type;
    actionRecipient = action.recipient;
    actionContactSource = action.contactSource;
    actionLimitations = action.contactLimitations.join('\n');
    actionDueAt = localFromIso(action.dueAt);
    actionFollowUpAt = localFromIso(action.followUpAt);
    actionOriginId = action.originActionId || '';
    clearTransition();
    transitionNextState = nextTransitionState(action, transitionSourceClass);
  }

  async function saveAction() {
    const patch = selectedActionId
      ? { actionUpdate: { id: selectedActionId, ...actionInput() } }
      : { action: actionInput() };
    if (!await persist(patch, `${selectedActionId ? 'Updated' : 'Recorded'} a case action for ${record.domain}.`)) return;
    clearAction();
  }

  function nextTransitionState(action: CaseActionRecord, sourceClass: CaseActionEventSourceClass): CaseActionState {
    return CASE_ACTION_STATES.find((nextState) => isLegalCaseActionTransition(action.state, nextState, sourceClass)
      && (!['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState) || sourceClass === 'analyst')
      && (!(nextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(action.state))
        || sourceClass === 'analyst')) ?? action.state;
  }

  function clearTransition() {
    transitionOccurredAt = '';
    transitionSourceClass = 'analyst';
    transitionProvenance = 'analyst recorded event';
    transitionReference = '';
    transitionEvidencePinId = '';
    transitionLimitations = '';
    transitionProviderOutcome = '';
    transitionOutcomeDetail = '';
  }

  function setTransitionSourceClass(value: string) {
    transitionSourceClass = value === 'provider' ? 'provider' : 'analyst';
    if (selectedAction) transitionNextState = nextTransitionState(selectedAction, transitionSourceClass);
    transitionProviderOutcome = '';
  }

  function setTransitionNextState(value: string) {
    if (CASE_ACTION_STATES.includes(value as CaseActionState)) transitionNextState = value as CaseActionState;
    transitionProviderOutcome = '';
  }

  async function addActionTransition() {
    if (!selectedAction) return;
    if (!await persist({
      actionUpdate: {
        id: selectedAction.id,
        transition: {
          nextState: transitionNextState,
          occurredAt: isoFromLocal(transitionOccurredAt) || new Date().toISOString(),
          sourceClass: transitionSourceClass,
          provenance: transitionProvenance,
          reference: transitionReference || null,
          evidencePinId: transitionEvidencePinId || null,
          limitations: list(transitionLimitations),
          providerOutcome: transitionProviderOutcome || null,
          outcomeDetail: transitionOutcomeDetail || null,
          originActionId: selectedAction.originActionId,
        },
      },
    }, `Appended a ${transitionNextState.replaceAll('_', ' ')} action event for ${record.domain}.`)) return;
    clearTransition();
    await tick();
    if (selectedAction) transitionNextState = nextTransitionState(selectedAction, 'analyst');
  }

  async function addObservedEffectReview() {
    if (!await persist({
      observedEffectReview: {
        state: effectState,
        observedAt: isoFromLocal(effectObservedAt) || new Date().toISOString(),
        sourceClass: effectSourceClass,
        source: effectSource,
        completeness: effectCompleteness,
        evidencePinId: effectEvidencePinId || null,
        sightingId: effectSightingId || null,
        followUpAt: isoFromLocal(effectFollowUpAt),
        limitations: list(effectLimitations),
      },
    }, `Recorded an independent observed-effect review for ${record.domain}.`)) return;
    effectLimitations = '';
    effectEvidencePinId = '';
    effectSightingId = '';
  }

  async function closeCaseDeliberately() {
    if (!await persist({
      closure: {
        reason: closureReason,
        summary: closureSummary,
        observedEffectReviewId: closureReviewId || null,
        actionId: closureActionId || null,
        limitations: list(closureLimitations),
      },
    }, `Recorded a deliberate closure for ${record.domain}.`)) return;
    closureSummary = '';
    closureReviewId = '';
    closureActionId = '';
    closureLimitations = '';
  }

  function packetContactsInput() {
    return RESPONSE_CONTACT_KINDS.flatMap((kind) => packetContacts[kind].trim()
      ? [{
          kind,
          contact: packetContacts[kind],
          source: packetContactSources[kind],
          observedAt: isoFromLocal(packetContactObservedAt[kind]),
          limitations: list(packetContactLimitations[kind]),
        }]
      : []);
  }

  function packetInput(includeAuthorisation = true): CaseResponsePacketInput {
    const artefactReferences = packetArtefactDigest.trim() ? [{
      label: packetArtefactLabel,
      mediaType: packetArtefactMediaType,
      capturedAt: isoFromLocal(packetArtefactCapturedAt),
      source: packetArtefactSource,
      digestSha256: packetArtefactDigest,
      byteLength: packetArtefactByteLength ? Number(packetArtefactByteLength) : null,
      limitations: list(packetArtefactLimitations),
    }] : [];
    return {
      profile: packetProfile,
      category: packetCategory,
      affectedParty: packetAffectedParty,
      abusiveUrls: packetUrls,
      observedHarm: packetHarm,
      observedAt: isoFromLocal(packetObservedAt),
      contacts: packetContactsInput(),
      selectedEvidencePinIds: packetSelectedEvidenceIds,
      readiness: {
        infrastructureResponsibility: {
          state: packetInfrastructureState,
          detail: packetInfrastructureDetail,
          limitations: list(packetInfrastructureLimitations),
        },
        authorityReview: {
          state: packetAuthorityState,
          detail: packetAuthorityDetail,
          limitations: list(packetAuthorityLimitations),
        },
        contradictionsReview: {
          state: packetContradictionsState,
          detail: packetContradictionsDetail,
          limitations: list(packetContradictionsLimitations),
        },
        sourceLimitations: {
          state: packetSourceLimitationsState,
          detail: packetSourceLimitationsDetail,
          limitations: list(packetSourceLimitations),
        },
      },
      artefactReferences,
      ...(includeAuthorisation ? {
        authorisation: {
          reviewedInputDigestSha256: packetReviewDigest,
          confirmedAt: isoFromLocal(packetAuthorisationConfirmedAt),
          confirmations: packetConfirmations,
        },
      } : {}),
    };
  }

  function packetMaterialSignature(): string {
    return JSON.stringify({ record, input: packetInput(false) });
  }

  async function reviewPacketInputs() {
    if (packetBusy) return;
    packetBusy = true;
    try {
      const signature = packetMaterialSignature();
      const digest = await buildCaseResponseReviewDigest(record, packetInput(false), new Date().toISOString());
      if (signature !== packetMaterialSignature()) {
        packetAuthorisationConfirmedAt = '';
        onmessage('The local packet inputs changed while the review digest was being prepared. Review and bind the current inputs again.');
        return;
      }
      packetReviewDigest = digest;
      packetReviewSignature = signature;
      packetConfirmations = {
        selectedEvidence: false,
        recipientScope: false,
        privacyRedactions: false,
        analystAuthority: false,
        evidenceFreshness: false,
      };
      packetAuthorisationConfirmedAt = '';
      onmessage('Bound the current local draft inputs to a review digest. Confirm each authorisation statement after completing the review.');
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Could not bind the current packet inputs for review.');
    } finally {
      packetBusy = false;
    }
  }

  function setPacketConfirmation(id: ResponseAuthorisationConfirmationId, checked: boolean) {
    packetConfirmations = { ...packetConfirmations, [id]: checked };
    packetAuthorisationConfirmedAt = '';
  }

  async function authorisePacketInputs() {
    if (!packetReviewIsCurrent || !packetConfirmationsComplete || !packetAuthorisationReadinessComplete) return;
    if (packetBusy) return;
    packetBusy = true;
    try {
      const signature = packetMaterialSignature();
      const currentDigest = await buildCaseResponseReviewDigest(record, packetInput(false), new Date().toISOString());
      if (signature !== packetMaterialSignature() || signature !== packetReviewSignature || currentDigest !== packetReviewDigest) {
        packetAuthorisationConfirmedAt = '';
        onmessage('The reviewed inputs or their freshness state changed. Review and bind the current packet again before authorisation.');
        return;
      }
      packetAuthorisationConfirmedAt = localFromIso(new Date().toISOString());
      onmessage('Authorised the exact browser-local inputs bound to the retained review digest. Nothing was submitted.');
    } catch (cause) {
      packetAuthorisationConfirmedAt = '';
      onmessage(cause instanceof Error ? cause.message : 'Could not verify the exact packet review before authorisation.');
    } finally {
      packetBusy = false;
    }
  }

  function packet(generatedAt: string = new Date().toISOString()) {
    return buildCaseResponsePacket(record, packetInput(), generatedAt);
  }

  function contactKind(action: CaseActionRecord): ResponseContactKind | null {
    if (action.type === 'registrar_report') return 'registrar';
    if (action.type === 'registry_report') return 'registry';
    if (action.type === 'network_hosting_report') return 'network_hosting';
    if (action.type === 'security_contact_report') return 'security_txt';
    return null;
  }

  function useRecordedActionRoutes() {
    let added = 0;
    const contacts = { ...packetContacts };
    const sources = { ...packetContactSources };
    const limitations = { ...packetContactLimitations };
    const observedAt = { ...packetContactObservedAt };
    for (const action of [...record.actions].reverse()) {
      const kind = contactKind(action);
      if (!kind || contacts[kind]) continue;
      contacts[kind] = action.recipient;
      sources[kind] = action.contactSource;
      limitations[kind] = action.contactLimitations.join('\n');
      observedAt[kind] = localFromIso(action.metadataUpdatedAt);
      added += 1;
    }
    packetContacts = contacts;
    packetContactSources = sources;
    packetContactLimitations = limitations;
    packetContactObservedAt = observedAt;
    onmessage(added
      ? `Loaded ${added} recorded case contact route${added === 1 ? '' : 's'} into the local packet draft.`
      : 'No unused external contact route was available in the recorded case actions.');
  }

  async function downloadPacket(format: 'json' | 'md' | 'txt') {
    if (packetBusy) return;
    packetBusy = true;
    try {
      const generatedAt = new Date().toISOString();
      const built = await packet(generatedAt);
      const content = format === 'json'
        ? JSON.stringify(built.json, null, 2)
        : format === 'md'
          ? built.markdown
          : built.email;
      const url = URL.createObjectURL(new Blob([content], {
        type: format === 'json' ? 'application/json' : format === 'md' ? 'text/markdown' : 'text/plain',
      }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = caseResponsePacketFilename(record.domain, format, generatedAt);
      anchor.click();
      URL.revokeObjectURL(url);
      onmessage(`Exported a ${built.json.authorisation.status} ${format === 'txt' ? 'plain-text email draft' : format.toUpperCase()} response packet. Nothing was submitted.`);
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Could not prepare the response packet.');
    } finally {
      packetBusy = false;
    }
  }

  async function copyEmail() {
    if (packetBusy) return;
    packetBusy = true;
    try {
      const built = await packet();
      await navigator.clipboard.writeText(built.email);
      onmessage(`Copied the ${built.json.authorisation.status} response email draft. Nothing was submitted.`);
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Clipboard access was unavailable.');
    } finally {
      packetBusy = false;
    }
  }
</script>

<section id={`case-response-${record.id}`} class="response-workspace" aria-labelledby={`response-title-${record.id}`} tabindex="-1">
  <header>
    <div><p class="eyebrow">Reviewed response</p><h3 id={`response-title-${record.id}`}>Evidence, reasoning, and actions</h3></div>
    <span>{countLabel(record.evidencePins.length, 'pin')} · {countLabel(record.sightings.length, 'sighting')} · {countLabel(record.decisions.length, 'decision')} · {countLabel(record.assertions.length, 'assertion')} · {countLabel(record.actions.length, 'action')} · {countLabel(record.branches?.length ?? 0, 'branch')}</span>
  </header>
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

  <details>
    <summary>Pin an observed fact</summary>
    <form class="response-form" onsubmit={(event) => { event.preventDefault(); void addPin(); }}>
      <div class="two-columns">
        <label class="field">Label<input bind:value={pinLabel} maxlength="80" required placeholder="Observed login form"></label>
        <label class="field">Source<input bind:value={pinSource} maxlength="80" required placeholder="Lookup evidence"></label>
        <label class="field">Observed at<input type="datetime-local" bind:value={pinObservedAt}></label>
        <label class="field">Completeness<select bind:value={pinCompleteness}>{#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}</select></label>
      </div>
      <label class="field">Fact<textarea bind:value={pinValue} maxlength="1000" rows="2" required></textarea></label>
      <label class="field">Limitations <small>one per line</small><textarea bind:value={pinLimitations} maxlength="2000" rows="2"></textarea></label>
      <button class="btn" type="submit" disabled={mutationBusy}>Pin evidence</button>
    </form>
    {#if record.evidencePins.length}
      <ol class="records">{#each [...record.evidencePins].reverse() as pin}<li><strong>{pin.label}</strong><p>{pin.value}</p><small>{pin.source} · {pin.completeness} · {pin.observedAt}</small>{#if pin.limitations.length}<small>Limits: {pin.limitations.join('; ')}</small>{/if}</li>{/each}</ol>
    {/if}
  </details>

  <details>
    <summary>Record a source-qualified sighting</summary>
    <form class="response-form" onsubmit={(event) => { event.preventDefault(); void addSighting(); }}>
      <p class="notice">Use observed or reported states for source evidence. Analyst confirmed, not reproduced, and expired are review conclusions and do not alter the original observation.</p>
      <div class="two-columns">
        <label class="field">Sighting state<select bind:value={sightingState}>{#each CASE_SIGHTING_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
        <label class="field">Evidence category<select bind:value={sightingCategory}>{#each CASE_SIGHTING_CATEGORIES as value}<option {value}>{value}</option>{/each}</select></label>
        <label class="field">Source<input bind:value={sightingSource} maxlength="80" required></label>
        <label class="field">Observed or reviewed at<input type="datetime-local" bind:value={sightingObservedAt}></label>
        <label class="field">Completeness<select bind:value={sightingCompleteness}>{#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}</select></label>
        {#if record.evidencePins.length}<label class="field">Supporting evidence pin<select bind:value={sightingEvidencePinId}><option value="">No pin selected</option>{#each record.evidencePins as pin}<option value={pin.id}>{pin.label}</option>{/each}</select></label>{/if}
      </div>
      <label class="field">Limitations <small>one per line</small><textarea bind:value={sightingLimitations} maxlength="2000" rows="2"></textarea></label>
      <button class="btn" type="submit" disabled={mutationBusy}>Record sighting</button>
    </form>
    {#if record.sightings.length}
      <ol class="records">{#each [...record.sightings].reverse() as sighting}<li><strong>{sighting.state.replaceAll('_', ' ')} · {sighting.category}</strong><p>{sighting.source}</p><small>{sighting.sourceClass} source · {sighting.completeness} · {sighting.observedAt}</small>{#if sighting.limitations.length}<small>Limits: {sighting.limitations.join('; ')}</small>{/if}</li>{/each}</ol>
    {/if}
    {#if sightingChronology.length}
      <section class="chronology" aria-labelledby={`sighting-chronology-${record.id}`}>
        <div>
          <strong id={`sighting-chronology-${record.id}`}>Observation chronology</strong>
          <span>{countLabel(sightingChronology.length, 'source sequence')}</span>
        </div>
        <p>First and last observed describe retained evidence, not domain creation, activation, or removal. Review conclusions remain outside these ranges.</p>
        <ol>
          {#each sightingChronology as entry}
            <li>
              <div><strong>{entry.category}</strong><span>{entry.sourceClass} · {entry.completeness}</span></div>
              <p>{entry.source}</p>
              <dl>
                <div><dt>First observed</dt><dd>{entry.firstObservedAt}</dd></div>
                <div><dt>Last observed</dt><dd>{entry.lastObservedAt}</dd></div>
                <div><dt>Observations</dt><dd>{entry.observationCount}</dd></div>
              </dl>
              {#if entry.limitations.length}<small>Limits: {entry.limitations.join('; ')}</small>{/if}
            </li>
          {/each}
        </ol>
        {#if sightingReviewConclusionCount}
          <small>{countLabel(sightingReviewConclusionCount, 'review conclusion')} retained separately and excluded from observed ranges.</small>
        {/if}
      </section>
    {/if}
  </details>

  <details>
    <summary>Record an analyst decision</summary>
    <form class="response-form" onsubmit={(event) => { event.preventDefault(); void addDecision(); }}>
      <label class="field">Decision summary<input bind:value={decisionSummary} maxlength="80" required></label>
      <label class="field">Rationale<textarea bind:value={decisionRationale} maxlength="2000" rows="3" required></textarea></label>
      {#if record.evidencePins.length}
        <fieldset class="pin-references"><legend>Supporting evidence pins</legend>{#each record.evidencePins as pin}<label class="choice"><input type="checkbox" checked={decisionPinIds.includes(pin.id)} onchange={(event) => decisionPinIds = event.currentTarget.checked ? [...decisionPinIds, pin.id] : decisionPinIds.filter((id) => id !== pin.id)}><span>{pin.label}</span></label>{/each}</fieldset>
      {/if}
      <button class="btn" type="submit" disabled={mutationBusy}>Record decision</button>
    </form>
    {#if record.decisions.length}
      <ol class="records">{#each [...record.decisions].reverse() as decision}<li><strong>{decision.summary}</strong><p>{decision.rationale}</p><small>{decision.createdAt}{decision.evidencePinIds.length ? ` · ${decision.evidencePinIds.length} supporting pin${decision.evidencePinIds.length === 1 ? '' : 's'}` : ''}</small></li>{/each}</ol>
    {/if}
  </details>

  <details>
    <summary>Structure facts, hypotheses, unknowns, and next steps</summary>
    <form class="stack" onsubmit={(event) => { event.preventDefault(); void addAssertion(); }}>
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
      <ol class="records">{#each [...record.assertions].reverse() as assertion}<li id={assertionItemId(assertion.id)} tabindex="-1"><strong>{assertion.provenance ? 'external import' : assertion.kind.replaceAll('_', ' ')} · {assertion.state}</strong><p>{assertion.statement}</p>{#if assertion.rationale}<p>{assertion.rationale}</p>{/if}{#if assertion.provenance}<small>{assertion.provenance.format.toUpperCase()} · {assertion.provenance.sourceName}{assertion.provenance.publisher ? ` · ${assertion.provenance.publisher}` : ''}{assertion.provenance.externalId ? ` · ${assertion.provenance.externalId}` : ''}</small><small>File SHA-256 {assertion.provenance.sourceDigestSha256}{assertion.provenance.observedAt ? ` · observed ${assertion.provenance.observedAt}` : ''}</small>{#if assertion.provenance.labels.length || assertion.provenance.markings.length}<small>{[...assertion.provenance.labels, ...assertion.provenance.markings].join(' · ')}</small>{/if}{/if}{#if assertion.evidenceRelations?.length}<small>{assertion.evidenceRelations.filter((item) => item.stance === 'supports').length} supporting · {assertion.evidenceRelations.filter((item) => item.stance === 'contradicts').length} contradicting · {assertion.evidenceRelations.filter((item) => item.stance === 'unresolved').length} unresolved evidence relationship{assertion.evidenceRelations.length === 1 ? '' : 's'}</small>{:else}<small>updated {assertion.updatedAt}{assertion.evidencePinIds.length ? ` · ${assertion.evidencePinIds.length} linked pin${assertion.evidencePinIds.length === 1 ? '' : 's'}` : ''}</small>{/if}{#if assertion.state === 'open'}<button class="btn small" type="button" disabled={mutationBusy} onclick={() => void setAssertionState(assertion.id, 'resolved')}>Mark resolved</button>{/if}</li>{/each}</ol>
    {/if}
  </details>

  <CaseInvestigationBranches {record} {onsaved} {oncommitted} {onmessage} />

  <details>
    <summary>Record and review the investigation trail</summary>
    <form class="stack" onsubmit={(event) => { event.preventDefault(); void addTrailEvent(); }}>
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

  <details>
    <summary>Track append-only response actions</summary>
    <div class="response-form">
      <p class="notice">Action metadata and lifecycle events are separate. New actions start in drafting. Readiness, review, authorisation, submission, acknowledgement, and terminal handling require explicit legal transitions; editing metadata never rewrites earlier events.</p>
      <form class="stack" onsubmit={(event) => { event.preventDefault(); void saveAction(); }}>
        {#if record.actions.length}
          <label class="field">Action metadata<select value={selectedActionId} onchange={(event) => selectAction(event.currentTarget.value)}><option value="">Create a new action</option>{#each record.actions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient}</option>{/each}</select></label>
        {/if}
        {#if selectedActionIdentityLocked}<p class="notice">Submitted, acknowledged, and terminal action identity and recipient metadata are immutable. Update scheduling only, or create a linked follow-on action.</p>{/if}
        <div class="two-columns">
          <label class="field">Action type<select bind:value={actionType} disabled={selectedActionIdentityLocked}>{#each CASE_ACTION_TYPES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label class="field">Recipient or internal owner<input bind:value={actionRecipient} maxlength="320" required disabled={selectedActionIdentityLocked}></label>
          <label class="field">Contact source<input bind:value={actionContactSource} maxlength="80" required disabled={selectedActionIdentityLocked}></label>
          <label class="field">Originating action<select bind:value={actionOriginId} disabled={selectedActionIdentityLocked}><option value="">No originating action</option>{#each record.actions.filter((action) => action.id !== selectedActionId) as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient}</option>{/each}</select></label>
          <label class="field">Due at<input type="datetime-local" bind:value={actionDueAt}></label>
          <label class="field">Follow-up at<input type="datetime-local" bind:value={actionFollowUpAt}></label>
        </div>
        <label class="field">Contact limitations <small>one per line</small><textarea bind:value={actionLimitations} maxlength="2000" rows="2" disabled={selectedActionIdentityLocked}></textarea></label>
        <div class="actions"><button class="btn" type="submit" disabled={mutationBusy}>{mutationBusy ? 'Saving…' : selectedActionId ? 'Update metadata' : 'Create drafting action'}</button>{#if selectedActionId}<button class="btn" type="button" disabled={mutationBusy} onclick={clearAction}>Cancel edit</button>{/if}</div>
      </form>

      {#if selectedAction}
        <form class="transition-form" aria-labelledby={`transition-title-${record.id}`} onsubmit={(event) => { event.preventDefault(); void addActionTransition(); }}>
          <div><strong id={`transition-title-${record.id}`}>Append transition for {selectedAction.recipient}</strong><span>Current projection: {selectedAction.state.replaceAll('_', ' ')}</span></div>
          {#if legalTransitionStates.length}
            <div class="two-columns">
              <label class="field">Event source<select value={transitionSourceClass} onchange={(event) => setTransitionSourceClass(event.currentTarget.value)}>{#each userActionEventSourceClasses as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
              <label class="field">Next state<select value={transitionNextState} onchange={(event) => setTransitionNextState(event.currentTarget.value)}>{#each legalTransitionStates as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
              <label class="field">Original event time<input type="datetime-local" bind:value={transitionOccurredAt}></label>
              <label class="field">Provenance<input bind:value={transitionProvenance} maxlength="80" required></label>
              <label class="field">Bounded reference<input bind:value={transitionReference} maxlength="500"></label>
              <label class="field">Evidence pin<select bind:value={transitionEvidencePinId}><option value="">No evidence pin</option>{#each record.evidencePins as pin}<option value={pin.id}>{pin.label}</option>{/each}</select></label>
              <label class="field">Typed provider outcome<select bind:value={transitionProviderOutcome} required={transitionNextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(selectedAction.state)}><option value="">No provider outcome</option>{#each availableTransitionProviderOutcomes as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
            </div>
            {#if transitionNextState === 'terminal' && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(selectedAction.state)}
              <p class="notice">Ending a pre-authorisation action requires an analyst-sourced withdrawn outcome. It does not authorise or submit the action.</p>
            {/if}
            <label class="field">Provider outcome detail<textarea bind:value={transitionOutcomeDetail} maxlength="2000" rows="2"></textarea></label>
            <label class="field">Event limitations <small>one per line</small><textarea bind:value={transitionLimitations} maxlength="2000" rows="2"></textarea></label>
            <button class="btn" type="submit" disabled={mutationBusy}>Append transition</button>
          {:else}
            <p class="notice">This action is terminal. Its retained transition history cannot be rewritten or extended.</p>
          {/if}
        </form>
      {/if}
    </div>
    {#if record.actions.length}
      <ol class="records action-records" aria-label="Response action transition timelines">
        {#each [...record.actions].reverse() as action}
          <li id={`case-action-${record.id}-${action.id}`} tabindex="-1">
            <strong>{action.type.replaceAll('_', ' ')} · {action.state.replaceAll('_', ' ')}</strong>
            <p>{action.recipient}</p>
            <small>Action ID {action.id} · {action.contactSource} · created {action.createdAt}</small>
            {#if action.originActionId}<small>Originating action: {action.originActionId}</small>{/if}
            {#if action.reference}<p>Latest reference: {action.reference}</p>{/if}
            {#if action.providerOutcome}<p>Latest typed provider outcome: {action.providerOutcome.replaceAll('_', ' ')}{action.outcome ? ` · ${action.outcome}` : ''}</p>{:else if action.outcome}<p>Recorded legacy outcome detail: {action.outcome}</p>{/if}
            <ol class="transition-timeline" aria-label={`Transitions for ${action.recipient}`}>
              {#each action.history as event}
                <li data-applied={event.applied}>
                  <strong>{event.previousState ?? 'none'} → {event.nextState.replaceAll('_', ' ')}</strong>
                  <span>{event.occurredAt} · {event.sourceClass.replaceAll('_', ' ')} · {event.provenance}</span>
                  <small>Event ID {event.id} · {event.applied ? 'applied to projection' : 'retained concurrent conflict'}</small>
                  {#if event.providerOutcome}<p>Provider outcome: {event.providerOutcome.replaceAll('_', ' ')}{event.outcomeDetail ? ` · ${event.outcomeDetail}` : ''}</p>{:else if event.outcomeDetail}<p>Recorded outcome detail: {event.outcomeDetail}</p>{/if}
                  {#if event.reference}<p>Reference: {event.reference}</p>{/if}
                  {#if event.evidencePinId}<small>Evidence pin: {event.evidencePinId}</small>{/if}
                  {#if event.originActionId}<small>Originating action: {event.originActionId}</small>{/if}
                  {#if event.limitations.length}<small>Limitations: {event.limitations.join('; ')}</small>{/if}
                </li>
              {/each}
            </ol>
            {#if action.historyOmitted}<p class="history-warning">{action.historyOmitted} earlier or invalid transition event{action.historyOmitted === 1 ? '' : 's'} omitted by bounded retention.</p>{/if}
            {#if action.historyLimitations.length}<small>History limitations: {action.historyLimitations.join('; ')}</small>{/if}
            <button class="btn small" type="button" onclick={() => selectAction(action.id)}>Review or append event</button>
          </li>
        {/each}
      </ol>
    {/if}
  </details>

  <details>
    <summary>Verify remediation independently and close deliberately</summary>
    <div class="response-form remediation-review">
      <p class="notice">Provider workflow and technical effect are separate. A provider acknowledgement, terminal action, or reported resolution never becomes independently observed change, absence, or safety. Reviews are analyst-triggered and make no network request.</p>
      <dl class="separate-times">
        <div><dt>Provider outcome time</dt><dd>{responseLifecycle.latestProviderOutcome ? `${responseLifecycle.latestProviderOutcome.occurredAt} · ${responseLifecycle.latestProviderOutcome.outcome.replaceAll('_', ' ')}` : `Withheld — ${responseLifecycle.providerOutcomeState}`}</dd></div>
        <div><dt>Independently observed change time</dt><dd>{responseLifecycle.latestObservedChangeAt ?? `Withheld — ${responseLifecycle.observedChangeState}`}</dd></div>
      </dl>
      {#if record.observedEffects.preV13HistoryUnavailable || record.closures.preV13HistoryUnavailable}
        <p class="history-warning">This Case predates v13. Earlier independent review or deliberate closure history is unavailable and was not reconstructed.</p>
      {/if}
      <form class="stack" aria-labelledby={`effect-review-title-${record.id}`} onsubmit={(event) => { event.preventDefault(); void addObservedEffectReview(); }}>
        <strong id={`effect-review-title-${record.id}`}>Append independent observed-effect review</strong>
        <div class="two-columns">
          <label class="field">Observed effect<select bind:value={effectState}>{#each CASE_OBSERVED_EFFECT_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label class="field">Observation time<input type="datetime-local" bind:value={effectObservedAt}></label>
          <label class="field">Source class<select bind:value={effectSourceClass}>{#each userObservedEffectSourceClasses as value}<option {value}>{value}</option>{/each}</select></label>
          <label class="field">Separately attributed source<input bind:value={effectSource} maxlength="80" required></label>
          <label class="field">Completeness<select bind:value={effectCompleteness}>{#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}</select></label>
          <label class="field">Evidence pin<select bind:value={effectEvidencePinId}><option value="">No evidence pin</option>{#each record.evidencePins as pin}<option value={pin.id}>{pin.label}</option>{/each}</select></label>
          <label class="field">Existing sighting<select bind:value={effectSightingId}><option value="">No sighting</option>{#each record.sightings as sighting}<option value={sighting.id}>{sighting.state.replaceAll('_', ' ')} · {sighting.source}</option>{/each}</select></label>
          <label class="field">Scheduled local follow-up<input type="datetime-local" bind:value={effectFollowUpAt}></label>
        </div>
        <label class="field">Limitations <small>one per line</small><textarea bind:value={effectLimitations} maxlength="2000" rows="2"></textarea></label>
        <button class="btn" type="submit" disabled={mutationBusy}>Record independent review</button>
      </form>
      {#if record.observedEffects.reviews.length}
        <ol class="records embedded-records" aria-label="Independent observed-effect reviews">
          {#each [...record.observedEffects.reviews].reverse() as review}
            <li><strong>{review.state.replaceAll('_', ' ')}</strong><p>{review.source}</p><small>Review ID {review.id} · {review.observedAt} · {review.sourceClass} · {review.completeness}</small>{#if review.evidencePinId}<small>Evidence pin: {review.evidencePinId}</small>{/if}{#if review.sightingId}<small>Sighting: {review.sightingId}</small>{/if}{#if review.followUpAt}<small>Scheduled follow-up: {review.followUpAt}</small>{/if}{#if review.limitations.length}<small>Limitations: {review.limitations.join('; ')}</small>{/if}</li>
          {/each}
        </ol>
      {/if}
      {#if record.observedEffects.omitted}<p class="history-warning">{record.observedEffects.omitted} earlier independent review{record.observedEffects.omitted === 1 ? '' : 's'} omitted by bounded retention.</p>{/if}

      <form class="stack closure-form" aria-labelledby={`closure-title-${record.id}`} onsubmit={(event) => { event.preventDefault(); void closeCaseDeliberately(); }}>
        <strong id={`closure-title-${record.id}`}>Deliberate analyst closure</strong>
        <p class="notice">Closure records a reason and linked context. It does not alter provider events or independent observations, and it does not establish safety or legal sufficiency.</p>
        <div class="two-columns">
          <label class="field">Closure reason<select bind:value={closureReason}>{#each CASE_CLOSURE_REASONS as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label class="field">Independent review<select bind:value={closureReviewId} required={closureNeedsReview}><option value="">{closureNeedsReview ? 'Select the required typed review' : 'No linked review'}</option>{#each eligibleClosureReviews as review}<option value={review.id}>{review.state.replaceAll('_', ' ')} · {review.observedAt}</option>{/each}</select></label>
          <label class="field">Provider action<select bind:value={closureActionId} required={closureNeedsAction}><option value="">{closureNeedsAction ? 'Select the required provider-resolution action' : 'No linked provider action'}</option>{#each eligibleClosureActions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.providerOutcome?.replaceAll('_', ' ') ?? action.state.replaceAll('_', ' ')}</option>{/each}</select></label>
        </div>
        <label class="field">Closure summary<textarea bind:value={closureSummary} maxlength="2000" rows="2" required></textarea></label>
        <label class="field">Closure limitations <small>one per line</small><textarea bind:value={closureLimitations} maxlength="2000" rows="2"></textarea></label>
        <button class="btn" type="submit" disabled={mutationBusy}>Close case with reason</button>
      </form>
      {#if record.closures.records.length}
        <ol class="records embedded-records" aria-label="Deliberate case closures">
          {#each [...record.closures.records].reverse() as closure}
            <li><strong>{closure.reason.replaceAll('_', ' ')}</strong><p>{closure.summary}</p><small>Closure ID {closure.id} · {closure.createdAt}</small>{#if closure.observedEffectReviewId}<small>Independent review: {closure.observedEffectReviewId}</small>{/if}{#if closure.actionId}<small>Provider action: {closure.actionId}</small>{/if}{#if closure.limitations.length}<small>Limitations: {closure.limitations.join('; ')}</small>{/if}</li>
          {/each}
        </ol>
      {/if}
    </div>
  </details>

  <details id={`case-response-preflight-${record.id}`}>
    <summary>Prepare a reviewed abuse evidence packet</summary>
    <form class="response-form packet-form" onsubmit={(event) => event.preventDefault()}>
      <p class="notice">This prepares deliberate local JSON, Markdown, or plain-text drafts only. WHOISleuth performs no contact discovery, submission, mail, authentication, retry, or background request. Draft readiness never implies authorisation.</p>
      <p class="notice preflight-scope">{CASE_RESPONSE_PREFLIGHT_EVIDENCE_SCOPE.limitation}</p>
      <label class="field">Audience profile<select bind:value={packetProfile}>{#each RESPONSE_PACKET_PROFILES as profile}<option value={profile.id}>{profile.label}</option>{/each}</select></label>
      <section class="profile-preview" aria-labelledby={`profile-preview-title-${record.id}`}>
        <div>
          <strong id={`profile-preview-title-${record.id}`}>{packetProfilePreview.label}</strong>
          <span>{packetProfilePreview.audience}</span>
        </div>
        <p><strong>Suggested subject:</strong> {packetProfilePreview.subject}</p>
        <div class="profile-columns">
          <section><strong>Included</strong><ul>{#each packetProfilePreview.includedEvidence as item}<li>{item}</li>{/each}</ul></section>
          <section><strong>Excluded</strong><ul>{#each packetProfilePreview.excludedEvidence as item}<li>{item}</li>{/each}</ul></section>
          <section><strong>Redactions</strong><ul>{#each packetProfilePreview.redactions as item}<li>{item}</li>{/each}</ul></section>
          <section><strong>Attachments and follow-up</strong><ul>{#each packetProfilePreview.attachments as item}<li>{item}</li>{/each}{#each packetProfilePreview.followUpFields as item}<li>{item}</li>{/each}</ul></section>
        </div>
        {#if packetProfilePreview.missingEvidence.length}
          <p class="profile-missing"><strong>Still needed:</strong> {packetProfilePreview.missingEvidence.join('; ')}</p>
        {/if}
      </section>
      <section class="preflight" aria-labelledby={`preflight-title-${record.id}`}>
        <div><strong id={`preflight-title-${record.id}`}>Response preflight</strong><span class={`preflight-state state-${packetPreflight.status}`}>{packetPreflight.status.replaceAll('_', ' ')}</span></div>
        <p>{packetPreflight.counts.pass} pass · {packetPreflight.counts.caution} caution · {packetPreflight.counts.block} block</p>
        <ul>{#each packetPreflight.checks as check}<li data-state={check.state}><strong>{check.label}</strong><span>{check.detail}</span></li>{/each}</ul>
      </section>
      <div class="two-columns">
        <label class="field">Abuse category<input bind:value={packetCategory} maxlength="80" required placeholder="Credential phishing"></label>
        <label class="field">Affected party<input bind:value={packetAffectedParty} maxlength="200" required></label>
        <label class="field">Observed at<input type="datetime-local" bind:value={packetObservedAt} required></label>
      </div>
      <label class="field">Exact abusive HTTP(S) URLs <small>one per line</small><textarea bind:value={packetUrls} maxlength="42000" rows="3" required></textarea></label>
      <label class="field">Observed harm<textarea bind:value={packetHarm} maxlength="2000" rows="3" required></textarea></label>
      <fieldset class="contacts"><legend>Separately routed escalation contacts</legend>
        {#if record.actions.some((action) => contactKind(action))}
          <button class="btn small" type="button" onclick={useRecordedActionRoutes}>Use recorded case routes</button>
        {/if}
        {#each RESPONSE_CONTACT_KINDS as kind}
          <div class="contact-row">
            <strong>{kind.replaceAll('_', ' ')}</strong>
            <label class="field">Contact<input aria-label={`${kind.replaceAll('_', ' ')} contact`} bind:value={packetContacts[kind]} maxlength="320"></label>
            <label class="field">Source<input aria-label={`${kind.replaceAll('_', ' ')} source`} bind:value={packetContactSources[kind]} maxlength="120"></label>
            <label class="field">Route observed<input aria-label={`${kind.replaceAll('_', ' ')} route observed`} type="datetime-local" bind:value={packetContactObservedAt[kind]}></label>
            <label class="field">Limitations<input aria-label={`${kind.replaceAll('_', ' ')} limitations`} bind:value={packetContactLimitations[kind]} maxlength="240"></label>
          </div>
        {/each}
      </fieldset>
      <fieldset class="pin-references"><legend>Evidence selected for this exact packet</legend>
        {#if record.evidencePins.length}
          {#each record.evidencePins as pin}<label class="choice"><input type="checkbox" checked={packetSelectedEvidenceIds.includes(pin.id)} onchange={(event) => packetSelectedEvidenceIds = event.currentTarget.checked ? [...packetSelectedEvidenceIds, pin.id] : packetSelectedEvidenceIds.filter((id) => id !== pin.id)}><span>{pin.label} · {pin.source} · {pin.observedAt}</span></label>{/each}
        {:else}<p class="notice">No evidence pins are retained in this Case. The draft will keep this unavailable.</p>{/if}
      </fieldset>
      <fieldset class="readiness-inputs"><legend>Explicit review inputs</legend>
        <div class="readiness-editor">
          <section><strong>Infrastructure responsibility</strong><label class="field">State<select bind:value={packetInfrastructureState}>{#each RESPONSE_READINESS_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label><label class="field">Detail<input bind:value={packetInfrastructureDetail} maxlength="500"></label><label class="field">Limitations<textarea bind:value={packetInfrastructureLimitations} maxlength="2000" rows="2"></textarea></label></section>
          <section><strong>Analyst authority</strong><label class="field">State<select bind:value={packetAuthorityState}>{#each RESPONSE_READINESS_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label><label class="field">Detail<input bind:value={packetAuthorityDetail} maxlength="500"></label><label class="field">Limitations<textarea bind:value={packetAuthorityLimitations} maxlength="2000" rows="2"></textarea></label></section>
          <section><strong>Contradiction review</strong><label class="field">State<select bind:value={packetContradictionsState}>{#each RESPONSE_READINESS_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label><label class="field">Detail<input bind:value={packetContradictionsDetail} maxlength="500"></label><label class="field">Limitations<textarea bind:value={packetContradictionsLimitations} maxlength="2000" rows="2"></textarea></label></section>
          <section><strong>Source limitations review</strong><label class="field">State<select bind:value={packetSourceLimitationsState}>{#each RESPONSE_READINESS_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label><label class="field">Detail<input bind:value={packetSourceLimitationsDetail} maxlength="500"></label><label class="field">Limitations<textarea bind:value={packetSourceLimitations} maxlength="2000" rows="2"></textarea></label></section>
        </div>
      </fieldset>
      <section class="readiness-matrix" aria-labelledby={`readiness-title-${record.id}`}>
        <div><strong id={`readiness-title-${record.id}`}>Profile-specific readiness matrix</strong><span>{packetReadiness.counts.complete} complete · {packetReadiness.counts.partial} partial · {packetReadiness.counts.stale} stale · {packetReadiness.counts.unavailable} unavailable · {packetReadiness.counts.not_provided} not provided</span></div>
        <div class="table-wrap"><table><thead><tr><th scope="col">Review input</th><th scope="col">State</th><th scope="col">Detail and limitations</th></tr></thead><tbody>{#each packetReadiness.rows as row}<tr><th scope="row">{row.label}{row.requiredForAuthorisation ? ' *' : ''}</th><td><span class={`readiness-state state-${row.state}`}>{row.state.replaceAll('_', ' ')}</span></td><td>{row.detail}{#if row.limitations.length}<small>{row.limitations.join('; ')}</small>{/if}</td></tr>{/each}</tbody></table></div>
        <small>* Required for authorisation. Partial and stale states remain visible and require deliberate freshness and limitation confirmation.</small>
      </section>
      <fieldset class="artefact-reference"><legend>Optional integrity-checked capture reference</legend>
        <p class="notice">Retain metadata and SHA-256 only. Do not paste raw payloads, bodies, credentials, cookies, secrets, complete query-bearing URLs, or unnecessary personal data.</p>
        <div class="two-columns"><label class="field">Label<input bind:value={packetArtefactLabel} maxlength="120"></label><label class="field">Media type<input bind:value={packetArtefactMediaType} maxlength="120"></label><label class="field">Captured at<input type="datetime-local" bind:value={packetArtefactCapturedAt}></label><label class="field">Source<input bind:value={packetArtefactSource} maxlength="120"></label><label class="field">SHA-256 digest<input bind:value={packetArtefactDigest} maxlength="64" pattern="[a-fA-F0-9]{64}"></label><label class="field">Byte length<input type="number" min="0" max="104857600" bind:value={packetArtefactByteLength}></label></div>
        <label class="field">Limitations<textarea bind:value={packetArtefactLimitations} maxlength="2000" rows="2"></textarea></label>
      </fieldset>
      <section class="authorisation" aria-labelledby={`authorisation-title-${record.id}`}>
        <div><strong id={`authorisation-title-${record.id}`}>Exact-input review and authorisation</strong><span class:attention={!packetReviewIsCurrent || !packetConfirmationsComplete || !packetAuthorisationReadinessComplete || !packetAuthorisationConfirmedAt}>{packetReviewIsCurrent && packetConfirmationsComplete && packetAuthorisationReadinessComplete && packetAuthorisationConfirmedAt ? 'authorised inputs' : packetReviewDigest ? 'draft · review stale or incomplete' : 'draft · not reviewed'}</span></div>
        <p>Review the rendered matrix, selected evidence, recipient scope, privacy and redactions, authority, freshness, contradictions, and limitations. Then bind the exact current inputs to a digest.</p>
        <button class="btn" type="button" onclick={() => void reviewPacketInputs()} disabled={packetBusy || !packetPreflight.canExport}>Review and bind exact inputs</button>
        {#if packetReviewDigest}<code>{packetReviewDigest}</code>{/if}
        {#if packetReviewDigest && !packetReviewIsCurrent}<p class="history-warning">Material inputs changed after review. The retained digest is stale; re-review before authorisation.</p>{/if}
        <fieldset class="confirmations" disabled={!packetReviewIsCurrent}><legend>Explicit confirmations</legend>
          {#each RESPONSE_AUTHORISATION_CONFIRMATION_IDS as id}<label class="choice"><input type="checkbox" checked={packetConfirmations[id]} onchange={(event) => setPacketConfirmation(id, event.currentTarget.checked)}><span>{id === 'selectedEvidence' ? 'I reviewed the exact selected evidence.' : id === 'recipientScope' ? 'I reviewed the recipient and scope.' : id === 'privacyRedactions' ? 'I reviewed privacy and redactions.' : id === 'analystAuthority' ? 'I confirm analyst authority for this scope.' : 'I reviewed evidence freshness and retained cautions.'}</span></label>{/each}
        </fieldset>
        <button class="btn" type="button" onclick={() => void authorisePacketInputs()} disabled={packetBusy || !packetReviewIsCurrent || !packetConfirmationsComplete || !packetAuthorisationReadinessComplete}>Authorise exact bound inputs</button>
        <label class="field">Confirmation time<input type="datetime-local" bind:value={packetAuthorisationConfirmedAt} readonly disabled={!packetReviewIsCurrent || !packetConfirmationsComplete}></label>
        <p class="notice">Authorisation is bound only when all confirmations, a valid confirmation time, complete authority review, required readiness rows, and the canonical digest match. It does not submit the packet or promise removal, suspension, legal sufficiency, maliciousness, attribution, or any provider outcome.</p>
      </section>
      <div class="actions"><button class="btn" type="button" onclick={() => void downloadPacket('json')} disabled={packetBusy || !packetPreflight.canExport}>Export JSON draft or authorised packet</button><button class="btn" type="button" onclick={() => void downloadPacket('md')} disabled={packetBusy || !packetPreflight.canExport}>Export Markdown</button><button class="btn" type="button" onclick={() => void downloadPacket('txt')} disabled={packetBusy || !packetPreflight.canExport}>Export email draft</button><button class="btn" type="button" onclick={() => void copyEmail()} disabled={packetBusy || !packetPreflight.canExport}>Copy email draft</button></div>
    </form>
  </details>
</section>

<style>
  .response-workspace{display:grid;gap:10px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:10px}h3{margin:0}header>span{color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{padding:11px 12px;cursor:pointer;font:700 var(--text-xs) var(--mono)}details[open]>summary{border-bottom:1px solid var(--border)}
  .response-form{display:grid;gap:10px;padding:12px}.two-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .action-summary{display:flex;flex-wrap:wrap;gap:6px}.action-summary span{padding:5px 7px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:var(--text-2xs) var(--mono)}.action-summary strong{color:var(--accent)}.action-summary .attention{border-color:rgb(var(--amber-rgb) / .45);color:var(--amber)}.action-summary .attention strong{color:var(--amber)}
  textarea,input,select{width:100%}.field small{color:var(--muted)}
  .records{display:grid;gap:8px;margin:0;padding:0 12px 12px;list-style:none}.records li{padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .records strong,.records small{display:block}.records p{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}.records small{color:var(--muted);font-size:var(--text-2xs)}
  .transition-form,.remediation-review .stack{display:grid;gap:10px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.transition-form>div:first-child,.authorisation>div,.readiness-matrix>div:first-child{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px}.transition-form>div:first-child span,.readiness-matrix>div:first-child span{color:var(--muted);font-size:var(--text-2xs)}
  .transition-timeline{display:grid;gap:7px;margin:9px 0 0;padding:0;list-style:none}.transition-timeline li{min-width:0;padding:8px;border-left:3px solid var(--accent);background:var(--panel)}.transition-timeline li[data-applied="false"]{border-color:var(--amber)}.transition-timeline span,.transition-timeline small{display:block;overflow-wrap:anywhere}.history-warning{margin:7px 0;padding:8px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06);color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .remediation-review{gap:12px}.separate-times{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}.separate-times div{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.separate-times dt{color:var(--muted);font-size:var(--text-2xs)}.separate-times dd{margin:4px 0 0;font:650 var(--text-xs) var(--mono);overflow-wrap:anywhere}.embedded-records{padding:0}.closure-form{border-color:rgb(var(--amber-rgb) / .35)!important}
  .chronology{display:grid;gap:8px;margin:0 12px 12px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.chronology>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px}.chronology>div>span,.chronology>p,.chronology>small{color:var(--muted);font-size:var(--text-2xs)}.chronology>p{margin:0;line-height:1.5}.chronology ol{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:7px;margin:0;padding:0;list-style:none}.chronology li{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.chronology li>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px}.chronology li>div>strong{font:700 var(--text-xs) var(--mono);text-transform:capitalize}.chronology li>div>span,.chronology li>small{color:var(--muted);font-size:var(--text-2xs)}.chronology li>p{margin:6px 0;overflow-wrap:anywhere}.chronology dl{display:grid;gap:3px;margin:0}.chronology dl div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 8px}.chronology dt,.chronology dd{margin:0;font-size:var(--text-2xs)}.chronology dt{color:var(--muted)}.chronology dd{font-family:var(--mono);overflow-wrap:anywhere}
  .pin-references,.contacts,.readiness-inputs,.artefact-reference,.confirmations{display:grid;gap:8px;margin:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm)}legend{padding:0 5px;font:700 var(--text-xs) var(--mono)}
  .actions{display:flex;flex-wrap:wrap;gap:8px}.notice{margin:0;padding:9px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06);color:var(--muted);font-size:var(--text-xs)}
  .preflight{display:grid;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.preflight>div{display:flex;align-items:center;justify-content:space-between;gap:8px}.preflight>p{margin:0;color:var(--muted);font-size:var(--text-2xs)}.preflight-state{padding:4px 7px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}.preflight .state-ready_for_review{color:var(--success);border-color:rgb(var(--accent2-rgb) / .4)}.preflight .state-review_cautions{color:var(--amber);border-color:rgb(var(--amber-rgb) / .4)}.preflight .state-needs_input{color:var(--danger);border-color:rgb(var(--danger-rgb) / .4)}.preflight ul{display:grid;gap:5px;margin:0;padding:0;list-style:none}.preflight li{display:grid;grid-template-columns:minmax(110px,.35fr) minmax(0,1fr);gap:8px;padding:7px;border-left:3px solid var(--border);font-size:var(--text-2xs)}.preflight li[data-state="pass"]{border-color:var(--success)}.preflight li[data-state="caution"]{border-color:var(--amber)}.preflight li[data-state="block"]{border-color:var(--danger)}.preflight li span{color:var(--muted);line-height:1.45}
  .profile-preview{display:grid;gap:9px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.profile-preview>div:first-child{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:5px 12px}.profile-preview>div:first-child>strong{font:700 var(--text-sm) var(--mono)}.profile-preview>div:first-child>span,.profile-preview>p{color:var(--muted);font-size:var(--text-2xs)}.profile-preview>p{margin:0;overflow-wrap:anywhere}.profile-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.profile-columns section{padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}.profile-columns strong{font:700 var(--text-2xs) var(--mono)}.profile-columns ul{margin:6px 0 0;padding-left:17px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.profile-missing{padding:7px 8px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06)}
  .readiness-editor{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.readiness-editor section{display:grid;min-width:0;gap:7px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}.readiness-editor strong{font:700 var(--text-2xs) var(--mono)}.readiness-matrix{display:grid;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.table-wrap{max-width:100%;overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:var(--text-2xs)}th,td{min-width:0;padding:7px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;overflow-wrap:anywhere}td small{display:block;margin-top:4px;color:var(--muted)}.readiness-state{display:inline-block;padding:3px 5px;border:1px solid var(--border);border-radius:999px;font:650 var(--text-2xs) var(--mono);white-space:nowrap}.readiness-state.state-complete{color:var(--success)}.readiness-state.state-partial,.readiness-state.state-stale{color:var(--amber)}.readiness-state.state-unavailable,.readiness-state.state-not_provided{color:var(--muted)}
  .authorisation{display:grid;gap:9px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.authorisation>div>span{color:var(--success);font:650 var(--text-2xs) var(--mono)}.authorisation>div>span.attention{color:var(--amber)}.authorisation>p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}.authorisation code{display:block;max-width:100%;padding:7px;background:var(--panel);font-size:var(--text-2xs);overflow-wrap:anywhere}.choice{display:flex;align-items:flex-start;gap:7px;min-width:0}.choice input{width:auto;margin-top:2px}.choice span{min-width:0;overflow-wrap:anywhere}
  .contact-row{display:grid;grid-template-columns:130px repeat(4,minmax(0,1fr));gap:8px;align-items:end}.contact-row>strong{padding-bottom:10px;font:700 var(--text-xs) var(--mono);text-transform:capitalize}
  @media(max-width:1000px){.contact-row{grid-template-columns:repeat(2,minmax(0,1fr))}.contact-row>strong{grid-column:1/-1;padding:4px 0 0}}
  @media(max-width:800px){.two-columns,.contact-row,.preflight li,.profile-columns,.readiness-editor,.separate-times{grid-template-columns:1fr}.actions .btn{flex:1 1 150px}th,td{min-width:135px}.response-workspace{padding:10px}}
</style>

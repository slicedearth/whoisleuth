import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../lib/evidence-export.mts';
import {
  appendCaseAction,
  appendCaseActionTransition,
  appendCaseAssertion,
  appendCaseClosure,
  appendCaseDecision,
  appendCaseEvidencePin,
  appendCaseEvidencePins,
  appendCaseManualTrailEvent,
  appendCaseObservedEffectReview,
  appendCaseSighting,
  buildCaseActionOutcomeSummary,
  buildCaseClosureLinkContext,
  buildCaseInvestigationTrail,
  buildCaseResponseLifecycleSummary,
  MAX_CASE_ACTION_BYTES,
  MAX_CASE_ACTION_EVENTS_PER_ACTION,
  MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE,
  MAX_CASE_ACTIONS,
  MAX_CASE_DECISIONS,
  MAX_CASE_EVIDENCE_PINS,
  mergeCaseActions,
  normalizeCaseActions,
  normalizeCaseClosureHistory,
  normalizeCaseDecisions,
  normalizeCaseEvidencePins,
  normalizeCaseObservedEffectHistory,
  normalizeCaseSightings,
  updateCaseAction,
  updateCaseAssertion,
} from '../frontend/src/lib/analysis/case-response-model.ts';
import * as caseModel from '../frontend/src/lib/analysis/case-model.ts';
import { requiredValue } from './value-assertions.mts';

const NOW = '2026-07-28T01:00:00.000Z';
const LATER = '2026-07-29T01:00:00.000Z';
const NEXT = '2026-07-30T01:00:00.000Z';
const LATEST = '2026-07-31T01:00:00.000Z';

describe('case response record normalization', () => {
  test('pins keep bounded provenance and explicit completeness', () => {
    const pins = appendCaseEvidencePin([], {
      label: 'Observed form',
      value: 'A credential form was present.',
      source: 'deep lookup',
      observedAt: NOW,
      completeness: 'partial',
      limitations: ['Rendered JavaScript was not evaluated.'],
    }, NOW);
    const pin = requiredValue(pins[0]);
    assert.equal(pin.label, 'Observed form');
    assert.equal(pin.completeness, 'partial');
    assert.deepEqual(pin.limitations, ['Rendered JavaScript was not evaluated.']);
  });

  test('decisions retain only valid references to existing pins', () => {
    const pins = appendCaseEvidencePin([], { label: 'Fact', value: 'Observed value' }, NOW);
    const pin = requiredValue(pins[0]);
    const decisions = appendCaseDecision([], {
      summary: 'Escalate for review',
      rationale: 'The selected evidence warrants a provider review.',
      evidencePinIds: [pin.id, 'missing-pin'],
    }, NOW, new Set([pin.id]));
    assert.deepEqual(requiredValue(decisions[0]).evidencePinIds, [pin.id]);
  });

  test('checkpoints append bounded selected facts with typed provenance metadata', () => {
    const pins = appendCaseEvidencePins([], [
      {
        checkpointId: 'checkpoint-one',
        field: 'dns.mx',
        category: 'dns',
        label: 'MX hosts',
        value: 'mx.response.example',
        source: 'DNS',
        sourceState: 'success',
        sourceSchema: {
          collection: 'lookup_result',
          schema: 'whoisleuth.lookup-evidence',
          version: LOOKUP_EVIDENCE_SCHEMA_VERSION,
        },
        observedAt: NOW,
        collectionDepth: 'deep',
        completeness: 'complete',
        truncated: false,
      },
      {
        checkpointId: 'checkpoint-one',
        field: 'tls.protocol',
        category: 'tls',
        label: 'TLS protocol',
        value: 'TLSv1.3',
        source: 'TLS',
        sourceState: 'partial',
        observedAt: NOW,
        collectionDepth: 'deep',
        completeness: 'partial',
        truncated: true,
      },
    ], NOW);
    assert.equal(pins.length, 2);
    assert.equal(pins[0]?.field, 'dns.mx');
    assert.equal(pins[0]?.sourceSchema?.version, LOOKUP_EVIDENCE_SCHEMA_VERSION);
    assert.equal(pins[1]?.truncated, true);
  });

  test('actions retain explicit legal transitions and derive mutable projections from history', () => {
    let actions = appendCaseAction([], {
      type: 'registrar_report',
      recipient: 'abuse@example.test',
      contactSource: 'registrar RDAP',
      contactLimitations: ['Contact monitoring is not verified.'],
    }, NOW);
    const action = requiredValue(actions[0]);
    assert.equal(action.state, 'drafting');
    assert.equal(Object.hasOwn(requiredValue(action.history[0]), 'actionId'), false);
    assert.throws(() => appendCaseActionTransition(actions, action.id, {
      nextState: 'ready_for_review',
      sourceClass: 'provider',
      provenance: 'provider_pre_submission_review',
    }, LATER), /not permitted/iu);
    actions = appendCaseActionTransition(actions, action.id, {
      nextState: 'ready_for_review',
      occurredAt: LATER,
      sourceClass: 'analyst',
      provenance: 'analyst_readiness_review',
      evidencePinId: 'pin-one',
      limitations: ['Recipient monitoring remains unverified.'],
    }, LATER);
    assert.equal(requiredValue(actions[0]).state, 'ready_for_review');
    assert.throws(() => appendCaseActionTransition(actions, action.id, {
      nextState: 'submitted',
      sourceClass: 'analyst',
    }, NEXT), /not permitted/iu);
    actions = appendCaseActionTransition(actions, action.id, {
      nextState: 'reviewed', sourceClass: 'analyst', provenance: 'analyst_content_review',
    }, NEXT);
    actions = appendCaseActionTransition(actions, action.id, {
      nextState: 'authorised', sourceClass: 'analyst', provenance: 'explicit_analyst_authorisation',
    }, '2026-07-30T02:00:00.000Z');
    assert.throws(() => appendCaseActionTransition(actions, action.id, {
      nextState: 'submitted', sourceClass: 'analyst', provenance: 'submission_with_conflated_outcome',
      providerOutcome: 'accepted_for_review',
    }, '2026-07-30T03:00:00.000Z'), /invalid time, provider outcome, or provenance/iu);
    actions = appendCaseActionTransition(actions, action.id, {
      nextState: 'submitted', sourceClass: 'analyst', provenance: 'deliberate_external_submission',
    }, '2026-07-30T03:00:00.000Z');
    assert.throws(() => appendCaseActionTransition(actions, action.id, {
      nextState: 'submitted', sourceClass: 'provider', provenance: 'misattributed_no_response',
      providerOutcome: 'no_response',
    }, '2026-07-30T03:30:00.000Z'), /explicit analyst transition/iu);
    actions = appendCaseActionTransition(actions, action.id, {
      nextState: 'acknowledged',
      sourceClass: 'provider',
      provenance: 'provider_acknowledgement',
      reference: 'CASE-123',
      providerOutcome: 'accepted_for_review',
      outcomeDetail: 'Provider acknowledged receipt for review.',
    }, LATEST);
    const updated = requiredValue(actions[0]);
    assert.equal(updated.state, 'acknowledged');
    assert.equal(updated.reference, 'CASE-123');
    assert.equal(updated.providerOutcome, 'accepted_for_review');
    assert.equal(updated.history.length, 6);
    assert.equal(updated.history[1]?.occurredAt, LATER);
    assert.equal(updated.history[1]?.evidencePinId, 'pin-one');
    assert.equal(new Set(updated.history.map((event) => event.id)).size, updated.history.length);
    assert.equal(updated.history.every((event) => event.applied), true);

    assert.throws(() => updateCaseAction(actions, {
      id: action.id, state: 'terminal', reference: 'rewritten', providerOutcome: 'duplicate',
    }, LATEST), /append-only action transition/iu);
    assert.throws(() => updateCaseAction(actions, {
      id: action.id, recipient: 'Rewritten response desk',
    }, LATEST), /cannot be rewritten.*follow-on action/iu);

    let withdrawn = appendCaseAction([], { recipient: 'Cancelled draft owner' }, NOW);
    const withdrawnId = requiredValue(withdrawn[0]).id;
    assert.throws(() => appendCaseActionTransition(withdrawn, withdrawnId, {
      nextState: 'terminal', sourceClass: 'analyst', provenance: 'analyst_cancelled_draft',
    }, LATER), /invalid time, provider outcome, or provenance/iu);
    withdrawn = appendCaseActionTransition(withdrawn, withdrawnId, {
      nextState: 'terminal', sourceClass: 'analyst', provenance: 'analyst_withdrawal',
      providerOutcome: 'withdrawn', outcomeDetail: 'The analyst withdrew the draft before authorisation.',
    }, LATER);
    assert.equal(requiredValue(withdrawn[0]).state, 'terminal');
    assert.equal(requiredValue(withdrawn[0]).providerOutcome, 'withdrawn');
  });

  test('action summaries separate each explicit state, deadlines, and typed provider outcomes', () => {
    let actions = appendCaseAction([], {
      type: 'registrar_report', recipient: 'Registrar response desk',
      dueAt: '2026-07-27T01:00:00.000Z', followUpAt: NOW,
    }, NOW);
    const firstId = requiredValue(actions[0]).id;
    for (const [index, nextState] of (['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const).entries()) {
      actions = appendCaseActionTransition(actions, firstId, {
        nextState, sourceClass: 'analyst', provenance: `analyst_${nextState}`,
      }, new Date(Date.parse(NOW) + (index + 1) * 60_000).toISOString());
    }
    actions = appendCaseAction(actions, {
      type: 'registry_report', recipient: 'Registry response desk',
    }, '2026-07-28T02:00:00.000Z');
    const secondId = requiredValue(actions[1]).id;
    for (const [index, nextState] of (['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const).entries()) {
      actions = appendCaseActionTransition(actions, secondId, {
        nextState, sourceClass: 'analyst', provenance: `analyst_${nextState}`,
      }, new Date(Date.parse(NOW) + (index + 61) * 60_000).toISOString());
    }
    actions = appendCaseActionTransition(actions, secondId, {
      nextState: 'acknowledged', sourceClass: 'provider', provenance: 'provider_response',
      providerOutcome: 'partially_remediated', outcomeDetail: 'Provider reported a partial change.',
    }, NEXT);
    actions = appendCaseActionTransition(actions, secondId, {
      nextState: 'terminal', sourceClass: 'provider', provenance: 'provider_terminal_handling',
      providerOutcome: 'provider_reports_resolved', outcomeDetail: 'Provider reported resolution.',
    }, LATEST);
    const summary = buildCaseActionOutcomeSummary(actions, LATER);
    assert.deepEqual({
      total: summary.total,
      active: summary.active,
      drafting: summary.drafting,
      readyForReview: summary.readyForReview,
      reviewed: summary.reviewed,
      authorised: summary.authorised,
      submitted: summary.submitted,
      acknowledged: summary.acknowledged,
      terminal: summary.terminal,
      overdue: summary.overdue,
      followUpDue: summary.followUpDue,
      withProviderOutcome: summary.withProviderOutcome,
    }, {
      total: 2,
      active: 1,
      drafting: 0,
      readyForReview: 0,
      reviewed: 0,
      authorised: 0,
      submitted: 1,
      acknowledged: 0,
      terminal: 1,
      overdue: 1,
      followUpDue: 1,
      withProviderOutcome: 1,
    });
    assert.equal(summary.latestOutcomes[0]?.providerOutcome, 'provider_reports_resolved');
    assert.equal(summary.latestOutcomes[0]?.outcomeDetail, 'Provider reported resolution.');
  });

  test('material edits append an invalidation instead of rewriting reviewed history', () => {
    let actions = appendCaseAction([], { recipient: 'Initial review desk' }, NOW);
    const id = requiredValue(actions[0]).id;
    actions = appendCaseActionTransition(actions, id, { nextState: 'ready_for_review' }, LATER);
    actions = appendCaseActionTransition(actions, id, { nextState: 'reviewed' }, NEXT);
    const beforeIds = requiredValue(actions[0]).history.map((event) => event.id);
    actions = updateCaseAction(actions, { id, recipient: 'Changed review desk' }, LATEST);
    const changed = requiredValue(actions[0]);
    assert.equal(changed.state, 'drafting');
    assert.deepEqual(changed.history.slice(0, beforeIds.length).map((event) => event.id), beforeIds);
    assert.equal(changed.history.at(-1)?.provenance, 'material_action_change');
    assert.match(changed.history.at(-1)?.limitations.join(' ') ?? '', /prior readiness.*no longer applies/iu);
  });

  test('migrates a v12 action as one deterministic legacy snapshot without inventing a sequence', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/case-v12-response-lifecycle.json', import.meta.url), 'utf8'));
    const raw = fixture.cases[0].actions;
    raw[0].providerOutcome = 'accepted_for_review';
    const first = normalizeCaseActions(raw, fixture.cases[0].updatedAt, { sourceVersion: 12, legacyTimestamps: true });
    const second = normalizeCaseActions(first, fixture.cases[0].updatedAt, { sourceVersion: 13 });
    const migrated = requiredValue(first[0]);
    assert.equal(migrated.history.length, 1);
    assert.equal(migrated.history[0]?.previousState, null);
    assert.equal(migrated.history[0]?.nextState, 'acknowledged');
    assert.equal(migrated.history[0]?.occurredAt, '2026-08-01T12:00:00.000Z');
    assert.equal(migrated.history[0]?.provenance, 'case_v12_legacy_snapshot');
    assert.equal(migrated.reference, 'LEGACY-RESPONSE-42');
    assert.equal(migrated.providerOutcome, null);
    assert.equal(migrated.outcome, 'A provider acknowledgement was recorded.');
    assert.equal(migrated.createdAt, '2026-07-28T12:00:00.000Z');
    assert.deepEqual(migrated.contactLimitations, ['Route freshness was not retained.']);
    assert.match(migrated.history[0]?.limitations.join(' ') ?? '', /pre-v13 transition history is unavailable/iu);
    assert.deepEqual(second, first);
  });

  test('merges action histories by stable event identity and reports bounded omissions', () => {
    let actions = appendCaseAction([], { recipient: 'Concurrent review desk' }, NOW);
    const id = requiredValue(actions[0]).id;
    const local = appendCaseActionTransition(actions, id, { nextState: 'ready_for_review' }, LATER);
    const duplicate = mergeCaseActions(local, structuredClone(local), NEXT);
    assert.deepEqual(duplicate, local);
    assert.equal(requiredValue(duplicate[0]).history.length, 2);

    const concurrent = appendCaseActionTransition(actions, id, {
      nextState: 'ready_for_review', occurredAt: LATER, provenance: 'concurrent_analyst_review',
    }, LATER);
    const merged = mergeCaseActions(local, concurrent, NEXT);
    const mergedAction = requiredValue(merged[0]);
    assert.equal(mergedAction.history.length, 3);
    assert.equal(new Set(mergedAction.history.map((event) => event.id)).size, 3);
    assert.equal(mergedAction.history.filter((event) => event.nextState === 'ready_for_review' && event.applied).length, 1);
    assert.equal(mergedAction.history.filter((event) => event.nextState === 'ready_for_review' && !event.applied).length, 1);
    assert.match(mergedAction.historyLimitations.join(' '), /retained concurrent transition.*not applied/iu);
    assert.deepEqual(mergeCaseActions(merged, concurrent, LATEST), merged);

    const seed = requiredValue(duplicate[0]);
    const oversized = normalizeCaseActions([{
      ...seed,
      history: Array.from({ length: MAX_CASE_ACTION_EVENTS_PER_ACTION + 7 }, (_, index) => ({
        ...seed.history[0],
        id: `event-${String(index).padStart(3, '0')}`,
        previousState: index === 0 ? null : 'submitted',
        nextState: index === 0 ? 'drafting' : 'submitted',
        sourceClass: index === 0 ? 'analyst' : 'provider',
        occurredAt: new Date(Date.parse(NOW) + index * 1_000).toISOString(),
      })),
    }], LATEST, { sourceVersion: 13 });
    assert.equal(requiredValue(oversized[0]).history.length <= MAX_CASE_ACTION_EVENTS_PER_ACTION, true);
    assert.equal(requiredValue(oversized[0]).historyOmitted > 0, true);
    assert.match(requiredValue(oversized[0]).historyLimitations.join(' '), /omitted/iu);
  });

  test('normalises malformed and conflicting lifecycle histories idempotently with explicit omissions', () => {
    const seed = requiredValue(appendCaseAction([], { recipient: 'Bounded lifecycle desk' }, NOW)[0]);
    const initial = requiredValue(seed.history[0]);
    const actions = normalizeCaseActions([{
      ...seed,
      history: [
        initial,
        { ...initial, provenance: 'conflicting_same_identity' },
        {
          ...initial, id: 'non-analyst-review-event', previousState: 'drafting', nextState: 'ready_for_review',
          occurredAt: LATER, sourceClass: 'import', provenance: 'imported_readiness_claim',
        },
        { id: 'malformed-event' },
      ],
    }], LATEST, { sourceVersion: 13 });
    const action = requiredValue(actions[0]);
    assert.equal(action.historyOmitted, 3);
    assert.match(action.historyLimitations.join(' '), /3 earlier action transition events omitted/iu);
    assert.match(action.historyLimitations.join(' '), /malformed or illegal/iu);
    assert.match(action.historyLimitations.join(' '), /conflicting duplicate event identity/iu);
    assert.deepEqual(normalizeCaseActions(actions, LATEST, { sourceVersion: 13 }), actions);

    const review = {
      id: 'effect-review-shared', state: 'changed', observedAt: NEXT, sourceClass: 'analyst',
      source: 'Independent fixture review', completeness: 'partial', limitations: [],
      evidencePinId: null, sightingId: null, followUpAt: null, createdAt: NEXT,
    };
    const effects = normalizeCaseObservedEffectHistory({
      reviews: [review, { ...review, state: 'still_observed' }, { id: 'malformed-review' }],
    }, LATEST);
    assert.equal(effects.reviews.length, 1);
    assert.equal(effects.omitted, 2);
    assert.match(effects.limitations.join(' '), /malformed or unlinked observed-effect review/iu);
    assert.match(effects.limitations.join(' '), /conflicting observed-effect review identity/iu);
    assert.deepEqual(normalizeCaseObservedEffectHistory(effects, LATEST), effects);

    const closure = {
      id: 'closure-shared', reason: 'risk_accepted', summary: 'Fixture risk acceptance.',
      observedEffectReviewId: null, actionId: null, limitations: [], createdAt: LATEST,
    };
    const closures = normalizeCaseClosureHistory({
      records: [closure, { ...closure, summary: 'Conflicting fixture risk acceptance.' }, { id: 'malformed-closure' }],
    }, LATEST);
    assert.equal(closures.records.length, 1);
    assert.equal(closures.omitted, 2);
    assert.match(closures.limitations.join(' '), /malformed, unsupported, or unlinked closure record/iu);
    assert.match(closures.limitations.join(' '), /conflicting closure record identity/iu);
    assert.deepEqual(normalizeCaseClosureHistory(closures, LATEST), closures);
  });

  test('enforces per-action and per-Case response-history byte bounds with stable omission reporting', () => {
    const repeatedDetail = 'Bounded provider detail. '.repeat(100);
    const rawActions = Array.from({ length: MAX_CASE_ACTIONS }, (_, actionIndex) => ({
      id: `bounded-action-${actionIndex}`,
      type: 'registrar_report',
      recipient: `Bounded response owner ${actionIndex}`,
      contactSource: 'fixture policy',
      contactLimitations: [],
      createdAt: new Date(Date.parse(NOW) + actionIndex * 1_000).toISOString(),
      metadataUpdatedAt: new Date(Date.parse(NOW) + actionIndex * 1_000).toISOString(),
      history: Array.from({ length: MAX_CASE_ACTION_EVENTS_PER_ACTION }, (_, eventIndex) => ({
        id: `bounded-event-${actionIndex}-${eventIndex}`,
        previousState: eventIndex === 0 ? null
          : eventIndex === 1 ? 'drafting'
            : eventIndex === 2 ? 'ready_for_review'
              : eventIndex === 3 ? 'reviewed'
                : eventIndex === 4 ? 'authorised' : 'submitted',
        nextState: eventIndex === 0 ? 'drafting'
          : eventIndex === 1 ? 'ready_for_review'
            : eventIndex === 2 ? 'reviewed'
              : eventIndex === 3 ? 'authorised' : 'submitted',
        occurredAt: new Date(Date.parse(NOW) + actionIndex * 1_000 + eventIndex).toISOString(),
        sourceClass: eventIndex <= 4 ? 'analyst' : 'provider',
        provenance: eventIndex <= 4 ? 'analyst_fixture_transition' : 'provider_fixture_update',
        reference: null,
        evidencePinId: null,
        limitations: [],
        providerOutcome: eventIndex <= 4 ? null : 'accepted_for_review',
        outcomeDetail: eventIndex <= 4 ? null : repeatedDetail,
        originActionId: null,
      })),
    }));
    const bounded = normalizeCaseActions(rawActions, LATEST, { sourceVersion: 13 });
    const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    assert.equal(bounded.every((action) => encoded(action.history) <= MAX_CASE_ACTION_BYTES), true);
    assert.equal(encoded(bounded) <= MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE, true);
    assert.equal(bounded.reduce((total, action) => total + action.historyOmitted, 0) > 0, true);
    assert.match(bounded.flatMap((action) => action.historyLimitations).join(' '), /transition events? omitted/iu);
    assert.deepEqual(normalizeCaseActions(bounded, LATEST, { sourceVersion: 13 }), bounded);
  });

  test('retains the latest typed provider outcome across later detail-only events', () => {
    let actions = appendCaseAction([], { recipient: 'Provider outcome desk' }, NOW);
    const actionId = requiredValue(actions[0]).id;
    for (const [index, nextState] of (['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const).entries()) {
      actions = appendCaseActionTransition(actions, actionId, { nextState, sourceClass: 'analyst' },
        new Date(Date.parse(NOW) + (index + 1) * 60_000).toISOString());
    }
    actions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider', providerOutcome: 'provider_reports_resolved',
      outcomeDetail: 'The provider reported resolution.', provenance: 'provider_reported_resolution',
    }, LATER);
    actions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider',
      outcomeDetail: 'A later response supplied procedural detail only.', provenance: 'provider_detail_only',
    }, NEXT);
    const action = requiredValue(actions[0]);
    assert.equal(action.providerOutcome, 'provider_reports_resolved');
    assert.equal(action.outcome, 'The provider reported resolution.');
    const closures = appendCaseClosure(normalizeCaseClosureHistory(undefined, NOW), {
      reason: 'provider_reported_resolution_not_independently_checked',
      summary: 'Closed on the typed provider report without an independent check.', actionId,
    }, LATEST, normalizeCaseObservedEffectHistory(undefined, NOW), actions);
    assert.equal(closures.records[0]?.actionId, actionId);

    actions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider', providerOutcome: 'more_information_requested',
      provenance: 'later_provider_update',
    }, new Date(Date.parse(LATEST) + 60_000).toISOString());
    const retained = normalizeCaseClosureHistory(
      closures,
      LATEST,
      new Set<string>(),
      new Set([actionId]),
      {},
      buildCaseClosureLinkContext(normalizeCaseObservedEffectHistory(undefined, NOW), actions),
    );
    assert.equal(retained.records[0]?.id, closures.records[0]?.id);
  });

  test('rejects a closure that predates its linked review or provider-resolution event', () => {
    const reviewId = 'review-future';
    const actionId = 'action-future';
    const linkContext = {
      reviewEvidence: new Map([[reviewId, { state: 'changed' as const, observedAt: LATEST, createdAt: LATEST }]]),
      providerResolutionEvents: new Map([[actionId, [{ eventId: 'event-future', occurredAt: LATEST }]]]),
    };
    const closures = normalizeCaseClosureHistory({ records: [{
      id: 'closure-before-review', reason: 'infrastructure_changed', summary: 'Invalid temporal link.',
      observedEffectReviewId: reviewId, actionId: null, limitations: [], createdAt: NEXT,
    }, {
      id: 'closure-before-provider', reason: 'provider_reported_resolution_not_independently_checked',
      summary: 'Invalid temporal provider link.', observedEffectReviewId: null, actionId,
      limitations: [], createdAt: NEXT,
    }] }, LATEST, new Set([reviewId]), new Set([actionId]), {}, linkContext);
    assert.equal(closures.records.length, 0);
    assert.equal(closures.omitted, 2);
  });

  test('omits imported closure reasons whose typed evidence links do not support them', () => {
    const reviewEvidence = new Map([['review-changed', {
      state: 'changed' as const,
      observedAt: NEXT,
      createdAt: NEXT,
    }]]);
    const providerResolutionEvents = new Map([['action-accepted', []]]);
    const linkContext = { reviewEvidence, providerResolutionEvents };
    const closures = normalizeCaseClosureHistory({
      records: [{
        id: 'closure-wrong-review', reason: 'independently_not_reproduced',
        summary: 'The linked review has a different state.', observedEffectReviewId: 'review-changed',
        actionId: null, limitations: [], createdAt: NEXT,
      }, {
        id: 'closure-wrong-outcome', reason: 'provider_reported_resolution_not_independently_checked',
        summary: 'The linked action has a different provider outcome.', observedEffectReviewId: null,
        actionId: 'action-accepted', limitations: [], createdAt: LATEST,
      }],
    }, LATEST, new Set(reviewEvidence.keys()), new Set(providerResolutionEvents.keys()), {}, linkContext);
    assert.equal(closures.records.length, 0);
    assert.equal(closures.omitted, 2);
    assert.match(closures.limitations.join(' '), /unlinked closure records omitted/iu);
    assert.deepEqual(
      normalizeCaseClosureHistory(closures, LATEST, new Set(reviewEvidence.keys()), new Set(providerResolutionEvents.keys()), {}, linkContext),
      closures,
    );

    const normalized = caseModel.normalizeCase({
      domain: 'invalid-closure.example', status: 'resolved', observedEffects: {
        reviews: [{
          id: 'review-changed', state: 'changed', observedAt: NEXT, sourceClass: 'analyst',
          source: 'Independent fixture review', completeness: 'partial', limitations: [],
          evidencePinId: null, sightingId: null, followUpAt: null, createdAt: NEXT,
        }],
      },
      closures: { records: [{
        id: 'closure-wrong-review', reason: 'independently_not_reproduced',
        summary: 'The linked review has a different state.', observedEffectReviewId: 'review-changed',
        actionId: null, limitations: [], createdAt: LATEST,
      }] },
      createdAt: NOW, updatedAt: LATEST,
    }, undefined, LATEST, 13);
    assert.equal(normalized?.status, 'reviewing');
    assert.equal(normalized?.closures.records.length, 0);
    assert.equal(normalized?.closures.omitted, 1);
  });

  test('keeps provider workflow separate from independent observed effect and deliberate closure', () => {
    let actions = appendCaseAction([], { recipient: 'Provider response desk' }, NOW);
    const actionId = requiredValue(actions[0]).id;
    for (const [index, nextState] of (['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const).entries()) {
      actions = appendCaseActionTransition(actions, actionId, { nextState, sourceClass: 'analyst' },
        new Date(Date.parse(NOW) + (index + 1) * 60_000).toISOString());
    }
    actions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider', providerOutcome: 'provider_reports_resolved',
      provenance: 'provider_reported_outcome',
    }, LATER);
    const emptyEffects = normalizeCaseObservedEffectHistory(undefined, NOW);
    const emptyClosures = normalizeCaseClosureHistory(undefined, NOW);
    const providerOnly = buildCaseResponseLifecycleSummary({ actions, observedEffects: emptyEffects, closures: emptyClosures });
    assert.equal(providerOnly.providerOutcomeState, 'available');
    assert.equal(providerOnly.latestProviderOutcome?.occurredAt, LATER);
    assert.equal(providerOnly.observedChangeState, 'missing');
    assert.equal(providerOnly.latestObservedEffect, null);
    assert.equal(providerOnly.latestObservedChangeAt, null);

    const effects = appendCaseObservedEffectReview(emptyEffects, {
      state: 'changed', observedAt: NEXT, sourceClass: 'analyst', source: 'Independent fixture review',
      completeness: 'partial', limitations: ['Only the retained path was reviewed.'], followUpAt: LATEST,
    }, NEXT);
    const reviewId = requiredValue(effects.reviews[0]).id;
    assert.throws(() => appendCaseClosure(emptyClosures, {
      reason: 'independently_not_reproduced', summary: 'Would require a not-reproduced review.', observedEffectReviewId: reviewId,
    }, LATEST, effects, actions), /requires a linked independent not-reproduced review/iu);
    const closures = appendCaseClosure(emptyClosures, {
      reason: 'infrastructure_changed', summary: 'Independent review recorded changed infrastructure.',
      observedEffectReviewId: reviewId, limitations: ['This does not establish safety.'],
    }, LATEST, effects, actions);
    const lifecycle = buildCaseResponseLifecycleSummary({ actions, observedEffects: effects, closures });
    assert.equal(lifecycle.providerOutcomeState, 'available');
    assert.equal(lifecycle.latestProviderOutcome?.occurredAt, LATER);
    assert.equal(lifecycle.observedChangeState, 'available');
    assert.equal(lifecycle.latestObservedChangeAt, NEXT);
    assert.equal(lifecycle.latestClosure?.createdAt, LATEST);
    assert.notEqual(lifecycle.latestProviderOutcome?.occurredAt, lifecycle.latestObservedChangeAt);

    let ambiguousActions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider', providerOutcome: 'more_information_requested',
      provenance: 'first_same_time_provider_event',
    }, LATEST);
    ambiguousActions = appendCaseActionTransition(ambiguousActions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider', providerOutcome: 'referred_elsewhere',
      provenance: 'second_same_time_provider_event',
    }, LATEST);
    const ambiguousEffects = appendCaseObservedEffectReview(effects, {
      state: 'changed', observedAt: NEXT, sourceClass: 'analyst', source: 'Second independent fixture review',
      completeness: 'partial', limitations: ['The same observation time prevents an ordered change measure.'],
    }, LATEST);
    const ambiguous = buildCaseResponseLifecycleSummary({ actions: ambiguousActions, observedEffects: ambiguousEffects });
    assert.equal(ambiguous.providerOutcomeState, 'ambiguous');
    assert.equal(ambiguous.latestProviderOutcome, null);
    assert.equal(ambiguous.observedChangeState, 'ambiguous');
    assert.equal(ambiguous.latestObservedChangeAt, null);
  });

  test('keeps analyst assertions distinct from evidence and derives an explicit trail', () => {
    const pins = appendCaseEvidencePin([], { label: 'Registration', value: 'Observed as registered' }, NOW);
    const pin = requiredValue(pins[0]);
    const assertions = appendCaseAssertion([], {
      kind: 'hypothesis',
      statement: 'The domain may be related to the reviewed campaign.',
      rationale: 'Infrastructure overlap needs independent verification.',
      evidencePinIds: [pin.id, 'missing-pin'],
    }, NOW, new Set([pin.id]));
    const assertion = requiredValue(assertions[0]);
    assert.equal(assertion.kind, 'hypothesis');
    assert.deepEqual(assertion.evidencePinIds, [pin.id]);
    assert.deepEqual(assertion.evidenceRelations, [{ evidencePinId: pin.id, stance: 'supports' }]);
    const resolved = updateCaseAssertion(assertions, { id: assertion.id, state: 'resolved' }, LATER, new Set([pin.id]));
    assert.equal(requiredValue(resolved[0]).state, 'resolved');

    const manualTrail = appendCaseManualTrailEvent([], {
      kind: 'pivot',
      summary: 'Reviewed the certificate relationship.',
      target: 'certificate fingerprint',
    }, LATER);
    const trail = buildCaseInvestigationTrail({ assertions: resolved, manualTrail });
    assert.equal(trail.length, 2);
    assert.equal(trail[0]?.kind, 'assertion');
    assert.equal(trail[1]?.kind, 'manual');
  });

  test('retains explicit supporting, contradicting, and unresolved hypothesis evidence', () => {
    const pins = [
      requiredValue(appendCaseEvidencePin([], { label: 'Registration', value: 'Observed' }, NOW)[0]),
      requiredValue(appendCaseEvidencePin([], { label: 'Hosting', value: 'Different network' }, NOW)[0]),
      requiredValue(appendCaseEvidencePin([], { label: 'Certificate', value: 'Incomplete' }, NOW)[0]),
    ];
    const validIds = new Set(pins.map((pin) => pin.id));
    const assertions = appendCaseAssertion([], {
      kind: 'hypothesis',
      statement: 'The observations may describe related infrastructure.',
      evidenceRelations: [
        { evidencePinId: pins[0]?.id, stance: 'supports' },
        { evidencePinId: pins[1]?.id, stance: 'contradicts' },
        { evidencePinId: pins[2]?.id, stance: 'unresolved' },
        { evidencePinId: 'missing-pin', stance: 'supports' },
      ],
    }, NOW, validIds);

    const assertion = requiredValue(assertions[0]);
    assert.deepEqual(assertion.evidenceRelations?.map((item) => item.stance), ['supports', 'contradicts', 'unresolved']);
    assert.deepEqual(assertion.evidencePinIds, pins.map((pin) => pin.id));
  });

  test('keeps deployment, provider, and analyst sighting states source-qualified', () => {
    const pin = requiredValue(appendCaseEvidencePin([], {
      label: 'Observed certificate',
      value: 'Leaf certificate fingerprint was retained.',
    }, NOW)[0]);
    const deployment = requiredValue(appendCaseSighting([], {
      state: 'observed_by_deployment',
      category: 'certificate',
      source: 'WHOISleuth deep lookup',
      observedAt: NOW,
      completeness: 'partial',
      evidencePinId: pin.id,
      limitations: ['One point-in-time handshake.'],
    }, NOW, new Set([pin.id]))[0]);
    const reviewed = requiredValue(appendCaseSighting([deployment], {
      state: 'not_reproduced',
      category: 'certificate',
      source: 'Manual analyst review',
      observedAt: LATER,
      completeness: 'inconclusive',
      evidencePinId: 'missing-pin',
    }, LATER, new Set([pin.id]))[1]);
    assert.equal(deployment.sourceClass, 'deployment');
    assert.equal(reviewed.sourceClass, 'analyst');
    assert.equal(reviewed.evidencePinId, null);
    assert.deepEqual(deployment.limitations, ['One point-in-time handshake.']);
    assert.equal(normalizeCaseSightings([{ state: 'missing', source: 'invalid' }], NOW).length, 0);
    const trail = buildCaseInvestigationTrail({ sightings: [deployment, reviewed] });
    assert.deepEqual(trail.map((item) => item.kind), ['sighting', 'sighting']);
  });

  test('collections reject malformed entries and enforce record caps', () => {
    const pins = Array.from({ length: MAX_CASE_EVIDENCE_PINS + 5 }, (_, index) => ({
      label: `Pin ${index}`,
      value: `Value ${index}`,
      createdAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    }));
    const decisions = Array.from({ length: MAX_CASE_DECISIONS + 5 }, (_, index) => ({
      summary: `Decision ${index}`,
      rationale: `Rationale ${index}`,
      createdAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    }));
    const actions = Array.from({ length: MAX_CASE_ACTIONS + 5 }, (_, index) => ({
      recipient: `owner-${index}`,
      createdAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    }));
    assert.equal(normalizeCaseEvidencePins([...pins, null, {}], NOW).length, MAX_CASE_EVIDENCE_PINS);
    assert.equal(normalizeCaseDecisions([...decisions, null, {}], NOW).length, MAX_CASE_DECISIONS);
    const boundedActions = normalizeCaseActions([...actions, null, {}], NOW);
    assert.equal(boundedActions.length, MAX_CASE_ACTIONS);
    assert.match(boundedActions[0]?.historyLimitations.join(' ') ?? '', /5 earlier response actions? omitted/iu);
    assert.throws(
      () => appendCaseAction(boundedActions, { recipient: 'one-more-owner' }, LATER),
      /at most 50 response actions.*No additional action was retained/iu,
    );
  });

  test('removes every control character from normalized analyst records', () => {
    const control = /[\u0000-\u001f\u007f]/u;
    const pin = requiredValue(appendCaseEvidencePin([], {
      label: 'Observed\rform\n\u0007',
      value: 'Credential\trequest\u007fdetected',
      source: 'deep\rlookup\n',
      limitations: ['Rendered\rcontent\nwas\u0007not evaluated.'],
    }, NOW)[0]);
    const decision = requiredValue(appendCaseDecision([], {
      summary: 'Escalate\rfor\nreview',
      rationale: 'Selected\tevidence\u007frequires review.',
    }, NOW)[0]);
    let actions = appendCaseAction([], {
      recipient: 'abuse@example.test\r\n\u0007',
      contactSource: 'registrar\tRDAP\u007f',
      contactLimitations: ['Monitoring\rstatus\nis\u0007unknown.'],
    }, NOW);
    const actionId = requiredValue(actions[0]).id;
    actions = appendCaseActionTransition(actions, actionId, { nextState: 'ready_for_review' }, '2026-07-28T01:01:00.000Z');
    actions = appendCaseActionTransition(actions, actionId, { nextState: 'reviewed' }, '2026-07-28T01:02:00.000Z');
    actions = appendCaseActionTransition(actions, actionId, { nextState: 'authorised' }, '2026-07-28T01:03:00.000Z');
    actions = appendCaseActionTransition(actions, actionId, { nextState: 'submitted' }, '2026-07-28T01:04:00.000Z');
    actions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider',
      reference: 'CASE\r123\n\u0007',
      outcomeDetail: 'Pending\tprovider\u007freview.',
      providerOutcome: 'accepted_for_review',
    }, LATER);
    const action = requiredValue(actions[0]);

    for (const value of [
      pin.label,
      pin.value,
      pin.source,
      ...pin.limitations,
      decision.summary,
      decision.rationale,
      action.recipient,
      action.contactSource,
      ...action.contactLimitations,
      action.reference ?? '',
      action.outcome ?? '',
    ]) {
      assert.doesNotMatch(value, control);
    }
  });
});

describe('case store integration', () => {
  test('new response records survive normalization, export, and import', () => {
    const created = caseModel.createCase({
      domain: 'response.example',
      evidencePin: { label: 'Observed URL', value: 'https://response.example/path', observedAt: NOW },
      decision: { summary: 'Review', rationale: 'An analyst review is required.' },
      action: { recipient: 'security@example.test', type: 'security_contact_report' },
      assertion: { kind: 'unknown', statement: 'The operator remains unknown.' },
      trailEvent: { kind: 'review', summary: 'Reviewed the retained evidence.' },
      sighting: { state: 'reported_by_provider', category: 'website', source: 'Reviewed provider report', observedAt: NOW },
    }, NOW);
    const payload = caseModel.buildCaseExport([created], NOW);
    const imported = requiredValue(caseModel.mergeCases([], payload).cases[0]);
    assert.equal(imported.evidencePins.length, 1);
    assert.equal(imported.decisions.length, 1);
    assert.equal(imported.actions.length, 1);
    assert.equal(imported.assertions.length, 1);
    assert.equal(imported.manualTrail.length, 1);
    assert.equal(imported.sightings.length, 1);
    assert.equal(imported.sightings[0]?.sourceClass, 'provider');
    assert.equal(imported.actions[0]?.type, 'security_contact_report');
  });

  test('updates append response records without replacing collected evidence', () => {
    const created = caseModel.createCase({
      domain: 'response.example',
      evidence: { availability: 'registered', capturedAt: NOW },
    }, NOW);
    const result = caseModel.updateCase([created], created.id, {
      evidencePin: { label: 'Registration', value: 'Registered', observedAt: NOW },
      decision: { summary: 'Monitor', rationale: 'Retain for comparison.' },
      action: { recipient: 'internal queue', type: 'internal_review' },
      assertion: { kind: 'next_step', statement: 'Verify the contact destination.' },
      trailEvent: { kind: 'handoff', summary: 'Handed off for internal review.' },
      sighting: { state: 'analyst_confirmed', category: 'website', source: 'Manual analyst review', observedAt: LATER },
    }, LATER);
    assert.equal(result.record.evidenceHistory.length, 1);
    assert.equal(result.record.evidencePins.length, 1);
    assert.equal(result.record.decisions.length, 1);
    assert.equal(result.record.actions.length, 1);
    assert.equal(result.record.assertions.length, 1);
    assert.equal(result.record.manualTrail.length, 1);
    assert.equal(result.record.sightings.length, 1);
  });
});

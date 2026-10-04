// Independent observed effects, linked closures and lifecycle summaries.

import {
  MAX_CASE_CLOSURES,
  MAX_CASE_OBSERVED_EFFECT_REVIEWS,
  MAX_RESPONSE_LABEL_LENGTH,
  MAX_RESPONSE_RATIONALE_LENGTH,
} from '../contracts/case-portability.mts';
import {
  latestObservationCohort,
} from '../evidence/latest-observations.mts';
import { readCaseRecheckAnswerContext, assertRecheckNonReproduction, COMPARATIVE_CASE_OBJECT_OUTCOMES } from './case-recheck-model.mts';
import { readCaseResponseObject, readCaseResponseObjectOutcome, assertCaseObjectOutcome, sameCaseResponseObject, type CaseResponseObject } from './case-response-object.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import {
  CASE_CLOSURE_REASONS,
  CASE_OBSERVED_EFFECT_SOURCE_CLASSES,
  CASE_OBSERVED_EFFECT_STATES,
  type CaseActionRecord,
  type CaseClosureHistory,
  type CaseClosureLinkContext,
  type CaseClosureReason,
  type CaseClosureRecord,
  type CaseObservedEffectHistory,
  type CaseObservedEffectReview,
  type CaseObservedEffectSourceClass,
  type CaseObservedEffectState,
  type CasePinCompleteness,
  type CaseEvidencePin,
  type CaseResponseLifecycleSummary,
  type CaseResponseTimestampOptions,
} from './case-response-records.mts';
import {
  COMPLETENESS,
  SAFE_ID_RE,
  boundedCounter,
  compareCodeUnits,
  freshId,
  iso,
  lifecycleLimitations,
  limitations,
  optionalIso,
  record,
  safeId,
  text,
} from './case-response-values.mts';

const OBSERVED_EFFECT_STATES = new Set<string>(CASE_OBSERVED_EFFECT_STATES);

const OBSERVED_EFFECT_SOURCE_CLASSES = new Set<string>(CASE_OBSERVED_EFFECT_SOURCE_CLASSES);

const CLOSURE_REASONS = new Set<string>(CASE_CLOSURE_REASONS);

function normalizeObservedEffectReview(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  validSightingIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
): CaseObservedEffectReview | null {
  const item = record(raw);
  if (typeof item.state !== 'string' || !OBSERVED_EFFECT_STATES.has(item.state)) return null;
  if (typeof item.sourceClass !== 'string' || !OBSERVED_EFFECT_SOURCE_CLASSES.has(item.sourceClass)) return null;
  const source = text(item.source, MAX_RESPONSE_LABEL_LENGTH);
  const observedAt = optionalIso(item.observedAt, options);
  if (!source || !observedAt) return null;
  const createdAt = iso(item.createdAt, observedAt || fallback, options);
  const recheck = readCaseRecheckAnswerContext(item.recheck, options.sourceVersion);
  const responseObject = readCaseResponseObject(item.responseObject, options.sourceVersion);
  const objectOutcome = readCaseResponseObjectOutcome(item.objectOutcome, options.sourceVersion);
  assertCaseObjectOutcome(objectOutcome, responseObject);
  if (objectOutcome && (item.state === 'unavailable' || item.state === 'not_checked')) throw new TypeError('Unavailable or unchecked collection cannot establish an object outcome.');
  if (objectOutcome && COMPARATIVE_CASE_OBJECT_OUTCOMES.includes(objectOutcome)
    && (item.completeness !== 'complete' || !recheck?.responseObject || recheck.conditionsMatch !== 'comparable')) throw new TypeError('An independently observed object state change requires complete evidence and comparable exact-object conditions.');
  if (recheck?.responseObject && !sameCaseResponseObject(recheck.responseObject, responseObject)) throw new TypeError('The recheck answer and observation must concern the same exact object.');
  if (recheck && item.state === 'not_reproduced' && (item.completeness !== 'complete' || recheck.conditionsMatch !== 'comparable')) {
    throw new TypeError('A question cannot be marked not reproduced from incomplete evidence or unconfirmed comparison conditions.');
  }
  const evidencePinId = typeof item.evidencePinId === 'string'
    && SAFE_ID_RE.test(item.evidencePinId)
    && (!validPinIds || validPinIds.has(item.evidencePinId))
    ? item.evidencePinId
    : null;
  const sightingId = typeof item.sightingId === 'string'
    && SAFE_ID_RE.test(item.sightingId)
    && (!validSightingIds || validSightingIds.has(item.sightingId))
    ? item.sightingId
    : null;
  const linkLimitations = [
    ...(item.evidencePinId != null && !evidencePinId ? ['A malformed or dangling evidence-pin reference was omitted from this independent review.'] : []),
    ...(item.sightingId != null && !sightingId ? ['A malformed or dangling sighting reference was omitted from this independent review.'] : []),
  ];
  return {
    id: safeId(item.id, 'effect-review', { state: item.state, source, observedAt, createdAt }),
    state: item.state as CaseObservedEffectState,
    observedAt,
    sourceClass: item.sourceClass as CaseObservedEffectSourceClass,
    source,
    completeness: typeof item.completeness === 'string' && COMPLETENESS.has(item.completeness)
      ? item.completeness as CasePinCompleteness
      : 'unknown',
    limitations: limitations([...linkLimitations, ...limitations(item.limitations)]),
    evidencePinId,
    sightingId,
    followUpAt: optionalIso(item.followUpAt, options),
    ...(recheck ? { recheck } : {}),
    ...(responseObject ? { responseObject } : {}),
    ...(objectOutcome ? { objectOutcome } : {}),
    createdAt,
  };
}

export function normalizeCaseObservedEffectHistory(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  validSightingIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
): CaseObservedEffectHistory {
  const root = record(raw);
  const source = Array.isArray(raw) ? raw : Array.isArray(root.reviews) ? root.reviews : [];
  const byId = new Map<string, CaseObservedEffectReview>();
  let invalid = 0;
  let duplicateConflict = 0;
  for (const item of source.slice(0, MAX_CASE_OBSERVED_EFFECT_REVIEWS * 4)) {
    const normalized = normalizeObservedEffectReview(item, fallback, validPinIds, validSightingIds, options);
    if (!normalized) {
      invalid += 1;
      continue;
    }
    const existing = byId.get(normalized.id);
    if (!existing) byId.set(normalized.id, normalized);
    else if (JSON.stringify(normalized) !== JSON.stringify(existing)) {
      duplicateConflict += 1;
      if (JSON.stringify(normalized) < JSON.stringify(existing)) byId.set(normalized.id, normalized);
    }
  }
  const all = [...byId.values()].sort((left, right) =>
    Date.parse(left.observedAt) - Date.parse(right.observedAt) || compareCodeUnits(left.id, right.id));
  invalid += Math.max(0, source.length - MAX_CASE_OBSERVED_EFFECT_REVIEWS * 4);
  const omitted = boundedCounter(root.omitted)
    + invalid
    + duplicateConflict
    + Math.max(0, all.length - MAX_CASE_OBSERVED_EFFECT_REVIEWS);
  const preV13HistoryUnavailable = options.sourceVersion != null && options.sourceVersion <= 12
    ? true
    : root.preV13HistoryUnavailable === true;
  const retainedLimitations = limitations(root.limitations).filter((item) =>
    !/^\d+ earlier observed-effect reviews? omitted by bounded retention\.$/u.test(item));
  return {
    reviews: all.slice(-MAX_CASE_OBSERVED_EFFECT_REVIEWS),
    omitted,
    preV13HistoryUnavailable,
    limitations: lifecycleLimitations([
      ...(omitted ? [`${omitted} earlier observed-effect review${omitted === 1 ? '' : 's'} omitted by bounded retention.`] : []),
      ...(invalid ? [`${invalid} malformed or unlinked observed-effect review${invalid === 1 ? '' : 's'} omitted during normalisation.`] : []),
      ...(duplicateConflict ? [`${duplicateConflict} conflicting observed-effect review identit${duplicateConflict === 1 ? 'y was' : 'ies were'} reconciled deterministically.`] : []),
      ...(preV13HistoryUnavailable ? ['Migrated from a pre-v13 Case; earlier independent observed-effect review history is unavailable.'] : []),
      'Observed-effect reviews are independent point-in-time records; provider workflow events do not create or replace them.',
      ...retainedLimitations,
    ]),
  };
}

export function appendCaseObservedEffectReview(
  current: CaseObservedEffectHistory,
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
  validSightingIds?: ReadonlySet<string>,
): CaseObservedEffectHistory {
  const item = record(raw);
  const created = normalizeObservedEffectReview({ ...item, id: freshId('effect-review'), createdAt: now }, now, validPinIds, validSightingIds);
  if (!created) throw new Error('An independent observed-effect review requires a valid state, time, source class, and source.');
  return normalizeCaseObservedEffectHistory({
    reviews: [...current.reviews, created],
    omitted: current.omitted,
    preV13HistoryUnavailable: current.preV13HistoryUnavailable,
    limitations: current.limitations,
  }, now, validPinIds, validSightingIds);
}

export function mergeCaseObservedEffectHistories(
  local: CaseObservedEffectHistory,
  imported: CaseObservedEffectHistory,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  validSightingIds?: ReadonlySet<string>,
): CaseObservedEffectHistory {
  return normalizeCaseObservedEffectHistory({
    reviews: [...local.reviews, ...imported.reviews],
    omitted: Math.max(local.omitted, imported.omitted),
    preV13HistoryUnavailable: local.preV13HistoryUnavailable || imported.preV13HistoryUnavailable,
    limitations: [...local.limitations, ...imported.limitations],
  }, fallback, validPinIds, validSightingIds);
}

function normalizeClosure(
  raw: unknown,
  fallback: string,
  validReviewIds?: ReadonlySet<string>,
  validActionIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
  linkContext: CaseClosureLinkContext = {},
): CaseClosureRecord | null {
  const item = record(raw);
  if (typeof item.reason !== 'string' || !CLOSURE_REASONS.has(item.reason)) return null;
  const reason = item.reason as CaseClosureReason;
  const summary = text(item.summary, MAX_RESPONSE_RATIONALE_LENGTH);
  if (!summary) return null;
  const createdAt = iso(item.createdAt, fallback, options);
  const responseObject = readCaseResponseObject(item.responseObject, options.sourceVersion);
  const observedEffectReviewId = typeof item.observedEffectReviewId === 'string'
    && SAFE_ID_RE.test(item.observedEffectReviewId)
    && (!validReviewIds || validReviewIds.has(item.observedEffectReviewId))
    ? item.observedEffectReviewId
    : null;
  const actionId = typeof item.actionId === 'string'
    && SAFE_ID_RE.test(item.actionId)
    && (!validActionIds || validActionIds.has(item.actionId))
    ? item.actionId
    : null;
  const linkedReview = observedEffectReviewId ? linkContext.reviewEvidence?.get(observedEffectReviewId) : undefined;
  const reviewPredatesClosure = linkedReview !== undefined
    && Date.parse(linkedReview.observedAt) <= Date.parse(createdAt)
    && Date.parse(linkedReview.createdAt) <= Date.parse(createdAt);
  if (linkContext.reviewEvidence && reason === 'independently_not_reproduced'
    && (!reviewPredatesClosure || linkedReview?.state !== 'not_reproduced')) return null;
  if (linkContext.reviewEvidence && reason === 'infrastructure_changed'
    && (!reviewPredatesClosure || linkedReview?.state !== 'changed')) return null;
  const linkedProviderEvents = actionId ? linkContext.providerResolutionEvents?.get(actionId) ?? [] : [];
  if (linkContext.providerResolutionEvents && reason === 'provider_reported_resolution_not_independently_checked'
    && !linkedProviderEvents.some((event) => Date.parse(event.occurredAt) <= Date.parse(createdAt)
      && (responseObject ? event.responseObjects?.some(object => sameCaseResponseObject(object, responseObject)) : !event.responseObjects?.length))) return null;
  const linkLimitations = [
    ...(item.observedEffectReviewId != null && !observedEffectReviewId ? ['A malformed or dangling observed-effect review reference was omitted from this closure.'] : []),
    ...(item.actionId != null && !actionId ? ['A malformed or dangling response-action reference was omitted from this closure.'] : []),
  ];
  return {
    id: safeId(item.id, 'case-closure', { reason: item.reason, summary, createdAt }),
    ...(responseObject === undefined ? {} : { responseObject }),
    reason,
    summary,
    observedEffectReviewId,
    actionId,
    limitations: limitations([...linkLimitations, ...limitations(item.limitations)]),
    createdAt,
  };
}

export function buildCaseClosureLinkContext(
  observedEffects: CaseObservedEffectHistory,
  actions: readonly CaseActionRecord[],
): CaseClosureLinkContext {
  return {
    reviewEvidence: new Map(observedEffects.reviews.map((review) => [review.id, {
      state: review.state,
      observedAt: review.observedAt,
      createdAt: review.createdAt,
    }] as const)),
    providerResolutionEvents: new Map(actions.map((action) => [action.id, action.history
      // Reconciliation can change projection, but not the identity of a retained
      // typed receipt supporting an already-authored historical decision.
      .filter((event) => event.providerOutcome === 'provider_reports_resolved')
      .map((event) => ({ eventId: event.id, occurredAt: event.occurredAt,
        ...(event.responseObjects === undefined ? {} : { responseObjects: event.responseObjects }) }))] as const)),
  };
}

export function normalizeCaseClosureHistory(
  raw: unknown,
  fallback: string,
  validReviewIds?: ReadonlySet<string>,
  validActionIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
  linkContext: CaseClosureLinkContext = {},
): CaseClosureHistory {
  const root = record(raw);
  const source = Array.isArray(raw) ? raw : Array.isArray(root.records) ? root.records : [];
  const byId = new Map<string, CaseClosureRecord>();
  let invalid = 0;
  let duplicateConflict = 0;
  for (const item of source.slice(0, MAX_CASE_CLOSURES * 4)) {
    const normalized = normalizeClosure(item, fallback, validReviewIds, validActionIds, options, linkContext);
    if (!normalized) {
      invalid += 1;
      continue;
    }
    const existing = byId.get(normalized.id);
    if (!existing) byId.set(normalized.id, normalized);
    else if (JSON.stringify(normalized) !== JSON.stringify(existing)) {
      duplicateConflict += 1;
      if (JSON.stringify(normalized) < JSON.stringify(existing)) byId.set(normalized.id, normalized);
    }
  }
  const all = [...byId.values()].sort((left, right) =>
    Date.parse(left.createdAt) - Date.parse(right.createdAt) || compareCodeUnits(left.id, right.id));
  invalid += Math.max(0, source.length - MAX_CASE_CLOSURES * 4);
  const omitted = boundedCounter(root.omitted)
    + invalid
    + duplicateConflict
    + Math.max(0, all.length - MAX_CASE_CLOSURES);
  const preV13HistoryUnavailable = options.sourceVersion != null && options.sourceVersion <= 12
    ? true
    : root.preV13HistoryUnavailable === true;
  const retainedLimitations = limitations(root.limitations).filter((item) =>
    !/^\d+ earlier closure records? omitted by bounded retention\.$/u.test(item));
  return {
    records: all.slice(-MAX_CASE_CLOSURES),
    omitted,
    preV13HistoryUnavailable,
    limitations: lifecycleLimitations([
      ...(omitted ? [`${omitted} earlier closure record${omitted === 1 ? '' : 's'} omitted by bounded retention.`] : []),
      ...(invalid ? [`${invalid} malformed, unsupported, or unlinked closure record${invalid === 1 ? '' : 's'} omitted during normalisation.`] : []),
      ...(duplicateConflict ? [`${duplicateConflict} conflicting closure record identit${duplicateConflict === 1 ? 'y was' : 'ies were'} reconciled deterministically.`] : []),
      ...(preV13HistoryUnavailable ? ['Migrated from a pre-v13 Case; earlier deliberate closure history is unavailable.'] : []),
      'Closure records are deliberate analyst actions and do not establish absence, safety, provider performance, or legal sufficiency.',
      ...retainedLimitations,
    ]),
  };
}

/** New-write policy only. Historical normalisation must not re-adjudicate a closure. */
export function caseClosureReviewBlocker(
  reason: CaseClosureReason | null,
  review: CaseObservedEffectReview | null | undefined,
  now: string,
  responseObject?: CaseResponseObject,
  evidencePins: readonly CaseEvidencePin[] = [],
): string | null {
  if (review?.responseObject && !sameCaseResponseObject(responseObject, review.responseObject)) return 'This independent review concerns one object. Select that object for closure; it cannot close the whole Case.';
  if (reason !== 'independently_not_reproduced' && reason !== 'infrastructure_changed') return null;
  const expected = reason === 'independently_not_reproduced' ? 'not_reproduced' : 'changed';
  const invalidLink = reason === 'independently_not_reproduced'
    ? 'This closure reason requires a linked independent not-reproduced review.'
    : 'This closure reason requires a linked independent changed review.';
  if (!review || review.state !== expected) return invalidLink;
  if (responseObject) {
    if (!sameCaseResponseObject(responseObject, review.responseObject)) return 'Object-specific technical closure requires a linked independent review explicitly bound to this exact object; historical missing binding remains unknown.';
    if (!review.recheck || !sameCaseResponseObject(responseObject, review.recheck.responseObject)) return 'Object-specific technical closure requires a complete exact-object baseline and current review under comparable conditions.';
    try {
      assertRecheckNonReproduction('not_reproduced', review.recheck, review.completeness, evidencePins,
        evidencePins.find(pin => pin.id === review.evidencePinId), review.observedAt);
    } catch (cause) { return cause instanceof Error ? cause.message : 'The exact-object review cannot support technical closure.'; }
  }
  const observedAt = normalizeExplicitIsoTimestamp(review.observedAt);
  const createdAt = normalizeExplicitIsoTimestamp(review.createdAt);
  const closedAt = normalizeExplicitIsoTimestamp(now);
  if (!observedAt || !createdAt || !closedAt
    || Date.parse(observedAt) > Date.parse(closedAt)
    || Date.parse(createdAt) > Date.parse(closedAt)) return invalidLink;
  if (reason === 'independently_not_reproduced') {
    if (review.completeness !== 'complete') return 'Independent non-reproduction closure requires a complete observation. Keep this limited review and collect or record a complete recheck.';
    if (review.recheck && review.recheck.conditionsMatch !== 'comparable') return 'Independent non-reproduction closure requires comparable recheck conditions.';
  }
  return null;
}

/** Latest applicable provider cohort, never the action-wide summary or an old receipt. */
export function caseClosureProviderBlocker(action: CaseActionRecord | null | undefined, responseObject: CaseResponseObject | undefined, now: string): string | null {
  const blocked = 'This closure reason requires a linked typed provider-reported-resolution outcome for the latest applicable object observation.';
  const closedAt = normalizeExplicitIsoTimestamp(now);
  if (!action || !closedAt) return blocked;
  if (responseObject ? !action.responseObjects?.some(object => sameCaseResponseObject(object, responseObject)) : action.responseObjects?.length) return blocked;
  // A losing workflow transition is still retained evidence. Select the
  // exact-object cohort before checking whether its receipts were applied.
  const events = action.history.filter(event => (event.providerOutcome !== null || event.objectOutcome !== undefined)
    && Date.parse(event.occurredAt) <= Date.parse(closedAt)
    && (responseObject ? event.responseObjects?.some(object => sameCaseResponseObject(object, responseObject)) : !event.responseObjects?.length));
  const cohort = latestObservationCohort(events, event => event.occurredAt);
  if (!cohort.latest.length || cohort.undated.length || cohort.latest.some(event => !event.applied || event.providerOutcome !== 'provider_reports_resolved'
    || event.objectOutcome === 'restored' || event.objectOutcome === 'disputed')
    || new Set(cohort.latest.map(event => event.objectOutcome ?? null)).size !== 1) return blocked;
  return null;
}

export function caseClosureActionBlocker(reason: CaseClosureReason | null, action: CaseActionRecord | null | undefined, responseObject: CaseResponseObject | undefined, now: string): string | null {
  if (action?.responseObjects?.length && (!responseObject || !action.responseObjects.some(object => sameCaseResponseObject(object, responseObject)))) return 'This action concerns explicitly bound objects. Select one of them for this closure; other objects remain independent.';
  return reason === 'provider_reported_resolution_not_independently_checked' ? caseClosureProviderBlocker(action, responseObject, now) : null;
}

/** Derived presentation only: never rewrite the analyst's summary or limitations. */
export function caseClosureHistoryQualification(closure: CaseClosureRecord, actions: readonly CaseActionRecord[]): string | null {
  if (closure.reason !== 'provider_reported_resolution_not_independently_checked') return null;
  const action = actions.find(candidate => candidate.id === closure.actionId);
  // Evaluate the retained history, not a wall-clock freshness claim. Future-dated
  // or conflicting receipts cannot silently make an old decision authoritative.
  const latestAt = (action?.history ?? []).reduce((latest, event) =>
    Date.parse(event.occurredAt) > Date.parse(latest) ? event.occurredAt : latest, closure.createdAt);
  return caseClosureProviderBlocker(action, closure.responseObject, latestAt) === null ? null
    : 'Retained provider history no longer supports a new closure for this scope. This historical analyst decision is preserved; it does not establish current remediation.';
}

export function appendCaseClosure(
  current: CaseClosureHistory,
  raw: unknown,
  now: string,
  observedEffects: CaseObservedEffectHistory,
  actions: readonly CaseActionRecord[],
  evidencePins: readonly CaseEvidencePin[] = [],
): CaseClosureHistory {
  const item = record(raw);
  const reason = typeof item.reason === 'string' && CLOSURE_REASONS.has(item.reason)
    ? item.reason as CaseClosureReason
    : null;
  const review = typeof item.observedEffectReviewId === 'string'
    ? observedEffects.reviews.find((candidate) => candidate.id === item.observedEffectReviewId) ?? null
    : null;
  const action = typeof item.actionId === 'string'
    ? actions.find((candidate) => candidate.id === item.actionId) ?? null
    : null;
  const responseObject = readCaseResponseObject(item.responseObject);
  const reviewBlocker = caseClosureReviewBlocker(reason, review, now, responseObject, evidencePins);
  if (reviewBlocker) throw new Error(reviewBlocker);
  const actionBlocker = caseClosureActionBlocker(reason, action, responseObject, now);
  if (actionBlocker) throw new Error(actionBlocker);
  const linkContext = buildCaseClosureLinkContext(observedEffects, actions);
  const created = normalizeClosure({ ...item, id: freshId('case-closure'), createdAt: now }, now,
    new Set(observedEffects.reviews.map((candidate) => candidate.id)),
    new Set(actions.map((candidate) => candidate.id)), {}, linkContext);
  if (!created || !reason) throw new Error('A deliberate closure requires a typed reason and summary.');
  return normalizeCaseClosureHistory({
    records: [...current.records, created],
    omitted: current.omitted,
    preV13HistoryUnavailable: current.preV13HistoryUnavailable,
    limitations: current.limitations,
  }, now,
  new Set(observedEffects.reviews.map((candidate) => candidate.id)),
  new Set(actions.map((candidate) => candidate.id)), {}, linkContext);
}

export function mergeCaseClosureHistories(
  local: CaseClosureHistory,
  imported: CaseClosureHistory,
  fallback: string,
  validReviewIds?: ReadonlySet<string>,
  validActionIds?: ReadonlySet<string>,
  linkContext: CaseClosureLinkContext = {},
): CaseClosureHistory {
  return normalizeCaseClosureHistory({
    records: [...local.records, ...imported.records],
    omitted: Math.max(local.omitted, imported.omitted),
    preV13HistoryUnavailable: local.preV13HistoryUnavailable || imported.preV13HistoryUnavailable,
    limitations: [...local.limitations, ...imported.limitations],
  }, fallback, validReviewIds, validActionIds, {}, linkContext);
}

export function buildCaseResponseLifecycleSummary(input: Readonly<{
  actions?: readonly CaseActionRecord[];
  observedEffects?: CaseObservedEffectHistory;
  closures?: CaseClosureHistory;
}>): CaseResponseLifecycleSummary {
  const providerEvents = (input.actions ?? []).flatMap((action) => action.history
    .filter((event) => event.providerOutcome)
    .map((event) => ({ action, event })));
  const providerCohort = latestObservationCohort(providerEvents, ({ event }) => event.occurredAt);
  const providerEventsAtLatestTime = providerCohort.latest;
  const latestProvider = providerEventsAtLatestTime.length === 1 && !providerCohort.undated.length && providerEventsAtLatestTime[0]!.event.applied
    ? providerEventsAtLatestTime[0]!
    : null;
  const providerOutcomeState = providerEvents.length === 0
    ? 'missing' as const
    : latestProvider ? 'available' as const : 'ambiguous' as const;
  const reviews = input.observedEffects?.reviews ?? [];
  const observedCohort = latestObservationCohort(reviews, (review) => review.observedAt);
  const latestObserved = observedCohort.latest.length === 1 && !observedCohort.undated.length
    ? observedCohort.latest[0]!
    : null;
  const changedReviews = reviews.filter((review) => review.state === 'changed');
  const changedCohort = latestObservationCohort(changedReviews, (review) => review.observedAt);
  const latestObservedChangeAt = changedCohort.latest.length === 1 && !changedCohort.undated.length
    ? changedCohort.observedAt
    : null;
  const observedChangeState = changedReviews.length === 0
    ? 'missing' as const
    : latestObservedChangeAt ? 'available' as const : 'ambiguous' as const;
  const latestClosure = [...(input.closures?.records ?? [])]
    .filter(closure => closure.responseObject === undefined)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || compareCodeUnits(right.id, left.id))[0] ?? null;
  return {
    providerOutcomeState,
    latestProviderOutcome: latestProvider ? {
      actionId: latestProvider.action.id,
      eventId: latestProvider.event.id,
      outcome: latestProvider.event.providerOutcome!,
      occurredAt: latestProvider.event.occurredAt,
      reference: latestProvider.event.reference,
    } : null,
    observedChangeState,
    latestObservedEffect: latestObserved ? {
      reviewId: latestObserved.id,
      state: latestObserved.state,
      observedAt: latestObserved.observedAt,
      sourceClass: latestObserved.sourceClass,
      source: latestObserved.source,
    } : null,
    latestObservedChangeAt,
    latestClosure,
  };
}

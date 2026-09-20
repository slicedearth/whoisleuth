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
import { readCaseRecheckAnswerContext } from './case-recheck-model.mts';
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
    && !linkedProviderEvents.some((event) => Date.parse(event.occurredAt) <= Date.parse(createdAt))) return null;
  const linkLimitations = [
    ...(item.observedEffectReviewId != null && !observedEffectReviewId ? ['A malformed or dangling observed-effect review reference was omitted from this closure.'] : []),
    ...(item.actionId != null && !actionId ? ['A malformed or dangling response-action reference was omitted from this closure.'] : []),
  ];
  return {
    id: safeId(item.id, 'case-closure', { reason: item.reason, summary, createdAt }),
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
      .filter((event) => event.applied && event.providerOutcome === 'provider_reports_resolved')
      .map((event) => ({ eventId: event.id, occurredAt: event.occurredAt }))] as const)),
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

export function appendCaseClosure(
  current: CaseClosureHistory,
  raw: unknown,
  now: string,
  observedEffects: CaseObservedEffectHistory,
  actions: readonly CaseActionRecord[],
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
  if (reason === 'independently_not_reproduced'
    && (review?.state !== 'not_reproduced' || Date.parse(review.observedAt) > Date.parse(now) || Date.parse(review.createdAt) > Date.parse(now))) {
    throw new Error('This closure reason requires a linked independent not-reproduced review.');
  }
  if (reason === 'infrastructure_changed'
    && (review?.state !== 'changed' || Date.parse(review.observedAt) > Date.parse(now) || Date.parse(review.createdAt) > Date.parse(now))) {
    throw new Error('This closure reason requires a linked independent changed review.');
  }
  if (reason === 'provider_reported_resolution_not_independently_checked'
    && (action?.providerOutcome !== 'provider_reports_resolved'
      || !action.history.some((event) => event.applied
        && event.providerOutcome === 'provider_reports_resolved'
        && Date.parse(event.occurredAt) <= Date.parse(now)))) {
    throw new Error('This closure reason requires a linked typed provider-reported-resolution outcome.');
  }
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

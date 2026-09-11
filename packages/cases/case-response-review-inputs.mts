// Exact, bounded validation of current and published response-review inputs.

import {
  CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
  MAX_ABUSE_CATEGORY_LENGTH,
  MAX_ABUSIVE_URLS,
  MAX_AFFECTED_PARTY_LENGTH,
  MAX_CASE_ACTIONS,
  MAX_CASE_ACTION_EVENTS_PER_ACTION,
  MAX_CASE_ACTION_EVENTS_PER_CASE,
  MAX_EXACT_URL_LENGTH,
  MAX_RESPONSE_ACTION_HISTORY,
  MAX_RESPONSE_ARTEFACT_REFERENCES,
  MAX_RESPONSE_CONTACTS,
  MAX_RESPONSE_CONTRADICTIONS,
  MAX_RESPONSE_HARM_LENGTH,
  MAX_RESPONSE_LIMITATIONS,
  MAX_RESPONSE_LIMITATION_LENGTH,
  MAX_RESPONSE_REFERENCE_LENGTH,
  MAX_RESPONSE_SELECTED_EVIDENCE,
  MAX_RESPONSE_VALUE_LENGTH,
  PUBLISHED_V2_2_CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  PUBLISHED_V2_3_CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  SUPPORTED_CASE_RESPONSE_REVIEW_INPUTS_VERSIONS,
} from '../contracts/case-portability.mts';
import {
  CASE_ACTION_EVENT_SOURCE_CLASSES,
  CASE_ACTION_STATES,
  CASE_ACTION_TYPES,
  CASE_ASSERTION_STATES,
  CASE_CLOSURE_REASONS,
  CASE_OBSERVED_EFFECT_SOURCE_CLASSES,
  CASE_OBSERVED_EFFECT_STATES,
  CASE_PIN_COMPLETENESS,
  CASE_PROVIDER_OUTCOMES,
} from './case-response-records.mts';
import {
  RESPONSE_CONTACT_KINDS,
  RESPONSE_PACKET_PROFILE_IDS,
  RESPONSE_READINESS_ROW_IDS,
  RESPONSE_READINESS_STATES,
  type ResponseReadinessState,
} from './case-response-packet-vocabulary.mts';

const CONTACT_KINDS = new Set<string>(RESPONSE_CONTACT_KINDS);
const PRE_PLATFORM_CONTACT_KINDS = new Set<string>(RESPONSE_CONTACT_KINDS.filter((kind) => kind !== 'application_platform'));
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

const RESPONSE_PROFILE_IDS = new Set<string>(RESPONSE_PACKET_PROFILE_IDS);

const PRE_PLATFORM_PROFILE_IDS = new Set<string>(RESPONSE_PACKET_PROFILE_IDS.filter((id) => id !== 'application_platform'));

const PRE_PLATFORM_ACTION_TYPES = CASE_ACTION_TYPES.filter((type) => type !== 'platform_report');

const CASE_RESPONSE_REVIEW_INPUT_KEYS = Object.freeze([
  'contract',
  'version',
  'profile',
  'case',
  'incident',
  'contacts',
  'recipientRoute',
  'actionBinding',
  'selectedEvidence',
  'contradictions',
  'readiness',
  'artefactReferences',
  'escalationHistory',
  'escalationHistoryOmitted',
  'escalationHistoryLimitations',
  'responseLifecycle',
] as const);

const PUBLISHED_V2_CASE_RESPONSE_REVIEW_INPUT_KEYS = Object.freeze(
  CASE_RESPONSE_REVIEW_INPUT_KEYS.filter((key) => key !== 'recipientRoute' && key !== 'actionBinding'),
);

function exactReviewRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an exact object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError(`${label} contains an undeclared field.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => !descriptors[key] || !Object.hasOwn(descriptors[key]!, 'value'))) {
    throw new TypeError(`${label} must not contain accessors.`);
  }
  return value as Record<string, unknown>;
}

function boundedReviewArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} exceeds its declared array bound.`);
  }
  const ownKeys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (ownKeys.length !== value.length
    || ownKeys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${label} must be a dense ordinary array.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (ownKeys.some((key) => typeof key !== 'string' || !Object.hasOwn(descriptors[key]!, 'value'))) {
    throw new TypeError(`${label} must not contain accessors.`);
  }
  return value;
}

function reviewText(value: unknown, maximum: number, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length > maximum || CONTROL_RE.test(value)) {
    throw new TypeError(`${label} is not a bounded text value.`);
  }
  return value;
}

function reviewStrings(value: unknown, maximum: number, itemMaximum: number, label: string): string[] {
  const items = boundedReviewArray(value, maximum, label);
  for (const item of items) reviewText(item, itemMaximum, `${label} item`);
  return items as string[];
}

function reviewCount(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new TypeError(`${label} is not a bounded count.`);
  }
  return value as number;
}

function reviewEnum(value: unknown, values: readonly string[], label: string): string {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new TypeError(`${label} contains an unsupported value.`);
  }
  return value;
}

function reviewNullableEnum(value: unknown, values: readonly string[], label: string): string | null {
  return value === null ? null : reviewEnum(value, values, label);
}

function validateReviewLifecycle(value: unknown): void {
  const lifecycle = exactReviewRecord(value, [
    'providerOutcomeState', 'latestProviderOutcome', 'observedChangeState',
    'latestObservedEffect', 'latestObservedChangeAt', 'closure', 'limitations',
  ], 'Case-response review lifecycle');
  reviewEnum(lifecycle.providerOutcomeState, ['available', 'missing', 'ambiguous'], 'Case-response provider-outcome state');
  reviewEnum(lifecycle.observedChangeState, ['available', 'missing', 'ambiguous'], 'Case-response observed-change state');
  reviewText(lifecycle.latestObservedChangeAt, 64, 'Case-response latest observed change', true);
  reviewStrings(lifecycle.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response lifecycle limitations');
  if (lifecycle.latestProviderOutcome !== null) {
    const outcome = exactReviewRecord(lifecycle.latestProviderOutcome, [
      'actionId', 'eventId', 'outcome', 'occurredAt', 'reference',
    ], 'Case-response latest provider outcome');
    reviewText(outcome.actionId, 64, 'Case-response provider action id');
    reviewText(outcome.eventId, 64, 'Case-response provider event id');
    reviewEnum(outcome.outcome, CASE_PROVIDER_OUTCOMES, 'Case-response provider outcome');
    reviewText(outcome.occurredAt, 64, 'Case-response provider outcome time');
    reviewText(outcome.reference, MAX_RESPONSE_REFERENCE_LENGTH, 'Case-response provider reference', true);
  }
  if (lifecycle.latestObservedEffect !== null) {
    const effect = exactReviewRecord(lifecycle.latestObservedEffect, [
      'reviewId', 'state', 'observedAt', 'sourceClass', 'source',
    ], 'Case-response latest observed effect');
    reviewText(effect.reviewId, 64, 'Case-response observed-effect review id');
    reviewEnum(effect.state, CASE_OBSERVED_EFFECT_STATES, 'Case-response observed-effect state');
    reviewText(effect.observedAt, 64, 'Case-response observed-effect time');
    reviewEnum(effect.sourceClass, CASE_OBSERVED_EFFECT_SOURCE_CLASSES, 'Case-response observed-effect source class');
    reviewText(effect.source, MAX_RESPONSE_VALUE_LENGTH, 'Case-response observed-effect source');
  }
  if (lifecycle.closure !== null) {
    const closure = exactReviewRecord(lifecycle.closure, [
      'id', 'reason', 'createdAt', 'limitations',
    ], 'Case-response latest closure');
    reviewText(closure.id, 64, 'Case-response closure id');
    reviewEnum(closure.reason, CASE_CLOSURE_REASONS, 'Case-response closure reason');
    reviewText(closure.createdAt, 64, 'Case-response closure time');
    reviewStrings(closure.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response closure limitations');
  }
}

function recursivelyFreezeReviewValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    recursivelyFreezeReviewValue(child);
  }
  return Object.freeze(value);
}

export function validateCaseResponseReviewInputs(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Case-response review inputs must be an exact object.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!descriptors.contract || !Object.hasOwn(descriptors.contract, 'value')
    || !descriptors.version || !Object.hasOwn(descriptors.version, 'value')) {
    throw new TypeError('Case-response review inputs must not contain accessors.');
  }
  const version = descriptors.version.value;
  if (descriptors.contract.value !== CASE_RESPONSE_REVIEW_INPUTS_SCHEMA
    || !SUPPORTED_CASE_RESPONSE_REVIEW_INPUTS_VERSIONS.some((supported) => supported === version)) {
    throw new TypeError('Case-response review inputs contain an unsupported version, shape, or bound.');
  }
  const hasPlatformRoutes = version >= PUBLISHED_V2_3_CASE_RESPONSE_REVIEW_INPUTS_VERSION;
  const hasActionBinding = version >= PUBLISHED_V2_2_CASE_RESPONSE_REVIEW_INPUTS_VERSION;
  const source = exactReviewRecord(
    value,
    hasActionBinding ? CASE_RESPONSE_REVIEW_INPUT_KEYS : PUBLISHED_V2_CASE_RESPONSE_REVIEW_INPUT_KEYS,
    'Case-response review inputs',
  );
  const profile = exactReviewRecord(source.profile, [
    'id', 'label', 'audience', 'subject', 'checklist', 'includedEvidence',
    'excludedEvidence', 'redactions',
  ], 'Case-response review profile');
  const supportedProfileIds = hasPlatformRoutes ? RESPONSE_PROFILE_IDS : PRE_PLATFORM_PROFILE_IDS;
  if (typeof profile.id !== 'string' || !supportedProfileIds.has(profile.id)) {
    throw new TypeError('Case-response review profile is unsupported.');
  }
  for (const key of ['label', 'audience', 'subject'] as const) {
    reviewText(profile[key], 500, `Case-response profile ${key}`);
  }
  for (const key of ['checklist', 'includedEvidence', 'excludedEvidence', 'redactions'] as const) {
    reviewStrings(profile[key], 32, 500, `Case-response profile ${key}`);
  }

  const caseRecord = exactReviewRecord(source.case, [
    'id', 'domain', 'status', 'disposition', 'updatedAt',
  ], 'Case-response review Case');
  reviewText(caseRecord.id, 64, 'Case-response Case id');
  reviewText(caseRecord.domain, 253, 'Case-response Case domain');
  reviewText(caseRecord.status, 64, 'Case-response Case status');
  reviewText(caseRecord.disposition, 64, 'Case-response Case disposition');
  reviewText(caseRecord.updatedAt, 64, 'Case-response Case update time');

  const incident = exactReviewRecord(source.incident, [
    'category', 'affectedParty', 'abusiveUrls', 'observedHarm', 'observedAt',
  ], 'Case-response review incident');
  reviewText(incident.category, MAX_ABUSE_CATEGORY_LENGTH, 'Case-response category');
  reviewText(incident.affectedParty, MAX_AFFECTED_PARTY_LENGTH, 'Case-response affected party');
  reviewStrings(incident.abusiveUrls, MAX_ABUSIVE_URLS, MAX_EXACT_URL_LENGTH, 'Case-response abusive URLs');
  reviewText(incident.observedHarm, MAX_RESPONSE_HARM_LENGTH, 'Case-response observed harm');
  reviewText(incident.observedAt, 64, 'Case-response observation time', true);

  for (const candidate of boundedReviewArray(source.contacts, MAX_RESPONSE_CONTACTS, 'Case-response contacts')) {
    const contact = exactReviewRecord(candidate, [
      'kind', 'contact', 'source', 'observedAt', ...(hasPlatformRoutes ? ['reviewAfter'] : []), 'freshness', 'limitations',
    ], 'Case-response contact');
    const supportedContactKinds = hasPlatformRoutes ? CONTACT_KINDS : PRE_PLATFORM_CONTACT_KINDS;
    if (typeof contact.kind !== 'string' || !supportedContactKinds.has(contact.kind)
      || typeof contact.freshness !== 'string'
      || !['current', 'stale', 'unknown'].includes(contact.freshness)) {
      throw new TypeError('Case-response contact contains an unsupported enum.');
    }
    reviewText(contact.contact, 320, 'Case-response contact value');
    reviewText(contact.source, 120, 'Case-response contact source');
    reviewText(contact.observedAt, 64, 'Case-response contact observation time', true);
    if (hasPlatformRoutes) reviewText(contact.reviewAfter, 64, 'Case-response contact review deadline', true);
    reviewStrings(contact.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response contact limitations');
  }

  if (hasActionBinding && source.recipientRoute !== null) {
    const route = exactReviewRecord(source.recipientRoute, [
      'actionId', 'kind', 'contact', 'source', 'observedAt', ...(hasPlatformRoutes ? ['reviewAfter'] : []), 'freshness', 'limitations',
    ], 'Case-response recipient route');
    reviewText(route.actionId, 64, 'Case-response recipient action id');
    reviewEnum(route.kind, [...(hasPlatformRoutes ? RESPONSE_CONTACT_KINDS : [...PRE_PLATFORM_CONTACT_KINDS]), 'manual'], 'Case-response recipient kind');
    reviewText(route.contact, 320, 'Case-response recipient value');
    reviewText(route.source, 120, 'Case-response recipient source');
    reviewText(route.observedAt, 64, 'Case-response recipient observation time', true);
    if (hasPlatformRoutes) reviewText(route.reviewAfter, 64, 'Case-response recipient review deadline', true);
    reviewEnum(route.freshness, ['current', 'stale', 'unknown'], 'Case-response recipient freshness');
    reviewStrings(route.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response recipient limitations');
  }

  let currentLineageActionIds: string[] | null = null;
  if (hasActionBinding) {
    const actionBinding = exactReviewRecord(source.actionBinding, [
      'state', 'selectedActionId', 'lineageActionIds', 'limitations',
    ], 'Case-response action binding');
    const bindingState = reviewEnum(actionBinding.state, ['selected', 'not_selected'], 'Case-response action binding state');
    const selectedActionId = reviewText(actionBinding.selectedActionId, 64, 'Case-response selected action id', true);
    const lineageActionIds = reviewStrings(actionBinding.lineageActionIds, MAX_RESPONSE_ACTION_HISTORY, 64, 'Case-response action lineage');
    currentLineageActionIds = lineageActionIds;
    if ((bindingState === 'selected') !== Boolean(selectedActionId)
      || (selectedActionId !== null && lineageActionIds[0] !== selectedActionId)
      || new Set(lineageActionIds).size !== lineageActionIds.length) {
      throw new TypeError('Case-response action binding is inconsistent.');
    }
    reviewStrings(actionBinding.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response action-binding limitations');
    if (source.recipientRoute !== null
      && (source.recipientRoute as Record<string, unknown>).actionId !== selectedActionId) {
      throw new TypeError('Case-response recipient route is not bound to the selected action.');
    }
  }

  for (const candidate of boundedReviewArray(source.selectedEvidence, MAX_RESPONSE_SELECTED_EVIDENCE, 'Case-response selected evidence')) {
    const evidence = exactReviewRecord(candidate, [
      'id', 'label', 'source', 'observedAt', 'completeness', 'limitations',
    ], 'Case-response selected evidence item');
    reviewText(evidence.id, 64, 'Case-response evidence id');
    reviewText(evidence.label, 80, 'Case-response evidence label');
    reviewText(evidence.source, 120, 'Case-response evidence source');
    reviewText(evidence.observedAt, 64, 'Case-response evidence observation time', version > PUBLISHED_V2_3_CASE_RESPONSE_REVIEW_INPUTS_VERSION);
    reviewEnum(evidence.completeness, CASE_PIN_COMPLETENESS, 'Case-response evidence completeness');
    reviewStrings(evidence.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response evidence limitations');
  }

  for (const candidate of boundedReviewArray(source.contradictions, MAX_RESPONSE_CONTRADICTIONS, 'Case-response contradictions')) {
    const contradiction = exactReviewRecord(candidate, [
      'id', 'statement', 'state', 'limitations',
    ], 'Case-response contradiction');
    reviewText(contradiction.id, 64, 'Case-response contradiction id');
    reviewText(contradiction.statement, 2_000, 'Case-response contradiction statement');
    reviewEnum(contradiction.state, CASE_ASSERTION_STATES, 'Case-response contradiction state');
    reviewStrings(contradiction.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response contradiction limitations');
  }

  const readiness = exactReviewRecord(source.readiness, [
    'profileId', 'rows', 'counts', 'limitations',
  ], 'Case-response readiness');
  if (typeof readiness.profileId !== 'string' || !supportedProfileIds.has(readiness.profileId)) {
    throw new TypeError('Case-response readiness profile is unsupported.');
  }
  const readinessRows = boundedReviewArray(readiness.rows, RESPONSE_READINESS_ROW_IDS.length, 'Case-response readiness rows');
  const readinessIds = new Set<string>();
  const readinessCounts = Object.fromEntries(RESPONSE_READINESS_STATES.map((state) => [state, 0])) as Record<ResponseReadinessState, number>;
  for (const candidate of readinessRows) {
    const row = exactReviewRecord(candidate, [
      'id', 'label', 'state', 'detail', 'requiredForAuthorisation', 'limitations',
    ], 'Case-response readiness row');
    if (typeof row.id !== 'string'
      || !(RESPONSE_READINESS_ROW_IDS as readonly string[]).includes(row.id)
      || readinessIds.has(row.id)
      || typeof row.state !== 'string'
      || !(RESPONSE_READINESS_STATES as readonly string[]).includes(row.state)
      || typeof row.requiredForAuthorisation !== 'boolean') {
      throw new TypeError('Case-response readiness row is unsupported or duplicated.');
    }
    readinessIds.add(row.id);
    readinessCounts[row.state as ResponseReadinessState] += 1;
    reviewText(row.label, 120, 'Case-response readiness label');
    reviewText(row.detail, 500, 'Case-response readiness detail');
    reviewStrings(row.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response readiness limitations');
  }
  const counts = exactReviewRecord(readiness.counts, RESPONSE_READINESS_STATES, 'Case-response readiness counts');
  for (const state of RESPONSE_READINESS_STATES) {
    if (reviewCount(counts[state], RESPONSE_READINESS_ROW_IDS.length, `Case-response readiness ${state} count`) !== readinessCounts[state]) {
      throw new TypeError('Case-response readiness counts do not match the exact rows.');
    }
  }
  reviewStrings(readiness.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response readiness limitations');

  for (const candidate of boundedReviewArray(source.artefactReferences, MAX_RESPONSE_ARTEFACT_REFERENCES, 'Case-response artefact references')) {
    const reference = exactReviewRecord(candidate, [
      'id', 'label', 'mediaType', 'capturedAt', 'source', 'digestSha256',
      'byteLength', 'limitations',
    ], 'Case-response artefact reference');
    reviewText(reference.id, 64, 'Case-response artefact id');
    reviewText(reference.label, 120, 'Case-response artefact label');
    reviewText(reference.mediaType, 120, 'Case-response artefact media type');
    reviewText(reference.capturedAt, 64, 'Case-response artefact capture time');
    reviewText(reference.source, 120, 'Case-response artefact source');
    if (typeof reference.digestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(reference.digestSha256)) {
      throw new TypeError('Case-response artefact digest is invalid.');
    }
    if (reference.byteLength !== null) reviewCount(reference.byteLength, 100 * 1024 * 1024, 'Case-response artefact byte length');
    reviewStrings(reference.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response artefact limitations');
  }

  const escalationActionIds: string[] = [];
  for (const candidate of boundedReviewArray(source.escalationHistory, MAX_RESPONSE_ACTION_HISTORY, 'Case-response escalation history')) {
    const action = exactReviewRecord(candidate, [
      'actionId', 'type', 'recipient', 'contactSource', 'state', 'reference',
      ...(hasActionBinding ? ['routeObservedAt'] : []),
      ...(hasPlatformRoutes ? ['routeReviewAfter'] : []),
      'providerOutcome', 'outcomeDetail', 'originActionId', 'historyOmitted',
      'historyLimitations', 'transitions', 'createdAt', 'updatedAt',
    ], 'Case-response escalation action');
    for (const key of ['actionId', 'recipient', 'contactSource', 'createdAt', 'updatedAt'] as const) {
      reviewText(action[key], MAX_RESPONSE_VALUE_LENGTH, `Case-response action ${key}`);
    }
    if (escalationActionIds.includes(action.actionId as string)) {
      throw new TypeError('Case-response escalation action identities must be unique.');
    }
    escalationActionIds.push(action.actionId as string);
    if (hasActionBinding) reviewText(action.routeObservedAt, 64, 'Case-response action route observation time', true);
    if (hasPlatformRoutes) reviewText(action.routeReviewAfter, 64, 'Case-response action route review deadline', true);
    reviewEnum(action.type, hasPlatformRoutes ? CASE_ACTION_TYPES : PRE_PLATFORM_ACTION_TYPES, 'Case-response action type');
    reviewEnum(action.state, CASE_ACTION_STATES, 'Case-response action state');
    for (const key of ['reference', 'outcomeDetail', 'originActionId'] as const) {
      reviewText(action[key], MAX_RESPONSE_VALUE_LENGTH, `Case-response action ${key}`, true);
    }
    reviewNullableEnum(action.providerOutcome, CASE_PROVIDER_OUTCOMES, 'Case-response action provider outcome');
    reviewCount(action.historyOmitted, MAX_CASE_ACTION_EVENTS_PER_CASE, 'Case-response omitted transition count');
    reviewStrings(action.historyLimitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response action history limitations');
    for (const candidateTransition of boundedReviewArray(action.transitions, MAX_CASE_ACTION_EVENTS_PER_ACTION, 'Case-response transitions')) {
      const transition = exactReviewRecord(candidateTransition, [
        'id', 'previousState', 'nextState', 'occurredAt', 'sourceClass', 'provenance',
        'reference', 'evidencePinId', 'limitations', 'providerOutcome', 'outcomeDetail',
        'originActionId', 'applied',
      ], 'Case-response transition');
      for (const key of ['id', 'occurredAt', 'provenance'] as const) {
        reviewText(transition[key], MAX_RESPONSE_VALUE_LENGTH, `Case-response transition ${key}`);
      }
      reviewNullableEnum(transition.previousState, CASE_ACTION_STATES, 'Case-response previous action state');
      reviewEnum(transition.nextState, CASE_ACTION_STATES, 'Case-response next action state');
      reviewEnum(transition.sourceClass, CASE_ACTION_EVENT_SOURCE_CLASSES, 'Case-response transition source class');
      for (const key of ['reference', 'evidencePinId', 'outcomeDetail', 'originActionId'] as const) {
        reviewText(transition[key], MAX_RESPONSE_VALUE_LENGTH, `Case-response transition ${key}`, true);
      }
      reviewNullableEnum(transition.providerOutcome, CASE_PROVIDER_OUTCOMES, 'Case-response transition provider outcome');
      if (typeof transition.applied !== 'boolean') throw new TypeError('Case-response transition applied state is invalid.');
      reviewStrings(transition.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response transition limitations');
    }
  }
  if (currentLineageActionIds
    && (currentLineageActionIds.length !== escalationActionIds.length
      || escalationActionIds.some((id, index) => currentLineageActionIds?.[index] !== id))) {
    throw new TypeError('Case-response escalation history must match the selected action lineage in order.');
  }
  reviewCount(source.escalationHistoryOmitted, MAX_CASE_ACTIONS, 'Case-response omitted action count');
  reviewStrings(source.escalationHistoryLimitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response escalation limitations');
  validateReviewLifecycle(source.responseLifecycle);

  return recursivelyFreezeReviewValue(structuredClone(source));
}

import { isValidAsciiHostname } from '../contracts/domain-name.mts';
import {
  INCIDENT_CASE_SCHEMA_VERSION,
  MAX_RESPONSE_RATIONALE_LENGTH,
} from '../contracts/case-portability.mts';
import { enumeration, exactOptional, text } from '../evidence/artifact-structure.mts';
import { readCaseResponseObject, sameCaseResponseObject, type CaseResponseObject } from './case-response-object.mts';
import { casePinHasCompleteObservation } from './case-evidence-quality.mts';
import type {
  CaseAssertionRecord,
  CaseEvidencePin,
  CaseObservedEffectState,
} from './case-response-records.mts';

export const CASE_RECHECK_CONDITIONS = Object.freeze({
  unknown: 'Not established',
  comparable: 'Comparable for this question',
  different: 'Different conditions',
} as const);
export type CaseRecheckConditionsMatch = keyof typeof CASE_RECHECK_CONDITIONS;

export type CaseRecheckContext = Readonly<{
  targetHostname: string;
  baselinePinId: string | null;
  conditions: string;
  responseObject?: CaseResponseObject;
}>;
export type CaseRecheckAnswerContext = CaseRecheckContext &
  Readonly<{
    questionId: string;
    question: string;
    conditionsMatch: CaseRecheckConditionsMatch;
  }>;

function reference(value: unknown, label: string): string {
  const id = text(value, label, 64);
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new TypeError(`${label} is invalid.`);
  return id;
}

function contextFields(item: Record<string, unknown>, sourceVersion?: number | null): CaseRecheckContext {
  const targetHostname = text(item.targetHostname, 'Recheck target hostname', 253);
  if (targetHostname !== targetHostname.toLowerCase() || !isValidAsciiHostname(targetHostname)) {
    throw new TypeError(
      'Use one normalised hostname for the recheck target, without a path or query.',
    );
  }
  const conditions = text(
    item.conditions,
    'Recheck comparison conditions',
    MAX_RESPONSE_RATIONALE_LENGTH,
  );
  if (!conditions.trim())
    throw new TypeError('Describe the conditions needed to compare the observations.');
  const responseObject = readCaseResponseObject(item.responseObject, sourceVersion);
  if (responseObject && (responseObject.kind === 'domain' || responseObject.kind === 'hostname'
    ? responseObject.identifier : new URL(responseObject.identifier).hostname) !== targetHostname) {
    throw new TypeError('The recheck target hostname must match the exact object snapshot.');
  }
  return Object.freeze({
    targetHostname,
    conditions,
    baselinePinId:
      item.baselinePinId === null ? null : reference(item.baselinePinId, 'Recheck baseline pin'),
    ...(responseObject ? { responseObject } : {}),
  });
}

/** Optional current-format context; historical records have no invented question. */
export function readCaseRecheckContext(
  value: unknown,
  sourceVersion?: number | null,
): CaseRecheckContext | undefined {
  if (value === undefined) return undefined;
  if (sourceVersion != null && sourceVersion < INCIDENT_CASE_SCHEMA_VERSION)
    throw new TypeError('This Case format cannot contain structured recheck questions.');
  return contextFields(
    exactOptional(value, ['targetHostname', 'baselinePinId', 'conditions'], ['responseObject'], 'Recheck question context'), sourceVersion,
  );
}

export function readCaseRecheckAnswerContext(
  value: unknown,
  sourceVersion?: number | null,
): CaseRecheckAnswerContext | undefined {
  if (value === undefined) return undefined;
  if (sourceVersion != null && sourceVersion < INCIDENT_CASE_SCHEMA_VERSION)
    throw new TypeError('This Case format cannot contain structured recheck answers.');
  const item = exactOptional(
    value,
    ['targetHostname', 'baselinePinId', 'conditions', 'questionId', 'question', 'conditionsMatch'],
    ['responseObject'],
    'Recheck answer context',
  );
  const question = text(item.question, 'Recheck question', MAX_RESPONSE_RATIONALE_LENGTH);
  if (!question.trim()) throw new TypeError('A recheck answer requires its original question.');
  return Object.freeze({
    ...contextFields(item, sourceVersion),
    questionId: reference(item.questionId, 'Recheck question ID'),
    question,
    conditionsMatch: enumeration(
      item.conditionsMatch,
      Object.keys(CASE_RECHECK_CONDITIONS) as CaseRecheckConditionsMatch[],
      'Recheck condition comparison',
    ),
  });
}

export function caseRecheckQuestions(
  assertions: readonly CaseAssertionRecord[],
): readonly CaseAssertionRecord[] {
  return assertions.filter(
    (item) => item.kind === 'next_step' && item.recheck && item.state === 'open',
  );
}

export function caseRecheckAnswerContext(
  question: CaseAssertionRecord,
  conditionsMatch: CaseRecheckAnswerContext['conditionsMatch'],
): CaseRecheckAnswerContext {
  if (question.kind !== 'next_step' || !question.recheck)
    throw new TypeError('Select a saved recheck question.');
  return readCaseRecheckAnswerContext({
    ...question.recheck,
    questionId: question.id,
    question: question.statement,
    conditionsMatch,
  })!;
}

/** Shared read projection; each form retains its draft and existing save coordinator. */
export function selectCaseRecheckQuestion(
  assertions: readonly CaseAssertionRecord[],
  selection: Readonly<{
    questionId: string;
    questionUpdatedAt: string;
    conditionsMatch: CaseRecheckConditionsMatch;
  }>,
) {
  const questions = caseRecheckQuestions(assertions);
  const question = questions.find((item) => item.id === selection.questionId);
  return {
    questions,
    context: question ? caseRecheckAnswerContext(question, selection.conditionsMatch) : undefined,
    stale: Boolean(selection.questionId) && (!question || question.updatedAt !== selection.questionUpdatedAt),
  };
}

/** A saved answer is a snapshot, not a live reference to an editable plan. */
export function assertCurrentRecheckQuestion(
  answer: CaseRecheckAnswerContext,
  assertions: readonly CaseAssertionRecord[],
): void {
  const question = caseRecheckQuestions(assertions).find((item) => item.id === answer.questionId);
  if (
    !question ||
    JSON.stringify(caseRecheckAnswerContext(question, answer.conditionsMatch)) !==
      JSON.stringify(answer)
  ) {
    throw new Error(
      'The recheck question changed or was resolved. Refresh and review its current conditions before saving this answer.',
    );
  }
}

const RECHECK_COMPARISON_MESSAGES = {
  different_conditions: 'The comparison conditions differ.',
  unconfirmed_conditions: 'Comparable conditions have not been confirmed.',
  missing_baseline: 'The baseline evidence is no longer available.',
  current_target_mismatch: 'The current evidence concerns a different or unknown hostname.',
  incomplete_current: 'The current source does not establish a complete observation.',
  later_observation_needed: 'A later source observation is needed; reviewing the baseline again is not a recheck.',
  baseline_target_mismatch: 'The baseline concerns a different hostname.',
  different_field_or_source: 'The observations use different fields or sources.',
  missing_object_baseline: 'An object-specific baseline is required for this exact-object comparison.',
  baseline_object_mismatch: 'The baseline does not explicitly concern this same object.',
  current_object_mismatch: 'The current observation does not explicitly concern this same object.',
} as const;
export type CaseRecheckComparisonBlocker = keyof typeof RECHECK_COMPARISON_MESSAGES;

/** Admissibility depends on these reasons, not on presentation warnings. */
export function caseRecheckComparisonBlockers(
  context: CaseRecheckAnswerContext,
  pins: readonly CaseEvidencePin[],
  current?: CaseEvidencePin,
): CaseRecheckComparisonBlocker[] {
  const blockers: CaseRecheckComparisonBlocker[] = [];
  if (context.conditionsMatch !== 'comparable') {
    blockers.push(
      context.conditionsMatch === 'different'
        ? 'different_conditions'
        : 'unconfirmed_conditions',
    );
  }
  const baseline = pins.find((pin) => pin.id === context.baselinePinId);
  if (context.responseObject) {
    if (!baseline) blockers.push('missing_object_baseline');
    else if (!sameCaseResponseObject(baseline.responseObject, context.responseObject)) blockers.push('baseline_object_mismatch');
    if (!current || !sameCaseResponseObject(current.responseObject, context.responseObject)) blockers.push('current_object_mismatch');
  }
  if (context.baselinePinId && !baseline)
    blockers.push('missing_baseline');
  if (current) {
    if (current.observationHostname !== context.targetHostname)
      blockers.push('current_target_mismatch');
    if (!casePinHasCompleteObservation(current))
      blockers.push('incomplete_current');
    if (baseline) {
      const sameObservation = baseline.id === current.id;
      const unknownObservationTime = !baseline.observedAt || !current.observedAt;
      const nonLaterObservation =
        !unknownObservationTime &&
        Date.parse(current.observedAt!) <= Date.parse(baseline.observedAt!);
      if (sameObservation || unknownObservationTime || nonLaterObservation) {
        blockers.push('later_observation_needed');
      }
      if (baseline.observationHostname && baseline.observationHostname !== context.targetHostname)
        blockers.push('baseline_target_mismatch');
      const differentField = Boolean(baseline.field) && current.field !== baseline.field;
      const differentSource = baseline.source !== current.source;
      if (differentField || differentSource)
        blockers.push('different_field_or_source');
    }
  }
  return blockers;
}

export function caseRecheckComparisonWarnings(
  context: CaseRecheckAnswerContext,
  pins: readonly CaseEvidencePin[],
  current?: CaseEvidencePin,
): string[] {
  return caseRecheckComparisonBlockers(context, pins, current)
    .map((reason) => RECHECK_COMPARISON_MESSAGES[reason]);
}

export function assertRecheckNonReproduction(
  state: CaseObservedEffectState,
  context: CaseRecheckAnswerContext,
  completeness: string,
  pins: readonly CaseEvidencePin[],
  current?: CaseEvidencePin,
  observedAt?: string | null,
): void {
  if (state !== 'not_reproduced') return;
  const blockers = caseRecheckComparisonBlockers(context, pins, current);
  const baseline = pins.find((pin) => pin.id === context.baselinePinId);
  let laterIndependentObservationNeeded = false;
  if (!current && baseline) {
    const missingObservationTime = !baseline.observedAt || !observedAt;
    const invalidObservationTime = observedAt ? !Number.isFinite(Date.parse(observedAt)) : false;
    const nonLaterObservation =
      !missingObservationTime && Date.parse(observedAt!) <= Date.parse(baseline.observedAt!);
    laterIndependentObservationNeeded = missingObservationTime || invalidObservationTime || nonLaterObservation;
  }
  if (completeness !== 'complete' || blockers.length || laterIndependentObservationNeeded) {
    throw new Error(
      'Not reproduced requires a complete observation under comparable conditions. Record unavailable or describe the limited observation instead.',
    );
  }
}

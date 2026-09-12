import { isValidAsciiHostname } from '../../lib/hostname.mts';
import { INCIDENT_CASE_SCHEMA_VERSION, MAX_RESPONSE_RATIONALE_LENGTH } from '../contracts/case-portability.mts';
import { enumeration, exact, text } from '../evidence/artifact-structure.mts';
import type { CaseAssertionRecord, CaseEvidencePin, CaseObservedEffectState } from './case-response-records.mts';

export const CASE_RECHECK_CONDITIONS = Object.freeze({ unknown: 'Not established', comparable: 'Comparable for this question', different: 'Different conditions' } as const);
export type CaseRecheckConditionsMatch = keyof typeof CASE_RECHECK_CONDITIONS;

export type CaseRecheckContext = Readonly<{
  targetHostname: string;
  baselinePinId: string | null;
  conditions: string;
}>;
export type CaseRecheckAnswerContext = CaseRecheckContext & Readonly<{
  questionId: string;
  question: string;
  conditionsMatch: CaseRecheckConditionsMatch;
}>;

function reference(value: unknown, label: string): string {
  const id = text(value, label, 64);
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new TypeError(`${label} is invalid.`);
  return id;
}

function contextFields(item: Record<string, unknown>): CaseRecheckContext {
  const targetHostname = text(item.targetHostname, 'Recheck target hostname', 253);
  if (targetHostname !== targetHostname.toLowerCase() || !isValidAsciiHostname(targetHostname)) {
    throw new TypeError('Use one normalised hostname for the recheck target, without a path or query.');
  }
  const conditions = text(item.conditions, 'Recheck comparison conditions', MAX_RESPONSE_RATIONALE_LENGTH);
  if (!conditions.trim()) throw new TypeError('Describe the conditions needed to compare the observations.');
  return Object.freeze({ targetHostname, conditions,
    baselinePinId: item.baselinePinId === null ? null : reference(item.baselinePinId, 'Recheck baseline pin') });
}

/** Optional current-format context; historical records have no invented question. */
export function readCaseRecheckContext(value: unknown, sourceVersion?: number | null): CaseRecheckContext | undefined {
  if (value === undefined) return undefined;
  if (sourceVersion != null && sourceVersion < INCIDENT_CASE_SCHEMA_VERSION) throw new TypeError('This Case format cannot contain structured recheck questions.');
  return contextFields(exact(value, ['targetHostname', 'baselinePinId', 'conditions'], 'Recheck question context'));
}

export function readCaseRecheckAnswerContext(value: unknown, sourceVersion?: number | null): CaseRecheckAnswerContext | undefined {
  if (value === undefined) return undefined;
  if (sourceVersion != null && sourceVersion < INCIDENT_CASE_SCHEMA_VERSION) throw new TypeError('This Case format cannot contain structured recheck answers.');
  const item = exact(value, ['targetHostname', 'baselinePinId', 'conditions', 'questionId', 'question', 'conditionsMatch'], 'Recheck answer context');
  const question = text(item.question, 'Recheck question', MAX_RESPONSE_RATIONALE_LENGTH);
  if (!question.trim()) throw new TypeError('A recheck answer requires its original question.');
  return Object.freeze({ ...contextFields(item), questionId: reference(item.questionId, 'Recheck question ID'),
    question,
    conditionsMatch: enumeration(item.conditionsMatch, Object.keys(CASE_RECHECK_CONDITIONS) as CaseRecheckConditionsMatch[], 'Recheck condition comparison') });
}

export function caseRecheckQuestions(assertions: readonly CaseAssertionRecord[]): readonly CaseAssertionRecord[] {
  return assertions.filter(item => item.kind === 'next_step' && item.recheck && item.state === 'open');
}

export function caseRecheckAnswerContext(question: CaseAssertionRecord, conditionsMatch: CaseRecheckAnswerContext['conditionsMatch']): CaseRecheckAnswerContext {
  if (question.kind !== 'next_step' || !question.recheck) throw new TypeError('Select a saved recheck question.');
  return readCaseRecheckAnswerContext({ ...question.recheck, questionId: question.id, question: question.statement, conditionsMatch })!;
}

/** A saved answer is a snapshot, not a live reference to an editable plan. */
export function assertCurrentRecheckQuestion(answer: CaseRecheckAnswerContext, assertions: readonly CaseAssertionRecord[]): void {
  const question = caseRecheckQuestions(assertions).find(item => item.id === answer.questionId);
  if (!question || JSON.stringify(caseRecheckAnswerContext(question, answer.conditionsMatch)) !== JSON.stringify(answer)) {
    throw new Error('The recheck question changed or was resolved. Refresh and review its current conditions before saving this answer.');
  }
}

export function caseRecheckComparisonWarnings(context: CaseRecheckAnswerContext, pins: readonly CaseEvidencePin[], current?: CaseEvidencePin): string[] {
  const warnings: string[] = [];
  if (context.conditionsMatch !== 'comparable') warnings.push(context.conditionsMatch === 'different'
    ? 'The comparison conditions differ.' : 'Comparable conditions have not been confirmed.');
  const baseline = pins.find(pin => pin.id === context.baselinePinId);
  if (context.baselinePinId && !baseline) warnings.push('The baseline evidence is no longer available.');
  if (current) {
    if (current.observationHostname !== context.targetHostname) warnings.push('The current evidence concerns a different or unknown hostname.');
    if (current.completeness !== 'complete' || current.truncated || current.sourceState !== 'complete' && current.sourceState !== 'success' && current.sourceState !== 'reviewed' && current.sourceState !== 'not_found') warnings.push('The current source does not establish a complete observation.');
    if (baseline) {
      if (baseline.id === current.id || !baseline.observedAt || !current.observedAt || Date.parse(current.observedAt) <= Date.parse(baseline.observedAt)) warnings.push('A later source observation is needed; reviewing the baseline again is not a recheck.');
      if (baseline.observationHostname && baseline.observationHostname !== context.targetHostname) warnings.push('The baseline concerns a different hostname.');
      if (baseline.field && current.field !== baseline.field || baseline.source !== current.source) warnings.push('The observations use different fields or sources.');
    }
  }
  return warnings;
}

export function assertRecheckNonReproduction(state: CaseObservedEffectState, context: CaseRecheckAnswerContext, completeness: string, pins: readonly CaseEvidencePin[], current?: CaseEvidencePin, observedAt?: string | null): void {
  if (state !== 'not_reproduced') return;
  const warnings = caseRecheckComparisonWarnings(context, pins, current);
  const baseline = pins.find(pin => pin.id === context.baselinePinId);
  if (!current && baseline && (!baseline.observedAt || !observedAt || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) <= Date.parse(baseline.observedAt))) warnings.push('A later independent observation is needed.');
  if (completeness !== 'complete' || warnings.length) throw new Error('Not reproduced requires a complete observation under comparable conditions. Record unavailable or describe the limited observation instead.');
}

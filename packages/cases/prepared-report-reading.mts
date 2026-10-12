import type { buildCaseReport } from './case-report.mts';
import { latestObservationCohort } from '../evidence/latest-observations.mts';
import { caseAssertionEvidenceReferences, caseEvidenceReferenceResolver } from './case-evidence-references.mts';

export type PreparedCaseReport = ReturnType<typeof buildCaseReport>['json'];
export type PreparedReportStatement = Readonly<{ kind: 'assertion' | 'decision'; id: string }>;

/** Reading only: references resolve against these prepared bytes, never a live Case. */
export function preparedStatementReferences(report: PreparedCaseReport, statement: PreparedReportStatement) {
  const resolve = caseEvidenceReferenceResolver(report.analystResponse.evidencePins);
  if (statement.kind === 'assertion') {
    const assertion = report.analystResponse.assertions.find(value => value.id === statement.id);
    return assertion ? caseAssertionEvidenceReferences(assertion, resolve) : null;
  }
  const decision = report.analystResponse.decisions.find(value => value.id === statement.id);
  return decision ? resolve(decision.evidencePinIds).map(reference => ({ ...reference, stance: null })) : null;
}

/** A bounded reading emphasis over the existing report, not another export model. */
export function preparedDecisionBrief(report: PreparedCaseReport) {
  const resolve = caseEvidenceReferenceResolver(report.analystResponse.evidencePins);
  const conclusions = latestObservationCohort(report.analystResponse.decisions, value => value.createdAt);
  const assertion = (value: PreparedCaseReport['analystResponse']['assertions'][number]) => ({
    assertion: value, references: caseAssertionEvidenceReferences(value, resolve),
  });
  return {
    assessments: report.analystResponse.assertions.filter(value => value.state === 'open' && value.kind !== 'next_step').map(assertion),
    latestConclusions: conclusions.latest,
    undatedConclusions: conclusions.undated,
    earlierConclusions: conclusions.superseded,
    nextSteps: report.analystResponse.assertions.filter(value => value.state === 'open' && value.kind === 'next_step').map(assertion),
    limitations: report.limitations,
  };
}

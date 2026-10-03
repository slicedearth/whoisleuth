import { CASE_ACTION_STATES, CASE_ACTION_TYPES } from '../../../../packages/cases/case-response-records.mts';
import type { CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';
import { MAX_CASES } from '../../../../packages/contracts/case-portability.mts';
import { casesForDomains } from '../../../../packages/cases/case-selection.mts';
import { buildCaseIncidentCoverage } from '../../../../packages/cases/case-workflow-metadata.mts';
import { buildCaseResponseLifecycleSummary } from '../../../../packages/cases/case-response-outcomes.mts';
import { normalizeCampaignDomains } from '../../../../packages/workspace/campaign-model.mts';
import type { OperationsReportSourceState } from './brand-protection-operations-report.ts';

/** Local presentation only. Campaign membership selects Cases; it never merges incidents. */
export function buildOperationsScopeReview(
  records: readonly CaseRecord[],
  sourceState: OperationsReportSourceState,
  campaignDomains?: readonly string[],
) {
  const domains = campaignDomains === undefined ? null : normalizeCampaignDomains(campaignDomains);
  const bounded = sourceState === 'ready' ? records.slice(0, MAX_CASES) : [];
  const selected = domains ? casesForDomains(bounded, domains) : bounded;
  const rows = selected.map(record => {
    const coverage = buildCaseIncidentCoverage(record);
    const lifecycle = buildCaseResponseLifecycleSummary(record);
    const latestReview = record.observedEffects.reviews.find(review => review.id === lifecycle.latestObservedEffect?.reviewId) ?? null;
    const providerEvent = record.actions.find(action => action.id === lifecycle.latestProviderOutcome?.actionId)?.history
      .find(event => event.id === lifecycle.latestProviderOutcome?.eventId) ?? null;
    return {
      record, coverage, lifecycle, latestReview, providerEvent,
      baselineRetained: Boolean(latestReview?.recheck?.baselinePinId
        && record.evidencePins.some(pin => pin.id === latestReview.recheck!.baselinePinId)),
      openObjects: coverage.filter(row => row.target.state === 'open').length,
      analystResolvedObjects: coverage.filter(row => row.target.state === 'resolved').length,
      observedState: latestReview ? 'available' as const : record.observedEffects.reviews.length ? 'ambiguous' as const : 'missing' as const,
      historyIncomplete: record.observedEffects.omitted > 0 || record.observedEffects.preV13HistoryUnavailable
        || record.closures.omitted > 0 || record.closures.preV13HistoryUnavailable
        || record.actions.some(action => action.historyOmitted > 0),
    };
  });
  return {
    sourceState, rows,
    missingDomains: sourceState === 'ready' && domains ? domains.filter(domain => !selected.some(record => record.domain === domain)) : null,
    casesOmitted: sourceState === 'ready' ? Math.max(0, records.length - MAX_CASES) : 0,
    openObjects: sourceState === 'ready' ? rows.reduce((count, row) => count + row.openObjects, 0) : null,
    analystResolvedObjects: sourceState === 'ready' ? rows.reduce((count, row) => count + row.analystResolvedObjects, 0) : null,
    unknownObjectCoverage: sourceState === 'ready' ? rows.reduce((count, row) => count + row.coverage.length, 0) : null,
  };
}

/** Presentation only; metric identifiers and the aggregate contract are unchanged. */
export function operationsContributorMetricLabel(metric: string): string {
  const labels: Readonly<Record<string, string>> = {
    'counts.actions': 'Current actions',
    'counts.casesInspected': 'Inspected Cases',
    'counts.casesWithActions': 'Cases with actions',
    'counts.overdue': 'Overdue actions',
    'counts.followUpDue': 'Actions due for follow-up',
    'counts.withProviderOutcome': 'Actions with a typed provider outcome',
    'counts.providerOutcomeEvents': 'Typed provider outcome events',
    'counts.independentEffectReviews': 'Independent effect reviews',
    'counts.independentChangedReviews': 'Independent changed reviews',
    'counts.withReference': 'Actions with a delivery reference',
    'counts.reviewedRecipientRoute': 'Actions with reviewed recipient-route context',
    'counts.unqualifiedRecipientRoute': 'Actions without qualified recipient-route context',
    'durations.submissionToProviderOutcome': 'Submission to provider outcome interval',
    'durations.providerReportedResolutionToIndependentChange': 'Provider-reported resolution to independent change interval',
    'omissions.actionsOutsideWindow': 'Actions outside the selected window',
    'omissions.actionsWithInvalidTime': 'Actions with an invalid event time',
  };
  if (Object.hasOwn(labels, metric)) return labels[metric]!;
  const readable = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ');
  const [group, value] = metric.split('.');
  if (group === 'states' && value && (CASE_ACTION_STATES as readonly string[]).includes(value)) return `${readable(value)} actions`;
  if (group === 'actionTypes' && value && (CASE_ACTION_TYPES as readonly string[]).includes(value)) return `${readable(value)} actions`;
  return 'Other retained contributions';
}

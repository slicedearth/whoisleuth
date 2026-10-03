import { CASE_ACTION_STATES, CASE_ACTION_TYPES } from '../../../../packages/cases/case-response-records.mts';

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

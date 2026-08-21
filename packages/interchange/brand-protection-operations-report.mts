import type { CaseRecord } from '../cases/case-model.mts';
import {
  CASE_ACTION_STATES,
  CASE_ACTION_TYPES,
  type CaseActionState,
  type CaseActionType,
} from '../cases/case-response-model.mts';
import {
  BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA,
  BRAND_PROTECTION_OPERATIONS_REPORT_VERSION,
  MAX_OPERATIONS_REPORT_BYTES,
} from '../contracts/analyst-interchange.mts';

export {
  BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA,
  BRAND_PROTECTION_OPERATIONS_REPORT_VERSION,
  MAX_OPERATIONS_REPORT_BYTES,
} from '../contracts/analyst-interchange.mts';

export const MAX_OPERATIONS_REPORT_CASES = 500;
export const MAX_OPERATIONS_REPORT_ACTIONS_PER_CASE = 50;

export const OPERATIONS_REPORT_WINDOWS = ['7d', '30d', '90d', 'all'] as const;
export type OperationsReportWindow = typeof OPERATIONS_REPORT_WINDOWS[number];
export type OperationsReportSourceState = 'loading' | 'ready' | 'unavailable';

type StateCounts = Readonly<Record<CaseActionState, number>>;
type TypeCounts = Readonly<Record<CaseActionType, number>>;

export type OperationsDurationMetric = Readonly<{
  denominator: number;
  eligible: number;
  included: number;
  ineligible: number;
  omittedMissingStart: number;
  omittedMissingEnd: number;
  omittedAmbiguous: number;
  minimumSeconds: number | null;
  medianSeconds: number | null;
  maximumSeconds: number | null;
}>;

export type BrandProtectionOperationsReport = Readonly<{
  schema: typeof BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA;
  version: typeof BRAND_PROTECTION_OPERATIONS_REPORT_VERSION;
  generatedAt: string;
  sourceState: OperationsReportSourceState;
  window: Readonly<{
    id: OperationsReportWindow;
    startAt: string | null;
    endAt: string;
    basis: 'latest applied action event occurredAt; independent review observedAt';
  }>;
  counts: Readonly<{
    casesInspected: number;
    casesWithActions: number;
    actions: number;
    drafting: number;
    readyForReview: number;
    reviewed: number;
    authorised: number;
    submitted: number;
    acknowledged: number;
    terminal: number;
    overdue: number;
    followUpDue: number;
    withProviderOutcome: number;
    providerOutcomeEvents: number;
    independentEffectReviews: number;
    independentChangedReviews: number;
    withReference: number;
    reviewedRecipientRoute: number;
    unqualifiedRecipientRoute: number;
  }> | null;
  states: StateCounts | null;
  actionTypes: TypeCounts | null;
  durations: Readonly<{
    submissionToProviderOutcome: OperationsDurationMetric;
    providerReportedResolutionToIndependentChange: OperationsDurationMetric;
  }> | null;
  omissions: Readonly<{
    casesBeyondLimit: number;
    actionsBeyondLimit: number;
    actionsOutsideWindow: number;
    actionsWithInvalidTime: number;
    transitionEventsOmitted: number;
    observedEffectReviewsOmitted: number;
  }>;
  limitations: readonly string[];
}>;

function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function reportWindow(value: unknown): OperationsReportWindow {
  return typeof value === 'string' && (OPERATIONS_REPORT_WINDOWS as readonly string[]).includes(value)
    ? value as OperationsReportWindow
    : '30d';
}

function emptyStateCounts(): Record<CaseActionState, number> {
  return Object.fromEntries(CASE_ACTION_STATES.map((state) => [state, 0])) as Record<CaseActionState, number>;
}

function emptyTypeCounts(): Record<CaseActionType, number> {
  return Object.fromEntries(CASE_ACTION_TYPES.map((type) => [type, 0])) as Record<CaseActionType, number>;
}

function durationMetric(denominator: number, values: readonly number[], omissions: Readonly<{
  missingStart: number;
  missingEnd: number;
  ambiguous: number;
}>): OperationsDurationMetric {
  const sorted = [...values].filter((value) => Number.isSafeInteger(value) && value >= 0).sort((a, b) => a - b);
  const middle = sorted.length
    ? sorted.length % 2
      ? sorted[Math.floor(sorted.length / 2)] ?? null
      : Math.floor(((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2)
    : null;
  const ineligible = Math.max(0, denominator - sorted.length - omissions.missingStart - omissions.missingEnd - omissions.ambiguous);
  return {
    denominator,
    eligible: sorted.length + omissions.missingEnd + omissions.ambiguous,
    included: sorted.length,
    ineligible,
    omittedMissingStart: omissions.missingStart,
    omittedMissingEnd: omissions.missingEnd,
    omittedAmbiguous: omissions.ambiguous,
    minimumSeconds: sorted.at(0) ?? null,
    medianSeconds: middle,
    maximumSeconds: sorted.at(-1) ?? null,
  };
}

export function buildBrandProtectionOperationsReport(
  records: readonly CaseRecord[],
  options: Readonly<{
    sourceState?: OperationsReportSourceState;
    window?: OperationsReportWindow;
    now?: string;
  }> = {},
): BrandProtectionOperationsReport {
  const generatedAt = validTimestamp(options.now) ?? new Date().toISOString();
  const endTime = Date.parse(generatedAt);
  const window = reportWindow(options.window);
  const days = window === 'all' ? null : Number.parseInt(window, 10);
  const startTime = days === null ? null : endTime - days * 86_400_000;
  const sourceState = options.sourceState ?? 'ready';
  const cases = records.slice(0, MAX_OPERATIONS_REPORT_CASES);
  let actionsBeyondLimit = 0;
  let actionsOutsideWindow = 0;
  let actionsWithInvalidTime = 0;
  let transitionEventsOmitted = 0;
  let observedEffectReviewsOmitted = 0;

  const base = {
    schema: BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA as typeof BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA,
    version: BRAND_PROTECTION_OPERATIONS_REPORT_VERSION as typeof BRAND_PROTECTION_OPERATIONS_REPORT_VERSION,
    generatedAt,
    sourceState,
    window: {
      id: window,
      startAt: startTime === null ? null : new Date(startTime).toISOString(),
      endAt: generatedAt,
      basis: 'latest applied action event occurredAt; independent review observedAt' as const,
    },
    omissions: {
      casesBeyondLimit: Math.max(0, records.length - MAX_OPERATIONS_REPORT_CASES),
      actionsBeyondLimit,
      actionsOutsideWindow,
      actionsWithInvalidTime,
      transitionEventsOmitted,
      observedEffectReviewsOmitted,
    },
  };

  const sharedLimitations = [
    'Counts use only the current bounded Case action records readable in this browser; they are not provider, delivery, or takedown telemetry.',
    'Ready for review, reviewed, and authorised are distinct append-only transitions. Readiness never implies authorisation, and creating or exporting a response packet does not create an action transition.',
    'Provider outcomes and independent observed-effect reviews remain separate. Durations use only unambiguous typed events and include their denominator and omitted or ineligible counts; they are not service levels, rankings, success rates, trends, or causal claims.',
    'Overdue and follow-up counts use recorded due dates on non-terminal actions. A reviewed recipient route records source and limitation text but does not prove reachability, responsibility, monitoring, or response.',
  ];

  if (sourceState !== 'ready') {
    return {
      ...base,
      counts: null,
      states: null,
      actionTypes: null,
      durations: null,
      limitations: [
        sourceState === 'loading'
          ? 'Case records are still loading. No zero or absence conclusion is available.'
          : 'Case records are unavailable. No zero or absence conclusion is available.',
        ...sharedLimitations,
      ],
    };
  }

  const states = emptyStateCounts();
  const actionTypes = emptyTypeCounts();
  const caseIds = new Set<string>();
  let overdue = 0;
  let followUpDue = 0;
  let withProviderOutcome = 0;
  let providerOutcomeEvents = 0;
  let independentEffectReviews = 0;
  let independentChangedReviews = 0;
  let withReference = 0;
  let reviewedRecipientRoute = 0;
  let unqualifiedRecipientRoute = 0;
  let actions = 0;
  const terminal = new Set<CaseActionState>(['terminal']);
  const providerDurationValues: number[] = [];
  const providerDurationOmissions = { missingStart: 0, missingEnd: 0, ambiguous: 0 };
  const independentDurationValues: number[] = [];
  const independentDurationOmissions = { missingStart: 0, missingEnd: 0, ambiguous: 0 };
  const externalRoutes = new Set<CaseActionType>([
    'registrar_report',
    'registry_report',
    'network_hosting_report',
    'security_contact_report',
  ]);

  for (const record of cases) {
    actionsBeyondLimit += Math.max(0, record.actions.length - MAX_OPERATIONS_REPORT_ACTIONS_PER_CASE);
    transitionEventsOmitted += record.actions.reduce((total, action) => total + action.historyOmitted, 0);
    observedEffectReviewsOmitted += record.observedEffects.omitted;
    const providerResolvedEvents = record.actions.flatMap((action) => action.history
      .filter((event) => event.applied && event.providerOutcome === 'provider_reports_resolved')
      .map((event) => ({ action, event })));
    const providerResolvedEventsInWindow = providerResolvedEvents.filter(({ event }) => {
      const occurredAt = Date.parse(event.occurredAt);
      return occurredAt <= endTime && (startTime === null || occurredAt >= startTime);
    });
    const changedReviews = record.observedEffects.reviews.filter((review) => review.state === 'changed');
    if (providerResolvedEvents.length === 0) independentDurationOmissions.missingStart += 1;
    else if (providerResolvedEventsInWindow.length === 0) {
      // The Case remains in the denominator, but its typed start event is
      // outside this report window and is therefore explicitly ineligible.
    } else if (providerResolvedEventsInWindow.length !== 1
      || providerResolvedEventsInWindow[0]!.action.historyOmitted > 0
      || providerResolvedEventsInWindow[0]!.action.history.some((event) => !event.applied)
      || record.observedEffects.omitted > 0) independentDurationOmissions.ambiguous += 1;
    else {
      const start = providerResolvedEventsInWindow[0]!.event;
      const laterChanges = changedReviews.filter((review) => {
        const observedAt = Date.parse(review.observedAt);
        return observedAt >= Date.parse(start.occurredAt) && observedAt <= endTime;
      });
      if (!laterChanges.length) independentDurationOmissions.missingEnd += 1;
      else independentDurationValues.push(Math.floor((Date.parse(laterChanges[0]!.observedAt) - Date.parse(start.occurredAt)) / 1_000));
    }
    for (const review of record.observedEffects.reviews) {
      const reviewTime = Date.parse(review.observedAt);
      if (reviewTime > endTime || (startTime !== null && reviewTime < startTime)) continue;
      independentEffectReviews += 1;
      if (review.state === 'changed') independentChangedReviews += 1;
    }
    for (const action of record.actions.slice(0, MAX_OPERATIONS_REPORT_ACTIONS_PER_CASE)) {
      const appliedEvents = action.history.filter((event) => event.applied);
      const latestEventAt = validTimestamp(appliedEvents.at(-1)?.occurredAt);
      if (!latestEventAt) {
        actionsWithInvalidTime += 1;
        continue;
      }
      const updatedTime = Date.parse(latestEventAt);
      if (updatedTime > endTime || (startTime !== null && updatedTime < startTime)) {
        actionsOutsideWindow += 1;
        continue;
      }
      actions += 1;
      caseIds.add(record.id);
      states[action.state] += 1;
      actionTypes[action.type] += 1;
      if (action.providerOutcome) withProviderOutcome += 1;
      providerOutcomeEvents += appliedEvents.filter((event) => {
        if (!event.providerOutcome) return false;
        const occurredAt = Date.parse(event.occurredAt);
        return occurredAt <= endTime && (startTime === null || occurredAt >= startTime);
      }).length;
      if (action.reference) withReference += 1;
      if (externalRoutes.has(action.type)) {
        if (action.contactSource && action.contactLimitations.length) reviewedRecipientRoute += 1;
        else unqualifiedRecipientRoute += 1;
      }
      if (!terminal.has(action.state)) {
        if (action.dueAt && Date.parse(action.dueAt) < endTime) overdue += 1;
        if (action.followUpAt && Date.parse(action.followUpAt) <= endTime) followUpDue += 1;
      }
      const submissionEvents = appliedEvents.filter((event) => event.nextState === 'submitted' && event.previousState === 'authorised');
      const submissionEventsInWindow = submissionEvents.filter((event) => {
        const occurredAt = Date.parse(event.occurredAt);
        return occurredAt <= endTime && (startTime === null || occurredAt >= startTime);
      });
      if (!submissionEvents.length) providerDurationOmissions.missingStart += 1;
      else if (!submissionEventsInWindow.length) {
        // The action remains in the denominator because its latest event is in
        // the report window, but its typed duration start is not.
      } else if (submissionEventsInWindow.length !== 1 || action.historyOmitted > 0 || action.history.some((event) => !event.applied)) {
        providerDurationOmissions.ambiguous += 1;
      } else {
        const start = submissionEventsInWindow[0]!;
        const outcome = appliedEvents.find((event) => event.providerOutcome && Date.parse(event.occurredAt) >= Date.parse(start.occurredAt));
        if (!outcome) providerDurationOmissions.missingEnd += 1;
        else providerDurationValues.push(Math.floor((Date.parse(outcome.occurredAt) - Date.parse(start.occurredAt)) / 1_000));
      }
    }
  }

  return {
    ...base,
    counts: {
      casesInspected: cases.length,
      casesWithActions: caseIds.size,
      actions,
      drafting: states.drafting,
      readyForReview: states.ready_for_review,
      reviewed: states.reviewed,
      authorised: states.authorised,
      submitted: states.submitted,
      acknowledged: states.acknowledged,
      terminal: states.terminal,
      overdue,
      followUpDue,
      withProviderOutcome,
      providerOutcomeEvents,
      independentEffectReviews,
      independentChangedReviews,
      withReference,
      reviewedRecipientRoute,
      unqualifiedRecipientRoute,
    },
    states,
    actionTypes,
    durations: {
      submissionToProviderOutcome: durationMetric(actions, providerDurationValues, providerDurationOmissions),
      providerReportedResolutionToIndependentChange: durationMetric(cases.length, independentDurationValues, independentDurationOmissions),
    },
    omissions: {
      casesBeyondLimit: Math.max(0, records.length - MAX_OPERATIONS_REPORT_CASES),
      actionsBeyondLimit,
      actionsOutsideWindow,
      actionsWithInvalidTime,
      transitionEventsOmitted,
      observedEffectReviewsOmitted,
    },
    limitations: sharedLimitations,
  };
}

export function serializeBrandProtectionOperationsReport(report: BrandProtectionOperationsReport): string {
  if (report.sourceState !== 'ready' || !report.counts) {
    throw new Error('A complete Case source is required before exporting an operations report.');
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > MAX_OPERATIONS_REPORT_BYTES) {
    throw new Error('The aggregate operations report exceeds its 64 KiB export limit.');
  }
  return serialized;
}

export function brandProtectionOperationsReportFilename(generatedAt: unknown): string {
  const timestamp = validTimestamp(generatedAt) ?? new Date().toISOString();
  return `whoisleuth-brand-protection-operations-${timestamp.replace(/[:.]/gu, '-')}.json`;
}

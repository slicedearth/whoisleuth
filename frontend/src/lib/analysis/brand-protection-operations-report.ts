import type { CaseRecord } from './case-model.ts';
import {
  CASE_ACTION_STATES,
  CASE_ACTION_TYPES,
  type CaseActionState,
  type CaseActionType,
} from './case-response-model.ts';

export const BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA = 'whoisleuth.brand-protection-operations-report';
export const BRAND_PROTECTION_OPERATIONS_REPORT_VERSION = 1;
export const MAX_OPERATIONS_REPORT_CASES = 500;
export const MAX_OPERATIONS_REPORT_ACTIONS_PER_CASE = 50;
export const MAX_OPERATIONS_REPORT_BYTES = 64 * 1024;

export const OPERATIONS_REPORT_WINDOWS = ['7d', '30d', '90d', 'all'] as const;
export type OperationsReportWindow = typeof OPERATIONS_REPORT_WINDOWS[number];
export type OperationsReportSourceState = 'loading' | 'ready' | 'unavailable';

type StateCounts = Readonly<Record<CaseActionState, number>>;
type TypeCounts = Readonly<Record<CaseActionType, number>>;

export type BrandProtectionOperationsReport = Readonly<{
  schema: typeof BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA;
  version: typeof BRAND_PROTECTION_OPERATIONS_REPORT_VERSION;
  generatedAt: string;
  sourceState: OperationsReportSourceState;
  window: Readonly<{
    id: OperationsReportWindow;
    startAt: string | null;
    endAt: string;
    basis: 'current action updatedAt';
  }>;
  counts: Readonly<{
    casesInspected: number;
    casesWithActions: number;
    actions: number;
    planned: number;
    prepared: number;
    submitted: number;
    acknowledged: number;
    resolved: number;
    closed: number;
    overdue: number;
    followUpDue: number;
    withOutcome: number;
    withReference: number;
    reviewedRecipientRoute: number;
    unqualifiedRecipientRoute: number;
  }> | null;
  states: StateCounts | null;
  actionTypes: TypeCounts | null;
  omissions: Readonly<{
    casesBeyondLimit: number;
    actionsBeyondLimit: number;
    actionsOutsideWindow: number;
    actionsWithInvalidTime: number;
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

  const base = {
    schema: BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA as typeof BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA,
    version: BRAND_PROTECTION_OPERATIONS_REPORT_VERSION as typeof BRAND_PROTECTION_OPERATIONS_REPORT_VERSION,
    generatedAt,
    sourceState,
    window: {
      id: window,
      startAt: startTime === null ? null : new Date(startTime).toISOString(),
      endAt: generatedAt,
      basis: 'current action updatedAt' as const,
    },
    omissions: {
      casesBeyondLimit: Math.max(0, records.length - MAX_OPERATIONS_REPORT_CASES),
      actionsBeyondLimit,
      actionsOutsideWindow,
      actionsWithInvalidTime,
    },
  };

  const sharedLimitations = [
    'Counts use only the current bounded Case action records readable in this browser; they are not provider, delivery, or takedown telemetry.',
    'Prepared means the recorded action state is ready for review. Creating or exporting a response packet does not create an action or count as prepared, submitted, acknowledged, resolved, or closed.',
    'Action states are current mutually exclusive records, not a reconstructed transition history. No response-time, service-level, trend, success-rate, or causal claim is calculated.',
    'Overdue and follow-up counts use recorded due dates on non-terminal actions. A reviewed recipient route records source and limitation text but does not prove reachability, responsibility, monitoring, or response.',
  ];

  if (sourceState !== 'ready') {
    return {
      ...base,
      counts: null,
      states: null,
      actionTypes: null,
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
  let withOutcome = 0;
  let withReference = 0;
  let reviewedRecipientRoute = 0;
  let unqualifiedRecipientRoute = 0;
  let actions = 0;
  const terminal = new Set<CaseActionState>(['resolved', 'closed']);
  const externalRoutes = new Set<CaseActionType>([
    'registrar_report',
    'registry_report',
    'network_hosting_report',
    'security_contact_report',
  ]);

  for (const record of cases) {
    actionsBeyondLimit += Math.max(0, record.actions.length - MAX_OPERATIONS_REPORT_ACTIONS_PER_CASE);
    for (const action of record.actions.slice(0, MAX_OPERATIONS_REPORT_ACTIONS_PER_CASE)) {
      const updatedAt = validTimestamp(action.updatedAt);
      if (!updatedAt) {
        actionsWithInvalidTime += 1;
        continue;
      }
      const updatedTime = Date.parse(updatedAt);
      if (updatedTime > endTime || (startTime !== null && updatedTime < startTime)) {
        actionsOutsideWindow += 1;
        continue;
      }
      actions += 1;
      caseIds.add(record.id);
      states[action.state] += 1;
      actionTypes[action.type] += 1;
      if (action.outcome) withOutcome += 1;
      if (action.reference) withReference += 1;
      if (externalRoutes.has(action.type)) {
        if (action.contactSource && action.contactLimitations.length) reviewedRecipientRoute += 1;
        else unqualifiedRecipientRoute += 1;
      }
      if (!terminal.has(action.state)) {
        if (action.dueAt && Date.parse(action.dueAt) < endTime) overdue += 1;
        if (action.followUpAt && Date.parse(action.followUpAt) <= endTime) followUpDue += 1;
      }
    }
  }

  return {
    ...base,
    counts: {
      casesInspected: cases.length,
      casesWithActions: caseIds.size,
      actions,
      planned: states.planned,
      prepared: states.ready_for_review,
      submitted: states.submitted,
      acknowledged: states.acknowledged,
      resolved: states.resolved,
      closed: states.closed,
      overdue,
      followUpDue,
      withOutcome,
      withReference,
      reviewedRecipientRoute,
      unqualifiedRecipientRoute,
    },
    states,
    actionTypes,
    omissions: {
      casesBeyondLimit: Math.max(0, records.length - MAX_OPERATIONS_REPORT_CASES),
      actionsBeyondLimit,
      actionsOutsideWindow,
      actionsWithInvalidTime,
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

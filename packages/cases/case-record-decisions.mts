// Lightweight canonical Case status and disposition definitions. Persistence,
// portability and presentation consumers derive these identities and policies
// without importing the wider Case record or serialisation graph.

export const CASE_STATUSES = Object.freeze([
  { value: 'new', label: 'New' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
] as const);
export type CaseStatus = typeof CASE_STATUSES[number]['value'];
export type CaseStatusOption = typeof CASE_STATUSES[number];

export const CASE_DISPOSITIONS = Object.freeze([
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'suspicious', label: 'Suspicious' },
  { value: 'confirmed_abuse', label: 'Confirmed abuse' },
  { value: 'false_positive', label: 'False positive' },
  { value: 'expected', label: 'Expected' },
  { value: 'closed_no_action', label: 'Closed without action' },
] as const);
export type CaseDisposition = typeof CASE_DISPOSITIONS[number]['value'];
export type CaseDispositionOption = typeof CASE_DISPOSITIONS[number];

export const DEFAULT_STATUS = 'new' satisfies CaseStatus;
export const DEFAULT_DISPOSITION = 'unreviewed' satisfies CaseDisposition;

type CaseStatusOperationPolicy = Readonly<{
  closed: boolean;
  closureRequired: boolean;
  directEdit: 'allowed' | 'existing_only';
}>;

const CASE_STATUS_OPERATION_POLICIES = Object.freeze({
  new: { closed: false, closureRequired: false, directEdit: 'allowed' },
  reviewing: { closed: false, closureRequired: false, directEdit: 'allowed' },
  monitoring: { closed: false, closureRequired: false, directEdit: 'allowed' },
  escalated: { closed: false, closureRequired: false, directEdit: 'allowed' },
  resolved: { closed: true, closureRequired: true, directEdit: 'existing_only' },
} as const satisfies Record<CaseStatus, CaseStatusOperationPolicy>);

type CaseDispositionDecisionPolicy = Readonly<{
  reviewed: boolean;
  supportsDefensiveResponse: boolean;
}>;

const CASE_DISPOSITION_DECISION_POLICIES = Object.freeze({
  unreviewed: { reviewed: false, supportsDefensiveResponse: false },
  suspicious: { reviewed: true, supportsDefensiveResponse: true },
  confirmed_abuse: { reviewed: true, supportsDefensiveResponse: true },
  false_positive: { reviewed: true, supportsDefensiveResponse: false },
  expected: { reviewed: true, supportsDefensiveResponse: false },
  closed_no_action: { reviewed: true, supportsDefensiveResponse: false },
} as const satisfies Record<CaseDisposition, CaseDispositionDecisionPolicy>);

export type ReviewedCaseDisposition = {
  [K in CaseDisposition]: (typeof CASE_DISPOSITION_DECISION_POLICIES)[K]['reviewed'] extends true ? K : never;
}[CaseDisposition];

function statusOption(value: unknown): CaseStatusOption | undefined {
  return CASE_STATUSES.find((option) => option.value === value);
}

function dispositionOption(value: unknown): typeof CASE_DISPOSITIONS[number] | undefined {
  return CASE_DISPOSITIONS.find((option) => option.value === value);
}

export function isValidStatus(value: unknown): value is CaseStatus {
  return Boolean(statusOption(value));
}

export function isValidDisposition(value: unknown): value is CaseDisposition {
  return Boolean(dispositionOption(value));
}

export function statusLabel(value: unknown): string {
  return statusOption(value)?.label ?? String(value || '');
}

export function dispositionLabel(value: unknown): string {
  return dispositionOption(value)?.label ?? String(value || '');
}

export function caseStatusRequiresClosure(value: unknown): boolean {
  const option = statusOption(value);
  return option ? CASE_STATUS_OPERATION_POLICIES[option.value].closureRequired : false;
}

export function caseStatusIsClosed(value: unknown): boolean {
  const option = statusOption(value);
  return option ? CASE_STATUS_OPERATION_POLICIES[option.value].closed : false;
}

export function isReviewedCaseDisposition(value: unknown): value is ReviewedCaseDisposition {
  const option = dispositionOption(value);
  return option ? CASE_DISPOSITION_DECISION_POLICIES[option.value].reviewed : false;
}

export function caseDispositionSupportsDefensiveResponse(value: unknown): boolean {
  const option = dispositionOption(value);
  return option ? CASE_DISPOSITION_DECISION_POLICIES[option.value].supportsDefensiveResponse : false;
}

export function caseStatusOptionsForDirectEdit(currentStatus: CaseStatus): readonly CaseStatusOption[] {
  return CASE_STATUSES.filter((option) => (
    CASE_STATUS_OPERATION_POLICIES[option.value].directEdit === 'allowed' || option.value === currentStatus
  ));
}

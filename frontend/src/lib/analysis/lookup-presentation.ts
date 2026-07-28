export type LookupEvidenceDensity = 'summary' | 'standard' | 'full';
export type LookupTaskView = 'general' | 'acquisition' | 'brand' | 'incident' | 'owned';
export type LookupSectionLink = Readonly<{ href: `#${string}`; label: string }>;

export const LOOKUP_EVIDENCE_DENSITIES = Object.freeze([
  Object.freeze({ id: 'summary' as const, label: 'Summary', detail: 'Overview and source-state ledger, with detailed sections reduced to headings.' }),
  Object.freeze({ id: 'standard' as const, label: 'Standard', detail: 'Evidence sections remain available while raw response data stays out of the reading path.' }),
  Object.freeze({ id: 'full' as const, label: 'Full', detail: 'Every settled evidence section, including the bounded raw response view.' }),
]);

export const LOOKUP_TASK_VIEWS = Object.freeze([
  Object.freeze({ id: 'general' as const, label: 'General investigation' }),
  Object.freeze({ id: 'acquisition' as const, label: 'Acquisition review' }),
  Object.freeze({ id: 'brand' as const, label: 'Brand review' }),
  Object.freeze({ id: 'incident' as const, label: 'Incident response' }),
  Object.freeze({ id: 'owned' as const, label: 'Owned-domain posture' }),
]);

const DENSITIES = new Set<LookupEvidenceDensity>(LOOKUP_EVIDENCE_DENSITIES.map((option) => option.id));
const TASKS = new Set<LookupTaskView>(LOOKUP_TASK_VIEWS.map((option) => option.id));

export function normalizeLookupEvidenceDensity(value: unknown): LookupEvidenceDensity {
  return typeof value === 'string' && DENSITIES.has(value as LookupEvidenceDensity)
    ? value as LookupEvidenceDensity
    : 'standard';
}

export function normalizeLookupTaskView(value: unknown): LookupTaskView {
  return typeof value === 'string' && TASKS.has(value as LookupTaskView)
    ? value as LookupTaskView
    : 'general';
}

const PRIORITY: Readonly<Record<LookupTaskView, readonly string[]>> = Object.freeze({
  general: Object.freeze(['overview', 'web-evidence', 'registry', 'external-intelligence', 'case-response', 'raw-data']),
  acquisition: Object.freeze(['overview', 'registry', 'web-evidence', 'case-response', 'external-intelligence', 'raw-data']),
  brand: Object.freeze(['overview', 'web-evidence', 'external-intelligence', 'registry', 'case-response', 'raw-data']),
  incident: Object.freeze(['overview', 'external-intelligence', 'web-evidence', 'registry', 'case-response', 'raw-data']),
  owned: Object.freeze(['overview', 'registry', 'web-evidence', 'case-response', 'external-intelligence', 'raw-data']),
});

export function prioritizeLookupSectionLinks(
  links: readonly LookupSectionLink[],
  task: unknown,
): LookupSectionLink[] {
  const order = PRIORITY[normalizeLookupTaskView(task)];
  const rank = new Map(order.map((id, index) => [`#${id}`, index]));
  return [...links].sort((left, right) => (
    (rank.get(left.href) ?? order.length) - (rank.get(right.href) ?? order.length)
  ));
}

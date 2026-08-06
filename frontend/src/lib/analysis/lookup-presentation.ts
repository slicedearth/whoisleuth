export type LookupEvidenceDensity = 'summary' | 'standard' | 'full';
export type LookupTaskView = 'general' | 'acquisition' | 'brand' | 'incident' | 'owned';
export type LookupSectionLink = Readonly<{ href: `#${string}`; label: string }>;
export type LookupPresentationState = Readonly<{
  density: LookupEvidenceDensity;
  task: LookupTaskView;
}>;

export type LookupPresentationStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const LOOKUP_PRESENTATION_STORAGE_KEY = 'whoisleuth:lookup-presentation:v1';
export const MAX_LOOKUP_PRESENTATION_SERIALIZED_BYTES = 1_024;

export const LOOKUP_EVIDENCE_DENSITIES = Object.freeze([
  Object.freeze({ id: 'summary' as const, label: 'Essentials', detail: 'A compact assessment, key observations, unresolved evidence, and one summary for each evidence family.' }),
  Object.freeze({ id: 'standard' as const, label: 'Evidence', detail: 'Settled evidence is grouped by task and remains collapsed until you choose a family to inspect.' }),
  Object.freeze({ id: 'full' as const, label: 'All evidence', detail: 'Every settled evidence family remains available, including advanced and bounded raw evidence, while each family stays collapsed until opened.' }),
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
    : 'summary';
}

export function normalizeLookupTaskView(value: unknown): LookupTaskView {
  return typeof value === 'string' && TASKS.has(value as LookupTaskView)
    ? value as LookupTaskView
    : 'general';
}

export function readLookupPresentation(
  storage: Pick<LookupPresentationStorage, 'getItem'>,
): LookupPresentationState {
  try {
    const serialized = storage.getItem(LOOKUP_PRESENTATION_STORAGE_KEY);
    if (serialized === null
      || serialized.length > MAX_LOOKUP_PRESENTATION_SERIALIZED_BYTES
      || new TextEncoder().encode(serialized).byteLength > MAX_LOOKUP_PRESENTATION_SERIALIZED_BYTES) {
      return { density: 'summary', task: 'general' };
    }
    const stored = JSON.parse(serialized) as {
      version?: unknown;
      density?: unknown;
      task?: unknown;
    } | null;
    if (stored?.version === 1) {
      return {
        density: normalizeLookupEvidenceDensity(stored.density),
        task: normalizeLookupTaskView(stored.task),
      };
    }
  } catch {
    // Invalid or unavailable browser storage falls back to the stable defaults.
  }
  return { density: 'summary', task: 'general' };
}

export function writeLookupPresentation(
  storage: Pick<LookupPresentationStorage, 'setItem'>,
  state: LookupPresentationState,
): void {
  try {
    storage.setItem(LOOKUP_PRESENTATION_STORAGE_KEY, JSON.stringify({
      version: 1,
      density: normalizeLookupEvidenceDensity(state.density),
      task: normalizeLookupTaskView(state.task),
    }));
  } catch {
    // The caller's in-memory selection remains valid when storage is unavailable.
  }
}

const PRIORITY: Readonly<Record<LookupTaskView, readonly string[]>> = Object.freeze({
  general: Object.freeze(['overview', 'registry', 'web-evidence', 'relationships-history', 'source-quality', 'case-response', 'advanced-evidence']),
  acquisition: Object.freeze(['overview', 'registry', 'relationships-history', 'web-evidence', 'source-quality', 'case-response', 'advanced-evidence']),
  brand: Object.freeze(['overview', 'web-evidence', 'relationships-history', 'registry', 'source-quality', 'case-response', 'advanced-evidence']),
  incident: Object.freeze(['overview', 'web-evidence', 'relationships-history', 'advanced-evidence', 'registry', 'source-quality', 'case-response']),
  owned: Object.freeze(['overview', 'registry', 'web-evidence', 'relationships-history', 'source-quality', 'case-response', 'advanced-evidence']),
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

export type LookupTaskView = 'general' | 'acquisition' | 'brand' | 'incident' | 'owned';
export type LookupSectionLink = Readonly<{ href: `#${string}`; label: string }>;
export type LookupPresentationState = Readonly<{
  task: LookupTaskView;
}>;

export type LookupPresentationStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const LOOKUP_PRESENTATION_STORAGE_KEY = 'whoisleuth:lookup-presentation:v1';
export const MAX_LOOKUP_PRESENTATION_SERIALIZED_BYTES = 1_024;

export const LOOKUP_TASK_VIEWS = Object.freeze([
  Object.freeze({ id: 'general' as const, label: 'General investigation' }),
  Object.freeze({ id: 'acquisition' as const, label: 'Acquisition review' }),
  Object.freeze({ id: 'brand' as const, label: 'Brand review' }),
  Object.freeze({ id: 'incident' as const, label: 'Incident response' }),
  Object.freeze({ id: 'owned' as const, label: 'Owned-domain posture' }),
]);

const TASKS = new Set<LookupTaskView>(LOOKUP_TASK_VIEWS.map((option) => option.id));

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
      return { task: 'general' };
    }
    const stored = JSON.parse(serialized) as {
      version?: unknown;
      task?: unknown;
    } | null;
    if (stored?.version === 1) {
      return {
        task: normalizeLookupTaskView(stored.task),
      };
    }
  } catch {
    // Invalid or unavailable browser storage falls back to the stable defaults.
  }
  return { task: 'general' };
}

export function writeLookupPresentation(
  storage: Pick<LookupPresentationStorage, 'setItem'>,
  state: LookupPresentationState,
): void {
  try {
    storage.setItem(LOOKUP_PRESENTATION_STORAGE_KEY, JSON.stringify({
      version: 1,
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

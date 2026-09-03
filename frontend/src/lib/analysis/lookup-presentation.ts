import { parseBoundedJson } from '../bounded-json.ts';
import { recordOrNull } from '../../../../lib/json-record.mts';

export type LookupTaskView = 'general' | 'acquisition' | 'brand' | 'incident' | 'owned';
export type LookupDepth = 'fast' | 'deep';
export type LookupSectionLink = Readonly<{ href: `#${string}`; label: string }>;
export type LookupPresentationState = Readonly<{
  task: LookupTaskView;
}>;

export type LookupPresentationStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const LOOKUP_PRESENTATION_STORAGE_KEY = 'whoisleuth:lookup-presentation:v1';
export const MAX_LOOKUP_PRESENTATION_SERIALIZED_BYTES = 1_024;
export const MAX_LOOKUP_URL_QUERY_LENGTH = 4_096;

export const LOOKUP_TASK_VIEWS = Object.freeze([
  Object.freeze({ id: 'general' as const, label: 'General investigation' }),
  Object.freeze({ id: 'acquisition' as const, label: 'Acquisition review' }),
  Object.freeze({ id: 'brand' as const, label: 'Brand review' }),
  Object.freeze({ id: 'incident' as const, label: 'Incident response' }),
  Object.freeze({ id: 'owned' as const, label: 'Owned-domain posture' }),
]);

const TASKS = new Set<LookupTaskView>(LOOKUP_TASK_VIEWS.map((option) => option.id));
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export function parseLookupTaskContext(value: unknown): LookupTaskView | null {
  if (typeof value !== 'string' || value.length > 16) return null;
  return TASKS.has(value as LookupTaskView) ? value as LookupTaskView : null;
}

export function normalizeLookupTaskView(value: unknown): LookupTaskView {
  return typeof value === 'string' && TASKS.has(value as LookupTaskView)
    ? value as LookupTaskView
    : 'general';
}

export type LookupUrlState<Result> = Readonly<{
  query: string;
  depth: LookupDepth;
  task: LookupTaskView;
  result: Result | null;
  completedTarget: string;
  error: string;
  retainedResultDepth: LookupDepth | null;
}>;

export type ReconciledLookupUrlState<Result> = Readonly<Omit<LookupUrlState<Result>, 'retainedResultDepth'>>;

function lookupUrlQuery(value: string | null): string | null {
  if (value === null || value.length > MAX_LOOKUP_URL_QUERY_LENGTH || CONTROL_CHARACTERS.test(value)) return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function lookupUrlDepth(value: string | null): LookupDepth | null {
  return value === 'fast' || value === 'deep' ? value : null;
}

const record = recordOrNull;

export function lookupResultDepth(value: unknown, fallback: LookupDepth | null = null): LookupDepth | null {
  const result = record(value);
  if (!result) return fallback;
  const availability = record(result.availability);
  if (availability?.deepScanComplete === false) return 'fast';
  if (availability?.deepScanComplete === true) return 'deep';
  const whois = record(result.whois);
  if (whois?.skipped === true
    && typeof whois.detail === 'string'
    && /fast rdap-only mode/iu.test(whois.detail)) return 'fast';
  const scanModes = [
    record(result.reverseDns)?.scanMode,
    record(availability?.dns)?.scanMode,
    record(availability?.http)?.scanMode,
  ];
  if (scanModes.includes('deep')) return 'deep';
  if (scanModes.includes('fast')) return 'fast';
  return fallback;
}

export function reconcileLookupUrlState<Result>(
  current: LookupUrlState<Result>,
  searchParams: Pick<URLSearchParams, 'get'>,
  preferredTask: unknown,
): ReconciledLookupUrlState<Result> {
  const explicitQuery = lookupUrlQuery(searchParams.get('q'));
  const explicitDepth = lookupUrlDepth(searchParams.get('depth'));
  const queryChanged = explicitQuery !== null && explicitQuery !== current.query;
  const depthChanged = explicitDepth !== null && explicitDepth !== current.depth;
  const conflictsWithResult = current.result !== null && (
    (explicitQuery !== null && explicitQuery !== current.completedTarget)
    || (explicitDepth !== null && explicitDepth !== current.retainedResultDepth)
  );
  return {
    query: explicitQuery ?? current.query,
    depth: explicitDepth ?? current.depth,
    task: parseLookupTaskContext(searchParams.get('task')) ?? normalizeLookupTaskView(preferredTask),
    result: conflictsWithResult ? null : current.result,
    completedTarget: conflictsWithResult ? '' : current.completedTarget,
    error: conflictsWithResult || queryChanged || depthChanged ? '' : current.error,
  };
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
    const stored = parseBoundedJson(serialized, {
      label: 'Lookup presentation state',
      maximumBytes: MAX_LOOKUP_PRESENTATION_SERIALIZED_BYTES,
    }) as {
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

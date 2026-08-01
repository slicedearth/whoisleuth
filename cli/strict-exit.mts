import type { UnknownRecord } from './saved-lookup.mts';

export const STRICT_EXIT_FAILURE_STATES = Object.freeze([
  'error',
  'failed',
  'partial',
  'rate_limited',
  'timeout',
  'unavailable',
] as const);
export const MAX_STRICT_EXIT_NODES = 2_000;

const FAILURE_STATES = new Set<string>(STRICT_EXIT_FAILURE_STATES);
const STATUS_FIELDS = new Set(['state', 'status']);

type StrictExitFinding = Readonly<{
  path: string;
  state: string;
}>;

function object(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function lookupStrictExitFindings(document: unknown): StrictExitFinding[] {
  const root = object(document);
  const diagnostics = object(root?.diagnostics);
  if (!diagnostics) return [{ path: 'diagnostics', state: 'unavailable' }];
  const findings: StrictExitFinding[] = [];
  const pending: Array<{ path: string; value: unknown }> = [{ path: 'diagnostics', value: diagnostics }];
  let visited = 0;
  while (pending.length && visited < MAX_STRICT_EXIT_NODES) {
    const current = pending.shift();
    if (!current) break;
    visited += 1;
    if (Array.isArray(current.value)) {
      current.value.slice(0, 100).forEach((value, index) => {
        pending.push({ path: `${current.path}[${index}]`, value });
      });
      continue;
    }
    const record = object(current.value);
    if (!record) continue;
    for (const [key, value] of Object.entries(record).slice(0, 100)) {
      const path = `${current.path}.${key}`;
      if (STATUS_FIELDS.has(key) && typeof value === 'string' && FAILURE_STATES.has(value.toLowerCase())) {
        findings.push({ path, state: value.toLowerCase() });
        if (findings.length >= 100) return findings;
      } else if (value && typeof value === 'object') {
        pending.push({ path, value });
      }
    }
  }
  if (visited >= MAX_STRICT_EXIT_NODES) findings.push({ path: 'diagnostics', state: 'partial' });
  return findings;
}

export { lookupStrictExitFindings };
export type { StrictExitFinding };

/** Bounded interpretation of current Lookup diagnostics, not retained history. */
const FAILURE_STATES: ReadonlySet<string> = new Set(['error', 'failed', 'partial', 'rate_limited', 'timeout', 'unavailable']);
const STATUS_FIELDS = new Set(['state', 'status']);
const MAX_NODES = 2_000;
export type StrictExitFinding = Readonly<{ path: string; state: string }>;
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function lookupStrictExitFindings(document: unknown): StrictExitFinding[] {
  const diagnostics = record(record(document)?.diagnostics);
  if (!diagnostics) return [{ path: 'diagnostics', state: 'unavailable' }];
  const findings: StrictExitFinding[] = [];
  const pending: Array<{ path: string; value: unknown }> = [{ path: 'diagnostics', value: diagnostics }];
  let visited = 0;
  while (pending.length && visited < MAX_NODES) {
    const current = pending.shift();
    if (!current) break;
    visited += 1;
    if (Array.isArray(current.value)) {
      current.value.slice(0, 100).forEach((value, index) => pending.push({ path: `${current.path}[${index}]`, value }));
      continue;
    }
    const source = record(current.value);
    if (!source) continue;
    for (const [key, value] of Object.entries(source).slice(0, 100)) {
      const path = `${current.path}.${key}`;
      if (STATUS_FIELDS.has(key) && typeof value === 'string' && FAILURE_STATES.has(value.toLowerCase())) {
        findings.push({ path, state: value.toLowerCase() });
        if (findings.length >= 100) return findings;
      } else if (value && typeof value === 'object') pending.push({ path, value });
    }
  }
  if (visited >= MAX_NODES) findings.push({ path: 'diagnostics', state: 'partial' });
  return findings;
}

// Bounded deterministic JSON projection shared by browser and CLI comparison paths.
const MAX_COLLECTION_SCAN = 256;
const MAX_DEPTH = 8;
const MAX_SCALAR_LENGTH = 2_000;
const MAX_TRAVERSAL_NODES = 1_024;
const MAX_SERIALISED_LENGTH = 8_192;

type ProjectionState = { truncated: boolean; nodes: number };
type JsonProjection = Readonly<{ value: string; truncated: boolean }>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedJsonString(value: string, state: ProjectionState): string {
  if (value.length > MAX_SCALAR_LENGTH) state.truncated = true;
  return JSON.stringify(value.slice(0, MAX_SCALAR_LENGTH));
}

function stableJson(value: unknown, depth: number, state: ProjectionState): string {
  if (depth > MAX_DEPTH) {
    state.truncated = true;
    return '"[bounded depth]"';
  }
  if (state.nodes >= MAX_TRAVERSAL_NODES) {
    state.truncated = true;
    return '"[bounded traversal]"';
  }
  state.nodes += 1;
  if (value === null) return 'null';
  if (typeof value === 'string') return boundedJsonString(value, state);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    const values: string[] = [];
    const limit = Math.min(value.length, MAX_COLLECTION_SCAN);
    for (let index = 0; index < limit && state.nodes < MAX_TRAVERSAL_NODES; index += 1) {
      values.push(stableJson(value[index], depth + 1, state));
    }
    if (values.length < value.length) state.truncated = true;
    return `[${values.join(',')}]`;
  }
  const item = record(value);
  if (!item) return 'null';
  const keys: string[] = [];
  for (const key in item) {
    if (!Object.hasOwn(item, key)) continue;
    if (keys.length >= MAX_COLLECTION_SCAN) {
      state.truncated = true;
      break;
    }
    keys.push(key);
  }
  keys.sort();
  const values: string[] = [];
  for (const key of keys) {
    if (state.nodes >= MAX_TRAVERSAL_NODES) {
      state.truncated = true;
      break;
    }
    values.push(`${boundedJsonString(key, state)}:${stableJson(item[key], depth + 1, state)}`);
  }
  if (values.length < keys.length) state.truncated = true;
  return `{${values.join(',')}}`;
}

export function projectComparisonLedgerJson(value: unknown): JsonProjection {
  const state = { truncated: false, nodes: 0 };
  const serialised = stableJson(value, 0, state);
  if (serialised.length > MAX_SERIALISED_LENGTH) state.truncated = true;
  return Object.freeze({ value: serialised.slice(0, MAX_SERIALISED_LENGTH), truncated: state.truncated });
}

export function stableComparisonLedgerJson(value: unknown): string {
  return projectComparisonLedgerJson(value).value;
}

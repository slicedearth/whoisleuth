import { exactKeys, requireRecord } from './bounded-contract-normalizers.mts';

export type DnsQueryState = 'observed' | 'partial' | 'unavailable';
export type DnsQueryCoverage = Readonly<{ owner: string; type: string; state: DnsQueryState }>;
const QUERY_KEYS = new Set(['owner', 'type', 'state']);

/** A positive legacy record proves its own query scope, never another type's absence. */
export function normaliseDnsQueryCoverage(
  value: unknown,
  options: Readonly<{
    legacy: boolean;
    label: string;
    maximum: number;
    state: DnsQueryState;
    records: readonly Readonly<{ owner: string; type: string }>[];
    owner: (value: unknown, label: string) => string;
    type: (value: unknown, label: string) => string;
  }>,
): readonly DnsQueryCoverage[] {
  const { label, maximum, state, records } = options;
  if (options.legacy) {
    return Object.freeze([...new Map(records.map((record) => [
      `${record.owner}\u0000${record.type}`,
      Object.freeze({ owner: record.owner, type: record.type, state }),
    ])).values()]);
  }
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} must contain no more than ${maximum} query outcomes.`);
  const byKey = new Map<string, DnsQueryCoverage>();
  for (const [index, raw] of value.entries()) {
    const path = `${label}[${index}]`;
    const item = requireRecord(raw, path);
    exactKeys(item, QUERY_KEYS, path);
    const owner = options.owner(item.owner, `${path}.owner`);
    const type = options.type(item.type, `${path}.type`);
    if (item.state !== 'observed' && item.state !== 'partial' && item.state !== 'unavailable') throw new TypeError(`${path}.state is unsupported.`);
    if ((state === 'unavailable' && item.state !== 'unavailable') || (state === 'observed' && item.state !== 'observed')) {
      throw new TypeError(`${path}.state contradicts the snapshot state.`);
    }
    const key = `${owner}\u0000${type}`;
    if (byKey.has(key)) throw new TypeError(`${path} duplicates an owner and type.`);
    byKey.set(key, Object.freeze({ owner, type, state: item.state }));
  }
  for (const record of records) {
    const query = byKey.get(`${record.owner}\u0000${record.type}`);
    if (!query || query.state === 'unavailable') throw new TypeError(`${label} must declare an observed or partial query for every supplied record.`);
  }
  return Object.freeze([...byKey.values()]);
}

export function dnsQueryState(queries: readonly DnsQueryCoverage[], owner: string, type: string): DnsQueryState | 'not_queried' {
  return queries.find((query) => query.owner === owner && query.type === type)?.state ?? 'not_queried';
}

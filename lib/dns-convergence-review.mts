import {
  exactKeys,
  requireBoundedString,
  requireDomainName,
  requireIsoTimestamp,
  requireRecord,
} from './bounded-contract-normalizers.mts';
import { normaliseRdata } from './zone-intent-review.mts';

export const DNS_CONVERGENCE_INPUT_SCHEMA = 'whoisleuth.dns-convergence.input';
export const DNS_CONVERGENCE_REVIEW_SCHEMA = 'whoisleuth.dns-convergence.review';
export const DNS_CONVERGENCE_REVIEW_VERSION = 1;
export const MAX_DNS_CONVERGENCE_SNAPSHOTS = 100;
export const MAX_DNS_CONVERGENCE_RECORDS = 2_000;

type RecordType = 'A' | 'AAAA' | 'CAA' | 'CNAME' | 'MX' | 'NS' | 'SOA' | 'SRV' | 'SVCB' | 'HTTPS' | 'TLSA' | 'TXT';
type ObservationState = 'observed' | 'partial' | 'unavailable';
const RECORD_TYPES = new Set<RecordType>(['A', 'AAAA', 'CAA', 'CNAME', 'MX', 'NS', 'SOA', 'SRV', 'SVCB', 'HTTPS', 'TLSA', 'TXT']);
const ROOT_KEYS = new Set(['schema', 'version', 'domain', 'expected', 'snapshots']);
const EXPECTED_KEYS = new Set(['owner', 'type', 'values']);
const SNAPSHOT_KEYS = new Set(['observer', 'source', 'observedAt', 'state', 'records']);
const RECORD_KEYS = new Set(['owner', 'type', 'value', 'ttl']);

function type(value: unknown, label: string): RecordType {
  const candidate = requireBoundedString(value, label, 16).toUpperCase() as RecordType;
  if (!RECORD_TYPES.has(candidate)) throw new TypeError(`${label} is unsupported.`);
  return candidate;
}

function owner(value: unknown, apex: string, label: string): string {
  const candidate = requireBoundedString(value, label, 253).toLowerCase().replace(/\.$/u, '');
  if (candidate === '@') return apex;
  if (candidate.length > 253 || candidate.split('.').some((part) => !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/u.test(part))) {
    throw new TypeError(`${label} must be a valid DNS owner name.`);
  }
  return candidate;
}

function state(value: unknown, label: string): ObservationState {
  if (value !== 'observed' && value !== 'partial' && value !== 'unavailable') throw new TypeError(`${label} is unsupported.`);
  return value;
}

function ttl(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 0x7fff_ffff) throw new TypeError(`${label} is outside its supported range.`);
  return Number(value);
}

function normaliseValue(recordType: RecordType, value: string) {
  if (recordType !== 'SOA') return normaliseRdata(recordType, value, null);
  const fields = value.trim().split(/\s+/u);
  if (fields.length >= 2) {
    fields[0] = fields[0]?.toLowerCase().replace(/\.$/u, '') ?? '';
    fields[1] = fields[1]?.toLowerCase().replace(/\.$/u, '') ?? '';
  }
  return { value: fields.join(' '), valueTreatment: 'normalised' as const };
}

function record(value: unknown, apex: string, label: string) {
  const input = requireRecord(value, label);
  exactKeys(input, RECORD_KEYS, label);
  const recordType = type(input.type, `${label}.type`);
  const normalised = normaliseValue(recordType, requireBoundedString(input.value, `${label}.value`, 16_384));
  return Object.freeze({
    owner: owner(input.owner, apex, `${label}.owner`),
    type: recordType,
    value: normalised.value,
    valueTreatment: normalised.valueTreatment,
    ttl: ttl(input.ttl, `${label}.ttl`),
  });
}

function expectedRows(value: unknown, apex: string) {
  if (value === null || value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('expected must contain no more than 100 rows.');
  const keys = new Set<string>();
  return Object.freeze(value.map((raw, index) => {
    const input = requireRecord(raw, `expected[${index}]`);
    exactKeys(input, EXPECTED_KEYS, `expected[${index}]`);
    const recordType = type(input.type, `expected[${index}].type`);
    const recordOwner = owner(input.owner, apex, `expected[${index}].owner`);
    const key = `${recordOwner}\u0000${recordType}`;
    if (keys.has(key)) throw new TypeError(`expected[${index}] duplicates an owner and type.`);
    keys.add(key);
    if (!Array.isArray(input.values) || input.values.length > 100) throw new TypeError(`expected[${index}].values must contain no more than 100 entries.`);
    const values = [...new Set(input.values.map((entry, valueIndex) => normaliseValue(
      recordType,
      requireBoundedString(entry, `expected[${index}].values[${valueIndex}]`, 16_384),
    ).value))].sort();
    return Object.freeze({ owner: recordOwner, type: recordType, values: Object.freeze(values) });
  }));
}

export function reviewDnsConvergence(inputRaw: unknown, generatedAtValue = new Date().toISOString()) {
  const input = requireRecord(inputRaw, 'DNS convergence input');
  if (input.schema !== DNS_CONVERGENCE_INPUT_SCHEMA || input.version !== 1) {
    throw new TypeError(`DNS convergence input must use ${DNS_CONVERGENCE_INPUT_SCHEMA} version 1.`);
  }
  exactKeys(input, ROOT_KEYS, 'DNS convergence input');
  const apex = requireDomainName(input.domain, 'domain');
  const expected = expectedRows(input.expected, apex);
  if (!Array.isArray(input.snapshots) || input.snapshots.length < 2 || input.snapshots.length > MAX_DNS_CONVERGENCE_SNAPSHOTS) {
    throw new TypeError(`snapshots must contain between 2 and ${MAX_DNS_CONVERGENCE_SNAPSHOTS} entries.`);
  }
  let recordCount = 0;
  const snapshots = input.snapshots.map((raw, index) => {
    const item = requireRecord(raw, `snapshots[${index}]`);
    exactKeys(item, SNAPSHOT_KEYS, `snapshots[${index}]`);
    if (!Array.isArray(item.records)) throw new TypeError(`snapshots[${index}].records must be an array.`);
    recordCount += item.records.length;
    if (recordCount > MAX_DNS_CONVERGENCE_RECORDS) throw new TypeError(`DNS convergence input is limited to ${MAX_DNS_CONVERGENCE_RECORDS} records.`);
    const observationState = state(item.state, `snapshots[${index}].state`);
    if (observationState === 'unavailable' && item.records.length) throw new TypeError(`snapshots[${index}] cannot contain records when unavailable.`);
    return Object.freeze({
      observer: requireBoundedString(item.observer, `snapshots[${index}].observer`, 120),
      source: requireBoundedString(item.source, `snapshots[${index}].source`, 240),
      observedAt: requireIsoTimestamp(item.observedAt, `snapshots[${index}].observedAt`),
      state: observationState,
      records: Object.freeze(item.records.map((entry, recordIndex) => record(entry, apex, `snapshots[${index}].records[${recordIndex}]`))),
    });
  }).sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.observer.localeCompare(right.observer));
  const observers = [...new Set(snapshots.map((item) => item.observer))];
  if (observers.length < 2) throw new TypeError('DNS convergence review requires at least two distinct observer labels.');
  const latestByObserver = observers.map((observer) => snapshots.filter((item) => item.observer === observer).at(-1)!);
  const keys = [...new Set([
    ...expected.map((item) => `${item.owner}\u0000${item.type}`),
    ...snapshots.flatMap((item) => item.records.map((entry) => `${entry.owner}\u0000${entry.type}`)),
  ])].sort();
  const rows = keys.map((key) => {
    const [recordOwner = '', recordType = ''] = key.split('\u0000');
    const expectedRow = expected.find((item) => item.owner === recordOwner && item.type === recordType);
    const observations = latestByObserver.map((snapshot) => {
      const matching = snapshot.records.filter((entry) => entry.owner === recordOwner && entry.type === recordType);
      const values = [...new Set(matching.map((entry) => entry.value))].sort();
      const ttls = matching.flatMap((entry) => entry.ttl === null ? [] : [entry.ttl]);
      const cacheUntil = ttls.length
        ? new Date(Date.parse(snapshot.observedAt) + Math.max(...ttls) * 1_000).toISOString()
        : null;
      return Object.freeze({
        observer: snapshot.observer,
        source: snapshot.source,
        observedAt: snapshot.observedAt,
        state: snapshot.state,
        values: Object.freeze(values),
        cacheUntil,
      });
    });
    const complete = observations.filter((item) => item.state === 'observed');
    const incomplete = observations.some((item) => item.state !== 'observed');
    const signatures = new Set(complete.map((item) => JSON.stringify(item.values)));
    const aligned = complete.length >= 2 && signatures.size === 1;
    const matchesExpected = expectedRow
      ? aligned && JSON.stringify(complete[0]?.values ?? []) === JSON.stringify(expectedRow.values)
      : null;
    const rowState = incomplete ? 'incomplete' as const
      : complete.length < 2 ? 'insufficient' as const
        : !aligned ? 'divergent' as const
          : matchesExpected === false ? 'unexpected' as const
            : 'converged' as const;
    return Object.freeze({
      owner: recordOwner,
      type: recordType,
      state: rowState,
      expectedValues: expectedRow?.values ?? null,
      observations: Object.freeze(observations),
    });
  });
  const reasons = Object.freeze([
    ...rows.filter((row) => row.state !== 'converged').map((row) => `${row.owner} ${row.type} is ${row.state}.`),
    ...latestByObserver.filter((item) => item.state !== 'observed').map((item) => `${item.observer} latest evidence is ${item.state}.`),
  ].slice(0, 200));
  return Object.freeze({
    schema: DNS_CONVERGENCE_REVIEW_SCHEMA,
    version: DNS_CONVERGENCE_REVIEW_VERSION,
    generatedAt: requireIsoTimestamp(generatedAtValue, 'generatedAt'),
    domain: apex,
    state: reasons.length ? 'review' as const : 'converged' as const,
    observers: Object.freeze(observers),
    snapshots: Object.freeze(snapshots),
    rows: Object.freeze(rows),
    gate: Object.freeze({ pass: reasons.length === 0, reasons }),
    limitations: Object.freeze([
      'This local workbench compares only supplied observations and makes no DNS request.',
      'Resolver differences can reflect caches, split-horizon policy, interception, collection timing, or propagation; they do not establish which value is authoritative.',
      'Cache-until times are simple observation-time plus supplied TTL projections and do not reveal actual cache age, refresh behaviour, or resolver policy.',
      'Partial and unavailable snapshots remain incomplete and are never interpreted as record absence.',
    ]),
  });
}

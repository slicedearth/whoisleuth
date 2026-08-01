import type { BulkLookupResult } from './bulk.mts';

type UnknownRecord = Record<string, unknown>;
type BulkResultFilter = 'all' | 'inconclusive' | 'registered';

const REGISTERED_STATES = new Set(['expiring', 'for_sale', 'registered']);
const MAX_DNS_VALUES_PER_TYPE = 100;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function boundedText(value: unknown, maximum = 500): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function availabilityState(item: BulkLookupResult): string {
  return item.ok ? boundedText(record(record(item.result).availability).state, 40).toLowerCase() : '';
}

function selectBulkItems(items: readonly BulkLookupResult[], filter: BulkResultFilter): BulkLookupResult[] {
  if (filter === 'all') return [...items];
  return items.filter((item) => {
    if (!item.ok) return filter === 'inconclusive';
    const state = availabilityState(item);
    return filter === 'registered' ? REGISTERED_STATES.has(state) : state === 'unknown';
  });
}

function stringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const candidate of value.slice(0, MAX_DNS_VALUES_PER_TYPE * 2)) {
    const normalized = boundedText(candidate, 500);
    if (normalized) output.add(normalized);
    if (output.size >= MAX_DNS_VALUES_PER_TYPE) break;
  }
  return [...output];
}

function mxValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const candidate of value.slice(0, MAX_DNS_VALUES_PER_TYPE * 2)) {
    const item = record(candidate);
    const exchange = boundedText(item.exchange ?? item.host ?? candidate, 253).replace(/\.$/u, '').toLowerCase();
    const priority = Number.isInteger(item.priority) ? Number(item.priority) : null;
    if (exchange) output.add(priority === null ? exchange : `${priority} ${exchange}`);
    if (output.size >= MAX_DNS_VALUES_PER_TYPE) break;
  }
  return [...output];
}

function bulkDnsSummary(item: BulkLookupResult) {
  if (!item.ok) {
    return {
      status: 'unavailable', a: [], aaaa: [], ns: [], mx: [],
      hasNullMx: null, hasSpf: null, hasDmarc: null,
    } as const;
  }
  const availability = record(record(item.result).availability);
  const dns = record(availability.dns);
  const records = record(dns.records);
  return {
    status: boundedText(dns.status, 40) || 'unavailable',
    a: stringValues(records.a),
    aaaa: stringValues(records.aaaa),
    ns: stringValues(records.ns),
    mx: mxValues(records.mx),
    hasNullMx: typeof availability.hasNullMx === 'boolean' ? availability.hasNullMx : null,
    hasSpf: typeof availability.hasSpf === 'boolean' ? availability.hasSpf : null,
    hasDmarc: typeof availability.hasDmarc === 'boolean' ? availability.hasDmarc : null,
  };
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(' | ') : boundedText(value, 32_768);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function booleanCell(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'observed' : 'not_observed';
}

function formatBulkCsv(items: readonly BulkLookupResult[]): string {
  const header = [
    'query', 'domain', 'outcome', 'availability', 'confidence', 'dns_status',
    'a', 'aaaa', 'ns', 'mx', 'null_mx', 'spf', 'dmarc', 'error',
  ];
  const rows = items.map((item) => {
    const availability = item.ok ? record(record(item.result).availability) : {};
    const dns = bulkDnsSummary(item);
    return [
      item.query,
      item.ok && item.classified.type === 'domain' ? item.classified.registrableDomain || item.classified.value : '',
      item.ok ? 'complete' : 'error',
      item.ok ? boundedText(availability.state, 40) || 'unknown' : 'unknown',
      item.ok ? boundedText(availability.confidence, 40) || 'unknown' : 'unknown',
      dns.status,
      dns.a,
      dns.aaaa,
      dns.ns,
      dns.mx,
      booleanCell(dns.hasNullMx),
      booleanCell(dns.hasSpf),
      booleanCell(dns.hasDmarc),
      item.ok ? '' : item.error,
    ].map(csvCell).join(',');
  });
  return `${[header.join(','), ...rows].join('\n')}\n`;
}

function formatBulkDomainList(items: readonly BulkLookupResult[]): string {
  const values = items.flatMap((item) => item.ok && item.classified.type === 'domain'
    ? [item.classified.registrableDomain || item.classified.value]
    : []);
  return values.length ? `${[...new Set(values)].join('\n')}\n` : '';
}

export {
  REGISTERED_STATES,
  availabilityState,
  bulkDnsSummary,
  formatBulkCsv,
  formatBulkDomainList,
  selectBulkItems,
};
export type { BulkResultFilter };

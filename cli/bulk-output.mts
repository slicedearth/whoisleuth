import type { BulkLookupResult } from './bulk.mts';
import { cliCsvCell } from './csv.mts';
import { lookupDiagnosticStates } from '../lib/lookup-diagnostics.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';

type UnknownRecord = Record<string, unknown>;
type BulkResultFilter = 'all' | 'errors' | 'inconclusive' | 'registered';

const REGISTERED_STATES = new Set(['expiring', 'for_sale', 'registered']);
const MAX_DNS_VALUES_PER_TYPE = 100;
const BULK_CSV_METADATA_COLUMNS = Object.freeze([
  'source_schema', 'source_version', 'observed_at', 'report_generated_at',
  'collection_origin', 'scan_mode', 'diagnostics_version', 'source_health',
]);
type CsvEvidenceMetadata = Readonly<{
  schema: string;
  version: number;
  generatedAt: string;
  mode: 'fast' | 'deep';
  results: readonly Readonly<Record<string, unknown>>[];
}>;

function bulkCsvMetadataValues(item: Readonly<Record<string, unknown>>, metadata: Omit<CsvEvidenceMetadata, 'results'>): readonly unknown[] {
  const diagnostics = record(item.diagnostics);
  return [
    metadata.schema,
    metadata.version,
    normalizeExplicitIsoTimestamp(item.observedAt) ?? 'unknown',
    normalizeExplicitIsoTimestamp(metadata.generatedAt) ?? 'unknown',
    item.collectionOrigin === 'current_run' || item.collectionOrigin === 'resumed_checkpoint' ? item.collectionOrigin : 'unknown',
    metadata.mode,
    Number.isSafeInteger(diagnostics.version) && Number(diagnostics.version) > 0 ? diagnostics.version : 'unknown',
    JSON.stringify(lookupDiagnosticStates(item.diagnostics)),
  ];
}

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
    if (filter === 'errors') return !item.ok;
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

function booleanCell(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'observed' : 'not_observed';
}

function formatBulkCsv(items: readonly BulkLookupResult[], metadata?: CsvEvidenceMetadata): string {
  if (metadata && metadata.results.length !== items.length) throw new TypeError('CSV metadata does not match the selected result count.');
  const header = [
    'query', 'domain', 'outcome', 'availability', 'confidence', 'dns_status',
    'a', 'aaaa', 'ns', 'mx', 'null_mx', 'spf', 'dmarc', 'error',
    ...(metadata ? BULK_CSV_METADATA_COLUMNS : []),
  ];
  const rows = items.map((item, index) => {
    const retained = metadata?.results[index];
    if (metadata && (!retained || retained.index !== item.index || retained.query !== item.query)) throw new TypeError('CSV metadata does not match the selected result identity.');
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
      ...(metadata && retained ? bulkCsvMetadataValues(retained, metadata) : []),
    ].map(cliCsvCell).join(',');
  });
  return `${[header.join(','), ...rows].join('\n')}\n`;
}

function formatBulkDomainList(items: readonly BulkLookupResult[]): string {
  const values = items.flatMap((item) => item.ok && item.classified.type === 'domain'
    ? [item.classified.registrableDomain || item.classified.value]
    : []);
  return values.length ? `${[...new Set(values)].join('\n')}\n` : '';
}

function formatBulkQueryList(items: readonly BulkLookupResult[]): string {
  return items.length ? `${items.map((item) => item.query).join('\n')}\n` : '';
}

export {
  REGISTERED_STATES,
  BULK_CSV_METADATA_COLUMNS,
  availabilityState,
  bulkDnsSummary,
  bulkCsvMetadataValues,
  formatBulkCsv,
  formatBulkDomainList,
  formatBulkQueryList,
  selectBulkItems,
};
export type { BulkResultFilter };

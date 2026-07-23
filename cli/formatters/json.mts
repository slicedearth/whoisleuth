import type { BulkLookupResult, ClassifiedQuery } from '../bulk.mts';
import type { UnknownRecord } from '../saved-lookup.mts';

const CLI_LOOKUP_SCHEMA = 'whoisleuth.cli.lookup';
const CLI_BULK_SCHEMA = 'whoisleuth.cli.bulk';
const CLI_BULK_ITEM_SCHEMA = 'whoisleuth.cli.bulk.item';
const CLI_CT_SEARCH_SCHEMA = 'whoisleuth.cli.ct-search';
const CLI_DISCOVER_SCHEMA = 'whoisleuth.cli.discover';
const CLI_DISCOVER_ITEM_SCHEMA = 'whoisleuth.cli.discover.item';
const CLI_POSTURE_SCHEMA = 'whoisleuth.cli.posture';
const CLI_HTTP_SCHEMA = 'whoisleuth.cli.http';
const CLI_TLS_SCHEMA = 'whoisleuth.cli.tls';
const CLI_COMPARE_SCHEMA = 'whoisleuth.cli.compare';
const CLI_LOOKUP_SCHEMA_VERSION = 1;
const CLI_BULK_SCHEMA_VERSION = 1;
const CLI_CT_SEARCH_SCHEMA_VERSION = 1;
const CLI_DISCOVER_SCHEMA_VERSION = 2;
const CLI_POSTURE_SCHEMA_VERSION = 1;
const CLI_HTTP_SCHEMA_VERSION = 1;
const CLI_TLS_SCHEMA_VERSION = 1;
const CLI_COMPARE_SCHEMA_VERSION = 3;

type DiscoverCandidate = {
  domain: unknown;
  source: unknown;
  tld: unknown;
  mutationTypes: unknown;
};

type DiscoverMetadata = {
  generatedAt: string;
  seed: string;
  preset: unknown;
  keyboardLayout: unknown;
  tlds: Iterable<unknown>;
  mutationFamilies?: Iterable<unknown>;
  dictionaryTermCount?: unknown;
  rejectedDictionaryTermCount?: unknown;
};

type BulkMetadata = { generatedAt: string; deep?: boolean; duplicates?: number };

function buildCliLookupDocument(
  query: string,
  classified: ClassifiedQuery,
  result: UnknownRecord,
  generatedAt = new Date().toISOString(),
  mode = 'fast',
): UnknownRecord {
  return {
    schema: CLI_LOOKUP_SCHEMA,
    version: CLI_LOOKUP_SCHEMA_VERSION,
    generatedAt,
    mode: mode === 'deep' ? 'deep' : 'fast',
    query,
    type: classified.type,
    inputHostname: classified.inputHostname,
    registrableDomain: classified.registrableDomain,
    isSubdomain: classified.isSubdomain,
    ...result,
  };
}

function formatJsonDocument(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildCliCtSearchDocument(
  keyword: string,
  result: UnknownRecord,
  generatedAt = new Date().toISOString(),
): UnknownRecord {
  return { ...result, schema: CLI_CT_SEARCH_SCHEMA, version: CLI_CT_SEARCH_SCHEMA_VERSION, generatedAt, keyword };
}

function buildCliDiscoverDocument(seed: string, result: UnknownRecord, metadata: DiscoverMetadata): UnknownRecord {
  return {
    ...result,
    schema: CLI_DISCOVER_SCHEMA,
    version: CLI_DISCOVER_SCHEMA_VERSION,
    generatedAt: metadata.generatedAt,
    seed,
    preset: metadata.preset,
    keyboardLayout: metadata.keyboardLayout,
    tlds: [...metadata.tlds],
    mutationFamilies: [...(metadata.mutationFamilies || [])],
    dictionaryTermCount: metadata.dictionaryTermCount || 0,
    rejectedDictionaryTermCount: metadata.rejectedDictionaryTermCount || 0,
  };
}

function discoverJsonItem(candidate: DiscoverCandidate, metadata: DiscoverMetadata): UnknownRecord {
  return {
    schema: CLI_DISCOVER_ITEM_SCHEMA,
    version: CLI_DISCOVER_SCHEMA_VERSION,
    generatedAt: metadata.generatedAt,
    seed: metadata.seed,
    preset: metadata.preset,
    keyboardLayout: metadata.keyboardLayout,
    mutationFamilies: [...(metadata.mutationFamilies || [])],
    dictionaryTermCount: metadata.dictionaryTermCount || 0,
    domain: candidate.domain,
    source: candidate.source,
    tld: candidate.tld,
    mutationTypes: candidate.mutationTypes,
  };
}

function formatDiscoverJsonLines(candidates: DiscoverCandidate[], metadata: DiscoverMetadata): string {
  if (!candidates.length) return '';
  return `${candidates.map((candidate) => JSON.stringify(discoverJsonItem(candidate, metadata))).join('\n')}\n`;
}

function versionedResult(
  result: UnknownRecord,
  schema: string,
  version: number,
  generatedAt: string,
  requestedField: string,
  requestedValue: string,
): UnknownRecord {
  return { ...result, schema, version, generatedAt, [requestedField]: requestedValue };
}

function buildCliPostureDocument(requestedDomain: string, report: UnknownRecord, generatedAt = new Date().toISOString()): UnknownRecord {
  return versionedResult(report, CLI_POSTURE_SCHEMA, CLI_POSTURE_SCHEMA_VERSION, generatedAt, 'requestedDomain', requestedDomain);
}

function buildCliHttpDocument(requestedDomain: string, result: UnknownRecord, generatedAt = new Date().toISOString()): UnknownRecord {
  return versionedResult(result, CLI_HTTP_SCHEMA, CLI_HTTP_SCHEMA_VERSION, generatedAt, 'requestedDomain', requestedDomain);
}

function buildCliTlsDocument(requestedHostname: string, result: UnknownRecord, generatedAt = new Date().toISOString()): UnknownRecord {
  return versionedResult(result, CLI_TLS_SCHEMA, CLI_TLS_SCHEMA_VERSION, generatedAt, 'requestedHostname', requestedHostname);
}

function buildCliCompareDocument(result: UnknownRecord, generatedAt = new Date().toISOString()): UnknownRecord {
  return { ...result, schema: CLI_COMPARE_SCHEMA, version: CLI_COMPARE_SCHEMA_VERSION, generatedAt };
}

function bulkJsonItem(item: BulkLookupResult, metadata: BulkMetadata): UnknownRecord {
  if (!item.ok) {
    return {
      schema: CLI_BULK_ITEM_SCHEMA, version: CLI_BULK_SCHEMA_VERSION, generatedAt: metadata.generatedAt,
      index: item.index, query: item.query, ok: false, error: item.error,
    };
  }
  const result = item.result as UnknownRecord;
  return {
    schema: CLI_BULK_ITEM_SCHEMA, version: CLI_BULK_SCHEMA_VERSION, generatedAt: metadata.generatedAt,
    index: item.index, query: item.query, ok: true,
    type: item.classified.type,
    inputHostname: item.classified.inputHostname,
    registrableDomain: item.classified.registrableDomain,
    isSubdomain: item.classified.isSubdomain,
    availability: result.availability,
    diagnostics: result.diagnostics,
    mode: metadata.deep ? 'deep' : 'fast',
  };
}

function buildCliBulkDocument(items: BulkLookupResult[], metadata: BulkMetadata): UnknownRecord {
  const succeeded = items.filter((item) => item.ok).length;
  return {
    schema: CLI_BULK_SCHEMA, version: CLI_BULK_SCHEMA_VERSION, generatedAt: metadata.generatedAt,
    mode: metadata.deep ? 'deep' : 'fast',
    summary: { total: items.length, succeeded, failed: items.length - succeeded, duplicatesRemoved: metadata.duplicates || 0 },
    results: items.map((item) => bulkJsonItem(item, metadata)),
  };
}

function formatJsonLines(items: BulkLookupResult[], metadata: BulkMetadata): string {
  return `${items.map((item) => JSON.stringify(bulkJsonItem(item, metadata))).join('\n')}\n`;
}

export {
  CLI_BULK_ITEM_SCHEMA, CLI_BULK_SCHEMA, CLI_BULK_SCHEMA_VERSION,
  CLI_COMPARE_SCHEMA, CLI_COMPARE_SCHEMA_VERSION, CLI_CT_SEARCH_SCHEMA, CLI_CT_SEARCH_SCHEMA_VERSION,
  CLI_DISCOVER_ITEM_SCHEMA, CLI_DISCOVER_SCHEMA, CLI_DISCOVER_SCHEMA_VERSION,
  CLI_HTTP_SCHEMA, CLI_HTTP_SCHEMA_VERSION, CLI_POSTURE_SCHEMA, CLI_POSTURE_SCHEMA_VERSION,
  CLI_TLS_SCHEMA, CLI_TLS_SCHEMA_VERSION, CLI_LOOKUP_SCHEMA, CLI_LOOKUP_SCHEMA_VERSION,
  buildCliBulkDocument, buildCliCompareDocument,
  buildCliCtSearchDocument, buildCliDiscoverDocument, buildCliHttpDocument,
  buildCliLookupDocument, buildCliPostureDocument, buildCliTlsDocument,
  bulkJsonItem, discoverJsonItem, formatDiscoverJsonLines, formatJsonDocument, formatJsonLines,
};
export type { BulkMetadata, DiscoverCandidate, DiscoverMetadata };

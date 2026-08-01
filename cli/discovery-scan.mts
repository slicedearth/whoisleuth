import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import type { BulkLookupResult, BulkLookupOptions } from './bulk.mts';
import { runBulkLookups } from './bulk.mts';
import { REGISTERED_STATES, availabilityState, bulkDnsSummary } from './bulk-output.mts';
import { CliUsageError } from './errors.mts';
import type { UnknownRecord } from './saved-lookup.mts';

export const CLI_DISCOVERY_SCAN_SCHEMA = 'whoisleuth.cli.discovery-scan';
export const CLI_DISCOVERY_SCAN_ITEM_SCHEMA = 'whoisleuth.cli.discovery-scan.item';
export const CLI_DISCOVERY_SCAN_VERSION = 1;
export const MAX_DISCOVERY_SCAN_ALLOWLIST_BYTES = 64 * 1024;
export const MAX_DISCOVERY_SCAN_ALLOWLIST_ITEMS = 500;
const MAX_DISCOVERY_SCAN_RELATIONSHIPS = 200;

type Candidate = { domain: unknown; source: unknown; tld: unknown; mutationTypes: unknown };
type ReviewLane = 'acquisition_review' | 'investigate' | 'retry' | 'suppressed';
type ScanFilter = 'all' | 'registered' | 'inconclusive' | 'acquisition' | 'suppressed';
type TextStream = { isTTY?: boolean; [Symbol.asyncIterator]?: () => AsyncIterator<unknown> };
type ScanMetadata = {
  generatedAt: string;
  seed: string;
  preset: unknown;
  keyboardLayout: unknown;
  tlds: readonly string[];
  mutationFamilies: readonly string[];
  generatedCandidateCount: number;
  selectedCandidateCount: number;
  scanLimit: number;
  chunkSize: number;
  concurrency: number;
  deep: boolean;
  filter: ScanFilter;
  resolverServers: readonly string[];
};

type ScanRelationship = {
  id: string;
  type: 'address' | 'mail_server' | 'nameserver';
  value: string;
  domains: string[];
  domainCount: number;
};

type ScanResult = ReturnType<typeof buildScanItem>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function boundedText(value: unknown, maximum = 500): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

async function readDiscoveryScanListBounded(
  stream: TextStream | null | undefined,
  limit = MAX_DISCOVERY_SCAN_ALLOWLIST_BYTES,
): Promise<string> {
  if (!stream || stream.isTTY) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<unknown>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`Discovery scan allowlists are limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseDiscoveryScanAllowlist(
  text: unknown,
  classifyQuery: NonNullable<BulkLookupOptions['classifyQuery']>,
): Set<string> {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_DISCOVERY_SCAN_ALLOWLIST_BYTES) {
    throw new CliUsageError(`Discovery scan allowlists are limited to ${MAX_DISCOVERY_SCAN_ALLOWLIST_BYTES} bytes.`);
  }
  const values = new Set<string>();
  for (const line of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    if (value.length > 253 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new CliUsageError('Discovery scan allowlists contain an invalid or overlong value.');
    }
    let classified;
    try {
      classified = classifyQuery(value);
    } catch {
      throw new CliUsageError(`Discovery scan allowlist value "${boundedText(value, 80)}" is not a domain.`);
    }
    if (classified.type !== 'domain') throw new CliUsageError('Discovery scan allowlists may contain domains only.');
    values.add(classified.registrableDomain || classified.value);
    if (values.size > MAX_DISCOVERY_SCAN_ALLOWLIST_ITEMS) {
      throw new CliUsageError(`Discovery scan allowlists are limited to ${MAX_DISCOVERY_SCAN_ALLOWLIST_ITEMS} unique domains.`);
    }
  }
  return values;
}

function normalizedCandidate(candidate: Candidate) {
  const domain = boundedText(candidate.domain, 253).toLowerCase();
  const source = boundedText(candidate.source, 253).toLowerCase();
  const tld = boundedText(candidate.tld, 63).toLowerCase();
  const mutationTypes = Array.isArray(candidate.mutationTypes)
    ? [...new Set(candidate.mutationTypes.flatMap((value) => {
        const normalized = boundedText(value, 80);
        return normalized ? [normalized] : [];
      }))].slice(0, 20)
    : [];
  return { domain, source, tld, mutationTypes };
}

function reviewFor(item: BulkLookupResult, domain: string, allowlist: ReadonlySet<string>) {
  const state = availabilityState(item) || 'unknown';
  const dns = bulkDnsSummary(item);
  const reasons: string[] = [];
  let lane: ReviewLane;
  if (allowlist.has(domain)) {
    lane = 'suppressed';
    reasons.push('The domain matches the analyst-supplied allowlist. Evidence is retained but deprioritized.');
  } else if (!item.ok || state === 'unknown') {
    lane = 'retry';
    reasons.push('Collection failed or authoritative registration evidence remained inconclusive.');
  } else if (state === 'available') {
    lane = 'acquisition_review';
    reasons.push('Authoritative lookup evidence reported the candidate as available at collection time.');
  } else {
    lane = 'investigate';
    reasons.push(REGISTERED_STATES.has(state)
      ? 'Registration evidence indicates that the candidate is registered or in a registered lifecycle state.'
      : 'The observed state warrants analyst review before any conclusion.');
  }
  if (dns.hasNullMx === true) reasons.push('A null MX record was observed, indicating that the domain does not accept mail under the published policy.');
  else if (dns.mx.length) reasons.push('One or more MX records were observed; mail capability requires separate passive review.');
  return { lane, reasons, state };
}

function buildScanItem(
  candidate: Candidate,
  item: BulkLookupResult,
  allowlist: ReadonlySet<string>,
  relationshipIds: readonly string[] = [],
) {
  const normalized = normalizedCandidate(candidate);
  const review = reviewFor(item, normalized.domain, allowlist);
  const result = item.ok ? record(item.result) : {};
  return {
    schema: CLI_DISCOVERY_SCAN_ITEM_SCHEMA,
    version: CLI_DISCOVERY_SCAN_VERSION,
    domain: normalized.domain,
    source: normalized.source,
    tld: normalized.tld,
    mutationTypes: normalized.mutationTypes,
    ok: item.ok,
    availabilityState: review.state,
    confidence: item.ok ? boundedText(record(result.availability).confidence, 40) || 'unknown' : 'unknown',
    dnsSummary: bulkDnsSummary(item),
    review: { lane: review.lane, reasons: review.reasons },
    relationshipIds: [...relationshipIds],
    ...(item.ok ? {
      availability: result.availability,
      diagnostics: result.diagnostics,
    } : { error: item.error }),
  };
}

function relationshipId(type: ScanRelationship['type'], value: string): string {
  return `rel-${createHash('sha256').update(`${type}\n${value}`).digest('hex').slice(0, 16)}`;
}

function buildRelationships(candidates: readonly Candidate[], items: readonly BulkLookupResult[]): ScanRelationship[] {
  const groups = new Map<string, { type: ScanRelationship['type']; value: string; domains: Set<string> }>();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const candidate = candidates[index];
    if (!item || !candidate || !item.ok) continue;
    const domain = normalizedCandidate(candidate).domain;
    const dns = bulkDnsSummary(item);
    const observations: Array<readonly [ScanRelationship['type'], string]> = [
      ...dns.a.map((value) => ['address', value] as const),
      ...dns.aaaa.map((value) => ['address', value] as const),
      ...dns.ns.map((value) => ['nameserver', value.toLowerCase().replace(/\.$/u, '')] as const),
      ...dns.mx.map((value) => ['mail_server', value.replace(/^\d+\s+/u, '').toLowerCase().replace(/\.$/u, '')] as const),
    ];
    for (const [type, value] of observations) {
      if (!value) continue;
      const key = `${type}\n${value}`;
      const group = groups.get(key) || { type, value, domains: new Set<string>() };
      group.domains.add(domain);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .filter((group) => group.domains.size >= 2)
    .sort((left, right) => right.domains.size - left.domains.size
      || left.type.localeCompare(right.type) || left.value.localeCompare(right.value))
    .slice(0, MAX_DISCOVERY_SCAN_RELATIONSHIPS)
    .map((group) => ({
      id: relationshipId(group.type, group.value),
      type: group.type,
      value: group.value,
      domains: [...group.domains].sort(),
      domainCount: group.domains.size,
    }));
}

function selectedByFilter(item: ScanResult, filter: ScanFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'registered') return REGISTERED_STATES.has(item.availabilityState);
  if (filter === 'inconclusive') return !item.ok || item.availabilityState === 'unknown';
  if (filter === 'acquisition') return item.review.lane === 'acquisition_review';
  return item.review.lane === 'suppressed';
}

function coverageSummary(results: readonly ScanResult[]) {
  const states: Record<string, number> = {};
  const lanes: Record<string, number> = {};
  const tlds: Record<string, { total: number; available: number; registered: number; inconclusive: number }> = {};
  for (const item of results) {
    states[item.availabilityState] = (states[item.availabilityState] ?? 0) + 1;
    lanes[item.review.lane] = (lanes[item.review.lane] ?? 0) + 1;
    const tld = tlds[item.tld] || { total: 0, available: 0, registered: 0, inconclusive: 0 };
    tld.total += 1;
    if (item.availabilityState === 'available') tld.available += 1;
    else if (REGISTERED_STATES.has(item.availabilityState)) tld.registered += 1;
    else tld.inconclusive += 1;
    tlds[item.tld] = tld;
  }
  return { states, reviewLanes: lanes, tlds };
}

function buildDiscoveryScanDocument(
  candidates: readonly Candidate[],
  items: readonly BulkLookupResult[],
  metadata: ScanMetadata,
  allowlist: ReadonlySet<string>,
  snapshot: unknown = null,
) {
  if (candidates.length !== items.length) throw new TypeError('Discovery candidates and lookup results must align.');
  const relationships = buildRelationships(candidates, items);
  const relationshipIdsByDomain = new Map<string, string[]>();
  for (const relationship of relationships) {
    for (const domain of relationship.domains) {
      const ids = relationshipIdsByDomain.get(domain) || [];
      ids.push(relationship.id);
      relationshipIdsByDomain.set(domain, ids);
    }
  }
  const allResults = candidates.map((candidate, index) => {
    const domain = normalizedCandidate(candidate).domain;
    const item = items[index];
    if (!item) throw new TypeError('Discovery scan result alignment failed.');
    return buildScanItem(candidate, item, allowlist, relationshipIdsByDomain.get(domain) || []);
  });
  const results = allResults.filter((item) => selectedByFilter(item, metadata.filter));
  return {
    schema: CLI_DISCOVERY_SCAN_SCHEMA,
    version: CLI_DISCOVERY_SCAN_VERSION,
    generatedAt: metadata.generatedAt,
    seed: metadata.seed,
    mode: metadata.deep ? 'deep' : 'fast',
    generation: {
      preset: metadata.preset,
      keyboardLayout: metadata.keyboardLayout,
      tlds: [...metadata.tlds],
      mutationFamilies: [...metadata.mutationFamilies],
      generatedCandidateCount: metadata.generatedCandidateCount,
      selectedCandidateCount: metadata.selectedCandidateCount,
      scanLimit: metadata.scanLimit,
    },
    collection: {
      chunkSize: metadata.chunkSize,
      concurrency: metadata.concurrency,
      resolver: metadata.resolverServers.length ? 'analyst_selected' : 'system_default',
      resolverServers: [...metadata.resolverServers],
    },
    filter: metadata.filter,
    summary: {
      collected: allResults.length,
      matched: results.length,
      succeeded: allResults.filter((item) => item.ok).length,
      failed: allResults.filter((item) => !item.ok).length,
      suppressed: allResults.filter((item) => item.review.lane === 'suppressed').length,
    },
    coverage: coverageSummary(allResults),
    relationships,
    results,
    ...(snapshot ? { snapshot } : {}),
    nextActions: [
      'Deep-collect only the candidates selected for review before comparing page, mail, certificate, or technology evidence.',
      'Confirm an available result again at the authoritative registration source before considering defensive acquisition.',
      'Treat shared infrastructure as a pivot lead only; it does not establish ownership, control, intent, safety, or maliciousness.',
      'Keep analyst assertions and external enforcement decisions separate from these observed and derived results.',
    ],
    limitations: [
      'Candidate mutations are leads, not findings. Selection order is deterministic and bounded by the requested scan limit.',
      'Failed, partial, rate-limited, and unavailable sources remain inconclusive and are not interpreted as absence or safety.',
      'The allowlist changes review priority only. It does not remove collected evidence or assert that a domain is benign.',
      'Relationship groups use exact bounded DNS observations from this run and can include common shared infrastructure.',
    ],
  };
}

async function runDiscoveryScanChunks(
  queries: readonly string[],
  options: BulkLookupOptions & { chunkSize: number },
): Promise<BulkLookupResult[]> {
  if (!Number.isSafeInteger(options.chunkSize) || options.chunkSize < 1 || options.chunkSize > 100) {
    throw new TypeError('Discovery scan chunk size is invalid.');
  }
  const output = new Array<BulkLookupResult>(queries.length);
  for (const initial of options.initialResults || []) output[initial.index] = initial;
  for (let start = 0; start < queries.length; start += options.chunkSize) {
    options.signal?.throwIfAborted();
    const chunkQueries = queries.slice(start, start + options.chunkSize);
    const initialResults = (options.initialResults || [])
      .filter((item) => item.index >= start && item.index < start + chunkQueries.length)
      .map((item) => ({ ...item, index: item.index - start }));
    const chunk = await runBulkLookups([...chunkQueries], {
      ...options,
      initialResults,
      onItemSettled: (item) => options.onItemSettled?.({ ...item, index: item.index + start }),
    });
    for (const item of chunk) output[item.index + start] = { ...item, index: item.index + start };
  }
  return output;
}

function formatDiscoveryScanJsonLines(document: ReturnType<typeof buildDiscoveryScanDocument>): string {
  return document.results.length
    ? `${document.results.map((item) => JSON.stringify({ ...item, generatedAt: document.generatedAt })).join('\n')}\n`
    : '';
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(' | ') : boundedText(value, 32_768);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatDiscoveryScanCsv(document: ReturnType<typeof buildDiscoveryScanDocument>): string {
  const header = ['domain', 'availability', 'confidence', 'review_lane', 'mutation_types', 'a', 'aaaa', 'ns', 'mx', 'relationship_ids', 'error'];
  const rows = document.results.map((item) => [
    item.domain, item.availabilityState, item.confidence, item.review.lane, item.mutationTypes,
    item.dnsSummary.a, item.dnsSummary.aaaa, item.dnsSummary.ns, item.dnsSummary.mx,
    item.relationshipIds, 'error' in item ? item.error : '',
  ].map(csvCell).join(','));
  return `${[header.join(','), ...rows].join('\n')}\n`;
}

function formatDiscoveryScanDomains(document: ReturnType<typeof buildDiscoveryScanDocument>): string {
  return document.results.length ? `${document.results.map((item) => item.domain).join('\n')}\n` : '';
}

function formatTerminalDiscoveryScan(document: ReturnType<typeof buildDiscoveryScanDocument>): string {
  const lines = [
    'Supervised candidate scan',
    `Seed             ${document.seed}`,
    `Mode             ${document.mode}`,
    `Generated        ${document.generation.generatedCandidateCount}`,
    `Collected        ${document.summary.collected}`,
    `Matched          ${document.summary.matched}`,
    `Source failures  ${document.summary.failed}`,
    `Relationships    ${document.relationships.length}`,
    '',
    'Review queue',
  ];
  for (const item of document.results.slice(0, 200)) {
    lines.push(`${item.domain.padEnd(42)} ${item.availabilityState.padEnd(13)} ${item.review.lane}`);
  }
  if (document.results.length > 200) lines.push(`... ${document.results.length - 200} additional results omitted from terminal display; use --json, --jsonl, or --csv.`);
  lines.push('', 'Next actions:', ...document.nextActions.map((item) => `  - ${item}`));
  return `${lines.join('\n')}\n`;
}

export {
  buildDiscoveryScanDocument,
  formatDiscoveryScanCsv,
  formatDiscoveryScanDomains,
  formatDiscoveryScanJsonLines,
  formatTerminalDiscoveryScan,
  parseDiscoveryScanAllowlist,
  readDiscoveryScanListBounded,
  runDiscoveryScanChunks,
};
export type { Candidate as DiscoveryScanCandidate, ScanFilter as DiscoveryScanFilter, ScanMetadata as DiscoveryScanMetadata };

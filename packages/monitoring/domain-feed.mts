import { normalizeDomain } from '../evidence/domain-name.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { createIncrementalSha256, sha256IdentityHex } from '../evidence/record-identity.mts';
import { MAX_CANDIDATE_MATCHES, normalizeCandidateObservation, type BrandCandidateObservation } from '../workspace/brand-candidate-workflow.mts';
import { planCandidateWatchHandoff, type CandidateWatchInput } from '../workspace/candidate-watch-handoff.mts';
import { CANDIDATE_WATCH_INPUT_SCHEMA, CANDIDATE_WATCH_INPUT_VERSION } from '../contracts/candidate-watch-review.mts';
import { assertWorkspaceInputGraph, ordinaryWorkspaceRecord } from '../workspace/hostile-input.mts';

export const DOMAIN_FEED_LIMITS = Object.freeze({ bytes: 256 * 1024 * 1024, rows: 10_000_000,
  lineBytes: 1024, durationMs: 10 * 60 * 1000, matches: 200, hosts: 200, terms: 20, batch: 256 });
export type DomainFeedDefinition = Readonly<{ id: string; label: string;
  kind: 'threat-intelligence' | 'recent-domain' | 'entropy-subset'; url: string; licence: 'GPL-3.0'; licenceUrl: string }>;
const catalogue = [
  ['tif-full', 'Threat Intelligence Feeds — full', 'threat-intelligence', 'dns-blocklists', 'wildcard/tif-onlydomains.txt'],
  ['tif-medium', 'Threat Intelligence Feeds — medium', 'threat-intelligence', 'dns-blocklists', 'wildcard/tif.medium-onlydomains.txt'],
  ['tif-mini', 'Threat Intelligence Feeds — mini', 'threat-intelligence', 'dns-blocklists', 'wildcard/tif.mini-onlydomains.txt'],
  ['nrd7', 'Newly registered domains — days 0–7', 'recent-domain', 'nrd', 'domains/nrd7.txt'],
  ['nrd14-8', 'Newly registered domains — days 8–14', 'recent-domain', 'nrd', 'domains/nrd14-8.txt'],
  ['nrd21-15', 'Newly registered domains — days 15–21', 'recent-domain', 'nrd', 'domains/nrd21-15.txt'],
  ['nrd28-22', 'Newly registered domains — days 22–28', 'recent-domain', 'nrd', 'domains/nrd28-22.txt'],
  ['nrd35-29', 'Newly registered domains — days 29–35', 'recent-domain', 'nrd', 'domains/nrd35-29.txt'],
  ['entropy7', 'High-entropy subset — 7 days', 'entropy-subset', 'nrd', 'domains/dga7.txt'],
  ['entropy14', 'High-entropy subset — 14 days', 'entropy-subset', 'nrd', 'domains/dga14.txt'],
  ['entropy30', 'High-entropy subset — 30 days', 'entropy-subset', 'nrd', 'domains/dga30.txt'],
] as const;
export const DOMAIN_FEED_CATALOGUE: readonly DomainFeedDefinition[] = Object.freeze(catalogue.map(([id, label, kind, repository, path]) => Object.freeze({
  id, label, kind, url: `https://raw.githubusercontent.com/hagezi/${repository}/main/${path}`,
  licence: 'GPL-3.0' as const, licenceUrl: `https://github.com/hagezi/${repository}/blob/main/LICENSE`,
})));
export function domainFeedDefinition(id: string): DomainFeedDefinition {
  const definition = DOMAIN_FEED_CATALOGUE.find(entry => entry.id === id);
  if (!definition) throw new TypeError('Choose a supported plain-domain feed identifier.');
  return definition;
}
export const DOMAIN_FEED_LIMITATIONS = Object.freeze([
  'Feed inclusion is third-party candidate evidence, not a finding of maliciousness, activity, ownership or domain existence.',
  'Recent-registration cohorts and high-entropy subsets do not verify a registration event or a domain-generation algorithm for an individual hostname.',
  'The raw-file SHA-256 identifies the scanned bytes; it does not authenticate the publisher or establish freshness.',
  'File publication comments are declarations, not per-host observation clocks. Source first and last observation times remain unknown.',
  'Exact hosts and literal terms only; no parent-domain equivalence, regular expressions, lookup, score change or collection authority.',
]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

/** Gate plain host syntax before the compatibility normaliser can strip URL parts. */
export function strictDomainFeedHostname(value: unknown): string {
  if (typeof value !== 'string' || value.length > 253 || value !== value.trim() || CONTROL.test(value)
    || !/^[\p{L}\p{N}\p{M}.-]+$/u.test(value) || value.endsWith('.') || !value.includes('.')) return '';
  return normalizeDomain(value);
}
export type DomainFeedSelection = Readonly<{ hosts: readonly string[]; terms: readonly string[]; brandProfileId: string | null }>;
export function normalizeDomainFeedSelection(value: { hosts?: readonly string[]; terms?: readonly string[]; brandProfileId?: string | null }): DomainFeedSelection {
  assertWorkspaceInputGraph(value, 'Domain feed selection');
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['hosts', 'terms', 'brandProfileId'].includes(key)))
    throw new TypeError('Use only exact hosts, literal terms and optional Brand context.');
  const hosts = value.hosts ?? [], terms = value.terms ?? [];
  if (!Array.isArray(hosts) || hosts.length > DOMAIN_FEED_LIMITS.hosts || !Array.isArray(terms) || terms.length > DOMAIN_FEED_LIMITS.terms)
    throw new RangeError('Feed selection is limited to 200 exact hosts and 20 literal terms.');
  const canonicalHosts = hosts.map(strictDomainFeedHostname);
  if (canonicalHosts.some(host => !host)) throw new TypeError('Feed hosts must be literal plain domain names.');
  const canonicalTerms = terms.map(term => {
    if (typeof term !== 'string' || term.length < 3 || term.length > 80 || term !== term.trim() || CONTROL.test(term))
      throw new TypeError('Literal feed terms must contain 3–80 characters without controls or surrounding spaces.');
    return term.toLowerCase();
  });
  const brandProfileId = value.brandProfileId ?? null;
  if (brandProfileId !== null && (typeof brandProfileId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(brandProfileId)))
    throw new TypeError('The selected Brand context identifier is invalid.');
  return Object.freeze({ hosts: Object.freeze([...new Set(canonicalHosts)]), terms: Object.freeze([...new Set(canonicalTerms)]), brandProfileId });
}
export type DomainFeedSnapshotMetadata = Readonly<{ feedId: string; revision: string; importedAt: string;
  acquiredAt: string | null; declaredPublishedAt: string | null; declaredVersion: string | null; bytes: number; rows: number }>;
export type DomainFeedMatch = Readonly<{ domain: string; exactHost: boolean; terms: readonly string[]; candidate: BrandCandidateObservation }>;
export type DomainFeedReview = DomainFeedSnapshotMetadata & Readonly<{ selection: DomainFeedSelection; matches: readonly DomainFeedMatch[];
  /** Exact matching input-row count, or null when a bounded query did not count all matches. */
  matched: number | null;
  /** Matching row occurrences not separately retained, including duplicate occurrences; null if unknown. */
  omitted: number | null; truncated: boolean; limitations: readonly string[] }>;
function snapshotMetadata(value: DomainFeedSnapshotMetadata): DomainFeedSnapshotMetadata {
  domainFeedDefinition(value.feedId);
  const importedAt = normalizeExplicitIsoTimestamp(value.importedAt);
  if (!importedAt || !/^sha256:[a-f0-9]{64}$/u.test(value.revision)
    || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > DOMAIN_FEED_LIMITS.bytes
    || !Number.isSafeInteger(value.rows) || value.rows < 0 || value.rows > DOMAIN_FEED_LIMITS.rows)
    throw new TypeError('Feed snapshot metadata is invalid or exceeds its bounds.');
  for (const clock of [value.acquiredAt, value.declaredPublishedAt]) if (clock !== null && !normalizeExplicitIsoTimestamp(clock))
    throw new TypeError('Feed snapshot clocks require explicit valid timestamps.');
  if (value.declaredVersion !== null && (typeof value.declaredVersion !== 'string' || !/^[A-Za-z0-9._+-]{1,80}$/u.test(value.declaredVersion)))
    throw new TypeError('The declared feed version is invalid.');
  return Object.freeze({ feedId: value.feedId, revision: value.revision, importedAt,
    acquiredAt: value.acquiredAt, declaredPublishedAt: value.declaredPublishedAt, declaredVersion: value.declaredVersion, bytes: value.bytes, rows: value.rows });
}
export function projectDomainFeedMatch(domain: string, metadata: DomainFeedSnapshotMetadata, input: DomainFeedSelection): DomainFeedMatch | null {
  const host = strictDomainFeedHostname(domain), snapshot = snapshotMetadata(metadata), selection = normalizeDomainFeedSelection(input);
  if (!host) throw new TypeError('A feed match must be a plain hostname.');
  const exactHost = selection.hosts.includes(host), terms = selection.terms.filter(term => host.includes(term));
  if (!exactHost && !terms.length) return null;
  const candidate: BrandCandidateObservation = { domain: host,
    matches: selection.brandProfileId ? [...(exactHost ? [{ brandProfileId: selection.brandProfileId,
      ruleKey: `feed-host:${sha256IdentityHex(new TextEncoder().encode(host)).slice(0, 32)}`,
      term: host, reason: 'The analyst explicitly selected this exact feed hostname for Brand review; inclusion is not a verdict.' }] : []), ...terms.map(term => ({ brandProfileId: selection.brandProfileId!,
      ruleKey: `feed-literal:${sha256IdentityHex(new TextEncoder().encode(term)).slice(0, 32)}`,
      term, reason: 'An explicit literal term occurs in this exact feed hostname; analyst review is required.' }))] : [],
    sources: [{ source: `domain-feed:${snapshot.feedId}`, revision: snapshot.revision, observedHostname: host,
      sourceFirstObservedAt: null, sourceLastObservedAt: null, firstLocalObservedAt: snapshot.importedAt,
      completeness: 'unknown', gap: 'Feed membership and file publication do not establish a per-host event time, maliciousness or completeness.' }] };
  if (candidate.matches.length > MAX_CANDIDATE_MATCHES) throw new RangeError('This hostname matches too many explicit selectors for retained Brand provenance. Reduce the literal selection; no rule was silently discarded.');
  if (!normalizeCandidateObservation(candidate)) throw new TypeError('The feed candidate provenance could not be admitted.');
  return freezeOwned({ domain: host, exactHost, terms, candidate });
}
function freezeOwned<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeOwned(child); Object.freeze(value); }
  return value;
}
export function buildDomainFeedReview(metadata: DomainFeedSnapshotMetadata, input: DomainFeedSelection, domains: readonly string[], counts: { matched: number | null; omitted: number | null; truncated: boolean }): DomainFeedReview {
  const snapshot = snapshotMetadata(metadata), selection = normalizeDomainFeedSelection(input);
  if (!Array.isArray(domains) || domains.length > DOMAIN_FEED_LIMITS.matches || new Set(domains).size !== domains.length)
    throw new RangeError('Retain at most 200 distinct exact feed matches.');
  const matches = domains.map(domain => {
    const match = projectDomainFeedMatch(domain, snapshot, selection);
    if (!match) throw new TypeError('The returned feed hostname does not match the reviewed selection.');
    return match;
  });
  for (const count of [counts.matched, counts.omitted]) if (count !== null && (!Number.isSafeInteger(count) || count < 0 || count > DOMAIN_FEED_LIMITS.rows))
    throw new RangeError('Feed matching-row counts exceed their bound.');
  if (typeof counts.truncated !== 'boolean' || (counts.matched === null) !== (counts.omitted === null)
    || (counts.matched !== null && (counts.matched < matches.length || counts.omitted !== counts.matched - matches.length)))
    throw new TypeError('Disclose exact matching-row counts together, or keep both unknown.');
  return freezeOwned({ ...snapshot, selection, matches, ...counts, limitations: DOMAIN_FEED_LIMITATIONS });
}
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalValue(child)]));
  return value;
}
/** Strict transient reply boundary; never accept altered attribution or extra fields. */
export function normalizeDomainFeedReview(value: unknown): DomainFeedReview | null {
  try {
    assertWorkspaceInputGraph(value, 'Domain feed review');
    const raw = ordinaryWorkspaceRecord(value, 'Domain feed review');
    if (!raw || !Array.isArray(raw.matches) || raw.matches.length > DOMAIN_FEED_LIMITS.matches) return null;
    const domains = raw.matches.map(match => {
      const row = ordinaryWorkspaceRecord(match, 'Domain feed match');
      if (!row || typeof row.domain !== 'string') throw new TypeError('Invalid feed match.');
      return row.domain;
    });
    const reviewed = buildDomainFeedReview(raw as unknown as DomainFeedSnapshotMetadata,
      raw.selection as DomainFeedSelection, domains,
      { matched: raw.matched as number | null, omitted: raw.omitted as number | null, truncated: raw.truncated as boolean });
    return JSON.stringify(canonicalValue(raw)) === JSON.stringify(canonicalValue(reviewed)) ? reviewed : null;
  } catch { return null; }
}
export type DomainFeedScanOptions = Readonly<{ feedId: string; selection: DomainFeedSelection; importedAt: string; acquiredAt?: string | null;
  signal?: AbortSignal; now?: () => number; onDomains?: (domains: readonly string[]) => void | Promise<void>;
  limits?: Partial<Record<'bytes' | 'rows' | 'lineBytes' | 'durationMs', number>> }>;
/** Batches are provisional; consumers must discard staged ingestion on any rejection. */
export async function scanDomainFeed(chunks: AsyncIterable<Uint8Array>, options: DomainFeedScanOptions): Promise<DomainFeedReview> {
  domainFeedDefinition(options.feedId);
  const selection = normalizeDomainFeedSelection(options.selection);
  if (!selection.hosts.length && !selection.terms.length && !options.onDomains) throw new TypeError('Select at least one exact host or literal term.');
  const limits = { ...DOMAIN_FEED_LIMITS, ...options.limits };
  for (const key of ['bytes', 'rows', 'lineBytes', 'durationMs'] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > DOMAIN_FEED_LIMITS[key]) throw new RangeError('Feed limits may only reduce the hard safety ceilings.');
  const importedAt = normalizeExplicitIsoTimestamp(options.importedAt);
  if (!importedAt) throw new TypeError('Feed import time requires an explicit timestamp.');
  const now = options.now ?? Date.now, started = now(), deadline = started + limits.durationMs;
  const digest = createIncrementalSha256(limits.bytes), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const line = new Uint8Array(limits.lineBytes), retained = new Set<string>(), hosts = new Set(selection.hosts);
  let lineLength = 0, bytes = 0, rows = 0, lines = 0, matched = 0, truncated = false, firstLine = true, declaredPublishedAt: string | null = null, declaredVersion: string | null = null;
  let batch: string[] = [];
  function check() { if (options.signal?.aborted) throw new Error('Feed scan was cancelled; no review was produced.');
    if (!Number.isFinite(now()) || now() >= deadline) throw new RangeError('Feed scan exceeded its deadline; no review was produced.'); }
  async function boundedAwait<T>(promise: Promise<T>): Promise<T> {
    check(); let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RangeError('Feed scan exceeded its deadline; no review was produced.')), Math.max(1, deadline - now()));
      abort = () => reject(new Error('Feed scan was cancelled; no review was produced.'));
      options.signal?.addEventListener('abort', abort, { once: true });
    })]); } finally { if (timer !== undefined) clearTimeout(timer); if (abort) options.signal?.removeEventListener('abort', abort); }
  }
  function consumeLine() {
    if (++lines > limits.rows) throw new RangeError('Feed rows exceed their limit; no review was produced.');
    let text = decoder.decode(line.subarray(0, lineLength && line[lineLength - 1] === 13 ? lineLength - 1 : lineLength));
    lineLength = 0;
    if (firstLine) { firstLine = false; text = text.replace(/^\uFEFF/u, ''); }
    if (CONTROL.test(text)) throw new TypeError('Feed content contains control characters; no review was produced.');
    if (!text) return;
    if (text.startsWith('#')) {
      const publication = /^#\s*Last modified:\s*(\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}) UTC\s*$/u.exec(text);
      if (publication) {
        const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(publication[2]!);
        const date = new Date(Date.UTC(Number(publication[3]), month, Number(publication[1]), Number(publication[4]), Number(publication[5])));
        if (month < 0 || date.getUTCDate() !== Number(publication[1]) || date.getUTCMonth() !== month || Number(publication[4]) > 23 || Number(publication[5]) > 59)
          throw new TypeError('The declared file publication timestamp is malformed.');
        const value = date.toISOString();
        if (declaredPublishedAt && declaredPublishedAt !== value) throw new TypeError('Feed publication declarations conflict.');
        declaredPublishedAt = value;
      } else if (/^#\s*Last modified:/u.test(text)) throw new TypeError('The declared file publication timestamp is malformed.');
      const version = /^#\s*Version:\s*([A-Za-z0-9._+-]{1,80})\s*$/u.exec(text);
      if (version) { if (declaredVersion && declaredVersion !== version[1]) throw new TypeError('Feed version declarations conflict.'); declaredVersion = version[1]!; }
      else if (/^#\s*Version:/u.test(text)) throw new TypeError('The declared file version is malformed.');
      return;
    }
    const domain = strictDomainFeedHostname(text);
    if (!domain) throw new TypeError('Feed rows must contain only plain domain names; no review was produced.');
    rows++;
    if (hosts.has(domain) || selection.terms.some(term => domain.includes(term))) {
      matched++;
      if (retained.size < DOMAIN_FEED_LIMITS.matches) retained.add(domain);
      else if (!retained.has(domain)) truncated = true;
    }
    if (options.onDomains) batch.push(domain);
  }
  async function flush() { if (batch.length) { check(); const outgoing = Object.freeze(batch); batch = []; await boundedAwait(Promise.resolve(options.onDomains!(outgoing))); } }
  const iterator = chunks[Symbol.asyncIterator](); let complete = false;
  try {
    while (true) {
      check();
      const next = await boundedAwait(Promise.resolve(iterator.next()));
      if (next.done) break;
      const chunk = next.value;
      if (!(chunk instanceof Uint8Array) || chunk.byteLength > limits.bytes - bytes) throw new RangeError('Feed bytes exceed their limit; no review was produced.');
      bytes += chunk.byteLength;
      for (let offset = 0; offset < chunk.byteLength; offset += 64 * 1024) {
        check(); const slice = chunk.subarray(offset, Math.min(offset + 64 * 1024, chunk.byteLength)); digest.update(slice);
        for (const byte of slice) {
          if (byte === 10) consumeLine();
          else { if (lineLength >= limits.lineBytes) throw new RangeError('Feed line exceeds its byte limit; no review was produced.'); line[lineLength++] = byte; }
          if (batch.length === DOMAIN_FEED_LIMITS.batch) await flush();
        }
        if (offset && offset % (1024 * 1024) === 0) await boundedAwait(new Promise<void>(resolve => setTimeout(resolve, 0)));
      }
    }
    if (lineLength) consumeLine(); await flush(); check();
    if (!rows) throw new TypeError('The feed contains no plain domain rows.');
    const result = buildDomainFeedReview({ feedId: options.feedId, revision: `sha256:${digest.digestHex()}`, importedAt,
      acquiredAt: options.acquiredAt ?? null, declaredPublishedAt, declaredVersion, bytes, rows }, selection, [...retained],
      { matched, omitted: matched - retained.size, truncated });
    complete = true; return result;
  } finally {
    if (!complete) { try { const closing = iterator.return?.(); if (closing) void Promise.resolve(closing).catch(() => {}); } catch { /* Preserve the scan failure. */ } }
  }
}
/** Existing portable handoff only; selected domains must come from this review. */
export function buildDomainFeedWatchInput(review: DomainFeedReview, domains: readonly string[], context: Omit<CandidateWatchInput, 'candidates'>, watchlists: unknown = null) {
  if (!Array.isArray(domains) || domains.length > DOMAIN_FEED_LIMITS.matches || new Set(domains).size !== domains.length || !domains.length)
    throw new TypeError('Choose 1–200 distinct reviewed feed domains.');
  const available = new Map(review.matches.map(match => [match.domain, match.candidate]));
  const candidates = domains.map(domain => { const candidate = available.get(domain); if (!candidate) throw new TypeError('The selection contains an unreviewed hostname.'); return candidate; });
  const selection = { ...context, candidates };
  planCandidateWatchHandoff(watchlists, selection);
  return freezeOwned(structuredClone({ schema: CANDIDATE_WATCH_INPUT_SCHEMA, version: CANDIDATE_WATCH_INPUT_VERSION, watchlists, selection }));
}

// Pure, bounded persistence model for analyst-saved Bulk investigations.
// Sessions retain compact derived rows and source states, never raw registry,
// WHOIS, HTTP, TLS, page, or provider payloads.

import { normalizeDomain } from './case-model.ts';

export const BULK_SESSION_SCHEMA = 'whoisleuth.bulk-sessions';
export const BULK_SESSION_SCHEMA_VERSION = 1;
export const MAX_BULK_SESSIONS = 10;
export const MAX_BULK_SESSION_ROWS = 2_000;
export const MAX_BULK_SESSION_STORE_BYTES = 4 * 1024 * 1024;
export const MAX_BULK_SESSION_NAME_LENGTH = 100;
export const MAX_BULK_SESSION_TEXT_LENGTH = 500;
export const MAX_BULK_SESSION_ARRAY_VALUES = 100;
export const MAX_BULK_SESSION_SOURCES = 12;

const CONTROL_RE = /[\x00-\x1f\x7f]/u;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const HASH_64_RE = /^[a-f0-9]{64}$/iu;
const PHASH_RE = /^[a-f0-9]{16}$/iu;
const SOURCE_RE = /^[a-z][a-z0-9_-]{0,39}$/u;
const TRACKING_IDENTIFIER_RE = /^[a-z-]{1,40}:[A-Z0-9-]{1,64}$/u;
const SESSION_STATES = new Set(['complete', 'partial', 'cancelled']);
const RESULT_STATES = new Set(['complete', 'error']);
const MODES = new Set(['fast', 'deep']);
const SOURCE_STATES = new Set([
  'complete',
  'partial',
  'skipped',
  'unavailable',
  'unsupported',
  'not_found',
  'error',
]);
const TRUST_STATES = new Set(['official', 'partner', 'allowlisted']);

type UnknownRecord = Record<string, unknown>;

export type BulkSessionMode = 'deep' | 'fast';
export type BulkSessionState = 'cancelled' | 'complete' | 'partial';
export type BulkSessionSourceState =
  | 'complete'
  | 'error'
  | 'not_found'
  | 'partial'
  | 'skipped'
  | 'unavailable'
  | 'unsupported';

export type BulkSessionSourceCoverage = {
  source: string;
  state: BulkSessionSourceState;
};

export type BulkSessionRiskFactor = {
  label: string;
  points: number;
};

export type BulkSessionRelationship = {
  version: 2;
  nameservers: string[];
  ipAddresses: string[];
  trackingIdentifiers: string[];
  officialAssetHosts: string[];
  faviconHash: string | null;
  faviconPHash: string | null;
  certificateFingerprint: string | null;
  truncated: boolean;
};

export type BulkSessionDnsEvidence = {
  status: string | null;
  records: {
    a: string[];
    aaaa: string[];
    cname: string[];
    caa: Array<{ critical: number | string; tag: string; value: string }>;
  };
};

export type BulkSessionResult = {
  domain: string;
  status: 'complete' | 'error';
  availability: string;
  confidence: string;
  registrar: string;
  activity: string;
  risk: number | null;
  opportunity: number | null;
  mutationTypes: string[];
  trusted: 'allowlisted' | 'official' | 'partner' | null;
  error: string;
  scanDepth: BulkSessionMode;
  createdDate: string | null;
  expiryDate: string | null;
  nameservers: string[];
  hasMx: boolean | null;
  hasSpf: boolean | null;
  hasDmarc: boolean | null;
  activityStatus: string | null;
  pageTitle: string | null;
  faviconHash: string | null;
  faviconPHash: string | null;
  faviconMatch: boolean;
  faviconNearMatch: boolean;
  reusesOfficialAssets: boolean;
  hasPasswordField: boolean;
  phishingLanguageMatch: string | null;
  riskModelVersion: number | null;
  riskFactors: BulkSessionRiskFactor[];
  dns: BulkSessionDnsEvidence | null;
  dnssec: string | null;
  relationship: BulkSessionRelationship;
  sourceCoverage: BulkSessionSourceCoverage[];
};

export type BulkSession = {
  id: string;
  name: string;
  mode: BulkSessionMode;
  state: BulkSessionState;
  inputDigest: string;
  domains: string[];
  results: BulkSessionResult[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type BulkSessionStore = {
  schema: typeof BULK_SESSION_SCHEMA;
  version: typeof BULK_SESSION_SCHEMA_VERSION;
  sessions: BulkSession[];
};

export type BulkSessionComparisonRow = {
  domain: string;
  changes: string[];
};

export type BulkSessionComparison = {
  baselineId: string;
  currentId: string;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  rows: BulkSessionComparisonRow[];
  limitations: string[];
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function boundedText(value: unknown, maximum = MAX_BULK_SESSION_TEXT_LENGTH): string {
  return typeof value === 'string' && value.length <= maximum && !CONTROL_RE.test(value)
    ? value.trim()
    : '';
}

function timestamp(value: unknown, fallback: string | null = null): string | null {
  const text = boundedText(value, 64);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : fallback;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function nullableScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value)
    : null;
}

function nullableVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 10_000
    ? value
    : null;
}

function boundedStrings(value: unknown, maximum = MAX_BULK_SESSION_ARRAY_VALUES): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const candidate of value.slice(0, maximum * 4)) {
    const text = boundedText(candidate, 253).toLowerCase().replace(/\.$/u, '');
    if (text) output.add(text);
    if (output.size >= maximum) break;
  }
  return [...output];
}

function boundedTrackingIdentifiers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const candidate of value.slice(0, 120)) {
    const text = boundedText(candidate, 105);
    if (TRACKING_IDENTIFIER_RE.test(text)) output.add(text);
    if (output.size >= 30) break;
  }
  return [...output];
}

function domainList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const candidate of value.slice(0, MAX_BULK_SESSION_ROWS * 2)) {
    const normalized = typeof candidate === 'string' ? normalizeDomain(candidate) : '';
    if (normalized) output.add(normalized);
    if (output.size >= MAX_BULK_SESSION_ROWS) break;
  }
  return [...output];
}

function normalizeSourceCoverage(value: unknown): BulkSessionSourceCoverage[] {
  if (!Array.isArray(value)) return [];
  const output: BulkSessionSourceCoverage[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, MAX_BULK_SESSION_SOURCES * 4)) {
    const item = record(candidate);
    const source = boundedText(item?.source, 40);
    const state = boundedText(item?.state, 20);
    if (!SOURCE_RE.test(source) || !SOURCE_STATES.has(state) || seen.has(source)) continue;
    seen.add(source);
    output.push({ source, state: state as BulkSessionSourceState });
    if (output.length >= MAX_BULK_SESSION_SOURCES) break;
  }
  return output;
}

function normalizeRiskFactors(value: unknown): BulkSessionRiskFactor[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap((candidate) => {
    const item = record(candidate);
    const label = boundedText(item?.label, 160);
    const points = item?.points;
    return label && typeof points === 'number' && Number.isFinite(points) && Math.abs(points) <= 100
      ? [{ label, points: Math.round(points) }]
      : [];
  });
}

function nullableHash(value: unknown, expression: RegExp): string | null {
  return typeof value === 'string' && expression.test(value) ? value.toLowerCase() : null;
}

function normalizeRelationship(value: unknown): BulkSessionRelationship {
  const item = record(value);
  return {
    version: 2,
    nameservers: boundedStrings(item?.nameservers, 20),
    ipAddresses: boundedStrings(item?.ipAddresses, 50),
    trackingIdentifiers: boundedTrackingIdentifiers(item?.trackingIdentifiers),
    officialAssetHosts: boundedStrings(item?.officialAssetHosts, 30),
    faviconHash: nullableHash(item?.faviconHash, HASH_64_RE),
    faviconPHash: nullableHash(item?.faviconPHash, PHASH_RE),
    certificateFingerprint: nullableHash(item?.certificateFingerprint, HASH_64_RE),
    truncated: item?.truncated === true,
  };
}

function normalizeDns(value: unknown): BulkSessionDnsEvidence | null {
  const item = record(value);
  const records = record(item?.records);
  if (!item || !records) return null;
  const caa = Array.isArray(records.caa)
    ? records.caa.slice(0, 100).flatMap((candidate) => {
        const caaRecord = record(candidate);
        const tag = boundedText(caaRecord?.tag, 64);
        const recordValue = boundedText(caaRecord?.value, 500);
        const critical = caaRecord?.critical;
        return tag && recordValue && (typeof critical === 'number' || typeof critical === 'string')
          ? [{ critical, tag, value: recordValue }]
          : [];
      })
    : [];
  return {
    status: boundedText(item.status, 40) || null,
    records: {
      a: boundedStrings(records.a),
      aaaa: boundedStrings(records.aaaa),
      cname: boundedStrings(records.cname),
      caa,
    },
  };
}

export function normalizeBulkSessionResult(value: unknown): BulkSessionResult | null {
  const item = record(value);
  const domain = normalizeDomain(item?.domain);
  const status = boundedText(item?.status, 20);
  const scanDepth = boundedText(item?.scanDepth, 10);
  if (!item || !domain || !RESULT_STATES.has(status) || !MODES.has(scanDepth)) return null;
  const trusted = boundedText(item.trusted, 20);
  return {
    domain,
    status: status as BulkSessionResult['status'],
    availability: boundedText(item.availability, 40) || 'unknown',
    confidence: boundedText(item.confidence, 40) || 'unknown',
    registrar: boundedText(item.registrar, 300) || '—',
    activity: boundedText(item.activity, 300) || '—',
    risk: nullableScore(item.risk),
    opportunity: nullableScore(item.opportunity),
    mutationTypes: boundedStrings(item.mutationTypes, 40),
    trusted: TRUST_STATES.has(trusted) ? trusted as BulkSessionResult['trusted'] : null,
    error: boundedText(item.error),
    scanDepth: scanDepth as BulkSessionMode,
    createdDate: boundedText(item.createdDate, 64) || null,
    expiryDate: boundedText(item.expiryDate, 64) || null,
    nameservers: boundedStrings(item.nameservers, 20),
    hasMx: nullableBoolean(item.hasMx),
    hasSpf: nullableBoolean(item.hasSpf),
    hasDmarc: nullableBoolean(item.hasDmarc),
    activityStatus: boundedText(item.activityStatus, 40) || null,
    pageTitle: boundedText(item.pageTitle, 300) || null,
    faviconHash: nullableHash(item.faviconHash, HASH_64_RE),
    faviconPHash: nullableHash(item.faviconPHash, PHASH_RE),
    faviconMatch: item.faviconMatch === true,
    faviconNearMatch: item.faviconNearMatch === true,
    reusesOfficialAssets: item.reusesOfficialAssets === true,
    hasPasswordField: item.hasPasswordField === true,
    phishingLanguageMatch: boundedText(item.phishingLanguageMatch, 300) || null,
    riskModelVersion: nullableVersion(item.riskModelVersion),
    riskFactors: normalizeRiskFactors(item.riskFactors),
    dns: normalizeDns(item.dns),
    dnssec: boundedText(item.dnssec, 40) || null,
    relationship: normalizeRelationship(item.relationship),
    sourceCoverage: normalizeSourceCoverage(item.sourceCoverage),
  };
}

export function normalizeBulkSession(value: unknown): BulkSession | null {
  const item = record(value);
  const id = boundedText(item?.id, 128);
  const name = boundedText(item?.name, MAX_BULK_SESSION_NAME_LENGTH);
  const mode = boundedText(item?.mode, 10);
  const state = boundedText(item?.state, 20);
  const inputDigest = boundedText(item?.inputDigest, 80);
  const startedAt = timestamp(item?.startedAt);
  const updatedAt = timestamp(item?.updatedAt);
  const completedAt = item?.completedAt === null ? null : timestamp(item?.completedAt);
  if (
    !item
    || !SAFE_ID_RE.test(id)
    || !name
    || !MODES.has(mode)
    || !SESSION_STATES.has(state)
    || !DIGEST_RE.test(inputDigest)
    || !startedAt
    || !updatedAt
  ) return null;
  const domains = domainList(item.domains);
  if (!domains.length) return null;
  const allowed = new Set(domains);
  const results: BulkSessionResult[] = [];
  const seen = new Set<string>();
  for (const candidate of Array.isArray(item.results) ? item.results.slice(0, MAX_BULK_SESSION_ROWS * 2) : []) {
    const result = normalizeBulkSessionResult(candidate);
    if (!result || !allowed.has(result.domain) || seen.has(result.domain)) continue;
    seen.add(result.domain);
    results.push(result);
    if (results.length >= MAX_BULK_SESSION_ROWS) break;
  }
  return {
    id,
    name,
    mode: mode as BulkSessionMode,
    state: state as BulkSessionState,
    inputDigest,
    domains,
    results,
    startedAt,
    updatedAt,
    completedAt,
  };
}

export function bulkSessionStoreVersion(raw: unknown): number | null {
  const value = record(raw);
  return typeof value?.version === 'number' && Number.isSafeInteger(value.version) && value.version > 0
    ? value.version
    : null;
}

export function normalizeBulkSessionStore(raw: unknown): BulkSessionStore {
  const value = record(raw);
  const candidates = Array.isArray(raw)
    ? raw
    : value?.schema === BULK_SESSION_SCHEMA
      && value.version === BULK_SESSION_SCHEMA_VERSION
      && Array.isArray(value.sessions)
      ? value.sessions
      : [];
  const byId = new Map<string, BulkSession>();
  for (const candidate of candidates.slice(0, MAX_BULK_SESSIONS * 4)) {
    const session = normalizeBulkSession(candidate);
    if (!session) continue;
    const existing = byId.get(session.id);
    if (!existing || existing.updatedAt < session.updatedAt) byId.set(session.id, session);
  }
  return {
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    sessions: [...byId.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, MAX_BULK_SESSIONS),
  };
}

export function serializeBulkSessionStore(raw: unknown): string {
  return JSON.stringify(normalizeBulkSessionStore(raw));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function enforceBulkSessionStoreBudget(raw: unknown): { store: BulkSessionStore; pruned: number } {
  const store = normalizeBulkSessionStore(raw);
  let pruned = 0;
  while (byteLength(JSON.stringify(store)) > MAX_BULK_SESSION_STORE_BYTES && store.sessions.length > 1) {
    store.sessions.pop();
    pruned += 1;
  }
  if (byteLength(JSON.stringify(store)) > MAX_BULK_SESSION_STORE_BYTES) {
    throw new Error('This Bulk session exceeds the 4 MiB browser-local session limit.');
  }
  return { store, pruned };
}

export function upsertBulkSession(
  raw: unknown,
  sessionRaw: unknown,
): { sessions: BulkSession[]; session: BulkSession; added: boolean; pruned: number } {
  const session = normalizeBulkSession(sessionRaw);
  if (!session) throw new Error('The Bulk session is incomplete or invalid.');
  const current = normalizeBulkSessionStore(raw).sessions;
  const index = current.findIndex((candidate) => candidate.id === session.id);
  const next = index >= 0
    ? current.map((candidate, candidateIndex) => candidateIndex === index ? session : candidate)
    : [session, ...current];
  const bounded = enforceBulkSessionStoreBudget({
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    sessions: next,
  });
  return {
    sessions: bounded.store.sessions,
    session,
    added: index < 0,
    pruned: bounded.pruned,
  };
}

export function deleteBulkSession(raw: unknown, idRaw: unknown): BulkSession[] {
  const id = boundedText(idRaw, 128);
  return normalizeBulkSessionStore({
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    sessions: normalizeBulkSessionStore(raw).sessions.filter((session) => session.id !== id),
  }).sessions;
}

function sourceStateMap(value: BulkSessionResult): Map<string, string> {
  return new Map(value.sourceCoverage.map((item) => [item.source, item.state]));
}

function resultChanges(previous: BulkSessionResult, current: BulkSessionResult): string[] {
  const changes: string[] = [];
  if (previous.availability !== current.availability) changes.push(`Registration: ${previous.availability} → ${current.availability}`);
  if (previous.risk !== current.risk) changes.push(`Risk: ${previous.risk ?? 'unavailable'} → ${current.risk ?? 'unavailable'}`);
  if (previous.registrar !== current.registrar) changes.push(`Registrar: ${previous.registrar} → ${current.registrar}`);
  if (previous.activity !== current.activity) changes.push(`Website: ${previous.activity} → ${current.activity}`);
  const previousSources = sourceStateMap(previous);
  const currentSources = sourceStateMap(current);
  for (const source of [...new Set([...previousSources.keys(), ...currentSources.keys()])].sort()) {
    const before = previousSources.get(source) ?? 'not recorded';
    const after = currentSources.get(source) ?? 'not recorded';
    if (before !== after) changes.push(`${source} source: ${before} → ${after}`);
  }
  return changes.slice(0, 20);
}

export function compareBulkSessions(
  baselineRaw: unknown,
  currentRaw: unknown,
): BulkSessionComparison | null {
  const baseline = normalizeBulkSession(baselineRaw);
  const current = normalizeBulkSession(currentRaw);
  if (!baseline || !current || baseline.id === current.id) return null;
  const before = new Map(baseline.results.map((result) => [result.domain, result]));
  const after = new Map(current.results.map((result) => [result.domain, result]));
  const rows: BulkSessionComparisonRow[] = [];
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const domain of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const previous = before.get(domain);
    const next = after.get(domain);
    if (!previous) {
      added += 1;
      rows.push({ domain, changes: ['Added to the later settled result set.'] });
    } else if (!next) {
      removed += 1;
      rows.push({ domain, changes: ['Absent from the later settled result set.'] });
    } else {
      const changes = resultChanges(previous, next);
      if (changes.length) rows.push({ domain, changes });
      else unchanged += 1;
    }
  }
  return {
    baselineId: baseline.id,
    currentId: current.id,
    added,
    removed,
    changed: rows.length - added - removed,
    unchanged,
    rows: rows.slice(0, MAX_BULK_SESSION_ROWS),
    limitations: [
      'This compares compact saved observations, not historical provider data or raw source payloads.',
      'A source-state change may reflect collection availability rather than a change to the domain.',
      'A missing row means it was not completed in that saved session; it does not establish domain removal.',
    ],
  };
}

export function buildBulkSessionExport(sessions: unknown, generatedAt: unknown = new Date().toISOString()) {
  const store = enforceBulkSessionStoreBudget(sessions).store;
  return {
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    generatedAt: timestamp(generatedAt, new Date().toISOString()),
    sessions: store.sessions,
    limitations: [
      'Compact Bulk results and source states only; raw source payloads and contact records are excluded.',
      'Import is non-destructive and does not resume network collection automatically.',
    ],
  };
}

export function mergeBulkSessions(
  localRaw: unknown,
  importedRaw: unknown,
): { sessions: BulkSession[]; added: number; updated: number; skipped: number; pruned: number } {
  const imported = record(importedRaw);
  if (!imported || imported.schema !== BULK_SESSION_SCHEMA || !Array.isArray(imported.sessions)) {
    throw new Error('This file is not a WHOISleuth Bulk session export.');
  }
  if (imported.version !== BULK_SESSION_SCHEMA_VERSION) {
    if (typeof imported.version === 'number' && imported.version > BULK_SESSION_SCHEMA_VERSION) {
      throw new Error(`This Bulk session export uses newer schema ${imported.version}. Update the app before importing it.`);
    }
    throw new Error(`Expected Bulk session schema ${BULK_SESSION_SCHEMA_VERSION}.`);
  }
  let sessions = normalizeBulkSessionStore(localRaw).sessions;
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const candidate of imported.sessions.slice(0, MAX_BULK_SESSIONS * 4)) {
    const session = normalizeBulkSession(candidate);
    if (!session) {
      skipped += 1;
      continue;
    }
    const existing = sessions.find((item) => item.id === session.id);
    if (!existing) added += 1;
    else if (existing.updatedAt !== session.updatedAt) updated += 1;
    else {
      skipped += 1;
      continue;
    }
    sessions = upsertBulkSession(sessions, session).sessions;
  }
  const bounded = enforceBulkSessionStoreBudget({
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    sessions,
  });
  return { sessions: bounded.store.sessions, added, updated, skipped, pruned: bounded.pruned };
}

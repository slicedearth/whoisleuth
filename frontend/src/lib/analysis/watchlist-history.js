// Pure watchlist history/diff logic. The latest full bulk records remain in
// the watchlist entry for rescanning, while history stores compact changes
// against a last-known baseline so browser-local storage does not grow by one complete
// result set on every check.

import { explainRiskScore, normalizeRiskModelVersion } from './scoring.js';
import { HTTP_SECURITY_HEADER_TOKENS, normalizeHttpSummary } from './http-summary.js';
import { normalizeDomain } from './case-model.js';

export const MAX_WATCHLIST_HISTORY_EVENTS = 12;
export const MAX_WATCHLIST_CHANGES_PER_EVENT = 500;
export const MAX_WATCHLIST_DOMAINS = 2000;
export const MAX_WATCHLIST_INPUT_RECORDS = MAX_WATCHLIST_DOMAINS * 2;
export const MAX_WATCHLIST_NAMESERVERS = 12;
export const MAX_WATCHLIST_MUTATION_TYPES = 30;
export const MAX_WATCHLIST_HISTORY_DOMAIN_OPTIONS = MAX_WATCHLIST_DOMAINS;

const MAX_TEXT_LENGTH = 300;
const MAX_TITLE_LENGTH = 200;
const MAX_MUTATION_TYPE_LENGTH = 60;
const MAX_TIMESTAMP_LENGTH = 64;
const CONTROL_RE = /[\x00-\x1f\x7f]/;

const CONCLUSIVE_AVAILABILITY = new Set(['available', 'registered', 'for_sale', 'expiring']);
const DEEP_FIELDS = new Set([
  'hasMx',
  'hasSpf',
  'hasDmarc',
  'activityStatus',
  'pageTitle',
  'httpSummaryVersion',
  'httpEvidenceStatus',
  'httpFinalOrigin',
  'httpResponseStatus',
  'httpTransportSecurity',
  'httpRedirectCount',
  'httpCrossOriginRedirect',
  'httpHttpsDowngrade',
  'httpContentType',
  'httpSecurityHeaders',
  'faviconHash',
  'faviconMatch',
  'faviconNearMatch',
  'hasPasswordField',
  'phishingLanguageMatch',
  'reusesOfficialAssets',
  'riskModelVersion',
  'riskScore',
]);

const FIELD_LABELS = {
  availability: 'Availability',
  registrarName: 'Registrar',
  nameservers: 'Nameservers',
  createdDate: 'Creation date',
  expiryDate: 'Expiry date',
  privacyProtected: 'WHOIS privacy',
  hasMx: 'MX',
  hasSpf: 'SPF',
  hasDmarc: 'DMARC',
  activityStatus: 'Website activity',
  pageTitle: 'Page title',
  httpEvidenceStatus: 'HTTP evidence status',
  httpFinalOrigin: 'Final website origin',
  httpResponseStatus: 'HTTP response status',
  httpTransportSecurity: 'Website transport',
  httpRedirectCount: 'HTTP redirect count',
  httpCrossOriginRedirect: 'Cross-origin redirect',
  httpHttpsDowngrade: 'HTTPS downgrade',
  httpContentType: 'Website content type',
  httpSecurityHeaders: 'Observed security headers',
  faviconHash: 'Favicon',
  faviconMatch: 'Official favicon match',
  faviconNearMatch: 'Official favicon near-match',
  hasPasswordField: 'Password form',
  phishingLanguageMatch: 'Phishing language',
  reusesOfficialAssets: 'Official asset reuse',
  riskScore: 'Risk score',
};

const HISTORY_CATEGORY_FIELDS = {
  registration: new Set(['availability', 'registrarName', 'createdDate', 'expiryDate', 'privacyProtected']),
  delegation: new Set(['nameservers']),
  mail: new Set(['hasMx', 'hasSpf', 'hasDmarc']),
  web: new Set([
    'activityStatus',
    'httpEvidenceStatus',
    'httpFinalOrigin',
    'httpResponseStatus',
    'httpTransportSecurity',
    'httpRedirectCount',
    'httpCrossOriginRedirect',
    'httpHttpsDowngrade',
    'httpContentType',
    'httpSecurityHeaders',
  ]),
  identity: new Set([
    'pageTitle',
    'faviconHash',
    'faviconMatch',
    'faviconNearMatch',
    'hasPasswordField',
    'phishingLanguageMatch',
    'reusesOfficialAssets',
  ]),
  risk: new Set(['riskScore']),
};

export const WATCHLIST_HISTORY_CATEGORIES = Object.freeze([
  Object.freeze({ key: 'registration', label: 'Registration' }),
  Object.freeze({ key: 'delegation', label: 'Delegation' }),
  Object.freeze({ key: 'mail', label: 'Mail' }),
  Object.freeze({ key: 'web', label: 'Web' }),
  Object.freeze({ key: 'identity', label: 'Identity' }),
  Object.freeze({ key: 'risk', label: 'Risk' }),
]);

const MAX_CHANGE_COUNT = MAX_WATCHLIST_DOMAINS * Object.keys(FIELD_LABELS).length;

// The schema version must travel with retained summaries so every storage
// boundary can revalidate them, but it is implementation metadata rather than
// an analyst-facing observation and must never generate a history event.
const BASELINE_FIELDS = ['httpSummaryVersion', 'riskModelVersion', ...Object.keys(FIELD_LABELS)];

const AVAILABILITY_LABELS = {
  available: 'Available',
  registered: 'Registered',
  for_sale: 'For sale',
  expiring: 'Expiring',
  unknown: 'Unknown',
  error: 'Lookup failed',
};

const ACTIVITY_LABELS = {
  active: 'Active site',
  parked: 'Parked',
  unreachable: 'Website check inconclusive',
  no_site: 'No site reported (legacy)',
};

const AVAILABILITY_VALUES = new Set(Object.keys(AVAILABILITY_LABELS));
const ACTIVITY_VALUES = new Set(Object.keys(ACTIVITY_LABELS));
const CHANGE_KINDS = new Set(['new_registration', 'released', 'availability_changed', 'risk_signal_added', 'mail_activated', 'high_risk', 'infrastructure_changed', 'field_changed']);
const HTTP_HEADER_VALUES = new Set(HTTP_SECURITY_HEADER_TOKENS);

function boundedText(value, maximum = MAX_TEXT_LENGTH, allowNull = true) {
  if (value == null && allowNull) return null;
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return allowNull ? null : '';
  const normalized = value.slice(0, maximum * 4).replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
  return normalized || (allowNull ? null : '');
}

function isoTimestamp(value, fallback = new Date(0).toISOString()) {
  if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH || CONTROL_RE.test(value)) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function boundedInteger(value, maximum, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : fallback;
}

function normalizeDateValue(value) {
  if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function inferredScanDepth(record) {
  if (record.scanDepth === 'deep' || record.scanDepth === 'fast') return record.scanDepth;
  return ['hasMx', 'hasSpf', 'hasDmarc', 'activityStatus', 'faviconHash', 'pageTitle', 'httpResponseStatus']
    .some((key) => record[key] !== null && record[key] !== undefined)
    ? 'deep'
    : 'fast';
}

function normalizeNameservers(value) {
  const values = Array.isArray(value) ? value : String(value || '').slice(0, 4096).split(';');
  const normalized = new Set();
  for (const item of values.slice(0, MAX_WATCHLIST_NAMESERVERS * 4)) {
    const nameserver = normalizeDomain(item);
    if (nameserver) normalized.add(nameserver);
    if (normalized.size >= MAX_WATCHLIST_NAMESERVERS) break;
  }
  return [...normalized].sort();
}

function normalizeRegistrar(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeDate(value) {
  return normalizeDateValue(value);
}

function normalizeMutationTypes(value) {
  if (!Array.isArray(value)) return [];
  const types = new Set();
  for (const item of value.slice(0, MAX_WATCHLIST_MUTATION_TYPES * 4)) {
    const type = (boundedText(item, MAX_MUTATION_TYPE_LENGTH, false) || '').toLowerCase();
    if (type) types.add(type);
    if (types.size >= MAX_WATCHLIST_MUTATION_TYPES) break;
  }
  return [...types].sort();
}

function compactRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const domain = normalizeDomain(record.domain);
  if (!domain) return null;
  const scanDepth = inferredScanDepth(record);
  const httpSummary = normalizeHttpSummary(record) || {};
  const providedRiskScore = typeof record.riskScore === 'number' && Number.isFinite(record.riskScore)
    ? Math.max(0, Math.min(100, Math.round(record.riskScore)))
    : null;
  const computedRisk = scanDepth === 'deep' && providedRiskScore === null ? explainRiskScore(record) : null;
  const riskScore = scanDepth === 'deep' ? (providedRiskScore ?? computedRisk?.score ?? null) : null;
  const riskModelVersion = riskScore === null
    ? null
    : providedRiskScore !== null
      ? normalizeRiskModelVersion(record.riskModelVersion)
      : computedRisk?.modelVersion ?? null;
  return {
    domain,
    scanDepth,
    availability: AVAILABILITY_VALUES.has(record.availability) ? record.availability : null,
    registrarName: boundedText(record.registrarName),
    nameservers: normalizeNameservers(record.nameservers),
    createdDate: normalizeDateValue(record.createdDate),
    expiryDate: normalizeDateValue(record.expiryDate),
    privacyProtected: typeof record.privacyProtected === 'boolean' ? record.privacyProtected : null,
    hasMx: typeof record.hasMx === 'boolean' ? record.hasMx : null,
    hasSpf: typeof record.hasSpf === 'boolean' ? record.hasSpf : null,
    hasDmarc: typeof record.hasDmarc === 'boolean' ? record.hasDmarc : null,
    activityStatus: ACTIVITY_VALUES.has(record.activityStatus) ? record.activityStatus : null,
    pageTitle: boundedText(record.pageTitle, MAX_TITLE_LENGTH),
    ...httpSummary,
    faviconHash: boundedText(record.faviconHash, 128),
    faviconMatch: typeof record.faviconMatch === 'boolean' ? record.faviconMatch : null,
    faviconNearMatch: typeof record.faviconNearMatch === 'boolean' ? record.faviconNearMatch : null,
    hasPasswordField: typeof record.hasPasswordField === 'boolean' ? record.hasPasswordField : null,
    phishingLanguageMatch: boundedText(record.phishingLanguageMatch, MAX_TITLE_LENGTH),
    reusesOfficialAssets: typeof record.reusesOfficialAssets === 'boolean' ? record.reusesOfficialAssets : null,
    riskModelVersion,
    riskScore,
    mutationTypes: normalizeMutationTypes(record.mutationTypes),
  };
}

/** @param {object[]} results */
export function compactWatchlistResults(results) {
  if (!Array.isArray(results)) return [];
  const byDomain = new Map();
  for (const item of results.slice(0, MAX_WATCHLIST_INPUT_RECORDS)) {
    const record = compactRecord(item);
    if (!record || byDomain.has(record.domain)) continue;
    byDomain.set(record.domain, record);
    if (byDomain.size >= MAX_WATCHLIST_DOMAINS) break;
  }
  return [...byDomain.values()];
}

function isComparable(field, value, record) {
  if (DEEP_FIELDS.has(field) && record.scanDepth !== 'deep') return false;
  if (field === 'availability') return CONCLUSIVE_AVAILABILITY.has(value);
  if (field === 'nameservers') return Array.isArray(value) && value.length > 0;
  if (field === 'httpSecurityHeaders') return Array.isArray(value);
  if (['httpSummaryVersion', 'riskModelVersion', 'httpResponseStatus', 'httpRedirectCount'].includes(field)) return Number.isInteger(value);
  if (['registrarName', 'createdDate', 'expiryDate', 'activityStatus', 'httpEvidenceStatus', 'httpFinalOrigin', 'httpTransportSecurity', 'httpContentType'].includes(field)) return Boolean(value);
  if (['pageTitle', 'faviconHash', 'phishingLanguageMatch'].includes(field)) return value === null || typeof value === 'string';
  if (field === 'riskScore') return typeof value === 'number';
  return typeof value === 'boolean';
}

function valuesEqual(field, before, after) {
  if (field === 'registrarName') return normalizeRegistrar(before) === normalizeRegistrar(after);
  if (field === 'nameservers') return JSON.stringify(normalizeNameservers(before)) === JSON.stringify(normalizeNameservers(after));
  if (field === 'httpSecurityHeaders') return JSON.stringify(before) === JSON.stringify(after);
  if (field === 'createdDate' || field === 'expiryDate') return normalizeDate(before) === normalizeDate(after);
  return before === after;
}

function classifyChange(field, before, after) {
  if (field === 'availability') {
    if (before === 'available' && ['registered', 'for_sale', 'expiring'].includes(after)) {
      return { kind: 'new_registration', tone: 'danger' };
    }
    if (['registered', 'for_sale', 'expiring'].includes(before) && after === 'available') {
      return { kind: 'released', tone: 'good' };
    }
    return { kind: 'availability_changed', tone: 'warn' };
  }
  if (['faviconMatch', 'faviconNearMatch', 'hasPasswordField', 'reusesOfficialAssets'].includes(field) && before === false && after === true) {
    return { kind: 'risk_signal_added', tone: 'danger' };
  }
  if (field === 'phishingLanguageMatch' && !before && after) return { kind: 'risk_signal_added', tone: 'danger' };
  if (field === 'hasMx' && before === false && after === true) return { kind: 'mail_activated', tone: 'warn' };
  if (field === 'riskScore' && before < 70 && after >= 70) return { kind: 'high_risk', tone: 'danger' };
  if (field === 'httpHttpsDowngrade' && before === false && after === true) return { kind: 'risk_signal_added', tone: 'danger' };
  if (field === 'httpCrossOriginRedirect' && before === false && after === true) return { kind: 'field_changed', tone: 'warn' };
  if (field === 'httpTransportSecurity' && before === 'https' && after === 'http') return { kind: 'risk_signal_added', tone: 'danger' };
  if (field === 'httpFinalOrigin') return { kind: 'infrastructure_changed', tone: 'warn' };
  if (['registrarName', 'nameservers', 'faviconHash'].includes(field)) return { kind: 'infrastructure_changed', tone: 'warn' };
  return { kind: 'field_changed', tone: 'neutral' };
}

/**
 * @param {object[]} baseline
 * @param {object[]} current
 * @param {Set<string>} [ignoredDomains]
 */
export function diffWatchlistBaseline(baseline, current, ignoredDomains = new Set()) {
  const previousByDomain = new Map(baseline.map((record) => [record.domain, record]));
  const changes = [];
  for (const next of current) {
    const previous = previousByDomain.get(next.domain);
    if (!previous || ignoredDomains.has(next.domain)) continue;
    for (const field of Object.keys(FIELD_LABELS)) {
      const before = previous[field];
      const after = next[field];
      if (!isComparable(field, before, previous) || !isComparable(field, after, next)) continue;
      if (field === 'riskScore' && (
        !Number.isInteger(previous.riskModelVersion)
        || previous.riskModelVersion !== next.riskModelVersion
      )) continue;
      if (valuesEqual(field, before, after)) continue;
      changes.push({ domain: next.domain, field, before, after, ...classifyChange(field, before, after) });
    }
  }
  return changes;
}

// Rebuilds the last-known baseline from the current snapshot's membership,
// carrying each retained domain's prior deep-scan fields forward (so a fast
// rescan doesn't erase evidence a fast scan can't re-observe). Domains absent
// from the new snapshot are dropped rather than accumulated - otherwise
// reusing a watchlist name with a changing candidate set would grow the
// baseline without bound and compare reintroduced domains against stale state.
/** @param {object[]} baseline @param {object[]} current */
export function mergeWatchlistBaseline(baseline, current) {
  const previousByDomain = new Map(baseline.map((record) => [record.domain, record]));
  return current.map((next) => {
    const previous = previousByDomain.get(next.domain) || {};
    const updated = { ...previous, domain: next.domain };
    updated.scanDepth = previous.scanDepth === 'deep' || next.scanDepth === 'deep' ? 'deep' : 'fast';
  for (const field of BASELINE_FIELDS) {
      if (isComparable(field, next[field], next)) updated[field] = next[field];
    }
    // Preserve an explicit null beside legacy scores. Absence and null both
    // mean "unversioned" to the comparator, but retaining the key makes the
    // stored/exported contract unambiguous and prevents consumers from having
    // to infer why a score was deliberately excluded from comparison.
    if (next.scanDepth === 'deep' && typeof next.riskScore === 'number') {
      updated.riskModelVersion = normalizeRiskModelVersion(next.riskModelVersion);
    }
    return updated;
  });
}

function sanitizeStoredChange(change) {
  if (!change || typeof change !== 'object' || Array.isArray(change) || !FIELD_LABELS[change.field]) return null;
  const domain = normalizeDomain(change.domain);
  if (!domain) return null;
  const before = normalizeStoredFieldValue(change.field, change.before);
  const after = normalizeStoredFieldValue(change.field, change.after);
  if (before === undefined || after === undefined) return null;
  return {
    domain,
    field: change.field,
    before,
    after,
    kind: CHANGE_KINDS.has(change.kind) ? change.kind : 'field_changed',
    tone: ['danger', 'warn', 'good', 'neutral'].includes(change.tone) ? change.tone : 'neutral',
  };
}

function normalizedOrigin(value) {
  if (typeof value !== 'string' || value.length > 4096 || CONTROL_RE.test(value)) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin.length <= 300
      ? url.origin
      : undefined;
  } catch { return undefined; }
}

function normalizeStoredFieldValue(field, value) {
  if (field === 'availability') return AVAILABILITY_VALUES.has(value) ? value : undefined;
  if (field === 'nameservers') return Array.isArray(value) ? normalizeNameservers(value) : undefined;
  if (field === 'httpSecurityHeaders') {
    return Array.isArray(value) ? [...new Set(value.slice(0, 20).filter((item) => HTTP_HEADER_VALUES.has(item)))].sort() : undefined;
  }
  if (field === 'createdDate' || field === 'expiryDate') return normalizeDateValue(value) ?? undefined;
  if (field === 'activityStatus') return ACTIVITY_VALUES.has(value) ? value : undefined;
  if (field === 'httpEvidenceStatus') return value === 'success' || value === 'partial' ? value : undefined;
  if (field === 'httpFinalOrigin') return normalizedOrigin(value);
  if (field === 'httpResponseStatus') return Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
  if (field === 'httpRedirectCount') return Number.isInteger(value) && value >= 0 && value <= 5 ? value : undefined;
  if (field === 'riskScore') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : undefined;
  if (field === 'httpTransportSecurity') return value === 'http' || value === 'https' ? value : undefined;
  if (field === 'httpContentType') {
    const type = boundedText(value, 100);
    return type && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(type) ? type.toLowerCase() : undefined;
  }
  if (field === 'registrarName') return boundedText(value) ?? undefined;
  if (['pageTitle', 'faviconHash', 'phishingLanguageMatch'].includes(field)) {
    if (value === null) return null;
    return boundedText(value, field === 'pageTitle' || field === 'phishingLanguageMatch' ? MAX_TITLE_LENGTH : 128) ?? undefined;
  }
  return typeof value === 'boolean' ? value : undefined;
}

function initialHistoryEvent(entry, baseline) {
  return {
    checkedAt: entry.updatedAt || new Date(0).toISOString(),
    mode: 'saved',
    resultCount: Array.isArray(entry.results) ? entry.results.length : baseline.length,
    conclusiveCount: baseline.filter((record) => CONCLUSIVE_AVAILABILITY.has(record.availability)).length,
    changeCount: 0,
    omittedChanges: 0,
    changes: [],
  };
}

/** @param {object} entry */
export function normalizeWatchlistEntry(entry) {
  const rawResults = Array.isArray(entry?.results) ? entry.results : [];
  const results = compactWatchlistResults(rawResults);
  const compactResults = results;
  const importedBaseline = Array.isArray(entry?.baseline) ? compactWatchlistResults(entry.baseline) : [];
  const baseline = mergeWatchlistBaseline(importedBaseline, compactResults);
  const history = Array.isArray(entry?.history)
    ? entry.history.slice(-MAX_WATCHLIST_HISTORY_EVENTS * 4).map((event) => {
      const changes = Array.isArray(event?.changes)
        ? event.changes.slice(0, MAX_WATCHLIST_CHANGES_PER_EVENT * 4).map(sanitizeStoredChange).filter(Boolean).slice(0, MAX_WATCHLIST_CHANGES_PER_EVENT)
        : [];
      return {
        checkedAt: isoTimestamp(event?.checkedAt),
        mode: ['fast', 'deep', 'saved'].includes(event?.mode) ? event.mode : 'saved',
        resultCount: boundedInteger(event?.resultCount, MAX_WATCHLIST_DOMAINS, results.length),
        conclusiveCount: boundedInteger(event?.conclusiveCount, MAX_WATCHLIST_DOMAINS),
        changeCount: boundedInteger(event?.changeCount, MAX_CHANGE_COUNT, changes.length),
        omittedChanges: boundedInteger(event?.omittedChanges, MAX_CHANGE_COUNT),
        changes,
      };
    }).slice(-MAX_WATCHLIST_HISTORY_EVENTS)
    : [];
  const normalized = {
    updatedAt: isoTimestamp(entry?.updatedAt),
    results,
    baseline,
    history,
  };
  if (normalized.history.length === 0) normalized.history.push(initialHistoryEvent(normalized, baseline));
  return normalized;
}

/**
 * @param {object | null} existingEntry
 * @param {object[]} results
 * @param {{ checkedAt?: string, mode?: string, ignoredDomains?: Set<string> }} [options]
 */
export function appendWatchlistScan(existingEntry, results, options = {}) {
  const checkedAt = isoTimestamp(options.checkedAt, new Date().toISOString());
  const mode = typeof options.mode === 'string' && ['fast', 'deep', 'saved'].includes(options.mode)
    ? options.mode
    : 'saved';
  const previous = existingEntry ? normalizeWatchlistEntry(existingEntry) : null;
  const current = compactWatchlistResults(results);
  const changes = previous
    ? diffWatchlistBaseline(previous.baseline, current, options.ignoredDomains || new Set())
    : [];
  const storedChanges = changes.slice(0, MAX_WATCHLIST_CHANGES_PER_EVENT);
  const event = {
    checkedAt,
    mode,
    resultCount: current.length,
    conclusiveCount: current.filter((record) => CONCLUSIVE_AVAILABILITY.has(record.availability)).length,
    changeCount: changes.length,
    omittedChanges: Math.max(0, changes.length - storedChanges.length),
    changes: storedChanges,
  };
  const history = [...(previous?.history || []), event].slice(-MAX_WATCHLIST_HISTORY_EVENTS);
  return {
    entry: {
      updatedAt: checkedAt,
      results: current,
      baseline: mergeWatchlistBaseline(previous?.baseline || [], current),
      history,
    },
    changes,
  };
}

export function watchlistFieldLabel(field) {
  return FIELD_LABELS[field] || field;
}

export function formatWatchlistValue(field, value) {
  if (field === 'availability') return AVAILABILITY_LABELS[value] || String(value ?? 'None');
  if (field === 'activityStatus') return ACTIVITY_LABELS[value] || String(value ?? 'None');
  if (field === 'nameservers') return Array.isArray(value) && value.length ? value.join(', ') : 'None';
  if (field === 'faviconHash') return value ? `${String(value).slice(0, 12)}…` : 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined || value === '') return 'None';
  return String(value);
}

export function watchlistHistoryCategory(field) {
  for (const category of WATCHLIST_HISTORY_CATEGORIES) {
    if (HISTORY_CATEGORY_FIELDS[category.key].has(field)) return category.key;
  }
  return null;
}

/**
 * Produces a bounded, deterministic domain list for the history focus control.
 * Current retained domains are prioritised before domains that appear only in
 * older change events, because the latter may have left the current watchlist.
 *
 * @param {object | null | undefined} entry
 */
export function watchlistHistoryDomains(entry) {
  const normalized = normalizeWatchlistEntry(entry || {});
  const current = new Set();
  const historical = new Set();
  for (const record of [...normalized.results, ...normalized.baseline]) {
    if (record?.domain) current.add(record.domain);
  }
  for (const event of normalized.history) {
    for (const change of event.changes) {
      if (change.domain && !current.has(change.domain)) historical.add(change.domain);
    }
  }
  const domains = [...current].sort().concat([...historical].sort()).slice(0, MAX_WATCHLIST_HISTORY_DOMAIN_OPTIONS);
  return {
    domains,
    omittedDomains: Math.max(0, current.size + historical.size - domains.length),
  };
}

/**
 * Builds a read-only view over one domain's retained watchlist changes. The
 * coverage window and scan modes describe the watchlist, not proof that the
 * selected domain was included in every retained check.
 *
 * @param {object | null | undefined} entry
 * @param {unknown} domain
 */
export function projectWatchlistDomainHistory(entry, domain) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;
  const normalized = normalizeWatchlistEntry(entry || {});
  const events = [];
  let materialChangeCount = 0;
  let omittedChanges = 0;

  for (const event of normalized.history) {
    omittedChanges += event.omittedChanges;
    const matching = event.changes.filter((change) => change.domain === normalizedDomain);
    if (!matching.length) continue;
    materialChangeCount += matching.length;
    const groups = [];
    for (const category of WATCHLIST_HISTORY_CATEGORIES) {
      const changes = matching.filter((change) => watchlistHistoryCategory(change.field) === category.key);
      if (changes.length) groups.push({ ...category, changes });
    }
    const uncategorized = matching.filter((change) => watchlistHistoryCategory(change.field) === null);
    if (uncategorized.length) groups.push({ key: 'other', label: 'Other', changes: uncategorized });
    events.push({ checkedAt: event.checkedAt, mode: event.mode, groups });
  }

  return {
    domain: normalizedDomain,
    retainedWatchlistChecks: normalized.history.length,
    watchlistFirstCheckedAt: normalized.history[0]?.checkedAt || null,
    watchlistLastCheckedAt: normalized.history.at(-1)?.checkedAt || null,
    scanModes: ['saved', 'fast', 'deep'].filter((mode) => normalized.history.some((event) => event.mode === mode)),
    materialChangeCount,
    omittedChanges,
    events,
  };
}

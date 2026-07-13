// Pure watchlist history/diff logic. The latest full bulk records remain in
// the watchlist entry for rescanning, while history stores compact changes
// against a last-known baseline so localStorage does not grow by one complete
// result set on every check.

import { computeRiskScore } from './scoring.js';

export const MAX_WATCHLIST_HISTORY_EVENTS = 12;
export const MAX_WATCHLIST_CHANGES_PER_EVENT = 500;

const CONCLUSIVE_AVAILABILITY = new Set(['available', 'registered', 'for_sale', 'expiring']);
const DEEP_FIELDS = new Set([
  'hasMx',
  'hasSpf',
  'hasDmarc',
  'activityStatus',
  'pageTitle',
  'faviconHash',
  'faviconMatch',
  'faviconNearMatch',
  'hasPasswordField',
  'phishingLanguageMatch',
  'reusesOfficialAssets',
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
  faviconHash: 'Favicon',
  faviconMatch: 'Official favicon match',
  faviconNearMatch: 'Official favicon near-match',
  hasPasswordField: 'Password form',
  phishingLanguageMatch: 'Phishing language',
  reusesOfficialAssets: 'Official asset reuse',
  riskScore: 'Risk score',
};

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

function inferredScanDepth(record) {
  if (record.scanDepth === 'deep' || record.scanDepth === 'fast') return record.scanDepth;
  return ['hasMx', 'hasSpf', 'hasDmarc', 'activityStatus', 'faviconHash', 'pageTitle']
    .some((key) => record[key] !== null && record[key] !== undefined)
    ? 'deep'
    : 'fast';
}

function normalizeNameservers(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(';');
  return [...new Set(values
    .map((name) => String(name).trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean))]
    .sort();
}

function normalizeRegistrar(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function compactRecord(record) {
  const scanDepth = inferredScanDepth(record);
  return {
    domain: String(record.domain || '').trim().toLowerCase(),
    scanDepth,
    availability: record.availability || null,
    registrarName: record.registrarName || null,
    nameservers: normalizeNameservers(record.nameservers),
    createdDate: record.createdDate || null,
    expiryDate: record.expiryDate || null,
    privacyProtected: typeof record.privacyProtected === 'boolean' ? record.privacyProtected : null,
    hasMx: typeof record.hasMx === 'boolean' ? record.hasMx : null,
    hasSpf: typeof record.hasSpf === 'boolean' ? record.hasSpf : null,
    hasDmarc: typeof record.hasDmarc === 'boolean' ? record.hasDmarc : null,
    activityStatus: record.activityStatus || null,
    pageTitle: record.pageTitle ?? null,
    faviconHash: record.faviconHash || null,
    faviconMatch: typeof record.faviconMatch === 'boolean' ? record.faviconMatch : null,
    faviconNearMatch: typeof record.faviconNearMatch === 'boolean' ? record.faviconNearMatch : null,
    hasPasswordField: typeof record.hasPasswordField === 'boolean' ? record.hasPasswordField : null,
    phishingLanguageMatch: record.phishingLanguageMatch ?? null,
    reusesOfficialAssets: typeof record.reusesOfficialAssets === 'boolean' ? record.reusesOfficialAssets : null,
    riskScore: scanDepth === 'deep'
      ? (typeof record.riskScore === 'number' ? record.riskScore : computeRiskScore(record))
      : null,
  };
}

/** @param {object[]} results */
export function compactWatchlistResults(results) {
  return results.map(compactRecord).filter((record) => record.domain);
}

function isComparable(field, value, record) {
  if (DEEP_FIELDS.has(field) && record.scanDepth !== 'deep') return false;
  if (field === 'availability') return CONCLUSIVE_AVAILABILITY.has(value);
  if (field === 'nameservers') return Array.isArray(value) && value.length > 0;
  if (['registrarName', 'createdDate', 'expiryDate', 'activityStatus'].includes(field)) return Boolean(value);
  if (['pageTitle', 'faviconHash', 'phishingLanguageMatch'].includes(field)) return value === null || typeof value === 'string';
  if (field === 'riskScore') return typeof value === 'number';
  return typeof value === 'boolean';
}

function valuesEqual(field, before, after) {
  if (field === 'registrarName') return normalizeRegistrar(before) === normalizeRegistrar(after);
  if (field === 'nameservers') return JSON.stringify(normalizeNameservers(before)) === JSON.stringify(normalizeNameservers(after));
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
    for (const field of Object.keys(FIELD_LABELS)) {
      if (isComparable(field, next[field], next)) updated[field] = next[field];
    }
    return updated;
  });
}

function sanitizeStoredChange(change) {
  if (!change || typeof change.domain !== 'string' || !FIELD_LABELS[change.field]) return null;
  return {
    domain: change.domain,
    field: change.field,
    before: change.before,
    after: change.after,
    kind: typeof change.kind === 'string' ? change.kind : 'field_changed',
    tone: ['danger', 'warn', 'good', 'neutral'].includes(change.tone) ? change.tone : 'neutral',
  };
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
  const results = Array.isArray(entry?.results) ? entry.results : [];
  const compactResults = compactWatchlistResults(results);
  const importedBaseline = Array.isArray(entry?.baseline) ? compactWatchlistResults(entry.baseline) : [];
  const baseline = mergeWatchlistBaseline(importedBaseline, compactResults);
  const history = Array.isArray(entry?.history)
    ? entry.history.map((event) => {
      const changes = Array.isArray(event?.changes)
        ? event.changes.map(sanitizeStoredChange).filter(Boolean).slice(0, MAX_WATCHLIST_CHANGES_PER_EVENT)
        : [];
      return {
        checkedAt: typeof event?.checkedAt === 'string' ? event.checkedAt : new Date(0).toISOString(),
        mode: ['fast', 'deep', 'saved'].includes(event?.mode) ? event.mode : 'saved',
        resultCount: Number.isFinite(event?.resultCount) ? event.resultCount : results.length,
        conclusiveCount: Number.isFinite(event?.conclusiveCount) ? event.conclusiveCount : 0,
        changeCount: Number.isFinite(event?.changeCount) ? event.changeCount : changes.length,
        omittedChanges: Number.isFinite(event?.omittedChanges) ? event.omittedChanges : 0,
        changes,
      };
    }).slice(-MAX_WATCHLIST_HISTORY_EVENTS)
    : [];
  const normalized = {
    updatedAt: typeof entry?.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString(),
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
  const checkedAt = options.checkedAt || new Date().toISOString();
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
    resultCount: results.length,
    conclusiveCount: current.filter((record) => CONCLUSIVE_AVAILABILITY.has(record.availability)).length,
    changeCount: changes.length,
    omittedChanges: Math.max(0, changes.length - storedChanges.length),
    changes: storedChanges,
  };
  const history = [...(previous?.history || []), event].slice(-MAX_WATCHLIST_HISTORY_EVENTS);
  return {
    entry: {
      updatedAt: checkedAt,
      results,
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

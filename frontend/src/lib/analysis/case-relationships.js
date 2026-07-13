// Bounded cross-case comparison over evidence already retained in the
// browser-local case store. These relationships are investigation pivots, not
// ownership, coordination, intent, or maliciousness conclusions. No network
// request, aggregate score, or new persisted record is produced here.

import {
  MAX_CASES,
  MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
  normalizeDomain,
  normalizeSnapshot,
} from './case-model.js';

export const CASE_RELATIONSHIP_VERSION = 1;
export const MAX_RELATIONSHIP_CASES = MAX_CASES;
export const MAX_CASE_RELATIONSHIP_GROUPS = 100;
export const MAX_CASES_PER_RELATIONSHIP = 50;

const SAFE_CASE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** @param {unknown} value */
function safeCaseId(value) {
  return typeof value === 'string' && SAFE_CASE_ID_RE.test(value) ? value : '';
}

/** @param {unknown} value */
function normalizedOrigin(value) {
  if (typeof value !== 'string' || value.length > 300 || /[\x00-\x1f\x7f]/.test(value)) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) return '';
    return parsed.origin.toLowerCase();
  } catch {
    return '';
  }
}

/** @param {unknown} value */
function latestNormalizedSnapshot(value) {
  if (!Array.isArray(value)) return null;
  let latest = null;
  for (const candidate of value.slice(0, MAX_EVIDENCE_SNAPSHOTS_PER_CASE)) {
    const snapshot = normalizeSnapshot(candidate);
    if (!snapshot) continue;
    if (!latest || Date.parse(snapshot.capturedAt) > Date.parse(latest.capturedAt)) latest = snapshot;
  }
  return latest;
}

/** @param {Map<string, Map<string, string>>} buckets @param {string} value @param {string} id @param {string} domain */
function addBucket(buckets, value, id, domain) {
  if (!value) return;
  if (!buckets.has(value)) buckets.set(value, new Map());
  buckets.get(value)?.set(id, domain);
}

/**
 * @param {string} type
 * @param {string} label
 * @param {string} method
 * @param {string} value
 * @param {Array<{id:string,domain:string}>} cases
 * @param {string} description
 */
function group(type, label, method, value, cases, description) {
  return { type, label, method, value, cases, description };
}

/**
 * Builds deterministic relationships from the latest valid evidence snapshot
 * in each case. Nameserver comparison uses the bounded retained normalized set;
 * final-origin comparison requires a deep HTTP observation.
 * @param {unknown} rawCases
 */
export function buildCaseRelationships(rawCases) {
  const input = Array.isArray(rawCases) ? rawCases : [];
  let truncated = input.length > MAX_RELATIONSHIP_CASES;
  const nameserverSets = new Map();
  const finalOrigins = new Map();
  const seenIds = new Set();
  const seenDomains = new Set();

  for (const raw of input.slice(0, MAX_RELATIONSHIP_CASES)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = safeCaseId(raw.id);
    const domain = normalizeDomain(raw.domain);
    if (!id || !domain || seenIds.has(id) || seenDomains.has(domain)) {
      if (id && domain) truncated = true;
      continue;
    }
    if (!Array.isArray(raw.evidenceHistory)
      || raw.evidenceHistory.length > MAX_EVIDENCE_SNAPSHOTS_PER_CASE) {
      if (Array.isArray(raw.evidenceHistory)) truncated = true;
      continue;
    }
    const snapshot = latestNormalizedSnapshot(raw.evidenceHistory);
    if (!snapshot) continue;
    seenIds.add(id);
    seenDomains.add(domain);

    if (snapshot.nameservers.length) {
      addBucket(nameserverSets, snapshot.nameservers.join(' · '), id, domain);
    }
    if (snapshot.scanDepth === 'deep'
      && (snapshot.httpEvidenceStatus === 'success' || snapshot.httpEvidenceStatus === 'partial')) {
      addBucket(finalOrigins, normalizedOrigin(snapshot.httpFinalOrigin), id, domain);
    }
  }

  const output = [];
  for (const [value, records] of nameserverSets) {
    if (records.size < 2) continue;
    output.push(group(
      'nameserver_set',
      'Shared nameserver set',
      'Exact retained normalized set',
      value,
      [...records].map(([id, domain]) => ({ id, domain })).sort((a, b) => a.domain.localeCompare(b.domain)),
      'The latest retained evidence for these cases contains the same bounded normalized nameserver set. Shared DNS providers are common.',
    ));
  }
  for (const [value, records] of finalOrigins) {
    if (records.size < 2) continue;
    output.push(group(
      'http_final_origin',
      'Shared final website origin',
      'Exact normalized HTTP(S) origin',
      value,
      [...records].map(([id, domain]) => ({ id, domain })).sort((a, b) => a.domain.localeCompare(b.domain)),
      'The latest retained deep evidence for these cases ended at the same website origin. Redirectors, parking services, CDNs, and shared platforms are common.',
    ));
  }

  const order = new Map(['nameserver_set', 'http_final_origin'].map((value, index) => [value, index]));
  output.sort((left, right) => (Number(order.get(left.type)) - Number(order.get(right.type)))
    || left.value.localeCompare(right.value)
    || left.cases.map((item) => item.domain).join('|').localeCompare(right.cases.map((item) => item.domain).join('|')));
  if (output.length > MAX_CASE_RELATIONSHIP_GROUPS) truncated = true;
  const groups = output.slice(0, MAX_CASE_RELATIONSHIP_GROUPS).map((item) => {
    if (item.cases.length <= MAX_CASES_PER_RELATIONSHIP) return item;
    truncated = true;
    return { ...item, cases: item.cases.slice(0, MAX_CASES_PER_RELATIONSHIP) };
  });

  return {
    version: CASE_RELATIONSHIP_VERSION,
    groups,
    truncated,
    limitations: [
      'Cross-case relationships compare only the latest compact evidence already stored in this browser and make no new network requests.',
      'Shared infrastructure or destinations are investigation pivots, not proof of common ownership, coordination, intent, or maliciousness.',
      'Older evidence snapshots may contain different observations; this comparison is not a historical campaign reconstruction.',
    ],
  };
}

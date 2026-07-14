// Pure MISP event JSON for local analyst import. The event stays unpublished,
// organization-only, non-IDS, and non-correlating until a MISP user reviews it.

import {
  collectDefensiveIndicatorCandidates,
  MAX_DEFENSIVE_INDICATORS,
} from './defensive-indicator-export.js';

export const MISP_INDICATOR_EXPORT_VERSION = 1;
export const MAX_MISP_ATTRIBUTES = MAX_DEFENSIVE_INDICATORS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_RE = /[\x00-\x1f\x7f]/;
const WARNING = 'Review before operational use; false positives are possible.';

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isoTimestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function defaultUuidFactory() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error('Secure random identifiers are unavailable for the MISP export.');
  return uuid;
}

function nextUuid(uuidFactory, used) {
  const value = uuidFactory();
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error('The MISP identifier factory returned an invalid UUID.');
  }
  const uuid = value.toLowerCase();
  if (used.has(uuid)) throw new Error('The MISP identifier factory returned a duplicate UUID.');
  used.add(uuid);
  return uuid;
}

function riskScore(value) {
  const source = record(value);
  const score = source.risk ?? source.riskScore;
  return typeof score === 'number' && Number.isFinite(score)
    ? Math.max(0, Math.min(100, Math.round(score)))
    : null;
}

function riskModelVersion(value) {
  const source = record(value);
  const saved = record(source.saved);
  const version = source.riskModelVersion ?? saved.riskModelVersion;
  return Number.isSafeInteger(version) && version > 0 && version <= 1000 ? version : null;
}

function scanDepth(value) {
  const source = record(value);
  const saved = record(source.saved);
  const depth = source.scanDepth ?? saved.scanDepth;
  return depth === 'fast' || depth === 'deep' ? depth : 'unknown';
}

function observationTime(value, generatedAt) {
  const source = record(value);
  const saved = record(source.saved);
  const observedAt = isoTimestamp(source.observedAt) || isoTimestamp(saved.observedAt);
  return observedAt
    ? { observedAt, basis: 'scan' }
    : { observedAt: generatedAt, basis: 'export' };
}

function attributeComment(source, observation) {
  const score = riskScore(source);
  const modelVersion = riskModelVersion(source);
  return [
    'Heuristic Bulk finding',
    `availability=${record(source).availability}`,
    `risk=${score ?? 'unknown'}`,
    ...(modelVersion === null ? [] : [`risk-model=v${modelVersion}`]),
    `scan-depth=${scanDepth(source)}`,
    `observed-at=${observation.observedAt}`,
    `timestamp-basis=${observation.basis}`,
    WARNING,
  ].join('; ');
}

export function buildMispIndicatorExport(records, options = {}) {
  const generatedAt = isoTimestamp(options.generatedAt) || new Date().toISOString();
  const uuidFactory = typeof options.uuidFactory === 'function' ? options.uuidFactory : defaultUuidFactory;
  let collected;
  try {
    collected = collectDefensiveIndicatorCandidates(records, MAX_MISP_ATTRIBUTES);
  } catch (cause) {
    if (cause instanceof TypeError) throw new TypeError('MISP indicator export requires an array of Bulk results.');
    throw cause;
  }
  const used = new Set();
  const eventUuid = nextUuid(uuidFactory, used);
  const epochSeconds = String(Math.floor(Date.parse(generatedAt) / 1000));
  const attributes = collected.entries.map(({ domain, source }) => {
    const observation = observationTime(source, generatedAt);
    return {
      uuid: nextUuid(uuidFactory, used),
      type: 'domain',
      category: 'Network activity',
      value: domain,
      to_ids: false,
      distribution: '5',
      timestamp: epochSeconds,
      first_seen: observation.observedAt,
      last_seen: observation.observedAt,
      comment: attributeComment(source, observation),
      disable_correlation: true,
      deleted: false,
    };
  });
  const payload = {
    Event: {
      uuid: eventUuid,
      date: generatedAt.slice(0, 10),
      info: `WHOISleuth heuristic defensive-domain candidates for analyst review (export v${MISP_INDICATOR_EXPORT_VERSION})`,
      threat_level_id: '4',
      analysis: '0',
      distribution: '0',
      published: false,
      timestamp: epochSeconds,
      publish_timestamp: '0',
      disable_correlation: true,
      Attribute: attributes,
    },
  };
  return {
    version: MISP_INDICATOR_EXPORT_VERSION,
    format: 'misp',
    generatedAt,
    domains: collected.domains,
    truncated: collected.truncated,
    filename: `whoisleuth-defensive-domains-${generatedAt.slice(0, 10)}.misp.json`,
    mimeType: 'application/json;charset=utf-8',
    content: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

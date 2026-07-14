// Pure STIX 2.1 interchange for locally reviewed Bulk candidates. Direct
// observations and heuristic inferences remain separate objects so consumers
// do not mistake a Risk score for confirmed maliciousness.

import {
  collectDefensiveIndicatorCandidates,
} from './defensive-indicator-export.js';

export const STIX_INDICATOR_EXPORT_VERSION = 1;
export const MAX_STIX_INDICATORS = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_RE = /[\x00-\x1f\x7f]/;
const WARNING = 'Heuristic finding; review before operational use because false positives are possible.';

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isoTimestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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

function defaultIdFactory(type) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error('Secure random identifiers are unavailable for the STIX export.');
  return `${type}--${uuid}`;
}

function stixId(type, idFactory) {
  const value = idFactory(type);
  const prefix = `${type}--`;
  if (typeof value !== 'string' || !value.startsWith(prefix) || !UUID_RE.test(value.slice(prefix.length))) {
    throw new Error(`The STIX identifier factory returned an invalid ${type} identifier.`);
  }
  return value.toLowerCase();
}

export function buildStixIndicatorExport(records, options = {}) {
  const generatedAt = isoTimestamp(options.generatedAt) || new Date().toISOString();
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory;
  let collected;
  try {
    collected = collectDefensiveIndicatorCandidates(records, MAX_STIX_INDICATORS);
  } catch (cause) {
    if (cause instanceof TypeError) throw new TypeError('STIX indicator export requires an array of Bulk results.');
    throw cause;
  }
  const usedIds = new Set();
  const nextId = (type) => {
    const id = stixId(type, idFactory);
    if (usedIds.has(id)) throw new Error('The STIX identifier factory returned a duplicate identifier.');
    usedIds.add(id);
    return id;
  };
  const producerId = nextId('identity');
  /** @type {Array<Record<string, unknown>>} */
  const objects = [{
    type: 'identity', spec_version: '2.1', id: producerId,
    created: generatedAt, modified: generatedAt,
    name: 'WHOISleuth', identity_class: 'system',
    description: 'Producer of locally generated defensive-domain observations and heuristic inferences.',
    x_whoisleuth_export_version: STIX_INDICATOR_EXPORT_VERSION,
    x_whoisleuth_generated_at: generatedAt,
    x_whoisleuth_false_positive_warning: WARNING,
  }];

  for (const { domain, source } of collected.entries) {
    const domainId = nextId('domain-name');
    const observedDataId = nextId('observed-data');
    const indicatorId = nextId('indicator');
    const relationshipId = nextId('relationship');
    const observation = observationTime(source, generatedAt);
    const score = riskScore(source);
    const modelVersion = riskModelVersion(source);

    objects.push(
      { type: 'domain-name', spec_version: '2.1', id: domainId, value: domain },
      {
        type: 'observed-data', spec_version: '2.1', id: observedDataId,
        created_by_ref: producerId, created: generatedAt, modified: generatedAt,
        first_observed: observation.observedAt, last_observed: observation.observedAt,
        number_observed: 1, object_refs: [domainId],
        x_whoisleuth_evidence_kind: 'direct-observation',
        x_whoisleuth_observed_at_basis: observation.basis,
        x_whoisleuth_source: 'bulk',
        x_whoisleuth_availability: record(source).availability,
        x_whoisleuth_scan_depth: scanDepth(source),
      },
      {
        type: 'indicator', spec_version: '2.1', id: indicatorId,
        created_by_ref: producerId, created: generatedAt, modified: generatedAt,
        name: `Heuristic domain candidate: ${domain}`,
        description: WARNING,
        pattern: `[domain-name:value = '${domain}']`, pattern_type: 'stix', pattern_version: '2.1',
        valid_from: observation.observedAt,
        labels: ['heuristic', 'defensive-review'],
        x_whoisleuth_evidence_kind: 'heuristic-inference',
        x_whoisleuth_risk_score: score,
        ...(modelVersion === null ? {} : { x_whoisleuth_risk_model_version: modelVersion }),
        x_whoisleuth_false_positive_warning: WARNING,
      },
      {
        type: 'relationship', spec_version: '2.1', id: relationshipId,
        created_by_ref: producerId, created: generatedAt, modified: generatedAt,
        relationship_type: 'based-on', source_ref: indicatorId, target_ref: observedDataId,
        description: 'The heuristic Indicator is based on the separately represented domain observation.',
      },
    );
  }

  const bundle = { type: 'bundle', id: nextId('bundle'), objects };
  return {
    version: STIX_INDICATOR_EXPORT_VERSION,
    format: 'stix',
    generatedAt,
    domains: collected.domains,
    truncated: collected.truncated,
    filename: `whoisleuth-defensive-domains-${generatedAt.slice(0, 10)}.stix.json`,
    mimeType: 'application/stix+json;charset=utf-8',
    content: `${JSON.stringify(bundle, null, 2)}\n`,
  };
}

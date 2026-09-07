// Pure STIX 2.1 interchange for locally reviewed Bulk candidates. Direct
// observations and heuristic inferences remain separate objects so consumers
// do not mistake a Risk score for confirmed maliciousness.

import {
  collectDefensiveIndicatorCandidates,
  defensiveIndicatorProvenance,
} from './defensive-indicator-export.mts';
import { STIX_INDICATOR_EXPORT_VERSION } from '../contracts/analyst-interchange.mts';

export { STIX_INDICATOR_EXPORT_VERSION } from '../contracts/analyst-interchange.mts';

export const MAX_STIX_INDICATORS = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_RE = /[\x00-\x1f\x7f]/;
const WARNING = 'Heuristic finding; review before operational use because false positives are possible.';

type IdFactory = (type: string) => unknown;
type StixExportOptions = {
  generatedAt?: unknown;
  idFactory?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function defaultIdFactory(type: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error('Secure random identifiers are unavailable for the STIX export.');
  return `${type}--${uuid}`;
}

function stixId(type: string, idFactory: IdFactory): string {
  const value = idFactory(type);
  const prefix = `${type}--`;
  if (typeof value !== 'string' || !value.startsWith(prefix) || !UUID_RE.test(value.slice(prefix.length))) {
    throw new Error(`The STIX identifier factory returned an invalid ${type} identifier.`);
  }
  return value.toLowerCase();
}

export function buildStixIndicatorExport(records: unknown, options: StixExportOptions = {}) {
  const generatedAt = isoTimestamp(options.generatedAt) || new Date().toISOString();
  const idFactory: IdFactory = typeof options.idFactory === 'function'
    ? options.idFactory as IdFactory
    : defaultIdFactory;
  let collected;
  try {
    collected = collectDefensiveIndicatorCandidates(records, MAX_STIX_INDICATORS);
  } catch (cause) {
    if (cause instanceof TypeError) throw new TypeError('STIX indicator export requires an array of Bulk results.');
    throw cause;
  }
  const usedIds = new Set<string>();
  const nextId = (type: string): string => {
    const id = stixId(type, idFactory);
    if (usedIds.has(id)) throw new Error('The STIX identifier factory returned a duplicate identifier.');
    usedIds.add(id);
    return id;
  };
  const producerId = nextId('identity');
  const objects: Array<Record<string, unknown>> = [{
    type: 'identity', spec_version: '2.1', id: producerId,
    created: generatedAt, modified: generatedAt,
    name: 'WHOISleuth', identity_class: 'system',
    description: 'Producer of locally generated defensive-domain observations and heuristic inferences.',
    x_whoisleuth_export_version: STIX_INDICATOR_EXPORT_VERSION,
    x_whoisleuth_generated_at: generatedAt,
    x_whoisleuth_false_positive_warning: WARNING,
  }];

  for (const { domain, source } of collected.entries) {
    const provenance = defensiveIndicatorProvenance(source);
    const { observedAt, riskScore: score, riskModelVersion: modelVersion } = provenance;
    const domainId = nextId('domain-name');
    const observationId = nextId(observedAt ? 'observed-data' : 'note');
    const indicatorId = nextId('indicator');
    const observationContext = {
      created_by_ref: producerId, created: generatedAt, modified: generatedAt,
      x_whoisleuth_observed_at_basis: observedAt ? 'scan' : 'unknown',
      x_whoisleuth_source: 'bulk',
      x_whoisleuth_availability: record(source).availability,
      x_whoisleuth_scan_depth: provenance.scanDepth,
    };

    objects.push(
      { type: 'domain-name', spec_version: '2.1', id: domainId, value: domain },
      observedAt ? {
        type: 'observed-data', spec_version: '2.1', id: observationId,
        ...observationContext,
        first_observed: observedAt, last_observed: observedAt,
        number_observed: 1, object_refs: [domainId],
        x_whoisleuth_evidence_kind: 'direct-observation',
      } : {
        type: 'note', spec_version: '2.1', id: observationId,
        ...observationContext,
        content: 'Observation time was not retained. This candidate is supplied for heuristic review; its export time is not a sighting time.',
        object_refs: [domainId, indicatorId],
        x_whoisleuth_evidence_kind: 'observation-context',
      },
      {
        type: 'indicator', spec_version: '2.1', id: indicatorId,
        created_by_ref: producerId, created: generatedAt, modified: generatedAt,
        name: `Heuristic domain candidate: ${domain}`,
        description: WARNING,
        pattern: `[domain-name:value = '${domain}']`, pattern_type: 'stix', pattern_version: '2.1',
        valid_from: generatedAt,
        x_whoisleuth_validity_basis: 'export',
        labels: ['heuristic', 'defensive-review'],
        x_whoisleuth_evidence_kind: 'heuristic-inference',
        x_whoisleuth_risk_score: score,
        ...(modelVersion === null ? {} : { x_whoisleuth_risk_model_version: modelVersion }),
        x_whoisleuth_false_positive_warning: WARNING,
      },
    );
    if (observedAt) objects.push({
      type: 'relationship', spec_version: '2.1', id: nextId('relationship'),
      created_by_ref: producerId, created: generatedAt, modified: generatedAt,
      relationship_type: 'based-on', source_ref: indicatorId, target_ref: observationId,
      description: 'The heuristic Indicator is based on the separately represented domain observation.',
    });
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

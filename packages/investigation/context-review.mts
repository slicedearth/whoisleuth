import { parseBoundedJson } from '../analysis/bounded-json.mts';
import { exact, text } from '../evidence/artifact-structure.mts';
import { readEditableCaseExport } from '../cases/case-export-input.mts';
import { MAX_CONTEXT_INPUT_BYTES, DOMAIN_HISTORY_LEGACY_INPUT_VERSION, type ContextReview } from '../contracts/context-review.mts';
import { DOMAIN_HISTORY_INPUT_SCHEMA, DOMAIN_HISTORY_INPUT_VERSION, reviewDomainHistory } from './domain-history-review.mts';
import { PLATFORM_CONTINUITY_INPUT_SCHEMA, PLATFORM_CONTINUITY_INPUT_VERSION, reviewPlatformContinuity } from './platform-continuity-review.mts';
import { STOREFRONT_INPUT_SCHEMA, STOREFRONT_INPUT_VERSION, reviewStorefront } from './storefront-review.mts';
import { CONNECTOR_INPUT_SCHEMA, CONNECTOR_INPUT_VERSION, reviewConnectorProvenance } from './connector-provenance-review.mts';
import { INCIDENT_SEQUENCE_INPUT_SCHEMA, INCIDENT_SEQUENCE_INPUT_VERSION, reviewIncidentSequence } from './incident-sequence-review.mts';

export { CONTEXT_INPUT_SCHEMAS } from '../contracts/context-review.mts';

/** Adapters share the same explicit dispatch; each domain owns its validation. */
export function reviewContextInput(raw: unknown, reviewedAt: string): ContextReview {
  const input = exact(raw, ['schema', 'version', 'evidence'], 'Context review input');
  if (input.schema === DOMAIN_HISTORY_INPUT_SCHEMA && (input.version === DOMAIN_HISTORY_INPUT_VERSION || input.version === DOMAIN_HISTORY_LEGACY_INPUT_VERSION)) {
    const evidence = exact(input.evidence, ['caseExport', 'caseId', 'declarations'], 'Domain history input');
    const caseId = text(evidence.caseId, 'Selected Case ID', 240);
    const cases = readEditableCaseExport(JSON.stringify(evidence.caseExport));
    const selected = cases.find(record => record.id === caseId);
    if (!selected) throw new TypeError('The selected Case is not present in this export.');
    return reviewDomainHistory(selected, evidence.declarations, reviewedAt, input.version);
  }
  if (input.schema === PLATFORM_CONTINUITY_INPUT_SCHEMA && input.version === PLATFORM_CONTINUITY_INPUT_VERSION) return reviewPlatformContinuity(input.evidence, reviewedAt);
  if (input.schema === STOREFRONT_INPUT_SCHEMA && input.version === STOREFRONT_INPUT_VERSION) return reviewStorefront(input.evidence, reviewedAt);
  if (input.schema === CONNECTOR_INPUT_SCHEMA && input.version === CONNECTOR_INPUT_VERSION) return reviewConnectorProvenance(input.evidence, reviewedAt);
  if (input.schema === INCIDENT_SEQUENCE_INPUT_SCHEMA && input.version === INCIDENT_SEQUENCE_INPUT_VERSION) return reviewIncidentSequence(input.evidence, reviewedAt);
  throw new TypeError('Unsupported context review schema or version.');
}

export function parseContextInput(input: string): unknown {
  return parseBoundedJson(input, { label: 'Context review input', maximumBytes: MAX_CONTEXT_INPUT_BYTES });
}

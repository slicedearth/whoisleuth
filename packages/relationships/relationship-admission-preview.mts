import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { RELATIONSHIP_TYPES, qualifyRelationshipSources, type RelationshipContribution } from '../comparison/relationship-provenance.mts';

export const RELATIONSHIP_ADMISSION_PREVIEW_VERSION = 2;
export const MAX_RELATIONSHIP_ADMISSION_SOURCES = 20;
export const MAX_RELATIONSHIP_ADMISSION_DOMAINS = 50;
export const MAX_RELATIONSHIP_ADMISSION_TEXT = 500;

export type RelationshipAdmissionAction = 'expand' | 'retain';

export type RelationshipAdmissionGroup = Readonly<{
  type: string;
  label: string;
  method: string;
  value: string;
  normalizedValue: string;
  domains: readonly string[];
  description: string;
  sourceEvidence?: readonly RelationshipContribution[];
  truncated?: boolean;
}>;

export type RelationshipRetentionAdmission = Readonly<{
  relationship: RelationshipAdmissionGroup;
  sourceContextId: string;
  observedAt: string | null;
  sourceIdentities: readonly string[];
  sourceEvidence: readonly RelationshipContribution[];
  complete: boolean;
  truncated: boolean;
  limitations: readonly string[];
}>;

export type RelationshipAdmissionPreview = Readonly<{
  version: typeof RELATIONSHIP_ADMISSION_PREVIEW_VERSION;
  action: RelationshipAdmissionAction;
  relationshipType: string;
  observedBasis: string;
  connectedCount: number;
  countScope: string;
  firstRetainedObservation: string | null;
  lastRetainedObservation: string | null;
  sourceIdentities: readonly string[];
  sourceEvidence: readonly RelationshipContribution[];
  completeness: 'complete' | 'partial';
  truncated: boolean;
  estimatedNewNodes: number;
  estimatedNewEdges: number;
  persistence: 'none' | 'browser_local_relationship_observation';
  networkRequests: 0;
  externalRecipients: readonly string[];
  sharedInfrastructureWarning: string;
  usefulness: string;
  limitations: readonly string[];
}>;

type RelationshipGroupInput = Readonly<{
  type?: unknown;
  label?: unknown;
  method?: unknown;
  value?: unknown;
  normalizedValue?: unknown;
  domains?: unknown;
  description?: unknown;
  sourceEvidence?: unknown;
  truncated?: boolean;
}>;

function text(value: unknown, fallback = ''): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return fallback;
  return value.replace(/\s+/gu, ' ').trim().slice(0, MAX_RELATIONSHIP_ADMISSION_TEXT);
}

function timestamp(value: unknown): string | null {
  return normalizeExplicitIsoTimestamp(value);
}

/** One immutable projection owns both preview consent and the pre-write check. */
export function snapshotRelationshipAdmission(
  group: RelationshipAdmissionGroup,
  sourceContextId: string,
  limitations: readonly string[],
): RelationshipRetentionAdmission {
  const qualified = qualifyRelationshipSources(group.sourceEvidence, group.domains, {
    truncated: group.truncated, type: RELATIONSHIP_TYPES.find((type) => type === group.type),
  });
  const sourceEvidence = Object.freeze(qualified.sourceEvidence.map((entry) => Object.freeze(entry)));
  const relationship = Object.freeze({
    type: group.type, label: group.label, method: group.method, value: group.value,
    normalizedValue: group.normalizedValue, domains: Object.freeze([...group.domains]),
    description: group.description, sourceEvidence, truncated: qualified.truncated,
  });
  return Object.freeze({
    relationship, sourceContextId, observedAt: qualified.observedAt,
    sourceIdentities: Object.freeze([...new Set(sourceEvidence.map((entry) => entry.source))].sort()),
    sourceEvidence, complete: qualified.complete, truncated: qualified.truncated,
    limitations: Object.freeze([...limitations]),
  });
}

export function relationshipAdmissionMatchesCurrent(
  admission: RelationshipRetentionAdmission,
  groups: readonly RelationshipAdmissionGroup[],
  sourceContextId: string,
  limitations: readonly string[],
): boolean {
  if (admission.sourceContextId !== sourceContextId) return false;
  const snapshot = JSON.stringify(admission.relationship);
  return groups.some((group) => {
    if (group.type !== admission.relationship.type || group.normalizedValue !== admission.relationship.normalizedValue
      || group.domains.length !== admission.relationship.domains.length
      || group.domains.some((domain, index) => domain !== admission.relationship.domains[index])) return false;
    const current = snapshotRelationshipAdmission(group, sourceContextId, limitations);
    return JSON.stringify(current.relationship) === snapshot
      && current.observedAt === admission.observedAt && current.complete === admission.complete
      && current.truncated === admission.truncated
      && JSON.stringify(current.sourceEvidence) === JSON.stringify(admission.sourceEvidence)
      && JSON.stringify(current.sourceIdentities) === JSON.stringify(admission.sourceIdentities)
      && JSON.stringify(current.limitations) === JSON.stringify(admission.limitations);
  });
}

function infrastructureWarning(type: string): string {
  if (type === 'ip_address') return 'Shared IP addresses commonly reflect shared hosting, CDNs, proxies, or managed platforms.';
  if (type === 'certificate') return 'Shared leaf certificates can reflect multi-domain certificates, shared hosting, CDNs, or managed platforms.';
  if (type === 'nameserver_set') return 'Shared nameservers commonly reflect registrar, DNS-hosting, or managed-service infrastructure.';
  if (type === 'favicon') return 'Similar favicons can be generic, copied, transformed, or supplied by a common platform.';
  if (type === 'tracking_identifier') return 'A shared public identifier can be copied, reused by an agency, or embedded by a common service.';
  return 'Shared infrastructure and copied public artefacts can connect otherwise unrelated domains.';
}

export function buildRelationshipAdmissionPreview(
  raw: RelationshipGroupInput,
  options: Readonly<{
    action: RelationshipAdmissionAction;
    observedAt?: unknown;
    firstRetainedObservation?: unknown;
    lastRetainedObservation?: unknown;
    sourceIdentities?: readonly unknown[];
    truncated?: boolean;
  }>,
): RelationshipAdmissionPreview {
  const type = text(raw.type, 'relationship');
  const label = text(raw.label, 'Observed relationship');
  const method = text(raw.method, 'Bounded retained comparison');
  const value = text(raw.value) || text(raw.normalizedValue, 'Value withheld by the bounded projection');
  const domains = Array.isArray(raw.domains)
    ? [...new Set(raw.domains.slice(0, MAX_RELATIONSHIP_ADMISSION_DOMAINS * 2).map((domain) => text(domain)).filter(Boolean))]
      .slice(0, MAX_RELATIONSHIP_ADMISSION_DOMAINS)
    : [];
  const qualified = qualifyRelationshipSources(raw.sourceEvidence, domains, {
    type: RELATIONSHIP_TYPES.find((candidate) => candidate === type),
    truncated: raw.truncated === true || (Array.isArray(raw.domains) && raw.domains.length > domains.length),
  });
  const sourceIdentities = [...new Set(qualified.sourceEvidence.map((entry) => entry.source))].sort();
  const { observedAt, truncated } = qualified;
  const firstRetainedObservation = timestamp(options.firstRetainedObservation);
  const lastRetainedObservation = timestamp(options.lastRetainedObservation);
  return Object.freeze({
    version: RELATIONSHIP_ADMISSION_PREVIEW_VERSION,
    action: options.action,
    relationshipType: type,
    observedBasis: `${label}: ${method}; exact bounded basis ${value}`,
    connectedCount: domains.length,
    countScope: `${domains.length} distinct domain${domains.length === 1 ? '' : 's'} in this one current relationship group${truncated ? '; the projection is partial' : ''}.`,
    firstRetainedObservation,
    lastRetainedObservation,
    sourceIdentities: Object.freeze(sourceIdentities.length ? sourceIdentities : ['Current bounded Bulk scan projection']),
    sourceEvidence: Object.freeze(qualified.sourceEvidence),
    completeness: qualified.complete ? 'complete' : 'partial',
    truncated,
    estimatedNewNodes: domains.length,
    estimatedNewEdges: domains.length,
    persistence: options.action === 'retain' ? 'browser_local_relationship_observation' : 'none',
    networkRequests: 0,
    externalRecipients: Object.freeze([]),
    sharedInfrastructureWarning: infrastructureWarning(type),
    usefulness: text(raw.description, 'This pivot can help compare already retained evidence across the connected domains.'),
    limitations: Object.freeze([
      'The pivot does not establish shared ownership, control, actor identity, coordination, intent, safety, or maliciousness.',
      'Expansion changes only the local scan queue. Retention writes one bounded browser-local relationship observation and does not copy raw upstream payloads.',
      observedAt
        ? `The latest contributing source observation was recorded at ${observedAt}; individual source times and states are retained.`
        : 'At least one contributing source observation time is unavailable, so the preview remains partial.',
    ]),
  });
}

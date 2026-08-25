export const RELATIONSHIP_ADMISSION_PREVIEW_VERSION = 1;
export const MAX_RELATIONSHIP_ADMISSION_SOURCES = 20;
export const MAX_RELATIONSHIP_ADMISSION_DOMAINS = 50;
export const MAX_RELATIONSHIP_ADMISSION_TEXT = 500;

export type RelationshipAdmissionAction = 'expand' | 'retain';

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
}>;

function text(value: unknown, fallback = ''): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return fallback;
  return value.replace(/\s+/gu, ' ').trim().slice(0, MAX_RELATIONSHIP_ADMISSION_TEXT);
}

function timestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
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
  const sourceIdentities = [...new Set((options.sourceIdentities ?? [])
    .slice(0, MAX_RELATIONSHIP_ADMISSION_SOURCES * 2)
    .map((source) => text(source))
    .filter(Boolean))]
    .slice(0, MAX_RELATIONSHIP_ADMISSION_SOURCES);
  const truncated = options.truncated === true
    || (Array.isArray(raw.domains) && raw.domains.length > domains.length)
    || (options.sourceIdentities?.length ?? 0) > sourceIdentities.length;
  const observedAt = timestamp(options.observedAt);
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
    completeness: truncated || !observedAt ? 'partial' : 'complete',
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
        ? `The transient relationship projection was observed at ${observedAt}.`
        : 'The relationship observation time is unavailable, so the preview remains partial.',
    ]),
  });
}

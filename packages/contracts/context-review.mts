/** Common presentation of bounded, analyst-selected contextual evidence. */
export const CONTEXT_REVIEW_SCHEMA = 'whoisleuth.context-review';
export const CONTEXT_REVIEW_VERSION = 1;
export const DOMAIN_HISTORY_INPUT_SCHEMA = 'whoisleuth.domain-history.input';
export const DOMAIN_HISTORY_INPUT_VERSION = 2;
export const DOMAIN_HISTORY_LEGACY_INPUT_VERSION = 1;
export const PLATFORM_CONTINUITY_INPUT_SCHEMA = 'whoisleuth.platform-continuity.input';
export const PLATFORM_CONTINUITY_INPUT_VERSION = 1;
export const STOREFRONT_INPUT_SCHEMA = 'whoisleuth.storefront-review.input';
export const STOREFRONT_INPUT_VERSION = 1;
export const CONNECTOR_INPUT_SCHEMA = 'whoisleuth.connector-review.input';
export const CONNECTOR_INPUT_VERSION = 1;
export const INCIDENT_SEQUENCE_INPUT_SCHEMA = 'whoisleuth.incident-sequence.input';
export const INCIDENT_SEQUENCE_INPUT_VERSION = 1;
export const CONTEXT_INPUT_CONTRACTS = [
  { schema: DOMAIN_HISTORY_INPUT_SCHEMA, version: DOMAIN_HISTORY_INPUT_VERSION },
  { schema: PLATFORM_CONTINUITY_INPUT_SCHEMA, version: PLATFORM_CONTINUITY_INPUT_VERSION },
  { schema: STOREFRONT_INPUT_SCHEMA, version: STOREFRONT_INPUT_VERSION },
  { schema: CONNECTOR_INPUT_SCHEMA, version: CONNECTOR_INPUT_VERSION },
  { schema: INCIDENT_SEQUENCE_INPUT_SCHEMA, version: INCIDENT_SEQUENCE_INPUT_VERSION },
] as const;
export const CONTEXT_INPUT_SCHEMAS = CONTEXT_INPUT_CONTRACTS.map(input => input.schema);
export const MAX_CONTEXT_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_CONTEXT_RECORDS = 200;
export const CONTEXT_REVIEW_KINDS = ['domain_history', 'platform_continuity', 'storefront', 'connector', 'incident_sequence'] as const;
export type ContextReviewKind = typeof CONTEXT_REVIEW_KINDS[number];
export type ContextObservation = Readonly<{
  label: string;
  state: 'observed' | 'changed' | 'reported' | 'unknown' | 'partial';
  detail: string;
  source: string;
  observedAt: string | null;
  hostname: string | null;
}>;
export type ContextReview = Readonly<{
  schema: typeof CONTEXT_REVIEW_SCHEMA;
  version: typeof CONTEXT_REVIEW_VERSION;
  kind: ContextReviewKind;
  reviewedAt: string;
  title: string;
  summary: string;
  state: 'reviewed' | 'partial';
  observations: readonly ContextObservation[];
  nextSteps: readonly string[];
  limitations: readonly string[];
}>;

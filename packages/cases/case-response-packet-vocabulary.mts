// Response packet vocabulary shared by construction and independent validation.

export const RESPONSE_CONTACT_KINDS = [
  'registrar',
  'registry',
  'network_hosting',
  'security_txt',
  'application_platform',
] as const;

export const RESPONSE_PACKET_PROFILE_IDS = [
  'registrar',
  'registry',
  'network_hosting',
  'security_contact',
  'application_platform',
  'browser_blocklist',
  'internal_soc',
] as const;

export const RESPONSE_READINESS_STATES = ['complete', 'partial', 'stale', 'unavailable', 'not_provided'] as const;
export type ResponseReadinessState = typeof RESPONSE_READINESS_STATES[number];

export const RESPONSE_READINESS_ROW_IDS = [
  'observed_behaviour',
  'exact_url',
  'observation_time',
  'capture_provenance',
  'infrastructure_responsibility',
  'recipient_route',
  'authority_review',
  'selected_evidence',
  'contradictions',
  'source_limitations',
] as const;

export const RESPONSE_AUTHORISATION_CONFIRMATION_IDS = [
  'selectedEvidence',
  'recipientScope',
  'privacyRedactions',
  'analystAuthority',
  'evidenceFreshness',
] as const;

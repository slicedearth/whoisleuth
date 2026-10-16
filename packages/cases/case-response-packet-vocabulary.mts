// Response packet vocabulary shared by construction and independent validation.
import type { CaseActionType } from './case-response-records.mts';

export const RESPONSE_CONTACT_KINDS = [
  'registrar',
  'registry',
  'network_hosting',
  'security_txt',
  'application_platform',
] as const;

const ACTION_CONTACT_KINDS = {
  registrar_report: 'registrar',
  registry_report: 'registry',
  network_hosting_report: 'network_hosting',
  security_contact_report: 'security_txt',
  platform_report: 'application_platform',
  defensive_control: 'manual',
  internal_review: 'manual',
} as const satisfies Record<CaseActionType, typeof RESPONSE_CONTACT_KINDS[number] | 'manual'>;

export function responseActionContactKind(type: CaseActionType): typeof RESPONSE_CONTACT_KINDS[number] | 'manual' {
  return ACTION_CONTACT_KINDS[type];
}

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

export function responseContactLabel(value: typeof RESPONSE_CONTACT_KINDS[number] | 'manual'): string {
  if (value === 'network_hosting') return 'Observed endpoint network registration';
  if (value === 'security_txt') return 'security.txt';
  if (value === 'application_platform') return 'Application platform';
  if (value === 'manual') return 'Manual submission';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

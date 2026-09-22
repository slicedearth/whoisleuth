/** Selected account telemetry, never a provider connection or an identity verdict. */
export const IDENTITY_EVENTS_INPUT_SCHEMA = 'whoisleuth.identity-events.input';
export const IDENTITY_EVENTS_INPUT_VERSION = 1;
export const MAX_IDENTITY_EVENTS = 10_000;
export type IdentityEventProvider = 'entra' | 'okta';
export type IdentityEvent = Readonly<{
  sequence: number;
  actorLabel: string | null;
  applicationIds: readonly string[];
  tenantId: string | null;
  protocol: 'oauth2' | 'device_code' | 'saml' | 'ws_federation' | 'password_grant' | 'unknown';
  kind: 'sign_in' | 'application_access' | 'session_start' | 'credential_check' | 'consent' | 'other';
  occurredAt: string | null;
  result: 'success' | 'failure' | 'denied' | 'challenge' | 'unknown';
}>;
export type IdentityMatchScope = Readonly<{
  applicationId: string;
  tenantId: string | null;
  actorLabel: string | null;
  startedAt: string;
  endedAt: string;
}>;
export type IdentityFieldMatch = 'matched' | 'different' | 'unavailable' | 'not_selected';
export type IdentityEventMatch = Readonly<{
  sequence: number;
  state: 'matched' | 'different' | 'incomplete';
  application: IdentityFieldMatch;
  tenant: IdentityFieldMatch;
  actor: IdentityFieldMatch;
  time: IdentityFieldMatch;
}>;
export type IdentityEventReview = Readonly<{
  provider: IdentityEventProvider;
  events: readonly IdentityEvent[];
  invalidEvents: number;
  sourceHasMore: boolean;
  comparison: Readonly<{ scope: IdentityMatchScope; events: readonly IdentityEventMatch[] }> | null;
}>;

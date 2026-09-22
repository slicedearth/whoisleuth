import type { MailAuthenticationReview } from './mail-authentication.mts';

export const MESSAGE_INTAKE_SCHEMA = 'whoisleuth.message-intake';
export const MESSAGE_INTAKE_VERSION = 1;
export const MESSAGE_INTAKE_KINDS = ['text', 'email', 'calendar', 'qr'] as const;
export type MessageIntakeKind = typeof MESSAGE_INTAKE_KINDS[number];
export const IDENTITY_ACTIONS = [
  { id: 'opened_link', label: 'Opened the link' },
  { id: 'entered_password', label: 'Entered a password' },
  { id: 'approved_signin', label: 'Approved a sign-in or MFA request' },
  { id: 'granted_consent', label: 'Granted application consent' },
  { id: 'entered_device_code', label: 'Entered a device code' },
  { id: 'executed_command', label: 'Ran a command or installed software' },
] as const;
export type IdentityAction = typeof IDENTITY_ACTIONS[number]['id'];
export type IdentityReviewStep = Readonly<{ id: string; title: string; detail: string }>;
// Byte admission, extraction work and decoded pixels are independent bounds.
export const MAX_MESSAGE_INTAKE_BYTES = 16 * 1024 * 1024;
export const MAX_MESSAGE_PARTS = 256;
export const MAX_MESSAGE_DEPTH = 12;
export const MAX_MESSAGE_HTML_NODES = 50_000;
export const MAX_INTAKE_LINKS = 512;
export const MAX_INTAKE_URL_LENGTH = 8_192;
export const MAX_EMBEDDED_LINK_DEPTH = 8;
export const MAX_AUTH_SCOPES = 64;

export type AuthorisationLinkReview = Readonly<{
  kind: 'authorisation_parameters' | 'device_code_reference';
  clientId: string | null;
  scopes: readonly string[];
  redirectOrigin: string | null;
  responseTypes: readonly string[];
  prompt: readonly string[];
  duplicateParameters: readonly string[];
  omittedParameters: boolean;
}>;
export type IntakeLink = Readonly<{
  id: string;
  origin: string;
  hostname: string;
  registrationDomain: string | null;
  source: 'text' | 'html_link' | 'html_form' | 'html_frame' | 'calendar' | 'qr' | 'embedded_parameter';
  parentId: string | null;
  displayedHostname: string | null;
  displayedDestination: 'same_host' | 'different_host' | 'not_a_hostname';
  hasPrivateLocation: boolean;
  authorisation: AuthorisationLinkReview | null;
}>;
/** Exact values exist only in the transient review, never in its saved report. */
export type IntakeTarget = Readonly<{ id: string; exactUrl: string }>;
export const MESSAGE_ACTION_HINTS = ['clipboard_instruction', 'shell_instruction', 'verification_prompt', 'device_code_instruction', 'consent_instruction'] as const;
export type MessageActionHint = typeof MESSAGE_ACTION_HINTS[number];
export type MessageIdentity = Readonly<{ part: number; role: 'from' | 'reply_to' | 'return_path' | 'dkim' | 'authentication_service'; domain: string }>;
export type MessageAuthenticationClaim = Readonly<{ part: number; method: 'spf' | 'dkim' | 'dmarc' | 'arc'; result: string }>;
export type MessageIntakeReport = Readonly<{
  schema: typeof MESSAGE_INTAKE_SCHEMA;
  schemaVersion: typeof MESSAGE_INTAKE_VERSION;
  reviewedAt: string;
  source: Readonly<{ kind: MessageIntakeKind; digestSha256: string; byteLength: number }>;
  coverage: Readonly<{ state: 'reviewed' | 'partial'; reviewedParts: number; unreviewedAttachments: number; rejectedLinks: number; boundsReached: readonly string[] }>;
  identities: readonly MessageIdentity[];
  authenticationClaims: readonly MessageAuthenticationClaim[];
  authenticationReview: MailAuthenticationReview;
  messageParts: readonly Readonly<{ part: number; parentPart: number | null; digestSha256: string; byteLength: number }>[];
  links: readonly IntakeLink[];
  actionHints: readonly MessageActionHint[];
  identityRecovery: Readonly<{ reportedActions: readonly IdentityAction[]; nextSteps: readonly IdentityReviewStep[] }>;
}>;
export type MessageIntakeResult = Readonly<{ report: MessageIntakeReport; targets: readonly IntakeTarget[] }>;

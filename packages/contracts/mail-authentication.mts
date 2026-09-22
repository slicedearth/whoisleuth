export const MAX_AUTHENTICATION_HEADERS = 512;
export const MAX_AUTHENTICATION_CLAUSES = 64;
export const MAX_AUTHENTICATION_VALUE_LENGTH = 16 * 1024;
export const MAIL_AUTHENTICATION_METHODS = Object.freeze(['spf', 'dkim', 'dmarc', 'arc'] as const);
export type MailAuthenticationMethod = typeof MAIL_AUTHENTICATION_METHODS[number];
export const MAIL_AUTHENTICATION_PROPERTIES = ['smtp.mailfrom', 'smtp.helo', 'header.d', 'header.i', 'header.from'] as const;
export type MailAuthenticationProperty = typeof MAIL_AUTHENTICATION_PROPERTIES[number];
export type MailAuthenticationClaim = Readonly<{
  method: MailAuthenticationMethod;
  methodVersion: number;
  result: string;
  state: 'reported' | 'unsupported';
  domains: readonly Readonly<{ property: MailAuthenticationProperty; domain: string }>[];
  duplicateProperties: readonly MailAuthenticationProperty[];
}>;
export type MailAuthenticationHeader = Readonly<{
  part: number;
  headerIndex: number;
  headerName: 'authentication-results' | 'received-spf';
  authservId: string | null;
  state: 'parsed' | 'none' | 'partial' | 'malformed' | 'unsupported';
  duplicateOf: number | null;
  receiverTrust: 'not_established' | 'analyst_selected';
  claims: readonly MailAuthenticationClaim[];
  issues: readonly string[];
}>;
export type MailAuthenticationReview = Readonly<{
  headers: readonly MailAuthenticationHeader[];
  omittedHeaders: number;
}>;

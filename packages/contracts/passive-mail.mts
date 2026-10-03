/** Stable interchange identities describe DNS publication, not message authentication. */
export const PASSIVE_MAIL_LABELS = Object.freeze({
  authenticated_mail: 'MX, SPF and DMARC observed',
  evidence_incomplete: 'Mail DNS evidence incomplete',
  mail_auth_gap: 'MX observed; SPF or DMARC absent',
  mail_auth_incomplete: 'MX observed; policy evidence incomplete',
  no_explicit_mx: 'No explicit MX observed',
  null_mx: 'Null MX observed',
});
export type PassiveMailState = keyof typeof PASSIVE_MAIL_LABELS;
export const PASSIVE_MAIL_INTERPRETATION = 'The retained authenticated_mail state means MX, SPF and DMARC publications were observed; it does not establish policy validity, alignment, message authentication or delivery.';

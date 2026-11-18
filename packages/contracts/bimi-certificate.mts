export const BIMI_CERTIFICATE_INPUT_SCHEMA = 'whoisleuth.bimi-certificate.input';
export const BIMI_CERTIFICATE_REVIEW_SCHEMA = 'whoisleuth.bimi-certificate.review';
export const BIMI_CERTIFICATE_VERSION = 1;
export const MAX_BIMI_INPUT_BYTES = 512 * 1024;
export const MAX_BIMI_CERTIFICATE_BYTES = 128 * 1024;
export const MAX_BIMI_PEM_BYTES = 256 * 1024;
export const MAX_BIMI_LOGO_BYTES = 32 * 1024;
export const MAX_BIMI_CHAIN_CERTIFICATES = 6;
export const BIMI_PURPOSE_OID = '1.3.6.1.5.5.7.3.31';
export const BIMI_MARK_POLICY_OID = '1.3.6.1.4.1.53087.1.1';
export const BIMI_LOGOTYPE_OID = '1.3.6.1.5.5.7.1.12';
export type BimiCheckState = 'matched' | 'mismatch' | 'unavailable' | 'unsupported' | 'not_supplied';
export type BimiCertificateCheck = Readonly<{ id: string; label: string; state: BimiCheckState; detail: string }>;

export const BIMI_CHECK_LABELS = Object.freeze({
  certification_path: 'Path to selected trust anchor', validity: 'Certificate validity time',
  purpose: 'BIMI certificate purpose', mark_policy: 'Mark policy declaration', domain: 'Exact domain in certificate',
  signature_strength: 'Signature and key strength', embedded_logo: 'Embedded logo digest',
  selected_logo: 'Selected logo matches certificate', svg_profile: 'Core SVG Tiny PS checks',
});

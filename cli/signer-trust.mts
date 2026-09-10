import { createHash } from 'node:crypto';
import { parseBoundedJsonObject } from './bounded-json.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { formatEvidenceSignatureVerification, type EvidenceSignatureVerification } from './evidence-signing.mts';

export const SIGNER_TRUST_STORE_SCHEMA = 'whoisleuth.evidence-signer-trust-store';
export const SIGNER_TRUST_STORE_VERSION = 1;
export const SIGNER_TRUST_REPORT_SCHEMA = 'whoisleuth.evidence-signer-trust-report';
export const SIGNER_TRUST_REPORT_VERSION = 1;
export const MAX_SIGNER_TRUST_STORE_BYTES = 4 * 1024 * 1024;
export const MAX_SIGNER_TRUST_ENTRIES = 1_024;
export const MAX_SIGNER_TRUST_LABEL_LENGTH = 160;
export const MAX_SIGNER_TRUST_NOTE_LENGTH = 2_048;

export type SignerTrustEntry = Readonly<{
  keyIdSha256: string;
  label: string;
  status: 'trusted' | 'retired' | 'revoked';
  updatedAt: string;
  note: string;
  successorKeyIdSha256: string | null;
}>;
export type SignerTrustStore = Readonly<{
  schema: typeof SIGNER_TRUST_STORE_SCHEMA;
  version: typeof SIGNER_TRUST_STORE_VERSION;
  entries: readonly SignerTrustEntry[];
}>;
export type SignerTrustReport = Readonly<{
  schema: typeof SIGNER_TRUST_REPORT_SCHEMA;
  version: typeof SIGNER_TRUST_REPORT_VERSION;
  state: 'trusted' | 'not_trusted';
  checkedAt: string;
  verification: EvidenceSignatureVerification;
  trust: Readonly<{
    state: 'trusted' | 'unknown' | 'retired' | 'revoked' | 'review_required';
    storeDigestSha256: string;
    entry: SignerTrustEntry | null;
  }>;
  limitations: readonly string[];
}>;

const FINGERPRINT = /^[a-f0-9]{64}$/u;
const UNSAFE_TEXT = /[\x00-\x1f\x7f-\x9f\u2028\u2029]|\p{Default_Ignorable_Code_Point}/u;
const PRIVATE_KEY_HEADER = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/u;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, maximum: number, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim()) || UNSAFE_TEXT.test(value) || PRIVATE_KEY_HEADER.test(value)) {
    throw new TypeError(`Signer trust ${label} must be single-line text of at most ${maximum} characters without hidden controls.`);
  }
  return value;
}

export function parseSignerTrustStore(raw: string): SignerTrustStore {
  const value = parseBoundedJsonObject(raw, { label: 'Signer trust store', maximumBytes: MAX_SIGNER_TRUST_STORE_BYTES });
  if (value.schema !== SIGNER_TRUST_STORE_SCHEMA || value.version !== SIGNER_TRUST_STORE_VERSION
    || Object.keys(value).some((key) => !['schema', 'version', 'entries'].includes(key))
    || !Array.isArray(value.entries) || value.entries.length > MAX_SIGNER_TRUST_ENTRIES) {
    throw new TypeError(`Signer trust store must use ${SIGNER_TRUST_STORE_SCHEMA} version ${SIGNER_TRUST_STORE_VERSION} with at most ${MAX_SIGNER_TRUST_ENTRIES} entries.`);
  }
  const seen = new Set<string>();
  const entries = value.entries.map((candidate): SignerTrustEntry => {
    const entry = object(candidate);
    if (!entry || Object.keys(entry).some((key) => !['keyIdSha256', 'label', 'status', 'updatedAt', 'note', 'successorKeyIdSha256'].includes(key))
      || typeof entry.keyIdSha256 !== 'string' || !FINGERPRINT.test(entry.keyIdSha256)
      || typeof entry.status !== 'string' || !['trusted', 'retired', 'revoked'].includes(entry.status)) {
      throw new TypeError('Signer trust entry requires a SHA-256 key fingerprint and trusted, retired or revoked status.');
    }
    if (seen.has(entry.keyIdSha256)) throw new TypeError('Signer trust store contains duplicate key fingerprints.');
    seen.add(entry.keyIdSha256);
    const updatedAt = normalizeExplicitIsoTimestamp(entry.updatedAt);
    if (!updatedAt) throw new TypeError('Signer trust entry updatedAt requires a valid timestamp with an explicit timezone.');
    const successor = entry.successorKeyIdSha256 ?? null;
    if (successor !== null && (typeof successor !== 'string' || !FINGERPRINT.test(successor) || successor === entry.keyIdSha256)) {
      throw new TypeError('Signer trust successor must be a different SHA-256 fingerprint or null.');
    }
    return Object.freeze({
      keyIdSha256: entry.keyIdSha256,
      label: text(entry.label, MAX_SIGNER_TRUST_LABEL_LENGTH, 'label'),
      status: entry.status as SignerTrustEntry['status'],
      updatedAt,
      note: text(entry.note === undefined ? '' : entry.note, MAX_SIGNER_TRUST_NOTE_LENGTH, 'note', true),
      successorKeyIdSha256: successor as string | null,
    });
  });
  return Object.freeze({ schema: SIGNER_TRUST_STORE_SCHEMA, version: SIGNER_TRUST_STORE_VERSION, entries: Object.freeze(entries) });
}

export function assessEvidenceSignerTrust(
  verification: EvidenceSignatureVerification,
  trustStoreRaw: string,
  checkedAt = new Date().toISOString(),
): SignerTrustReport {
  const now = normalizeExplicitIsoTimestamp(checkedAt);
  if (!now) throw new TypeError('Signer trust evaluation requires a valid timestamp with an explicit timezone.');
  const store = parseSignerTrustStore(trustStoreRaw);
  const entry = store.entries.find((candidate) => candidate.keyIdSha256 === verification.signature.keyIdSha256) ?? null;
  // Signing time is self-asserted. It cannot bypass the current revocation policy,
  // and a successor reference never makes another fingerprint trusted.
  const state = !entry ? 'unknown' : entry.status !== 'trusted' ? entry.status
    : Date.parse(entry.updatedAt) > Date.parse(now) ? 'review_required' : 'trusted';
  return Object.freeze({
    schema: SIGNER_TRUST_REPORT_SCHEMA,
    version: SIGNER_TRUST_REPORT_VERSION,
    state: state === 'trusted' ? 'trusted' : 'not_trusted',
    checkedAt: now,
    verification,
    trust: Object.freeze({ state, storeDigestSha256: createHash('sha256').update(trustStoreRaw, 'utf8').digest('hex'), entry }),
    limitations: Object.freeze([
      'Trust is the current policy in the explicitly selected local file. Obtain fingerprints and revocation updates through an authenticated channel; this command does not discover or refresh them.',
      'A label or successor reference does not authenticate a person, organisation or replacement key. A trusted fingerprint does not establish evidence accuracy, authority or collection time.',
      'Signing time is supplied by the signer, not a trusted timestamp. Retired and revoked fingerprints remain untrusted regardless of that time.',
      'The report includes only the matching entry and a SHA-256 digest of the exact trust-file bytes, not the file path, other entries or key files. Do not put sensitive material in labels or notes.',
    ]),
  });
}

export function formatSignerTrustReport(report: SignerTrustReport): string {
  const entry = report.trust.entry;
  return [
    `WHOISleuth signer trust: ${report.trust.state}`,
    `Checked: ${report.checkedAt}`,
    `Trust-file SHA-256: ${report.trust.storeDigestSha256}`,
    ...(entry ? [
      `Local label: ${entry.label}`,
      `Entry reviewed: ${entry.updatedAt}`,
      ...(entry.note ? [`Local note: ${entry.note}`] : []),
      ...(entry.successorKeyIdSha256 ? [`Successor reference: sha256:${entry.successorKeyIdSha256} (not a trust grant)`] : []),
    ] : ['No matching fingerprint in the selected trust file.']),
    '',
    'Signature checks (separate from current trust policy)',
    formatEvidenceSignatureVerification(report.verification, false).trimEnd(),
    ...report.limitations.map((limitation) => `Trust limitation: ${limitation}`),
    '',
  ].join('\n');
}

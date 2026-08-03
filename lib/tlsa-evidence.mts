import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const TLSA_EVIDENCE_SCHEMA = 'whoisleuth.tlsa-evidence';
const TLSA_EVIDENCE_VERSION = 1;
const MAX_TLSA_RECORDS = 50;
const MAX_CERTIFICATE_BYTES = 256 * 1024;

type TlsaRecord = Readonly<{
  usage: number;
  selector: number;
  matchingType: number;
  associationData: string;
}>;

type TlsaRecordResult = TlsaRecord & Readonly<{
  state: 'matched' | 'different' | 'unsupported' | 'unavailable';
  reason: string;
}>;

type TlsaEvidenceReport = Readonly<{
  schema: typeof TLSA_EVIDENCE_SCHEMA;
  version: typeof TLSA_EVIDENCE_VERSION;
  state: 'matched' | 'different' | 'partial' | 'unavailable' | 'invalid';
  dnssecState: 'validated' | 'insecure' | 'bogus' | 'unavailable';
  records: readonly TlsaRecordResult[];
  rejectedCount: number;
  truncated: boolean;
  limitations: readonly string[];
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

function hex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/gu, '').toLowerCase();
  return normalized && normalized.length % 2 === 0 && /^[0-9a-f]+$/u.test(normalized) ? normalized : null;
}

function normalizeTlsaRecord(value: unknown): TlsaRecord | null {
  const source = record(value);
  if (!source) return null;
  const usage = integer(source.usage, 0, 3);
  const selector = integer(source.selector, 0, 1);
  const matchingType = integer(source.matchingType, 0, 2);
  const associationData = hex(source.associationData);
  if (usage === null || selector === null || matchingType === null || !associationData) return null;
  if (matchingType === 1 && associationData.length !== 64) return null;
  if (matchingType === 2 && associationData.length !== 128) return null;
  if (matchingType === 0 && associationData.length > MAX_CERTIFICATE_BYTES * 2) return null;
  return Object.freeze({ usage, selector, matchingType, associationData });
}

function decodeBoundedBase64(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length > MAX_CERTIFICATE_BYTES * 2 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length > 0 && decoded.length <= MAX_CERTIFICATE_BYTES && decoded.toString('base64') === value ? decoded : null;
}

function comparisonValue(recordValue: TlsaRecord, certificateDer: Buffer | null, spkiDer: Buffer | null): string | null {
  const selected = recordValue.selector === 0 ? certificateDer : spkiDer;
  if (!selected) return null;
  if (recordValue.matchingType === 0) return selected.toString('hex');
  if (recordValue.matchingType === 1) return createHash('sha256').update(selected).digest('hex');
  return createHash('sha512').update(selected).digest('hex');
}

function normalizeDnssecState(value: unknown): TlsaEvidenceReport['dnssecState'] {
  return value === 'validated' || value === 'insecure' || value === 'bogus' ? value : 'unavailable';
}

function analyzeTlsaEvidence(input: Readonly<{
  dnssecState: unknown;
  records: unknown;
  certificateDerBase64?: unknown;
  spkiDerBase64?: unknown;
}>): TlsaEvidenceReport {
  const dnssecState = normalizeDnssecState(input.dnssecState);
  const raw = Array.isArray(input.records) ? input.records : null;
  if (!raw) {
    return Object.freeze({
      schema: TLSA_EVIDENCE_SCHEMA,
      version: TLSA_EVIDENCE_VERSION,
      state: 'invalid',
      dnssecState,
      records: Object.freeze([]),
      rejectedCount: 0,
      truncated: false,
      limitations: Object.freeze(['TLSA evidence must be supplied as a bounded record array.']),
    });
  }
  const truncated = raw.length > MAX_TLSA_RECORDS;
  const normalized = raw.slice(0, MAX_TLSA_RECORDS).map(normalizeTlsaRecord);
  const rejectedCount = normalized.filter((item) => item === null).length + Math.max(0, raw.length - MAX_TLSA_RECORDS);
  const records = normalized.filter((item): item is TlsaRecord => item !== null);
  const certificateDer = decodeBoundedBase64(input.certificateDerBase64);
  const spkiDer = decodeBoundedBase64(input.spkiDerBase64);
  const results = records.map((item): TlsaRecordResult => {
    const selected = comparisonValue(item, certificateDer, spkiDer);
    if (!selected) {
      return Object.freeze({ ...item, state: 'unavailable', reason: `No bounded ${item.selector === 0 ? 'certificate' : 'SPKI'} bytes were supplied for comparison.` });
    }
    const matched = selected === item.associationData;
    return Object.freeze({
      ...item,
      state: matched ? 'matched' : 'different',
      reason: matched ? 'The supplied certificate material matched this TLSA association.' : 'The supplied certificate material differed from this TLSA association.',
    });
  });
  const hasMatch = results.some((item) => item.state === 'matched');
  const hasDifferent = results.some((item) => item.state === 'different');
  const hasUnavailable = results.some((item) => item.state === 'unavailable');
  const limitations = [
    'This offline comparison does not connect to the target, retrieve DNS, negotiate SMTP STARTTLS, or validate a DNSSEC chain.',
    'A TLSA match is usable as DANE evidence only when the DNSSEC state was independently validated for the same observation.',
  ];
  if (dnssecState !== 'validated' && hasMatch) {
    limitations.push('Certificate material matched, but DNSSEC was not validated, so the result remains partial.');
  }
  const state = results.length === 0
    ? 'unavailable'
    : dnssecState === 'bogus' || hasDifferent && !hasMatch
      ? 'different'
      : hasMatch && dnssecState === 'validated' && !hasUnavailable && rejectedCount === 0 && !truncated
        ? 'matched'
        : 'partial';
  return Object.freeze({
    schema: TLSA_EVIDENCE_SCHEMA,
    version: TLSA_EVIDENCE_VERSION,
    state,
    dnssecState,
    records: Object.freeze(results),
    rejectedCount,
    truncated,
    limitations: Object.freeze(limitations),
  });
}

export {
  MAX_TLSA_RECORDS,
  TLSA_EVIDENCE_SCHEMA,
  TLSA_EVIDENCE_VERSION,
  analyzeTlsaEvidence,
  normalizeTlsaRecord,
};
export type { TlsaEvidenceReport, TlsaRecord, TlsaRecordResult };

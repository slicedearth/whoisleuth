import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

const TLSA_EVIDENCE_SCHEMA = 'whoisleuth.tlsa-evidence';
const TLSA_EVIDENCE_VERSION = 1;
const MAX_TLSA_RECORDS = 50;
const MAX_CERTIFICATE_BYTES = 256 * 1024;
const MAX_AUTHORITY_MATERIALS = 10;

type TlsaService = Readonly<{
  ownerName: string;
  port: number;
  transport: 'tcp' | 'udp';
  hostname: string;
}>;

type CertificateMaterial = Readonly<{
  certificateDer: Buffer | null;
  spkiDer: Buffer | null;
}>;

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
  state: 'matched' | 'different' | 'partial' | 'untrusted' | 'unavailable' | 'invalid';
  dnssecState: 'validated' | 'insecure' | 'bogus' | 'unavailable';
  pkixValidationState: 'validated' | 'failed' | 'unavailable';
  service: TlsaService | null;
  authorityMaterialCount: number;
  authorityMaterialRejectedCount: number;
  authorityMaterialTruncated: boolean;
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

function normalizeTlsaServiceName(value: unknown): TlsaService | null {
  if (typeof value !== 'string' || value.length > 270) return null;
  const match = /^_(\d{1,5})\._(tcp|udp)\.(.+)$/iu.exec(value.trim().replace(/\.$/u, ''));
  if (!match) return null;
  const port = Number(match[1]);
  const transport = match[2]?.toLowerCase();
  const hostname = domainToASCII(String(match[3] ?? '').toLowerCase());
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || (transport !== 'tcp' && transport !== 'udp')) return null;
  if (!hostname || hostname.length > 253 || hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) return null;
  return Object.freeze({ ownerName: `_${port}._${transport}.${hostname}`, port, transport, hostname });
}

function normalizeCertificateMaterial(value: unknown): CertificateMaterial | null {
  const source = record(value);
  if (!source) return null;
  const certificateDer = decodeBoundedBase64(source.certificateDerBase64);
  const spkiDer = decodeBoundedBase64(source.spkiDerBase64);
  return certificateDer || spkiDer ? Object.freeze({ certificateDer, spkiDer }) : null;
}

function selectedValues(recordValue: TlsaRecord, materials: readonly CertificateMaterial[]): string[] {
  return materials.flatMap((material) => {
    const selected = recordValue.selector === 0 ? material.certificateDer : material.spkiDer;
    if (!selected) return [];
    if (recordValue.matchingType === 0) return [selected.toString('hex')];
    if (recordValue.matchingType === 1) return [createHash('sha256').update(selected).digest('hex')];
    return [createHash('sha512').update(selected).digest('hex')];
  });
}

function normalizeDnssecState(value: unknown): TlsaEvidenceReport['dnssecState'] {
  return value === 'validated' || value === 'insecure' || value === 'bogus' ? value : 'unavailable';
}

function normalizePkixValidationState(value: unknown): TlsaEvidenceReport['pkixValidationState'] {
  return value === 'validated' || value === 'failed' ? value : 'unavailable';
}

function analyzeTlsaEvidence(input: Readonly<{
  serviceName: unknown;
  dnssecState: unknown;
  pkixValidationState?: unknown;
  records: unknown;
  certificateDerBase64?: unknown;
  spkiDerBase64?: unknown;
  authorityMaterials?: unknown;
}>): TlsaEvidenceReport {
  const service = normalizeTlsaServiceName(input.serviceName);
  const dnssecState = normalizeDnssecState(input.dnssecState);
  const pkixValidationState = normalizePkixValidationState(input.pkixValidationState);
  const leafMaterial = normalizeCertificateMaterial({
    certificateDerBase64: input.certificateDerBase64,
    spkiDerBase64: input.spkiDerBase64,
  });
  const rawAuthorityMaterials = Array.isArray(input.authorityMaterials) ? input.authorityMaterials : [];
  const normalizedAuthorityMaterials = rawAuthorityMaterials
    .slice(0, MAX_AUTHORITY_MATERIALS)
    .map(normalizeCertificateMaterial);
  const authorityMaterials = normalizedAuthorityMaterials
    .filter((item): item is CertificateMaterial => item !== null);
  const authorityMaterialRejectedCount = normalizedAuthorityMaterials.length - authorityMaterials.length;
  const authorityMaterialTruncated = rawAuthorityMaterials.length > MAX_AUTHORITY_MATERIALS;
  const raw = Array.isArray(input.records) ? input.records : null;
  if (!raw || !service) {
    return Object.freeze({
      schema: TLSA_EVIDENCE_SCHEMA,
      version: TLSA_EVIDENCE_VERSION,
      state: 'invalid',
      dnssecState,
      pkixValidationState,
      service,
      authorityMaterialCount: authorityMaterials.length,
      authorityMaterialRejectedCount,
      authorityMaterialTruncated,
      records: Object.freeze([]),
      rejectedCount: 0,
      truncated: false,
      limitations: Object.freeze([
        ...(!raw ? ['TLSA evidence must be supplied as a bounded record array.'] : []),
        ...(!service ? ['TLSA evidence must be bound to a valid _port._transport.hostname service name.'] : []),
      ]),
    });
  }
  const truncated = raw.length > MAX_TLSA_RECORDS;
  const normalized = raw.slice(0, MAX_TLSA_RECORDS).map(normalizeTlsaRecord);
  const rejectedCount = normalized.filter((item) => item === null).length + Math.max(0, raw.length - MAX_TLSA_RECORDS);
  const records = normalized.filter((item): item is TlsaRecord => item !== null);
  const results = records.map((item): TlsaRecordResult => {
    const materials = item.usage === 0 || item.usage === 2
      ? authorityMaterials
      : leafMaterial ? [leafMaterial] : [];
    const selected = selectedValues(item, materials);
    if (!selected.length) {
      const role = item.usage === 0 || item.usage === 2 ? 'authority' : 'leaf';
      return Object.freeze({ ...item, state: 'unavailable', reason: `No bounded ${role} ${item.selector === 0 ? 'certificate' : 'SPKI'} bytes were supplied for comparison.` });
    }
    const matched = selected.includes(item.associationData);
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
    'PKIX-TA and PKIX-EE usages require an independently validated PKIX path; association matching alone does not establish that prerequisite.',
  ];
  if (dnssecState !== 'validated' && hasMatch) {
    limitations.push('Certificate material matched, but DNSSEC was not validated, so the result remains partial.');
  }
  const matchedPkixDependent = results.some((item) => item.state === 'matched' && (item.usage === 0 || item.usage === 1));
  const matchedDaneOnly = results.some((item) => item.state === 'matched' && (item.usage === 2 || item.usage === 3));
  if (matchedPkixDependent && pkixValidationState !== 'validated') {
    limitations.push('A PKIX-dependent association matched, but a validated PKIX path was not supplied, so the result is not complete.');
  }
  if (authorityMaterialRejectedCount > 0 || authorityMaterialTruncated) {
    limitations.push('Authority certificate material was malformed or exceeded the review bound, so an unmatched trust-anchor association remains partial.');
  }
  if (hasUnavailable || rejectedCount > 0 || truncated) {
    limitations.push('Some TLSA associations or required certificate material were unavailable, malformed, or beyond the review bound, so the comparison remains incomplete.');
  }
  const comparisonMaterialComplete = !hasUnavailable
    && rejectedCount === 0
    && !truncated
    && authorityMaterialRejectedCount === 0
    && !authorityMaterialTruncated;
  const trustedMatch = dnssecState === 'validated'
    && (matchedDaneOnly || matchedPkixDependent && pkixValidationState === 'validated');
  const state = results.length === 0
    ? 'unavailable'
    : dnssecState === 'validated' && hasDifferent && !hasMatch && comparisonMaterialComplete
      ? 'different'
      : hasMatch && (dnssecState === 'bogus' || matchedPkixDependent && pkixValidationState === 'failed' && !matchedDaneOnly)
        ? 'untrusted'
      : trustedMatch && comparisonMaterialComplete
        ? 'matched'
        : 'partial';
  return Object.freeze({
    schema: TLSA_EVIDENCE_SCHEMA,
    version: TLSA_EVIDENCE_VERSION,
    state,
    dnssecState,
    pkixValidationState,
    service,
    authorityMaterialCount: authorityMaterials.length,
    authorityMaterialRejectedCount,
    authorityMaterialTruncated,
    records: Object.freeze(results),
    rejectedCount,
    truncated,
    limitations: Object.freeze(limitations),
  });
}

export {
  MAX_TLSA_RECORDS,
  MAX_AUTHORITY_MATERIALS,
  TLSA_EVIDENCE_SCHEMA,
  TLSA_EVIDENCE_VERSION,
  analyzeTlsaEvidence,
  normalizeTlsaRecord,
  normalizeTlsaServiceName,
};
export type { CertificateMaterial, TlsaEvidenceReport, TlsaRecord, TlsaRecordResult, TlsaService };

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { normalizeLegacyIsoTimestamp } from './observation.mts';

const DNSSEC_EVIDENCE_SCHEMA = 'whoisleuth.dnssec-evidence-validation';
const DNSSEC_EVIDENCE_VERSION = 1;
const MAX_DNSSEC_RECORDS = 50;
const MAX_PUBLIC_KEY_BYTES = 8192;

type DnssecDsRecord = Readonly<{
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: string;
}>;

type DnssecDnskeyRecord = Readonly<{
  flags: number;
  protocol: number;
  algorithm: number;
  publicKeyBase64: string;
}>;

type DnssecRrsigRecord = Readonly<{
  inception: number;
  expiration: number;
}>;

type DnssecEvidenceInput = Readonly<{
  ownerName: unknown;
  delegationSigned?: unknown;
  dsRecords?: unknown;
  dnskeyRecords?: unknown;
  rrSigRecords?: unknown;
  observedAt?: unknown;
}>;

type DnssecEvidenceReport = Readonly<{
  schema: typeof DNSSEC_EVIDENCE_SCHEMA;
  version: typeof DNSSEC_EVIDENCE_VERSION;
  state: 'consistent' | 'conflict' | 'partial' | 'unsigned' | 'invalid';
  ownerName: string | null;
  dsRecordCount: number;
  dnskeyRecordCount: number;
  rrsigRecordCount: number;
  matchedDsCount: number;
  unsupportedDigestCount: number;
  rejectedCount: number;
  truncated: boolean;
  signatureTimeState: 'within_window' | 'outside_window' | 'mixed' | 'unavailable';
  findings: readonly string[];
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

function ownerName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 253) return null;
  const ascii = domainToASCII(value.trim().replace(/\.$/u, '').toLowerCase());
  if (!ascii || ascii.length > 253) return null;
  const labels = ascii.split('.');
  if (labels.some((label) => !label || label.length > 63)) return null;
  return ascii;
}

function hexadecimal(value: unknown, length?: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/gu, '').toUpperCase();
  if (!normalized || !/^[0-9A-F]+$/u.test(normalized) || normalized.length % 2 !== 0) return null;
  if (length !== undefined && normalized.length !== length) return null;
  return normalized;
}

function normalizeDs(value: unknown): DnssecDsRecord | null {
  const source = record(value);
  if (!source) return null;
  const keyTag = integer(source.keyTag, 0, 65_535);
  const algorithm = integer(source.algorithm, 0, 255);
  const digestType = integer(source.digestType, 0, 255);
  const expectedLength = digestType === 1 ? 40 : digestType === 2 ? 64 : digestType === 4 ? 96 : undefined;
  const digest = hexadecimal(source.digest, expectedLength);
  return keyTag === null || algorithm === null || digestType === null || !digest
    ? null
    : Object.freeze({ keyTag, algorithm, digestType, digest });
}

function normalizeDnskey(value: unknown): DnssecDnskeyRecord | null {
  const source = record(value);
  if (!source) return null;
  const flags = integer(source.flags, 0, 65_535);
  const protocol = integer(source.protocol, 0, 255);
  const algorithm = integer(source.algorithm, 0, 255);
  if (flags === null || protocol === null || algorithm === null || typeof source.publicKeyBase64 !== 'string') return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(source.publicKeyBase64) || source.publicKeyBase64.length > MAX_PUBLIC_KEY_BYTES * 2) return null;
  const decoded = Buffer.from(source.publicKeyBase64, 'base64');
  if (!decoded.length || decoded.length > MAX_PUBLIC_KEY_BYTES || decoded.toString('base64') !== source.publicKeyBase64) return null;
  return Object.freeze({ flags, protocol, algorithm, publicKeyBase64: source.publicKeyBase64 });
}

function dnskeyRdata(value: DnssecDnskeyRecord): Buffer {
  const key = Buffer.from(value.publicKeyBase64, 'base64');
  const rdata = Buffer.allocUnsafe(4 + key.length);
  rdata.writeUInt16BE(value.flags, 0);
  rdata[2] = value.protocol;
  rdata[3] = value.algorithm;
  key.copy(rdata, 4);
  return rdata;
}

function dnskeyTag(rdata: Buffer): number {
  let accumulator = 0;
  for (let index = 0; index < rdata.length; index += 1) {
    accumulator += index & 1 ? rdata[index]! : rdata[index]! << 8;
  }
  accumulator += (accumulator >> 16) & 0xffff;
  return accumulator & 0xffff;
}

function ownerWire(value: string): Buffer {
  const output: number[] = [];
  for (const label of value.split('.')) {
    const bytes = Buffer.from(label, 'ascii');
    output.push(bytes.length, ...bytes);
  }
  output.push(0);
  return Buffer.from(output);
}

function dsDigest(owner: string, dnskey: DnssecDnskeyRecord, digestType: number): string | null {
  const hash = digestType === 1 ? 'sha1' : digestType === 2 ? 'sha256' : digestType === 4 ? 'sha384' : null;
  if (!hash) return null;
  return createHash(hash).update(ownerWire(owner)).update(dnskeyRdata(dnskey)).digest('hex').toUpperCase();
}

function normalizeRrsig(value: unknown): DnssecRrsigRecord | null {
  const source = record(value);
  if (!source) return null;
  const normalizedInception = normalizeLegacyIsoTimestamp(source.inception);
  const normalizedExpiration = normalizeLegacyIsoTimestamp(source.expiration);
  if (!normalizedInception || !normalizedExpiration) return null;
  const inception = Date.parse(normalizedInception);
  const expiration = Date.parse(normalizedExpiration);
  if (inception > expiration) return null;
  return Object.freeze({ inception, expiration });
}

function signatureTimeState(value: readonly DnssecRrsigRecord[], observedAt: unknown): DnssecEvidenceReport['signatureTimeState'] {
  if (!value.length) return 'unavailable';
  const normalizedObservedAt = normalizeLegacyIsoTimestamp(observedAt);
  if (!normalizedObservedAt) return 'unavailable';
  const observed = Date.parse(normalizedObservedAt);
  let withinWindow = 0;
  for (const item of value) {
    if (observed >= item.inception && observed <= item.expiration) withinWindow += 1;
  }
  if (withinWindow === value.length) return 'within_window';
  return withinWindow === 0 ? 'outside_window' : 'mixed';
}

function validateDnssecEvidence(input: DnssecEvidenceInput): DnssecEvidenceReport {
  const normalizedOwner = ownerName(input.ownerName);
  const rawDs = Array.isArray(input.dsRecords) ? input.dsRecords : [];
  const rawDnskeys = Array.isArray(input.dnskeyRecords) ? input.dnskeyRecords : [];
  const rawRrsigs = Array.isArray(input.rrSigRecords) ? input.rrSigRecords : [];
  const dsRecords = rawDs.slice(0, MAX_DNSSEC_RECORDS).map(normalizeDs).filter((item): item is DnssecDsRecord => item !== null);
  const dnskeys = rawDnskeys.slice(0, MAX_DNSSEC_RECORDS).map(normalizeDnskey).filter((item): item is DnssecDnskeyRecord => item !== null);
  const rrsigs = rawRrsigs.slice(0, MAX_DNSSEC_RECORDS).map(normalizeRrsig).filter((item): item is DnssecRrsigRecord => item !== null);
  const rejectedCount = Math.min(rawDs.length, MAX_DNSSEC_RECORDS) - dsRecords.length
    + Math.min(rawDnskeys.length, MAX_DNSSEC_RECORDS) - dnskeys.length
    + Math.min(rawRrsigs.length, MAX_DNSSEC_RECORDS) - rrsigs.length;
  const truncated = rawDs.length > MAX_DNSSEC_RECORDS
    || rawDnskeys.length > MAX_DNSSEC_RECORDS
    || rawRrsigs.length > MAX_DNSSEC_RECORDS;
  const signatureState = signatureTimeState(rrsigs, input.observedAt);
  const findings: string[] = [];
  const limitations = [
    'This offline review verifies supplied DS and DNSKEY relationships only. It does not retrieve or authenticate a complete chain to a configured root trust anchor.',
    'Missing records may reflect incomplete input and are not treated as proof that DNSSEC is absent.',
  ];

  if (!normalizedOwner) {
    return Object.freeze({
      schema: DNSSEC_EVIDENCE_SCHEMA,
      version: DNSSEC_EVIDENCE_VERSION,
      state: 'invalid',
      ownerName: null,
      dsRecordCount: dsRecords.length,
      dnskeyRecordCount: dnskeys.length,
      rrsigRecordCount: rrsigs.length,
      matchedDsCount: 0,
      unsupportedDigestCount: 0,
      rejectedCount,
      truncated,
      signatureTimeState: signatureState,
      findings: Object.freeze(['The supplied owner name was invalid.']),
      limitations: Object.freeze(limitations),
    });
  }

  const incompleteInput = rejectedCount > 0 || truncated;
  if (input.delegationSigned === false && dsRecords.length === 0 && !incompleteInput) {
    findings.push('The supplied delegation state was unsigned and no DS records were supplied.');
    return Object.freeze({
      schema: DNSSEC_EVIDENCE_SCHEMA,
      version: DNSSEC_EVIDENCE_VERSION,
      state: 'unsigned',
      ownerName: normalizedOwner,
      dsRecordCount: 0,
      dnskeyRecordCount: dnskeys.length,
      rrsigRecordCount: rrsigs.length,
      matchedDsCount: 0,
      unsupportedDigestCount: 0,
      rejectedCount,
      truncated,
      signatureTimeState: signatureState,
      findings: Object.freeze(findings),
      limitations: Object.freeze(limitations),
    });
  }

  const unsupportedDigestCount = dsRecords.filter((item) => ![1, 2, 4].includes(item.digestType)).length;
  let matchedDsCount = 0;
  for (const ds of dsRecords) {
    const matched = dnskeys.some((dnskey) => {
      if (dnskey.algorithm !== ds.algorithm) return false;
      const rdata = dnskeyRdata(dnskey);
      return dnskeyTag(rdata) === ds.keyTag && dsDigest(normalizedOwner, dnskey, ds.digestType) === ds.digest;
    });
    if (matched) matchedDsCount += 1;
  }

  const observedConflict = input.delegationSigned === false && dsRecords.length > 0
    || input.delegationSigned === true && dsRecords.length === 0 && !truncated
    || signatureState === 'outside_window'
    || (dsRecords.length > 0 && dnskeys.length > 0 && matchedDsCount === 0 && unsupportedDigestCount < dsRecords.length);
  const definiteConflict = observedConflict && !incompleteInput;
  if (definiteConflict) findings.push('The supplied delegation, signature-time, DS, or DNSKEY evidence conflicts.');
  else if (observedConflict) findings.push('The retained subset contains conflicting evidence, but omitted or rejected records prevent a definitive conflict conclusion.');
  if (matchedDsCount > 0) findings.push(`${matchedDsCount} supplied DS record(s) matched a supplied DNSKEY.`);
  if (unsupportedDigestCount > 0) findings.push(`${unsupportedDigestCount} DS digest type(s) were retained as unsupported.`);
  if (signatureState === 'mixed') findings.push('The supplied RRSIG validity windows were mixed at the observation time.');
  if (input.delegationSigned === false && dsRecords.length === 0 && incompleteInput) {
    findings.push('The retained subset contains no usable DS record, but omitted or rejected records prevent a definitive unsigned conclusion.');
  }
  if (rejectedCount > 0) findings.push(`${rejectedCount} malformed record(s) were rejected.`);
  if (truncated) findings.push('The supplied record set exceeded the review bound and was truncated.');

  const completeLocalRelationship = dsRecords.length > 0
    && dnskeys.length > 0
    && matchedDsCount > 0
    && !observedConflict
    && rejectedCount === 0
    && !truncated
    && unsupportedDigestCount === 0
    && signatureState !== 'mixed';
  return Object.freeze({
    schema: DNSSEC_EVIDENCE_SCHEMA,
    version: DNSSEC_EVIDENCE_VERSION,
    state: definiteConflict ? 'conflict' : completeLocalRelationship ? 'consistent' : 'partial',
    ownerName: normalizedOwner,
    dsRecordCount: dsRecords.length,
    dnskeyRecordCount: dnskeys.length,
    rrsigRecordCount: rrsigs.length,
    matchedDsCount,
    unsupportedDigestCount,
    rejectedCount,
    truncated,
    signatureTimeState: signatureState,
    findings: Object.freeze(findings),
    limitations: Object.freeze(limitations),
  });
}

export {
  DNSSEC_EVIDENCE_SCHEMA,
  DNSSEC_EVIDENCE_VERSION,
  MAX_DNSSEC_RECORDS,
  dnskeyTag,
  validateDnssecEvidence,
};
export type { DnssecDnskeyRecord, DnssecDsRecord, DnssecEvidenceInput, DnssecEvidenceReport, DnssecRrsigRecord };

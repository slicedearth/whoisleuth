// Isolated, bounded DNSSEC chain validation for explicitly authorised CLI
// actions. The validator asks one analyst-selected public recursive resolver
// for DNSSEC wire records over pinned DNS-over-TCP connections, then verifies
// the returned DS, DNSKEY, RRSIG, NSEC, and exact bounded NSEC3 material locally
// from an analyst-supplied trust anchor. It is not used by Lookup, Bulk,
// monitoring, or automatic investigation recipes.

import { Buffer } from 'node:buffer';
import * as crypto from 'node:crypto';
import { randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

import { isPrivateAddress } from './safe-fetch.mts';
import {
  MAX_DNS_MESSAGE_BYTES,
  defaultTcpExchange,
  formatIpv6,
  type DnsExchange,
  type ResolverEndpoint,
} from './service-binding-dns.mts';

const DNSSEC_CHAIN_SCHEMA = 'whoisleuth.dnssec-chain-validation';
const DNSSEC_CHAIN_VERSION = 1;
const DNSSEC_TRUST_ANCHOR_SCHEMA = 'whoisleuth.dnssec-trust-anchor';
const DNSSEC_TRUST_ANCHOR_VERSION = 1;
const MAX_DNSSEC_TRUST_ANCHOR_BYTES = 64 * 1024;

const DNS_CLASS_IN = 1;
const DNS_TYPE_A = 1;
const DNS_TYPE_NS = 2;
const DNS_TYPE_CNAME = 5;
const DNS_TYPE_SOA = 6;
const DNS_TYPE_AAAA = 28;
const DNS_TYPE_OPT = 41;
const DNS_TYPE_DS = 43;
const DNS_TYPE_RRSIG = 46;
const DNS_TYPE_NSEC = 47;
const DNS_TYPE_DNSKEY = 48;
const DNS_TYPE_NSEC3 = 50;
const DNS_TYPE_TLSA = 52;
const MAX_DNS_RECORDS_PER_RESPONSE = 128;
const MAX_DNSSEC_QUERIES = 32;
const MAX_DNSSEC_RESPONSE_BYTES = 512 * 1024;
const MAX_DNSSEC_DELEGATIONS = 8;
const MAX_DNSSEC_NSEC3_ITERATIONS = 500;
const MAX_DNSSEC_RRSET_RECORDS = 32;
const MAX_DNSSEC_RRSET_SIGNATURES = 16;
const MAX_DNSSEC_DENIAL_RECORDS = 16;
const DNSSEC_QUERY_TIMEOUT_MS = 2_500;
const DNSSEC_TOTAL_TIMEOUT_MS = 15_000;
const MAX_ERROR_LENGTH = 240;
const MAX_TRUST_ANCHOR_RECORDS = 8;

type DnsSection = 'answer' | 'authority' | 'additional';
type DnssecValidationState = 'secure' | 'insecure' | 'bogus' | 'indeterminate' | 'timed_out' | 'unsupported' | 'invalid';
type DnssecFailureKind = 'input' | 'transport' | 'validation' | 'unsupported';

type DsData = Readonly<{
  kind: 'DS';
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: Buffer;
}>;
type DnskeyData = Readonly<{
  kind: 'DNSKEY';
  flags: number;
  protocol: number;
  algorithm: number;
  publicKey: Buffer;
}>;
type RrsigData = Readonly<{
  kind: 'RRSIG';
  typeCovered: number;
  algorithm: number;
  labels: number;
  originalTtl: number;
  expiration: number;
  inception: number;
  keyTag: number;
  signerName: string;
  signature: Buffer;
  signedPrefix: Buffer;
}>;
type NsecData = Readonly<{
  kind: 'NSEC';
  nextName: string;
  types: ReadonlySet<number>;
}>;
type Nsec3Data = Readonly<{
  kind: 'NSEC3';
  hashAlgorithm: number;
  flags: number;
  iterations: number;
  salt: Buffer;
  nextHash: string;
  types: ReadonlySet<number>;
}>;
type TlsaData = Readonly<{
  kind: 'TLSA';
  usage: number;
  selector: number;
  matchingType: number;
  associationData: Buffer;
}>;
type AddressData = Readonly<{ kind: 'A' | 'AAAA'; address: string }>;
type NameData = Readonly<{ kind: 'NS' | 'CNAME'; name: string }>;
type OpaqueData = Readonly<{ kind: 'opaque' }>;
type DnsRecordData = DsData | DnskeyData | RrsigData | NsecData | Nsec3Data | TlsaData | AddressData | NameData | OpaqueData;

type DnsWireRecord = Readonly<{
  section: DnsSection;
  owner: string;
  type: number;
  class: number;
  ttl: number;
  canonicalRdata: Buffer;
  data: DnsRecordData;
}>;

type DnsWireResponse = Readonly<{
  name: string;
  type: number;
  rcode: number;
  authenticatedData: boolean;
  records: readonly DnsWireRecord[];
  byteLength: number;
}>;

type DnssecTrustAnchorDs = Readonly<{
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: string;
}>;

type DnssecTrustAnchor = Readonly<{
  schema: typeof DNSSEC_TRUST_ANCHOR_SCHEMA;
  version: typeof DNSSEC_TRUST_ANCHOR_VERSION;
  zone: string;
  source: string;
  reviewedAt: string;
  dsRecords: readonly DnssecTrustAnchorDs[];
}>;

type DnssecDelegationResult = Readonly<{
  zone: string;
  parentZone: string | null;
  state: 'secure' | 'insecure' | 'bogus' | 'indeterminate' | 'unsupported';
  dsRecordCount: number;
  dnskeyRecordCount: number;
  matchedDsCount: number;
  signatureAlgorithm: number | null;
  detail: string;
}>;

type DnssecChainReport = Readonly<{
  schema: typeof DNSSEC_CHAIN_SCHEMA;
  version: typeof DNSSEC_CHAIN_VERSION;
  state: DnssecValidationState;
  target: string | null;
  observedAt: string;
  resolver: Readonly<{ address: string | null; port: number }>;
  trustAnchor: Readonly<{
    zone: string | null;
    source: string | null;
    reviewedAt: string | null;
    dsRecordCount: number;
  }>;
  validatedZone: string | null;
  delegations: readonly DnssecDelegationResult[];
  completeness: 'complete' | 'partial' | 'unavailable';
  transport: Readonly<{
    state: 'complete' | 'partial' | 'timed_out' | 'unavailable';
    queryCount: number;
    responseBytes: number;
    queryLimit: number;
    responseByteLimit: number;
    totalTimeoutMs: number;
  }>;
  failure: Readonly<{ kind: DnssecFailureKind; stage: string; detail: string }> | null;
  limitations: readonly string[];
}>;

type DnssecQuerySessionOptions = Readonly<{
  resolver: ResolverEndpoint;
  exchange?: DnsExchange;
  transactionId?: () => number;
  now?: () => number;
  queryTimeoutMs?: number;
  totalTimeoutMs?: number;
  maximumQueries?: number;
  maximumResponseBytes?: number;
}>;

type QueryOptions = Readonly<{ fresh?: boolean }>;

type RrsetVerification = Readonly<{
  state: 'valid' | 'bogus' | 'unsupported' | 'indeterminate';
  algorithm: number | null;
  keyTag: number | null;
  detail: string;
}>;

type NegativeProof = Readonly<{
  state: 'valid' | 'bogus' | 'unsupported' | 'indeterminate';
  detail: string;
}>;

type DnssecValidatedContext = Readonly<{
  report: DnssecChainReport;
  zone: string | null;
  keys: readonly DnsWireRecord[];
}>;

type SignedRrsetResult = Readonly<{
  response: DnsWireResponse;
  records: readonly DnsWireRecord[];
  verification: RrsetVerification | NegativeProof;
}>;

class DnssecWireError extends Error {
  code: string;

  constructor(message: string, code = 'EBADRESP') {
    super(boundedError(message));
    this.name = 'DnssecWireError';
    this.code = code;
  }
}

function boundedError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value || 'DNSSEC operation failed');
  return message.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim().slice(0, MAX_ERROR_LENGTH) || 'DNSSEC operation failed';
}

function exactObject(value: unknown, keys: ReadonlySet<string>, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be one object.`);
  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).filter((key) => !keys.has(key));
  if (unexpected.length) throw new TypeError(`${label} contains unsupported field "${unexpected[0]}".`);
  return record;
}

function normalizeDnsName(value: unknown, options: Readonly<{ allowServiceLabels?: boolean; allowRoot?: boolean }> = {}): string | null {
  if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  const trimmed = value.trim().replace(/\.+$/u, '');
  if (!trimmed && options.allowRoot) return '.';
  const ascii = (/^[\x21-\x7e]+$/u.test(trimmed) ? trimmed : domainToASCII(trimmed)).toLowerCase();
  if (!ascii || ascii.length > 253) return null;
  const labelPattern = options.allowServiceLabels
    ? /^_?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
    : /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
  return ascii.split('.').every((label) => label.length <= 63 && labelPattern.test(label)) ? ascii : null;
}

function normalizeResolverEndpoint(value: unknown): ResolverEndpoint | null {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u0020\u007f%]/u.test(value)) return null;
  const family = isIP(value);
  if ((family !== 4 && family !== 6) || isPrivateAddress(value)) return null;
  return { address: value.toLowerCase(), port: 53, family };
}

function integer(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : null;
}

function normalizedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum * 4) return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return text && text.length <= maximum ? text : null;
}

function normalizedTimestamp(value: unknown): string | null {
  const text = normalizedText(value, 64);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function normalizeTrustAnchorDs(value: unknown): DnssecTrustAnchorDs | null {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!source || Object.keys(source).some((key) => !['keyTag', 'algorithm', 'digestType', 'digest'].includes(key))) return null;
  const keyTag = integer(source.keyTag, 0, 65_535);
  const algorithm = integer(source.algorithm, 0, 255);
  const digestType = integer(source.digestType, 1, 255);
  const digest = typeof source.digest === 'string' ? source.digest.replace(/\s+/gu, '').toUpperCase() : '';
  const expectedLength = digestType === 1 ? 40 : digestType === 2 ? 64 : digestType === 4 ? 96 : null;
  if (keyTag === null || algorithm === null || digestType === null || !expectedLength || digest.length !== expectedLength || !/^[0-9A-F]+$/u.test(digest)) return null;
  return Object.freeze({ keyTag, algorithm, digestType, digest });
}

function parseDnssecTrustAnchor(value: unknown): DnssecTrustAnchor {
  const input = typeof value === 'string' ? (() => {
    if (Buffer.byteLength(value, 'utf8') > MAX_DNSSEC_TRUST_ANCHOR_BYTES) {
      throw new TypeError(`DNSSEC trust anchor is limited to ${MAX_DNSSEC_TRUST_ANCHOR_BYTES} bytes.`);
    }
    try { return JSON.parse(value); } catch { throw new TypeError('DNSSEC trust anchor is not valid JSON.'); }
  })() : value;
  const source = exactObject(input, new Set(['schema', 'version', 'zone', 'source', 'reviewedAt', 'dsRecords']), 'DNSSEC trust anchor');
  if (source.schema !== DNSSEC_TRUST_ANCHOR_SCHEMA || source.version !== DNSSEC_TRUST_ANCHOR_VERSION) {
    throw new TypeError(`DNSSEC trust anchor must use ${DNSSEC_TRUST_ANCHOR_SCHEMA} version ${DNSSEC_TRUST_ANCHOR_VERSION}.`);
  }
  const zone = normalizeDnsName(source.zone, { allowRoot: true });
  const sourceLabel = normalizedText(source.source, 160);
  const reviewedAt = normalizedTimestamp(source.reviewedAt);
  if (!zone || !sourceLabel || !reviewedAt || !Array.isArray(source.dsRecords)
    || source.dsRecords.length < 1 || source.dsRecords.length > MAX_TRUST_ANCHOR_RECORDS) {
    throw new TypeError(`DNSSEC trust anchor requires one bounded zone, source, review time, and 1 to ${MAX_TRUST_ANCHOR_RECORDS} DS records.`);
  }
  const dsRecords = source.dsRecords.map(normalizeTrustAnchorDs);
  if (dsRecords.some((record) => record === null)) throw new TypeError('DNSSEC trust anchor contains a malformed or unsupported DS record.');
  return Object.freeze({
    schema: DNSSEC_TRUST_ANCHOR_SCHEMA,
    version: DNSSEC_TRUST_ANCHOR_VERSION,
    zone,
    source: sourceLabel,
    reviewedAt,
    dsRecords: Object.freeze(dsRecords as DnssecTrustAnchorDs[]),
  });
}

function assertRange(buffer: Buffer, offset: number, length: number, boundary = buffer.length): void {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > boundary) {
    throw new DnssecWireError('DNS response ended inside a field.');
  }
}

function encodeDnsName(value: string): Buffer {
  const name = value === '.' ? '.' : normalizeDnsName(value, { allowServiceLabels: true, allowRoot: true });
  if (!name) throw new DnssecWireError('DNS query name is invalid.', 'EINVAL');
  if (name === '.') return Buffer.from([0]);
  return Buffer.concat([...name.split('.').flatMap((label) => {
    const bytes = Buffer.from(label, 'ascii');
    return [Buffer.from([bytes.length]), bytes];
  }), Buffer.from([0])]);
}

function readDnsName(message: Buffer, startOffset: number, boundary = message.length): { name: string; nextOffset: number; wireName: Buffer } {
  const labels: string[] = [];
  const wireLabels: Buffer[] = [];
  const pointers = new Set<number>();
  let offset = startOffset;
  let nextOffset: number | null = null;
  let wireLength = 0;
  while (true) {
    assertRange(message, offset, 1, nextOffset === null ? boundary : message.length);
    const length = message[offset] as number;
    if ((length & 0xc0) === 0xc0) {
      assertRange(message, offset, 2, nextOffset === null ? boundary : message.length);
      const pointer = ((length & 0x3f) << 8) | (message[offset + 1] as number);
      if (pointer >= message.length || pointers.has(pointer) || pointers.size >= 32) throw new DnssecWireError('DNS name compression pointer is invalid.');
      pointers.add(pointer);
      if (nextOffset === null) nextOffset = offset + 2;
      offset = pointer;
      continue;
    }
    if ((length & 0xc0) !== 0 || length > 63) throw new DnssecWireError('DNS name label encoding is invalid.');
    offset += 1;
    if (length === 0) {
      if (nextOffset === null) nextOffset = offset;
      break;
    }
    assertRange(message, offset, length, nextOffset === null ? boundary : message.length);
    wireLength += length + 1;
    if (wireLength > 254) throw new DnssecWireError('DNS name exceeds the wire-length limit.');
    const bytes = message.subarray(offset, offset + length);
    if ([...bytes].some((byte) => byte < 0x21 || byte > 0x7e)) throw new DnssecWireError('DNS name contains an unsafe label byte.');
    labels.push(bytes.toString('ascii').toLowerCase());
    wireLabels.push(Buffer.concat([Buffer.from([length]), Buffer.from(bytes)]));
    offset += length;
  }
  return {
    name: labels.length ? labels.join('.') : '.',
    nextOffset: nextOffset as number,
    wireName: Buffer.concat([...wireLabels, Buffer.from([0])]),
  };
}

function buildDnssecQuery(nameValue: string, type: number, transactionId = randomInt(0x1_0000)): Buffer {
  const name = normalizeDnsName(nameValue, { allowServiceLabels: true, allowRoot: true });
  if (!name || !Number.isInteger(type) || type < 1 || type > 65_535
    || !Number.isInteger(transactionId) || transactionId < 0 || transactionId > 65_535) {
    throw new DnssecWireError('DNSSEC query parameters are invalid.', 'EINVAL');
  }
  const qname = encodeDnsName(name);
  const message = Buffer.alloc(12 + qname.length + 4 + 11);
  message.writeUInt16BE(transactionId, 0);
  message.writeUInt16BE(0x0110, 2);
  message.writeUInt16BE(1, 4);
  message.writeUInt16BE(0, 6);
  message.writeUInt16BE(0, 8);
  message.writeUInt16BE(1, 10);
  qname.copy(message, 12);
  let offset = 12 + qname.length;
  message.writeUInt16BE(type, offset);
  message.writeUInt16BE(DNS_CLASS_IN, offset + 2);
  offset += 4;
  message[offset] = 0;
  message.writeUInt16BE(DNS_TYPE_OPT, offset + 1);
  message.writeUInt16BE(1232, offset + 3);
  message.writeUInt32BE(0x00008000, offset + 5);
  message.writeUInt16BE(0, offset + 9);
  return message;
}

function parseTypeBitmap(bytes: Buffer): ReadonlySet<number> {
  const output = new Set<number>();
  let offset = 0;
  let priorWindow = -1;
  while (offset < bytes.length) {
    assertRange(bytes, offset, 2);
    const window = bytes[offset] as number;
    const length = bytes[offset + 1] as number;
    offset += 2;
    if (window <= priorWindow || length < 1 || length > 32) throw new DnssecWireError('DNSSEC type bitmap is malformed.');
    priorWindow = window;
    assertRange(bytes, offset, length);
    for (let octet = 0; octet < length; octet += 1) {
      const value = bytes[offset + octet] as number;
      for (let bit = 0; bit < 8; bit += 1) if (value & (0x80 >> bit)) output.add(window * 256 + octet * 8 + bit);
    }
    offset += length;
  }
  return output;
}

function base32hex(bytes: Buffer): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
  let accumulator = 0;
  let bits = 0;
  let output = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(accumulator >>> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits) output += alphabet[(accumulator << (5 - bits)) & 31];
  return output;
}

function parseRecordData(message: Buffer, type: number, start: number, end: number): { data: DnsRecordData; canonicalRdata: Buffer } {
  const raw = message.subarray(start, end);
  if (type === DNS_TYPE_A) {
    if (raw.length !== 4) throw new DnssecWireError('DNS A record length is invalid.');
    return { data: { kind: 'A', address: [...raw].join('.') }, canonicalRdata: Buffer.from(raw) };
  }
  if (type === DNS_TYPE_AAAA) {
    if (raw.length !== 16) throw new DnssecWireError('DNS AAAA record length is invalid.');
    return { data: { kind: 'AAAA', address: formatIpv6(raw) }, canonicalRdata: Buffer.from(raw) };
  }
  if (type === DNS_TYPE_NS || type === DNS_TYPE_CNAME) {
    const parsed = readDnsName(message, start, end);
    if (parsed.nextOffset !== end) throw new DnssecWireError('DNS name record contains trailing bytes.');
    return {
      data: { kind: type === DNS_TYPE_NS ? 'NS' : 'CNAME', name: parsed.name },
      canonicalRdata: encodeDnsName(parsed.name),
    };
  }
  if (type === DNS_TYPE_DS) {
    if (raw.length < 5 || raw.length > 68) throw new DnssecWireError('DNS DS record length is invalid.');
    return {
      data: { kind: 'DS', keyTag: raw.readUInt16BE(0), algorithm: raw[2] as number, digestType: raw[3] as number, digest: Buffer.from(raw.subarray(4)) },
      canonicalRdata: Buffer.from(raw),
    };
  }
  if (type === DNS_TYPE_DNSKEY) {
    if (raw.length < 5 || raw.length > 8196) throw new DnssecWireError('DNS DNSKEY record length is invalid.');
    return {
      data: { kind: 'DNSKEY', flags: raw.readUInt16BE(0), protocol: raw[2] as number, algorithm: raw[3] as number, publicKey: Buffer.from(raw.subarray(4)) },
      canonicalRdata: Buffer.from(raw),
    };
  }
  if (type === DNS_TYPE_RRSIG) {
    if (raw.length < 20) throw new DnssecWireError('DNS RRSIG record length is invalid.');
    const signer = readDnsName(message, start + 18, end);
    if (signer.nextOffset >= end) throw new DnssecWireError('DNS RRSIG record has no signature bytes.');
    const signedPrefix = Buffer.concat([raw.subarray(0, 18), encodeDnsName(signer.name)]);
    return {
      data: {
        kind: 'RRSIG',
        typeCovered: raw.readUInt16BE(0),
        algorithm: raw[2] as number,
        labels: raw[3] as number,
        originalTtl: raw.readUInt32BE(4),
        expiration: raw.readUInt32BE(8),
        inception: raw.readUInt32BE(12),
        keyTag: raw.readUInt16BE(16),
        signerName: signer.name,
        signature: Buffer.from(message.subarray(signer.nextOffset, end)),
        signedPrefix,
      },
      canonicalRdata: Buffer.concat([signedPrefix, message.subarray(signer.nextOffset, end)]),
    };
  }
  if (type === DNS_TYPE_NSEC) {
    const next = readDnsName(message, start, end);
    if (next.nextOffset >= end) throw new DnssecWireError('DNS NSEC record has no type bitmap.');
    const bitmap = Buffer.from(message.subarray(next.nextOffset, end));
    return {
      data: { kind: 'NSEC', nextName: next.name, types: parseTypeBitmap(bitmap) },
      canonicalRdata: Buffer.concat([next.wireName, bitmap]),
    };
  }
  if (type === DNS_TYPE_NSEC3) {
    if (raw.length < 6) throw new DnssecWireError('DNS NSEC3 record length is invalid.');
    const saltLength = raw[4] as number;
    assertRange(raw, 5, saltLength + 1);
    const hashLengthOffset = 5 + saltLength;
    const hashLength = raw[hashLengthOffset] as number;
    if (!hashLength) throw new DnssecWireError('DNS NSEC3 next hash is empty.');
    assertRange(raw, hashLengthOffset + 1, hashLength + 1);
    const bitmapOffset = hashLengthOffset + 1 + hashLength;
    return {
      data: {
        kind: 'NSEC3',
        hashAlgorithm: raw[0] as number,
        flags: raw[1] as number,
        iterations: raw.readUInt16BE(2),
        salt: Buffer.from(raw.subarray(5, 5 + saltLength)),
        nextHash: base32hex(Buffer.from(raw.subarray(hashLengthOffset + 1, bitmapOffset))),
        types: parseTypeBitmap(Buffer.from(raw.subarray(bitmapOffset))),
      },
      canonicalRdata: Buffer.from(raw),
    };
  }
  if (type === DNS_TYPE_TLSA) {
    if (raw.length < 4 || raw.length > 256 * 1024) throw new DnssecWireError('DNS TLSA record length is invalid.');
    return {
      data: { kind: 'TLSA', usage: raw[0] as number, selector: raw[1] as number, matchingType: raw[2] as number, associationData: Buffer.from(raw.subarray(3)) },
      canonicalRdata: Buffer.from(raw),
    };
  }
  return { data: { kind: 'opaque' }, canonicalRdata: Buffer.from(raw) };
}

function parseDnssecResponse(messageValue: Uint8Array, expected: Readonly<{ transactionId: number; name: string; type: number }>): DnsWireResponse {
  const message = Buffer.from(messageValue);
  if (message.length < 12 || message.length > MAX_DNS_MESSAGE_BYTES) throw new DnssecWireError('DNSSEC response size is invalid.');
  const flags = message.readUInt16BE(2);
  const counts = [message.readUInt16BE(6), message.readUInt16BE(8), message.readUInt16BE(10)];
  if (message.readUInt16BE(0) !== expected.transactionId || (flags & 0x8000) === 0 || (flags & 0x7800) !== 0
    || message.readUInt16BE(4) !== 1 || counts.reduce((total, value) => total + value, 0) > MAX_DNS_RECORDS_PER_RESPONSE) {
    throw new DnssecWireError('DNSSEC response header does not match the query.');
  }
  if ((flags & 0x0200) !== 0) throw new DnssecWireError('DNSSEC response remained truncated over TCP.');
  let offset = 12;
  const question = readDnsName(message, offset);
  offset = question.nextOffset;
  assertRange(message, offset, 4);
  const questionType = message.readUInt16BE(offset);
  const questionClass = message.readUInt16BE(offset + 2);
  offset += 4;
  if (question.name !== expected.name || questionType !== expected.type || questionClass !== DNS_CLASS_IN) {
    throw new DnssecWireError('DNSSEC response question does not match the query.');
  }
  const records: DnsWireRecord[] = [];
  for (let sectionIndex = 0; sectionIndex < counts.length; sectionIndex += 1) {
    const section = (['answer', 'authority', 'additional'] as const)[sectionIndex] as DnsSection;
    for (let index = 0; index < (counts[sectionIndex] as number); index += 1) {
      const owner = readDnsName(message, offset);
      offset = owner.nextOffset;
      assertRange(message, offset, 10);
      const type = message.readUInt16BE(offset);
      const recordClass = message.readUInt16BE(offset + 2);
      const ttl = message.readUInt32BE(offset + 4);
      const length = message.readUInt16BE(offset + 8);
      offset += 10;
      const end = offset + length;
      assertRange(message, offset, length);
      if (type !== DNS_TYPE_OPT) {
        const parsed = parseRecordData(message, type, offset, end);
        records.push(Object.freeze({ section, owner: owner.name, type, class: recordClass, ttl, ...parsed }));
      }
      offset = end;
    }
  }
  if (offset !== message.length) throw new DnssecWireError('DNSSEC response contains trailing bytes.');
  return Object.freeze({
    name: expected.name,
    type: expected.type,
    rcode: flags & 0x000f,
    authenticatedData: (flags & 0x0020) !== 0,
    records: Object.freeze(records),
    byteLength: message.length,
  });
}

class DnssecQuerySession {
  readonly resolver: ResolverEndpoint;
  readonly maximumQueries: number;
  readonly maximumResponseBytes: number;
  readonly totalTimeoutMs: number;
  readonly queryTimeoutMs: number;
  #exchange: DnsExchange;
  #transactionId: () => number;
  #now: () => number;
  #startedAt: number;
  #cache = new Map<string, Promise<DnsWireResponse>>();
  queryCount = 0;
  responseBytes = 0;

  constructor(options: DnssecQuerySessionOptions) {
    this.resolver = options.resolver;
    this.maximumQueries = Math.max(1, Math.min(MAX_DNSSEC_QUERIES, options.maximumQueries ?? MAX_DNSSEC_QUERIES));
    this.maximumResponseBytes = Math.max(1, Math.min(MAX_DNSSEC_RESPONSE_BYTES, options.maximumResponseBytes ?? MAX_DNSSEC_RESPONSE_BYTES));
    this.totalTimeoutMs = Math.max(250, Math.min(30_000, options.totalTimeoutMs ?? DNSSEC_TOTAL_TIMEOUT_MS));
    this.queryTimeoutMs = Math.max(250, Math.min(10_000, options.queryTimeoutMs ?? DNSSEC_QUERY_TIMEOUT_MS));
    this.#exchange = options.exchange ?? defaultTcpExchange;
    this.#transactionId = options.transactionId ?? (() => randomInt(0x1_0000));
    this.#now = options.now ?? Date.now;
    this.#startedAt = this.#now();
  }

  elapsedMs(): number { return Math.max(0, this.#now() - this.#startedAt); }

  async query(nameValue: string, type: number, options: QueryOptions = {}): Promise<DnsWireResponse> {
    const name = normalizeDnsName(nameValue, { allowServiceLabels: true, allowRoot: true });
    if (!name) throw new DnssecWireError('DNSSEC query name is invalid.', 'EINVAL');
    const key = `${name}|${type}`;
    if (!options.fresh) {
      const cached = this.#cache.get(key);
      if (cached) return cached;
    }
    const promise = this.#queryUncached(name, type);
    if (!options.fresh) this.#cache.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      if (!options.fresh) this.#cache.delete(key);
      throw error;
    }
  }

  async #queryUncached(name: string, type: number): Promise<DnsWireResponse> {
    if (this.queryCount >= this.maximumQueries) throw new DnssecWireError('DNSSEC query limit was reached.', 'ELIMIT');
    const remaining = this.totalTimeoutMs - this.elapsedMs();
    if (remaining <= 0) throw new DnssecWireError('DNSSEC total run timed out.', 'ETIMEOUT');
    this.queryCount += 1;
    const transactionId = this.#transactionId();
    const query = buildDnssecQuery(name, type, transactionId);
    let bytes: Buffer;
    try {
      bytes = await this.#exchange(query, this.resolver, { timeoutMs: Math.min(this.queryTimeoutMs, remaining) });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
      throw new DnssecWireError(boundedError(error), /TIMEOUT|TIMEDOUT/u.test(code) || /timed out/iu.test(boundedError(error)) ? 'ETIMEOUT' : 'ETRANSPORT');
    }
    this.responseBytes += bytes.length;
    if (this.responseBytes > this.maximumResponseBytes) throw new DnssecWireError('DNSSEC response-byte limit was reached.', 'ELIMIT');
    const response = parseDnssecResponse(bytes, { transactionId, name, type });
    if (![0, 3].includes(response.rcode)) throw new DnssecWireError(`DNS resolver returned response code ${response.rcode}.`, 'EDNSRCODE');
    return response;
  }
}

function recordsFor(response: DnsWireResponse, owner: string, type: number): DnsWireRecord[] {
  return response.records.filter((record) => record.owner === owner && record.type === type && record.class === DNS_CLASS_IN);
}

function dnskeyTag(rdata: Buffer): number {
  let accumulator = 0;
  for (let index = 0; index < rdata.length; index += 1) accumulator += index & 1 ? rdata[index] as number : (rdata[index] as number) << 8;
  accumulator += (accumulator >> 16) & 0xffff;
  return accumulator & 0xffff;
}

function digestForDs(owner: string, key: DnsWireRecord, digestType: number): Buffer | null {
  const hash = digestType === 1 ? 'sha1' : digestType === 2 ? 'sha256' : digestType === 4 ? 'sha384' : null;
  if (!hash || key.data.kind !== 'DNSKEY') return null;
  return crypto.createHash(hash).update(encodeDnsName(owner)).update(key.canonicalRdata).digest();
}

function dsMatchesKey(owner: string, ds: DsData | DnssecTrustAnchorDs, key: DnsWireRecord): boolean {
  if (key.data.kind !== 'DNSKEY' || key.data.protocol !== 3 || (key.data.flags & 0x0100) === 0 || key.data.algorithm !== ds.algorithm) return false;
  if (dnskeyTag(key.canonicalRdata) !== ds.keyTag) return false;
  const digest = digestForDs(owner, key, ds.digestType);
  const expected = Buffer.isBuffer(ds.digest) ? ds.digest : Buffer.from(ds.digest, 'hex');
  return Boolean(digest && digest.length === expected.length && crypto.timingSafeEqual(digest, expected));
}

function base64url(bytes: Buffer): string { return bytes.toString('base64url'); }

function dnskeyPublicKey(key: DnskeyData): crypto.KeyObject | null {
  try {
    if ([5, 7, 8, 10].includes(key.algorithm)) {
      const bytes = key.publicKey;
      if (bytes.length < 3) return null;
      const exponentLength = bytes[0] === 0 ? bytes.readUInt16BE(1) : bytes[0] as number;
      const offset = bytes[0] === 0 ? 3 : 1;
      if (!exponentLength || offset + exponentLength >= bytes.length) return null;
      return crypto.createPublicKey({
        key: { kty: 'RSA', n: base64url(bytes.subarray(offset + exponentLength)), e: base64url(bytes.subarray(offset, offset + exponentLength)), ext: true },
        format: 'jwk',
      });
    }
    if (key.algorithm === 13 && key.publicKey.length === 64) {
      return crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: base64url(key.publicKey.subarray(0, 32)), y: base64url(key.publicKey.subarray(32)), ext: true }, format: 'jwk' });
    }
    if (key.algorithm === 14 && key.publicKey.length === 96) {
      return crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-384', x: base64url(key.publicKey.subarray(0, 48)), y: base64url(key.publicKey.subarray(48)), ext: true }, format: 'jwk' });
    }
    if (key.algorithm === 15 && key.publicKey.length === 32) {
      return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: base64url(key.publicKey), ext: true }, format: 'jwk' });
    }
    if (key.algorithm === 16 && key.publicKey.length === 57) {
      return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed448', x: base64url(key.publicKey), ext: true }, format: 'jwk' });
    }
  } catch {
    return null;
  }
  return null;
}

function signatureOwner(owner: string, labels: number): string | null {
  const ownerLabels = owner === '.' ? [] : owner.split('.');
  if (labels > ownerLabels.length) return null;
  if (labels === ownerLabels.length) return owner;
  const suffix = labels ? ownerLabels.slice(ownerLabels.length - labels).join('.') : '';
  return suffix ? `*.${suffix}` : '*';
}

function encodeSignatureOwner(owner: string): Buffer {
  if (owner === '*') return Buffer.from([1, 0x2a, 0]);
  if (owner.startsWith('*.')) return Buffer.concat([Buffer.from([1, 0x2a]), encodeDnsName(owner.slice(2))]);
  return encodeDnsName(owner);
}

function signedRrsetData(owner: string, type: number, rrset: readonly DnsWireRecord[], signature: RrsigData): Buffer | null {
  const canonicalOwner = signatureOwner(owner, signature.labels);
  if (!canonicalOwner || signature.typeCovered !== type || !rrset.length) return null;
  const ownerWire = encodeSignatureOwner(canonicalOwner);
  const uniqueRdata = [...new Map(rrset.map((record) => [record.canonicalRdata.toString('hex'), record.canonicalRdata])).values()]
    .sort(Buffer.compare);
  const records = uniqueRdata.map((canonicalRdata) => {
    const header = Buffer.alloc(ownerWire.length + 10);
    ownerWire.copy(header, 0);
    header.writeUInt16BE(type, ownerWire.length);
    header.writeUInt16BE(DNS_CLASS_IN, ownerWire.length + 2);
    header.writeUInt32BE(signature.originalTtl, ownerWire.length + 4);
    header.writeUInt16BE(canonicalRdata.length, ownerWire.length + 8);
    return Buffer.concat([header, canonicalRdata]);
  });
  return Buffer.concat([signature.signedPrefix, ...records]);
}

function signatureWithinWindow(signature: RrsigData, nowSeconds: number): boolean {
  const now = Math.floor(nowSeconds) >>> 0;
  const sinceInception = (now - signature.inception) >>> 0;
  const untilExpiration = (signature.expiration - now) >>> 0;
  return sinceInception < 0x8000_0000 && untilExpiration < 0x8000_0000;
}

function verifyDnssecSignature(key: DnskeyData, signature: RrsigData, data: Buffer): boolean | null {
  if (![5, 7, 8, 10, 13, 14, 15, 16].includes(key.algorithm)) return null;
  const publicKey = dnskeyPublicKey(key);
  if (!publicKey) return false;
  try {
    if (key.algorithm === 5 || key.algorithm === 7) return crypto.verify('sha1', data, publicKey, signature.signature);
    if (key.algorithm === 8) return crypto.verify('sha256', data, publicKey, signature.signature);
    if (key.algorithm === 10) return crypto.verify('sha512', data, publicKey, signature.signature);
    if (key.algorithm === 13) return crypto.verify('sha256', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature.signature);
    if (key.algorithm === 14) return crypto.verify('sha384', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature.signature);
    if (key.algorithm === 15 || key.algorithm === 16) return crypto.verify(null, data, publicKey, signature.signature);
  } catch {
    return false;
  }
  return null;
}

function verifyRrset(
  response: DnsWireResponse,
  owner: string,
  type: number,
  keys: readonly DnsWireRecord[],
  signerName: string,
  now: Date,
): RrsetVerification {
  const rrset = recordsFor(response, owner, type);
  const signatures = response.records.filter((record): record is DnsWireRecord & { data: RrsigData } => (
    record.owner === owner && record.type === DNS_TYPE_RRSIG && record.class === DNS_CLASS_IN
    && record.data.kind === 'RRSIG' && record.data.typeCovered === type && record.data.signerName === signerName
  ));
  if (!rrset.length || !signatures.length) return { state: 'indeterminate', algorithm: null, keyTag: null, detail: 'The response did not contain a complete signed RRset.' };
  if (rrset.length > MAX_DNSSEC_RRSET_RECORDS || signatures.length > MAX_DNSSEC_RRSET_SIGNATURES || keys.length > MAX_DNSSEC_RRSET_RECORDS) {
    return { state: 'unsupported', algorithm: null, keyTag: null, detail: 'The signed RRset exceeded this validator\'s record, signature, or authenticated-key bound.' };
  }
  let attempted = false;
  let unsupported = false;
  let outsideWindow = false;
  let invalidLabelCount = false;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const ownerLabelCount = owner === '.' ? 0 : owner.split('.').length;
  for (const signatureRecord of signatures) {
    const signature = signatureRecord.data;
    if (!signatureWithinWindow(signature, nowSeconds)) {
      outsideWindow = true;
      continue;
    }
    if (signature.labels > ownerLabelCount) {
      invalidLabelCount = true;
      continue;
    }
    if (signature.labels < ownerLabelCount) {
      unsupported = true;
      continue;
    }
    const candidates = keys.filter((record): record is DnsWireRecord & { data: DnskeyData } => (
      record.data.kind === 'DNSKEY'
      && record.owner === signerName
      && record.data.protocol === 3
      && (record.data.flags & 0x0100) !== 0
      && record.data.algorithm === signature.algorithm
      && dnskeyTag(record.canonicalRdata) === signature.keyTag
    ));
    if (!candidates.length) continue;
    const data = signedRrsetData(owner, type, rrset, signature);
    if (!data) continue;
    for (const key of candidates) {
      const valid = verifyDnssecSignature(key.data, signature, data);
      if (valid === null) {
        unsupported = true;
        continue;
      }
      attempted = true;
      if (valid) return { state: 'valid', algorithm: signature.algorithm, keyTag: signature.keyTag, detail: 'The RRset signature validated against an authenticated zone key.' };
    }
  }
  if (invalidLabelCount) return { state: 'bogus', algorithm: null, keyTag: null, detail: 'The RRset signature label count exceeded the owner name.' };
  if (attempted || outsideWindow) return { state: 'bogus', algorithm: null, keyTag: null, detail: outsideWindow ? 'No usable RRset signature was within its validity window.' : 'The RRset signature did not validate.' };
  if (unsupported) return { state: 'unsupported', algorithm: null, keyTag: null, detail: 'The RRset used an unsupported DNSSEC algorithm or a wildcard-expanded signature that requires authenticated denial proof.' };
  return { state: 'indeterminate', algorithm: null, keyTag: null, detail: 'No authenticated key matched the supplied RRset signature.' };
}

function nsec3Hash(name: string, salt: Buffer, iterations: number): string {
  let value = crypto.createHash('sha1').update(encodeDnsName(name)).update(salt).digest();
  for (let index = 0; index < iterations; index += 1) value = crypto.createHash('sha1').update(value).update(salt).digest();
  return base32hex(value);
}

function circularHashCovers(ownerHash: string, nextHash: string, candidate: string): boolean {
  if (ownerHash < nextHash) return candidate > ownerHash && candidate < nextHash;
  if (ownerHash > nextHash) return candidate > ownerHash || candidate < nextHash;
  return false;
}

function validateNegativeProof(
  response: DnsWireResponse,
  name: string,
  missingType: number,
  keys: readonly DnsWireRecord[],
  zone: string,
  now: Date,
  requireDelegation: boolean,
): NegativeProof {
  const exactNsecs = response.records.filter((record): record is DnsWireRecord & { data: NsecData } => record.owner === name && record.data.kind === 'NSEC');
  if (exactNsecs.length > 1) return { state: 'bogus', detail: 'The denial response contained multiple NSEC records at one owner name.' };
  const exactNsec = exactNsecs[0];
  if (exactNsec) {
    const verification = verifyRrset(response, exactNsec.owner, DNS_TYPE_NSEC, keys, zone, now);
    if (verification.state !== 'valid') return verification;
    const delegation = exactNsec.data.types.has(DNS_TYPE_NS) && !exactNsec.data.types.has(DNS_TYPE_SOA);
    if (!exactNsec.data.types.has(missingType) && (!requireDelegation || delegation)) {
      return { state: 'valid', detail: 'A validated NSEC record proved the requested RRset absent.' };
    }
    return { state: 'bogus', detail: 'The validated NSEC bitmap did not prove the required absence and delegation state.' };
  }
  const nsec3Records = response.records.filter((record): record is DnsWireRecord & { data: Nsec3Data } => record.data.kind === 'NSEC3');
  if (nsec3Records.length > MAX_DNSSEC_DENIAL_RECORDS) return { state: 'unsupported', detail: 'The DNSSEC denial response exceeded the NSEC3 record bound.' };
  let sawUnsupported = false;
  let sawBogus = false;
  for (const record of nsec3Records) {
    const ownerParts = record.owner.split('.');
    const ownerHash = ownerParts.shift()?.toUpperCase() || '';
    if (record.data.hashAlgorithm !== 1 || record.data.iterations > MAX_DNSSEC_NSEC3_ITERATIONS || (record.data.flags & ~1) !== 0
      || ownerHash.length !== 32 || record.data.nextHash.length !== 32) {
      sawUnsupported = true;
      continue;
    }
    const ownerZone = ownerParts.length ? ownerParts.join('.') : '.';
    if (ownerZone !== zone || !/^[0-9A-V]+$/u.test(ownerHash)) continue;
    const candidate = nsec3Hash(name, record.data.salt, record.data.iterations);
    const exact = candidate === ownerHash;
    const optOutCover = missingType === DNS_TYPE_DS && (record.data.flags & 1) === 1
      && circularHashCovers(ownerHash, record.data.nextHash, candidate);
    if (!exact && !optOutCover) continue;
    if (recordsFor(response, record.owner, DNS_TYPE_NSEC3).length !== 1) {
      sawBogus = true;
      continue;
    }
    const verification = verifyRrset(response, record.owner, DNS_TYPE_NSEC3, keys, zone, now);
    if (verification.state !== 'valid') {
      if (verification.state === 'unsupported') sawUnsupported = true;
      else sawBogus = true;
      continue;
    }
    if (exact && record.data.types.has(missingType)) return { state: 'bogus', detail: 'The validated NSEC3 bitmap contains the RR type reported as absent.' };
    if (requireDelegation && exact && (!record.data.types.has(DNS_TYPE_NS) || record.data.types.has(DNS_TYPE_SOA))) return { state: 'bogus', detail: 'The validated NSEC3 record did not identify a parent-side delegation.' };
    if (optOutCover) return { state: 'unsupported', detail: 'NSEC3 opt-out span validation is outside this bounded validator.' };
    return { state: 'valid', detail: 'A validated exact NSEC3 record proved the requested RRset absent.' };
  }
  if (sawBogus) return { state: 'bogus', detail: 'The DNSSEC denial-of-existence signature did not validate.' };
  if (sawUnsupported) return { state: 'unsupported', detail: 'The DNSSEC denial of existence used unsupported NSEC3 parameters or algorithms.' };
  return { state: 'indeterminate', detail: 'The response did not contain a supported authenticated denial of existence.' };
}

function targetWithinAnchor(target: string, anchor: string): boolean {
  return anchor === '.' || target === anchor || target.endsWith(`.${anchor}`);
}

function zonesBelowAnchor(target: string, anchor: string): string[] {
  if (target === anchor) return [];
  const targetLabels = target.split('.');
  const anchorLabels = anchor === '.' ? [] : anchor.split('.');
  const count = targetLabels.length - anchorLabels.length;
  return Array.from({ length: count }, (_, index) => targetLabels.slice(targetLabels.length - anchorLabels.length - index - 1).join('.')).filter(Boolean);
}

function chainLimitations(): readonly string[] {
  return Object.freeze([
    'This isolated action validates retained DNSSEC wire evidence from one analyst-selected recursive resolver against one supplied trust anchor; another resolver or observation time may differ.',
    'Secure means that the supported chain and signatures validated at observation time. It is standards-posture evidence, not a complete security, ownership, availability, safety, or maliciousness guarantee.',
    'Insecure, bogus, indeterminate, timed-out, and unsupported are distinct states. Missing or incomplete evidence is never converted into an unsigned or secure conclusion.',
    'Wildcard-expanded positive RRsets remain unsupported unless authenticated denial evidence proves the wildcard expansion; this validator does not infer that proof from the signature alone.',
    'No raw DNS response, DNSKEY public key, signature, or resolver transaction identifier is retained in the report.',
  ]);
}

function transportSnapshot(session: DnssecQuerySession | null, state: DnssecChainReport['transport']['state']): DnssecChainReport['transport'] {
  return Object.freeze({
    state,
    queryCount: session?.queryCount ?? 0,
    responseBytes: session?.responseBytes ?? 0,
    queryLimit: session?.maximumQueries ?? MAX_DNSSEC_QUERIES,
    responseByteLimit: session?.maximumResponseBytes ?? MAX_DNSSEC_RESPONSE_BYTES,
    totalTimeoutMs: session?.totalTimeoutMs ?? DNSSEC_TOTAL_TIMEOUT_MS,
  });
}

function failureReport(options: Readonly<{
  state: DnssecValidationState;
  target: string | null;
  observedAt: string;
  resolver: ResolverEndpoint | null;
  anchor: DnssecTrustAnchor | null;
  session: DnssecQuerySession | null;
  delegations?: readonly DnssecDelegationResult[];
  validatedZone?: string | null;
  kind: DnssecFailureKind;
  stage: string;
  detail: string;
}>): DnssecChainReport {
  const transportState = options.state === 'timed_out' ? 'timed_out'
    : options.kind === 'transport' ? 'partial'
      : options.session ? 'complete' : 'unavailable';
  return Object.freeze({
    schema: DNSSEC_CHAIN_SCHEMA,
    version: DNSSEC_CHAIN_VERSION,
    state: options.state,
    target: options.target,
    observedAt: options.observedAt,
    resolver: Object.freeze({ address: options.resolver?.address ?? null, port: options.resolver?.port ?? 53 }),
    trustAnchor: Object.freeze({
      zone: options.anchor?.zone ?? null,
      source: options.anchor?.source ?? null,
      reviewedAt: options.anchor?.reviewedAt ?? null,
      dsRecordCount: options.anchor?.dsRecords.length ?? 0,
    }),
    validatedZone: options.validatedZone ?? null,
    delegations: Object.freeze([...(options.delegations ?? [])]),
    completeness: options.state === 'invalid' ? 'unavailable' : 'partial',
    transport: transportSnapshot(options.session, transportState),
    failure: Object.freeze({ kind: options.kind, stage: options.stage, detail: boundedError(options.detail) }),
    limitations: chainLimitations(),
  });
}

function stateFromVerification(state: RrsetVerification['state'] | NegativeProof['state']): DnssecValidationState {
  return state === 'bogus' ? 'bogus' : state === 'unsupported' ? 'unsupported' : 'indeterminate';
}

function kindFromVerification(state: RrsetVerification['state'] | NegativeProof['state']): DnssecFailureKind {
  return state === 'unsupported' ? 'unsupported' : 'validation';
}

async function validateDnssecChainWithContext(input: Readonly<{
  target: unknown;
  resolver: unknown;
  trustAnchor: unknown;
  observedAt?: string;
  ownedOrAuthorized: boolean;
  session?: DnssecQuerySession;
  sessionOptions?: Omit<DnssecQuerySessionOptions, 'resolver'>;
}>): Promise<DnssecValidatedContext> {
  const suppliedObservedAt = input.observedAt === undefined ? null : normalizedTimestamp(input.observedAt);
  const observedAt = suppliedObservedAt ?? new Date().toISOString();
  const now = new Date(observedAt);
  const target = normalizeDnsName(input.target);
  const resolver = normalizeResolverEndpoint(input.resolver);
  if (input.ownedOrAuthorized !== true) {
    return {
      report: failureReport({
        state: 'invalid', target, observedAt, resolver, anchor: null, session: null, kind: 'input', stage: 'authorization',
        detail: 'DNSSEC chain validation requires explicit owned-or-authorised scope for every run.',
      }),
      zone: null,
      keys: [],
    };
  }
  if (input.observedAt !== undefined && !suppliedObservedAt) {
    return {
      report: failureReport({
        state: 'invalid', target, observedAt, resolver, anchor: null, session: null, kind: 'input', stage: 'observed_at',
        detail: 'DNSSEC validation observation time is invalid.',
      }),
      zone: null,
      keys: [],
    };
  }
  let anchor: DnssecTrustAnchor | null = null;
  try { anchor = parseDnssecTrustAnchor(input.trustAnchor); } catch (error) {
    return { report: failureReport({ state: 'invalid', target, observedAt, resolver, anchor: null, session: null, kind: 'input', stage: 'trust_anchor', detail: boundedError(error) }), zone: null, keys: [] };
  }
  if (!target || !resolver || !targetWithinAnchor(target, anchor.zone)) {
    return {
      report: failureReport({
        state: 'invalid', target, observedAt, resolver, anchor, session: null, kind: 'input', stage: 'target',
        detail: !target ? 'DNSSEC validation target is invalid.' : !resolver ? 'DNSSEC resolver must be one public IP address.' : 'DNSSEC target is outside the supplied trust-anchor zone.',
      }),
      zone: null,
      keys: [],
    };
  }
  const zones = zonesBelowAnchor(target, anchor.zone);
  if (zones.length > MAX_DNSSEC_DELEGATIONS) {
    return { report: failureReport({ state: 'unsupported', target, observedAt, resolver, anchor, session: null, kind: 'unsupported', stage: 'delegation_bound', detail: `DNSSEC validation is limited to ${MAX_DNSSEC_DELEGATIONS} delegations below the trust anchor.` }), zone: null, keys: [] };
  }
  if (input.session && (input.session.resolver.address !== resolver.address || input.session.resolver.port !== resolver.port)) {
    return {
      report: failureReport({
        state: 'invalid', target, observedAt, resolver, anchor, session: null, kind: 'input', stage: 'resolver',
        detail: 'The supplied DNSSEC query session does not use the analyst-selected resolver.',
      }),
      zone: null,
      keys: [],
    };
  }
  const session = input.session ?? new DnssecQuerySession({ resolver, ...input.sessionOptions });
  const delegations: DnssecDelegationResult[] = [];
  let currentZone = anchor.zone;
  let currentKeys: DnsWireRecord[] = [];
  try {
    const rootKeysResponse = await session.query(anchor.zone, DNS_TYPE_DNSKEY);
    const rootKeys = recordsFor(rootKeysResponse, anchor.zone, DNS_TYPE_DNSKEY);
    const matchedRootKeys = rootKeys.filter((key) => anchor!.dsRecords.some((ds) => dsMatchesKey(anchor!.zone, ds, key)));
    const rootVerification = verifyRrset(rootKeysResponse, anchor.zone, DNS_TYPE_DNSKEY, matchedRootKeys, anchor.zone, now);
    if (!matchedRootKeys.length || rootVerification.state !== 'valid') {
      const verification = matchedRootKeys.length ? rootVerification : { state: 'bogus' as const, detail: 'No supplied trust-anchor DS record matched the anchor-zone DNSKEY RRset.' };
      return {
        report: failureReport({ state: stateFromVerification(verification.state), target, observedAt, resolver, anchor, session, delegations, validatedZone: null, kind: kindFromVerification(verification.state), stage: 'trust_anchor', detail: verification.detail }),
        zone: null,
        keys: [],
      };
    }
    currentKeys = rootKeys;
    delegations.push(Object.freeze({
      zone: anchor.zone,
      parentZone: null,
      state: 'secure',
      dsRecordCount: anchor.dsRecords.length,
      dnskeyRecordCount: rootKeys.length,
      matchedDsCount: matchedRootKeys.length,
      signatureAlgorithm: rootVerification.algorithm,
      detail: 'The supplied trust anchor matched and authenticated the anchor-zone DNSKEY RRset.',
    }));

    for (const zone of zones) {
      const dsResponse = await session.query(zone, DNS_TYPE_DS);
      const dsRecords = recordsFor(dsResponse, zone, DNS_TYPE_DS).filter((record): record is DnsWireRecord & { data: DsData } => record.data.kind === 'DS');
      if (!dsRecords.length) {
        const delegationProof = validateNegativeProof(dsResponse, zone, DNS_TYPE_DS, currentKeys, currentZone, now, true);
        if (delegationProof.state === 'valid') {
          delegations.push(Object.freeze({ zone, parentZone: currentZone, state: 'insecure', dsRecordCount: 0, dnskeyRecordCount: 0, matchedDsCount: 0, signatureAlgorithm: null, detail: delegationProof.detail }));
          const report: DnssecChainReport = Object.freeze({
            schema: DNSSEC_CHAIN_SCHEMA,
            version: DNSSEC_CHAIN_VERSION,
            state: 'insecure',
            target,
            observedAt,
            resolver: Object.freeze({ address: resolver.address, port: resolver.port }),
            trustAnchor: Object.freeze({ zone: anchor.zone, source: anchor.source, reviewedAt: anchor.reviewedAt, dsRecordCount: anchor.dsRecords.length }),
            validatedZone: currentZone,
            delegations: Object.freeze(delegations),
            completeness: 'complete',
            transport: transportSnapshot(session, 'complete'),
            failure: null,
            limitations: chainLimitations(),
          });
          return { report, zone: currentZone, keys: currentKeys };
        }
        const absenceProof = validateNegativeProof(dsResponse, zone, DNS_TYPE_DS, currentKeys, currentZone, now, false);
        if (absenceProof.state === 'valid') continue;
        const proof = [delegationProof, absenceProof].find((candidate) => candidate.state === 'unsupported')
          ?? [delegationProof, absenceProof].find((candidate) => candidate.state === 'bogus')
          ?? absenceProof;
        if (proof.state === 'valid') continue;
        delegations.push(Object.freeze({ zone, parentZone: currentZone, state: proof.state, dsRecordCount: 0, dnskeyRecordCount: 0, matchedDsCount: 0, signatureAlgorithm: null, detail: proof.detail }));
        return { report: failureReport({ state: stateFromVerification(proof.state), target, observedAt, resolver, anchor, session, delegations, validatedZone: currentZone, kind: kindFromVerification(proof.state), stage: `delegation:${zone}`, detail: proof.detail }), zone: currentZone, keys: currentKeys };
      }

      const dsVerification = verifyRrset(dsResponse, zone, DNS_TYPE_DS, currentKeys, currentZone, now);
      if (dsVerification.state !== 'valid') {
        delegations.push(Object.freeze({ zone, parentZone: currentZone, state: dsVerification.state, dsRecordCount: dsRecords.length, dnskeyRecordCount: 0, matchedDsCount: 0, signatureAlgorithm: dsVerification.algorithm, detail: dsVerification.detail }));
        return { report: failureReport({ state: stateFromVerification(dsVerification.state), target, observedAt, resolver, anchor, session, delegations, validatedZone: currentZone, kind: kindFromVerification(dsVerification.state), stage: `ds:${zone}`, detail: dsVerification.detail }), zone: currentZone, keys: currentKeys };
      }

      const keyResponse = await session.query(zone, DNS_TYPE_DNSKEY);
      const zoneKeys = recordsFor(keyResponse, zone, DNS_TYPE_DNSKEY);
      const supportedDs = dsRecords.filter((record) => [1, 2, 4].includes(record.data.digestType));
      const matchedKeys = zoneKeys.filter((key) => supportedDs.some((ds) => dsMatchesKey(zone, ds.data, key)));
      if (!supportedDs.length) {
        const detail = 'The authenticated DS RRset used only digest algorithms unsupported by this validator.';
        delegations.push(Object.freeze({ zone, parentZone: currentZone, state: 'unsupported', dsRecordCount: dsRecords.length, dnskeyRecordCount: zoneKeys.length, matchedDsCount: 0, signatureAlgorithm: dsVerification.algorithm, detail }));
        return { report: failureReport({ state: 'unsupported', target, observedAt, resolver, anchor, session, delegations, validatedZone: currentZone, kind: 'unsupported', stage: `dnskey:${zone}`, detail }), zone: currentZone, keys: currentKeys };
      }
      if (!matchedKeys.length) {
        const detail = 'No authenticated child DNSKEY matched the parent DS RRset.';
        delegations.push(Object.freeze({ zone, parentZone: currentZone, state: 'bogus', dsRecordCount: dsRecords.length, dnskeyRecordCount: zoneKeys.length, matchedDsCount: 0, signatureAlgorithm: dsVerification.algorithm, detail }));
        return { report: failureReport({ state: 'bogus', target, observedAt, resolver, anchor, session, delegations, validatedZone: currentZone, kind: 'validation', stage: `dnskey:${zone}`, detail }), zone: currentZone, keys: currentKeys };
      }
      const keyVerification = verifyRrset(keyResponse, zone, DNS_TYPE_DNSKEY, matchedKeys, zone, now);
      if (keyVerification.state !== 'valid') {
        delegations.push(Object.freeze({ zone, parentZone: currentZone, state: keyVerification.state, dsRecordCount: dsRecords.length, dnskeyRecordCount: zoneKeys.length, matchedDsCount: matchedKeys.length, signatureAlgorithm: keyVerification.algorithm, detail: keyVerification.detail }));
        return { report: failureReport({ state: stateFromVerification(keyVerification.state), target, observedAt, resolver, anchor, session, delegations, validatedZone: currentZone, kind: kindFromVerification(keyVerification.state), stage: `dnskey:${zone}`, detail: keyVerification.detail }), zone: currentZone, keys: currentKeys };
      }
      delegations.push(Object.freeze({ zone, parentZone: currentZone, state: 'secure', dsRecordCount: dsRecords.length, dnskeyRecordCount: zoneKeys.length, matchedDsCount: matchedKeys.length, signatureAlgorithm: keyVerification.algorithm, detail: 'The parent-signed DS RRset matched and authenticated the child DNSKEY RRset.' }));
      currentZone = zone;
      currentKeys = zoneKeys;
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
    const timedOut = code === 'ETIMEOUT';
    return {
      report: failureReport({ state: timedOut ? 'timed_out' : 'indeterminate', target, observedAt, resolver, anchor, session, delegations, validatedZone: currentZone, kind: 'transport', stage: 'dns_query', detail: boundedError(error) }),
      zone: currentZone,
      keys: currentKeys,
    };
  }

  const report: DnssecChainReport = Object.freeze({
    schema: DNSSEC_CHAIN_SCHEMA,
    version: DNSSEC_CHAIN_VERSION,
    state: 'secure',
    target,
    observedAt,
    resolver: Object.freeze({ address: resolver.address, port: resolver.port }),
    trustAnchor: Object.freeze({ zone: anchor.zone, source: anchor.source, reviewedAt: anchor.reviewedAt, dsRecordCount: anchor.dsRecords.length }),
    validatedZone: currentZone,
    delegations: Object.freeze(delegations),
    completeness: 'complete',
    transport: transportSnapshot(session, 'complete'),
    failure: null,
    limitations: chainLimitations(),
  });
  return { report, zone: currentZone, keys: currentKeys };
}

async function validateDnssecChain(input: Parameters<typeof validateDnssecChainWithContext>[0]): Promise<DnssecChainReport> {
  return (await validateDnssecChainWithContext(input)).report;
}

function formatDnssecChainReport(report: DnssecChainReport): string {
  const lines = [
    'DNSSEC chain validation',
    `Target       ${report.target ?? 'invalid'}`,
    `State        ${report.state.replaceAll('_', ' ')}`,
    `Completeness ${report.completeness}`,
    `Resolver     ${report.resolver.address ?? 'unavailable'}:${report.resolver.port}`,
    `Trust anchor ${report.trustAnchor.zone ?? 'unavailable'} (${report.trustAnchor.source ?? 'source unavailable'})`,
    `Validated    ${report.validatedZone ?? 'none'}`,
    `Queries      ${report.transport.queryCount}/${report.transport.queryLimit}`,
    `DNS bytes    ${report.transport.responseBytes}/${report.transport.responseByteLimit}`,
  ];
  if (report.delegations.length) {
    lines.push('', 'Delegations:');
    for (const delegation of report.delegations) {
      lines.push(`  - ${delegation.zone}: ${delegation.state} (${delegation.matchedDsCount} matched DS)`);
    }
  }
  if (report.failure) lines.push('', `Failure ${report.failure.kind}/${report.failure.stage}: ${report.failure.detail}`);
  lines.push('', 'Limitations:');
  for (const limitation of report.limitations) lines.push(`  - ${limitation}`);
  return `${lines.join('\n')}\n`;
}

async function collectValidatedRrset(
  session: DnssecQuerySession,
  context: DnssecValidatedContext,
  ownerValue: unknown,
  type: number,
  observedAt?: string,
): Promise<SignedRrsetResult> {
  const owner = normalizeDnsName(ownerValue, { allowServiceLabels: true });
  if (!owner || context.report.state !== 'secure' || !context.zone || !context.keys.length) {
    throw new DnssecWireError('A secure DNSSEC context and valid RRset owner are required.', 'EINVAL');
  }
  const response = await session.query(owner, type);
  const records = recordsFor(response, owner, type);
  const now = new Date(normalizedTimestamp(observedAt) ?? context.report.observedAt);
  const verification = records.length
    ? verifyRrset(response, owner, type, context.keys, context.zone, now)
    : validateNegativeProof(response, owner, type, context.keys, context.zone, now, false);
  return Object.freeze({ response, records: Object.freeze(records), verification });
}

export {
  DNSSEC_CHAIN_SCHEMA,
  DNSSEC_CHAIN_VERSION,
  DNSSEC_QUERY_TIMEOUT_MS,
  DNSSEC_TOTAL_TIMEOUT_MS,
  DNSSEC_TRUST_ANCHOR_SCHEMA,
  DNSSEC_TRUST_ANCHOR_VERSION,
  MAX_DNSSEC_TRUST_ANCHOR_BYTES,
  DNS_TYPE_A,
  DNS_TYPE_AAAA,
  DNS_TYPE_CNAME,
  DNS_TYPE_DNSKEY,
  DNS_TYPE_DS,
  DNS_TYPE_NS,
  DNS_TYPE_NSEC,
  DNS_TYPE_NSEC3,
  DNS_TYPE_RRSIG,
  DNS_TYPE_TLSA,
  MAX_DNSSEC_DELEGATIONS,
  MAX_DNSSEC_QUERIES,
  MAX_DNSSEC_RESPONSE_BYTES,
  DnssecQuerySession,
  DnssecWireError,
  buildDnssecQuery,
  collectValidatedRrset,
  dnskeyTag,
  formatDnssecChainReport,
  normalizeDnsName,
  normalizeResolverEndpoint,
  parseDnssecResponse,
  parseDnssecTrustAnchor,
  signedRrsetData,
  validateDnssecChain,
  validateDnssecChainWithContext,
  verifyRrset,
};

export type {
  AddressData,
  DnsRecordData,
  DnsWireRecord,
  DnsWireResponse,
  DnskeyData,
  DnssecChainReport,
  DnssecDelegationResult,
  DnssecQuerySessionOptions,
  DnssecTrustAnchor,
  DnssecTrustAnchorDs,
  DnssecValidatedContext,
  DnssecValidationState,
  DsData,
  NameData,
  NegativeProof,
  Nsec3Data,
  NsecData,
  RrsigData,
  SignedRrsetResult,
  TlsaData,
};

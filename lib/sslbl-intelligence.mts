// Exact local matching against the generated SSLBL certificate snapshot.
// Lookup never contacts SSLBL. A stale snapshot can preserve a historical
// positive match, but a stale miss remains inconclusive.

import { SSLBL_CERTIFICATE_SNAPSHOT } from './sslbl-certificates.generated.mts';
import { createHash } from 'node:crypto';

export const SSLBL_INTELLIGENCE_VERSION = 1;
export const SSLBL_SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const SSLBL_SNAPSHOT_EXPIRED_AGE_MS = 45 * 24 * 60 * 60 * 1000;
export const MAX_SSLBL_SNAPSHOT_ENTRIES = 50_000;
export const MAX_SSLBL_FINGERPRINT_CHUNKS = 1_000;
export const SSLBL_SOURCE_PAGE = 'https://sslbl.abuse.ch/blacklist/';

type UnknownRecord = Record<string, unknown>;
type SslblSnapshot = Readonly<{
  schema: string;
  version: number;
  source: string;
  sourceUpdatedAt: string;
  generatedAt: string;
  sourceDigestSha256: string;
  entriesDigestSha256: string;
  entryCount: number;
  fingerprintChunks: readonly string[];
}>;
type SslblIntelligenceStatus = 'success' | 'stale' | 'unavailable';
type SslblIntelligenceVerdict = 'listed' | 'not_listed' | 'inconclusive';
type ValidatedSslblSnapshot = Readonly<{
  snapshot: SslblSnapshot;
  fingerprints: Set<string>;
}>;
export type SslblSnapshotHealth = Readonly<{
  state: 'current' | 'stale' | 'expired' | 'invalid';
  sourceUpdatedAt: string | null;
  generatedAt: string | null;
  ageSeconds: number | null;
  entryCount: number | null;
  digestSha256: string | null;
  detail: string;
}>;
export type SslblCertificateIntelligence = Readonly<{
  sslblVersion: typeof SSLBL_INTELLIGENCE_VERSION;
  source: 'sslbl';
  status: SslblIntelligenceStatus;
  verdict: SslblIntelligenceVerdict;
  complete: boolean;
  observedAt: string;
  fingerprintSha1: string | null;
  referenceUrl: string | null;
  snapshot: Readonly<{
    sourceUpdatedAt: string | null;
    generatedAt: string | null;
    ageSeconds: number | null;
    entryCount: number | null;
    digestSha256: string | null;
  }>;
  detail: string;
  limitations: readonly string[];
}>;

const SHA1_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const SNAPSHOT_SCHEMA = 'whoisleuth.sslbl-certificate-snapshot';
const SNAPSHOT_SOURCE = 'https://sslbl.abuse.ch/blacklist/sslblacklist.csv';

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizedFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replaceAll(':', '').trim().toLowerCase();
  return SHA1_RE.test(normalized) ? normalized : null;
}

function fingerprintDigest(fingerprints: Set<string>): string {
  return createHash('sha256')
    .update([...fingerprints].sort().join('\n'), 'utf8')
    .digest('hex');
}

function validateSnapshot(value: unknown): ValidatedSslblSnapshot | null {
  const candidate = record(value);
  const sourceUpdatedAt = timestamp(candidate.sourceUpdatedAt);
  const generatedAt = timestamp(candidate.generatedAt);
  if (candidate.schema !== SNAPSHOT_SCHEMA
    || candidate.version !== 1
    || candidate.source !== SNAPSHOT_SOURCE
    || !sourceUpdatedAt
    || !generatedAt
    || Date.parse(sourceUpdatedAt) > Date.parse(generatedAt)
    || typeof candidate.sourceDigestSha256 !== 'string'
    || !SHA256_RE.test(candidate.sourceDigestSha256)
    || typeof candidate.entriesDigestSha256 !== 'string'
    || !SHA256_RE.test(candidate.entriesDigestSha256)
    || !Number.isSafeInteger(candidate.entryCount)
    || Number(candidate.entryCount) < 1
    || Number(candidate.entryCount) > MAX_SSLBL_SNAPSHOT_ENTRIES
    || !Array.isArray(candidate.fingerprintChunks)
    || candidate.fingerprintChunks.length < 1
    || candidate.fingerprintChunks.length > MAX_SSLBL_FINGERPRINT_CHUNKS) {
    return null;
  }
  const fingerprints = new Set<string>();
  for (const chunk of candidate.fingerprintChunks) {
    if (typeof chunk !== 'string' || chunk.length > 4_000 || !chunk.endsWith('\n')) return null;
    for (const line of chunk.split('\n')) {
      if (!line) continue;
      if (!SHA1_RE.test(line) || fingerprints.has(line)) return null;
      fingerprints.add(line);
      if (fingerprints.size > MAX_SSLBL_SNAPSHOT_ENTRIES) return null;
    }
  }
  if (fingerprints.size !== candidate.entryCount
    || fingerprintDigest(fingerprints) !== candidate.entriesDigestSha256) {
    return null;
  }
  return {
    snapshot: candidate as unknown as SslblSnapshot,
    fingerprints,
  };
}

let builtInSnapshotValidation: ValidatedSslblSnapshot | null | undefined;

function validatedSnapshot(value: unknown | undefined): ValidatedSslblSnapshot | null {
  if (value !== undefined) return validateSnapshot(value);
  if (builtInSnapshotValidation === undefined) {
    builtInSnapshotValidation = validateSnapshot(SSLBL_CERTIFICATE_SNAPSHOT);
  }
  return builtInSnapshotValidation;
}

function effectiveNow(value: string | number | Date | undefined): number {
  const candidate = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Date.parse(value)
        : Date.now();
  return Number.isFinite(candidate) ? candidate : Date.now();
}

export function sslblSnapshotHealth(
  options: Readonly<{
    snapshot?: unknown;
    now?: string | number | Date;
  }> = {},
): SslblSnapshotHealth {
  const validated = validatedSnapshot(options.snapshot);
  if (!validated) {
    return Object.freeze({
      state: 'invalid',
      sourceUpdatedAt: null,
      generatedAt: null,
      ageSeconds: null,
      entryCount: null,
      digestSha256: null,
      detail: 'The local SSLBL certificate snapshot is missing or failed validation.',
    });
  }
  const now = effectiveNow(options.now);
  const sourceUpdatedAt = timestamp(validated.snapshot.sourceUpdatedAt);
  const generatedAt = timestamp(validated.snapshot.generatedAt);
  if (!sourceUpdatedAt || !generatedAt || Date.parse(sourceUpdatedAt) > now) {
    return Object.freeze({
      state: 'invalid',
      sourceUpdatedAt,
      generatedAt,
      ageSeconds: null,
      entryCount: validated.snapshot.entryCount,
      digestSha256: validated.snapshot.entriesDigestSha256,
      detail: 'The local SSLBL certificate snapshot has invalid or future-dated timestamps.',
    });
  }
  const ageMs = now - Date.parse(sourceUpdatedAt);
  const state = ageMs > SSLBL_SNAPSHOT_EXPIRED_AGE_MS
    ? 'expired'
    : ageMs > SSLBL_SNAPSHOT_MAX_AGE_MS
      ? 'stale'
      : 'current';
  return Object.freeze({
    state,
    sourceUpdatedAt,
    generatedAt,
    ageSeconds: Math.floor(ageMs / 1000),
    entryCount: validated.snapshot.entryCount,
    digestSha256: validated.snapshot.entriesDigestSha256,
    detail: state === 'current'
      ? 'The local SSLBL certificate snapshot is current.'
      : state === 'stale'
        ? 'The local SSLBL certificate snapshot is stale; positive matches remain review leads and misses are inconclusive.'
        : 'The local SSLBL certificate snapshot is too old to support a current comparison.',
  });
}

function tlsFingerprint(value: unknown): string | null {
  const tls = record(value);
  const certificate = record(tls.certificate);
  return normalizedFingerprint(certificate.fingerprintSha1);
}

function unavailable(
  observedAt: string,
  fingerprintSha1: string | null,
  detail: string,
): SslblCertificateIntelligence {
  return Object.freeze({
    sslblVersion: SSLBL_INTELLIGENCE_VERSION,
    source: 'sslbl',
    status: 'unavailable',
    verdict: 'inconclusive',
    complete: false,
    observedAt,
    fingerprintSha1,
    referenceUrl: null,
    snapshot: Object.freeze({
      sourceUpdatedAt: null,
      generatedAt: null,
      ageSeconds: null,
      entryCount: null,
      digestSha256: null,
    }),
    detail,
    limitations: Object.freeze([
      'Unavailable certificate warning data is not evidence that the observed certificate is absent from SSLBL or safe.',
      'SSLBL associates listed certificate fingerprints with observed botnet command-and-control activity; a match does not establish current domain ownership, intent, or activity.',
    ]),
  });
}

export function inspectSslblCertificate(
  tls: unknown,
  options: Readonly<{
    snapshot?: unknown;
    now?: string | number | Date;
  }> = {},
): SslblCertificateIntelligence {
  const nowValue = effectiveNow(options.now);
  const observedAt = new Date(nowValue).toISOString();
  const fingerprintSha1 = tlsFingerprint(tls);
  if (!fingerprintSha1) {
    return unavailable(observedAt, null, 'The deep TLS observation did not retain a usable leaf-certificate SHA-1 fingerprint.');
  }
  const validated = validatedSnapshot(options.snapshot);
  if (!validated) {
    return unavailable(observedAt, fingerprintSha1, 'The local SSLBL certificate snapshot is missing or failed validation.');
  }
  const sourceUpdatedAt = timestamp(validated.snapshot.sourceUpdatedAt);
  const generatedAt = timestamp(validated.snapshot.generatedAt);
  if (!sourceUpdatedAt || !generatedAt) {
    return unavailable(observedAt, fingerprintSha1, 'The local SSLBL certificate snapshot has invalid timestamps.');
  }
  if (Date.parse(sourceUpdatedAt) > nowValue) {
    return unavailable(observedAt, fingerprintSha1, 'The local SSLBL certificate snapshot is future-dated and cannot support a current comparison.');
  }
  const ageMs = nowValue - Date.parse(sourceUpdatedAt);
  if (ageMs > SSLBL_SNAPSHOT_EXPIRED_AGE_MS) {
    return unavailable(observedAt, fingerprintSha1, 'The local SSLBL certificate snapshot is too old to support a current comparison.');
  }
  const listed = validated.fingerprints.has(fingerprintSha1);
  const stale = ageMs > SSLBL_SNAPSHOT_MAX_AGE_MS;
  const verdict: SslblIntelligenceVerdict = listed
    ? 'listed'
    : stale
      ? 'inconclusive'
      : 'not_listed';
  const referenceUrl = listed
    ? `https://sslbl.abuse.ch/ssl-certificates/sha1/${fingerprintSha1}/`
    : null;
  return Object.freeze({
    sslblVersion: SSLBL_INTELLIGENCE_VERSION,
    source: 'sslbl',
    status: stale ? 'stale' : 'success',
    verdict,
    complete: !stale,
    observedAt,
    fingerprintSha1,
    referenceUrl,
    snapshot: Object.freeze({
      sourceUpdatedAt,
      generatedAt,
      ageSeconds: Math.floor(ageMs / 1000),
      entryCount: validated.snapshot.entryCount,
      digestSha256: validated.snapshot.entriesDigestSha256,
    }),
    detail: listed
      ? stale
        ? 'The observed leaf certificate appears in the stale local SSLBL snapshot. Verify the current provider record before acting.'
        : 'The observed leaf certificate appears in the local SSLBL certificate snapshot.'
      : stale
        ? 'The stale local snapshot contains no exact match, so the result is inconclusive.'
        : 'No exact fingerprint match was found in the current local SSLBL certificate snapshot.',
    limitations: Object.freeze([
      'SSLBL matching uses the exact observed leaf-certificate SHA-1 fingerprint and makes no network request.',
      'No match is not evidence that the domain, certificate, or service is safe.',
      'Certificates can be reused across unrelated domains or infrastructure; a match does not prove ownership, intent, or current activity.',
      ...(stale ? ['The snapshot is older than the current-evidence threshold and should be refreshed.'] : []),
    ]),
  });
}

export type { SslblSnapshot };

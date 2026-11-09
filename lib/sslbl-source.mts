// Shared bounded certificate-feed projection for maintenance and scheduled refreshes.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { SSLBL_CERTIFICATE_SNAPSHOT } from './sslbl-certificates.generated.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { SSLBL_SOURCE_URL, SSLBL_SNAPSHOT_SCHEMA, SSLBL_SNAPSHOT_VERSION, MAX_SSLBL_SNAPSHOT_ENTRIES, MAX_SSLBL_FINGERPRINT_CHUNKS } from '../packages/contracts/sslbl-snapshot.mts';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export { SSLBL_SOURCE_URL };
export const MAX_SSLBL_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_SSLBL_CERTIFICATES = MAX_SSLBL_SNAPSHOT_ENTRIES;
export const MAX_SSLBL_SNAPSHOT_SHRINK_RATIO = 0.25;

export type SslblSnapshotBuild = Readonly<{
  sourceUpdatedAt: string;
  sourceDigestSha256: string;
  entriesDigestSha256: string;
  fingerprints: readonly string[];
}>;
export type SslblSnapshotUpdateAssessment = Readonly<{
  currentEntries: number;
  nextEntries: number;
  added: number;
  removed: number;
  unchanged: number;
  sourceUpdatedAt: string;
  sourceDigestSha256: string;
  entriesDigestSha256: string;
  largeShrink: boolean;
}>;

const SHA1_RE = /^[a-f0-9]{40}$/u;
const SOURCE_UPDATED_RE = /^# Last updated:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC(?:\s*#)?\s*$/mu;
const CSV_ROW_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),([a-fA-F0-9]{40}),(.{1,300})$/u;

export function isoTimestamp(value: string, label: string): string {
  const normalized = normalizeExplicitIsoTimestamp(value);
  if (!normalized) throw new TypeError(`${label} must be a valid timestamp with an explicit timezone.`);
  return normalized;
}

export function parseSslblCertificateCsv(raw: string): SslblSnapshotBuild {
  if (typeof raw !== 'string') throw new TypeError('SSLBL source must be UTF-8 text.');
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes === 0 || bytes > MAX_SSLBL_SOURCE_BYTES) {
    throw new TypeError(`SSLBL source must be between 1 byte and ${MAX_SSLBL_SOURCE_BYTES} bytes.`);
  }
  const updatedMatch = raw.match(SOURCE_UPDATED_RE);
  if (!updatedMatch?.[1]) throw new TypeError('SSLBL source is missing its Last updated header.');
  const sourceUpdatedAt = isoTimestamp(`${updatedMatch[1].replace(' ', 'T')}Z`, 'SSLBL Last updated header');
  const fingerprints = new Set<string>();
  let dataRows = 0;
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    dataRows += 1;
    if (dataRows > MAX_SSLBL_CERTIFICATES) {
      throw new TypeError(`SSLBL source exceeds ${MAX_SSLBL_CERTIFICATES} certificate rows.`);
    }
    const match = trimmed.match(CSV_ROW_RE);
    if (!match?.[2]) throw new TypeError(`SSLBL source contains a malformed row at data row ${dataRows}.`);
    const fingerprint = match[2].toLowerCase();
    if (!SHA1_RE.test(fingerprint)) throw new TypeError(`SSLBL row ${dataRows} contains an invalid SHA-1 fingerprint.`);
    if (fingerprints.has(fingerprint)) throw new TypeError(`SSLBL source contains a duplicate fingerprint at data row ${dataRows}.`);
    fingerprints.add(fingerprint);
  }
  if (!fingerprints.size) throw new TypeError('SSLBL source contains no certificate fingerprints.');
  const sorted = Object.freeze([...fingerprints].sort());
  return Object.freeze({
    sourceUpdatedAt,
    sourceDigestSha256: sha256(raw),
    entriesDigestSha256: sha256(sorted.join('\n')),
    fingerprints: sorted,
  });
}

function snapshotFingerprints(value: unknown): readonly string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('The current SSLBL snapshot is unavailable.');
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.fingerprintChunks)
    || candidate.fingerprintChunks.length > MAX_SSLBL_FINGERPRINT_CHUNKS
    || !Number.isSafeInteger(candidate.entryCount)
    || typeof candidate.sourceUpdatedAt !== 'string'
    || typeof candidate.sourceDigestSha256 !== 'string'
    || typeof candidate.entriesDigestSha256 !== 'string') {
    throw new TypeError('The current SSLBL snapshot has an unsupported shape.');
  }
  const fingerprints: string[] = [];
  for (const chunk of candidate.fingerprintChunks) {
    if (typeof chunk !== 'string' || chunk.length > 4_000) throw new TypeError('The current SSLBL snapshot contains an invalid fingerprint chunk.');
    for (const fingerprint of chunk.split('\n')) {
      if (!fingerprint) continue;
      if (!SHA1_RE.test(fingerprint)) throw new TypeError('The current SSLBL snapshot contains an invalid fingerprint.');
      if (fingerprints.length >= MAX_SSLBL_SNAPSHOT_ENTRIES) throw new TypeError('The current SSLBL snapshot exceeds its entry bound.');
      fingerprints.push(fingerprint);
    }
  }
  if (fingerprints.length !== candidate.entryCount
    || new Set(fingerprints).size !== fingerprints.length
    || sha256([...fingerprints].sort().join('\n')) !== candidate.entriesDigestSha256) {
    throw new TypeError('The current SSLBL snapshot failed its entry-count or digest check.');
  }
  return Object.freeze(fingerprints);
}

export function assessSslblSnapshotUpdate(
  next: SslblSnapshotBuild,
  generatedAt: string,
  options: Readonly<{
    currentSnapshot?: unknown;
    allowLargeShrink?: boolean;
  }> = {},
): SslblSnapshotUpdateAssessment {
  const generated = isoTimestamp(generatedAt, 'Generated time');
  if (Date.parse(next.sourceUpdatedAt) > Date.parse(generated)) {
    throw new TypeError('SSLBL Last updated time must not be later than the generated snapshot time.');
  }
  const currentSnapshot = (options.currentSnapshot ?? SSLBL_CERTIFICATE_SNAPSHOT) as Record<string, unknown>;
  const currentFingerprints = snapshotFingerprints(currentSnapshot);
  const currentUpdatedAt = isoTimestamp(String(currentSnapshot.sourceUpdatedAt), 'Current SSLBL source update time');
  const currentSourceDigest = String(currentSnapshot.sourceDigestSha256);
  if (Date.parse(next.sourceUpdatedAt) < Date.parse(currentUpdatedAt)) {
    throw new TypeError('SSLBL source update time moved backwards relative to the checked-in snapshot.');
  }
  if (next.sourceUpdatedAt === currentUpdatedAt && next.sourceDigestSha256 !== currentSourceDigest) {
    throw new TypeError('SSLBL source content changed without a newer Last updated timestamp.');
  }
  const current = new Set(currentFingerprints);
  const incoming = new Set(next.fingerprints);
  let unchanged = 0;
  let added = 0;
  for (const fingerprint of incoming) {
    if (current.has(fingerprint)) unchanged += 1;
    else added += 1;
  }
  let removed = 0;
  for (const fingerprint of current) {
    if (!incoming.has(fingerprint)) removed += 1;
  }
  const largeShrink = next.fingerprints.length < currentFingerprints.length
    && removed / currentFingerprints.length > MAX_SSLBL_SNAPSHOT_SHRINK_RATIO;
  if (largeShrink && options.allowLargeShrink !== true) {
    throw new TypeError(
      `SSLBL snapshot would remove ${removed} of ${currentFingerprints.length} entries; review the feed and use --allow-large-shrink only after confirming the change.`,
    );
  }
  return Object.freeze({
    currentEntries: currentFingerprints.length,
    nextEntries: next.fingerprints.length,
    added,
    removed,
    unchanged,
    sourceUpdatedAt: next.sourceUpdatedAt,
    sourceDigestSha256: next.sourceDigestSha256,
    entriesDigestSha256: next.entriesDigestSha256,
    largeShrink,
  });
}

export function buildSslblSnapshotData(snapshot: SslblSnapshotBuild, generatedAt: string) {
  const generated = isoTimestamp(generatedAt, 'Generated time');
  const fingerprintChunks: string[] = [];
  for (let index = 0; index < snapshot.fingerprints.length; index += 80) {
    fingerprintChunks.push(snapshot.fingerprints.slice(index, index + 80).join('\n') + '\n');
  }
  return Object.freeze({
    schema: SSLBL_SNAPSHOT_SCHEMA,
    version: SSLBL_SNAPSHOT_VERSION,
    source: SSLBL_SOURCE_URL,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    generatedAt: generated,
    sourceDigestSha256: snapshot.sourceDigestSha256,
    entriesDigestSha256: snapshot.entriesDigestSha256,
    entryCount: snapshot.fingerprints.length,
    fingerprintChunks: Object.freeze(fingerprintChunks),
  });
}

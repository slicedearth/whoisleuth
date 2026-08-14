#!/usr/bin/env node

// Builds the bounded, checked-in SSLBL certificate-fingerprint snapshot used
// by deep Lookup. The generator reads one operator-downloaded CSV file and
// never performs a network request. Listing reasons are deliberately omitted
// from the runtime snapshot; a matched fingerprint links back to SSLBL for
// current provider context.

import { Buffer } from 'node:buffer';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SSLBL_CERTIFICATE_SNAPSHOT } from '../lib/sslbl-certificates.generated.mts';
import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { normalizeExplicitIsoTimestamp } from '../lib/observation.mts';
import { sha256Text as sha256 } from './maintainer-tool-helpers.mts';

export const SSLBL_SOURCE_URL = 'https://sslbl.abuse.ch/blacklist/sslblacklist.csv';
export const SSLBL_SNAPSHOT_SCHEMA = 'whoisleuth.sslbl-certificate-snapshot';
export const SSLBL_SNAPSHOT_VERSION = 1;
export const MAX_SSLBL_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_SSLBL_CERTIFICATES = 50_000;
export const MAX_SSLBL_SNAPSHOT_SHRINK_RATIO = 0.25;

type WritableLike = { write(value: string): unknown };
type SnapshotArguments = Readonly<{
  input: string;
  output: string;
  generatedAt: string;
  checkOnly: boolean;
  allowLargeShrink: boolean;
}>;
type SslblSnapshotBuild = Readonly<{
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

function isoTimestamp(value: string, label: string): string {
  const normalized = normalizeExplicitIsoTimestamp(value);
  if (!normalized) throw new TypeError(`${label} must be a valid timestamp with an explicit timezone.`);
  return normalized;
}

function option(args: readonly string[], name: string): string | null {
  const prefix = `${name}=`;
  const values = args.filter((argument) => argument.startsWith(prefix));
  if (values.length > 1) throw new TypeError(`${name} may be supplied only once.`);
  return values[0]?.slice(prefix.length) ?? null;
}

export function parseSslblSnapshotArguments(args: readonly string[]): SnapshotArguments {
  const exactOptions = new Set(['--check-only', '--allow-large-shrink']);
  const valueOptions = ['--input=', '--output=', '--generated-at='];
  const unknown = args.find((argument) => (
    !exactOptions.has(argument)
    && !valueOptions.some((prefix) => argument.startsWith(prefix))
  ));
  if (unknown) throw new TypeError(`Unknown option: ${unknown}`);
  if (args.filter((argument) => argument === '--check-only').length > 1
    || args.filter((argument) => argument === '--allow-large-shrink').length > 1) {
    throw new TypeError('Boolean options may be supplied only once.');
  }
  const input = option(args, '--input');
  const output = option(args, '--output') ?? 'lib/sslbl-certificates.generated.mts';
  const generatedAt = isoTimestamp(option(args, '--generated-at') ?? new Date().toISOString(), 'Generated time');
  if (!input || input.length > 1024 || input.includes('\0')) {
    throw new TypeError('--input=FILE is required.');
  }
  if (!output || output.length > 1024 || output.includes('\0')) {
    throw new TypeError('--output=FILE must be a valid path.');
  }
  return Object.freeze({
    input,
    output,
    generatedAt,
    checkOnly: args.includes('--check-only'),
    allowLargeShrink: args.includes('--allow-large-shrink'),
  });
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
    || !Number.isSafeInteger(candidate.entryCount)
    || typeof candidate.sourceUpdatedAt !== 'string'
    || typeof candidate.sourceDigestSha256 !== 'string'
    || typeof candidate.entriesDigestSha256 !== 'string') {
    throw new TypeError('The current SSLBL snapshot has an unsupported shape.');
  }
  const fingerprints: string[] = [];
  for (const chunk of candidate.fingerprintChunks) {
    if (typeof chunk !== 'string') throw new TypeError('The current SSLBL snapshot contains an invalid fingerprint chunk.');
    for (const fingerprint of chunk.split('\n')) {
      if (!fingerprint) continue;
      if (!SHA1_RE.test(fingerprint)) throw new TypeError('The current SSLBL snapshot contains an invalid fingerprint.');
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

function quotedChunks(fingerprints: readonly string[]): string {
  const lines: string[] = [];
  for (let index = 0; index < fingerprints.length; index += 80) {
    lines.push(`  ${JSON.stringify(fingerprints.slice(index, index + 80).join('\n') + '\n')},`);
  }
  return lines.join('\n');
}

export function buildSslblSnapshotModule(
  snapshot: SslblSnapshotBuild,
  generatedAt: string,
): string {
  const generated = isoTimestamp(generatedAt, 'Generated time');
  return `// Generated by tools/sslbl-snapshot.mts from the SSLBL CC0 certificate
// blacklist. Do not edit by hand. Runtime matching is exact and local.

export const SSLBL_CERTIFICATE_SNAPSHOT = Object.freeze({
  schema: '${SSLBL_SNAPSHOT_SCHEMA}',
  version: ${SSLBL_SNAPSHOT_VERSION},
  source: '${SSLBL_SOURCE_URL}',
  sourceUpdatedAt: '${snapshot.sourceUpdatedAt}',
  generatedAt: '${generated}',
  sourceDigestSha256: '${snapshot.sourceDigestSha256}',
  entriesDigestSha256: '${snapshot.entriesDigestSha256}',
  entryCount: ${snapshot.fingerprints.length},
  fingerprintChunks: Object.freeze([
${quotedChunks(snapshot.fingerprints)}
  ]),
});
`;
}

export async function main(
  args = process.argv.slice(2),
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
): Promise<number> {
  try {
    const options = parseSslblSnapshotArguments(args);
    const raw = await readBoundedRegularTextFile(options.input, {
      allowSymbolicLink: true,
      maximumBytes: MAX_SSLBL_SOURCE_BYTES,
      minimumBytes: 1,
      label: 'SSLBL source',
    });
    const snapshot = parseSslblCertificateCsv(raw);
    const assessment = assessSslblSnapshotUpdate(snapshot, options.generatedAt, {
      allowLargeShrink: options.allowLargeShrink,
    });
    const moduleText = buildSslblSnapshotModule(snapshot, options.generatedAt);
    if (!options.checkOnly) {
      await writeFile(options.output, moduleText, { encoding: 'utf8', mode: 0o644 });
    }
    output.write(
      `${options.checkOnly ? 'Validated' : 'Wrote'} ${snapshot.fingerprints.length} SSLBL certificate fingerprints`
      + `${options.checkOnly ? '' : ` to ${options.output}`}; added ${assessment.added}, removed ${assessment.removed}, unchanged ${assessment.unchanged}; source ${assessment.sourceUpdatedAt}; digest ${assessment.entriesDigestSha256}.\n`,
    );
    return 0;
  } catch (cause) {
    errors.write(`${cause instanceof Error ? cause.message : 'SSLBL snapshot generation failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

export type { SnapshotArguments, SslblSnapshotBuild };

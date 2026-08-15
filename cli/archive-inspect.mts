import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

import { scanBoundedJson } from '../lib/bounded-json.mts';

import {
  decryptWorkspaceArchive,
  isEncryptedWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import {
  WORKSPACE_ARCHIVE_SCHEMA,
  readWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import { canonicalArtifactJson } from '../packages/evidence/artifact-integrity.mts';
import {
  MAX_OFFLINE_ARTIFACT_BYTES,
  verifyOfflineArtifact,
} from './artifact-verify.mts';
import { safeTerminalValue } from './formatters/terminal.mts';

export const ARCHIVE_INSPECTION_SCHEMA = 'whoisleuth.workspace-archive-inspection';
export const ARCHIVE_INSPECTION_VERSION = 2;
export const MAX_ARCHIVE_SEARCH_LENGTH = 253;
export const MAX_ARCHIVE_SEARCH_MATCHES = 100;
export const MAX_ARCHIVE_SEARCH_NODES = 100_000;

type UnknownRecord = Record<string, unknown>;
type ArchiveSearchMatch = Readonly<{
  section: string;
  field: string;
  valueDigestSha256: string;
  value?: string;
}>;
export type ArchiveInspectionReport = Readonly<{
  schema: typeof ARCHIVE_INSPECTION_SCHEMA;
  version: typeof ARCHIVE_INSPECTION_VERSION;
  mode: 'offline_local';
  archive: Readonly<{
    encrypted: boolean;
    schema: typeof WORKSPACE_ARCHIVE_SCHEMA;
    version: number;
    readerVersion: number;
  }>;
  summary: Readonly<{
    inputBytes: number;
    sectionCount: number;
    recordCount: number;
    contentDigestSha256: string;
  }>;
  sections: readonly Readonly<{
    id: string;
    label: string;
    schema: string | null;
    version: number;
    status: string;
    recordCount: number;
    bytes: number;
    checksum: string;
  }>[];
  search: Readonly<{
    requested: boolean;
    revealValues: boolean;
    matchCount: number;
    truncated: boolean;
    results: readonly ArchiveSearchMatch[];
  }>;
  limitations: readonly string[];
}>;

const SEARCHABLE_FIELDS = new Set([
  'domain',
  'hostname',
  'inputHostname',
  'query',
  'registrableDomain',
  'seed',
  'target',
]);
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function parseJson(raw: string): UnknownRecord {
  if (typeof raw !== 'string') throw new TypeError('Archive input must be UTF-8 JSON text.');
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes === 0 || bytes > MAX_OFFLINE_ARTIFACT_BYTES) {
    throw new TypeError(`Archive input must be between 1 byte and ${MAX_OFFLINE_ARTIFACT_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    scanBoundedJson(raw);
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError('Archive input must be valid bounded JSON without duplicate keys.');
  }
  const value = record(parsed);
  if (!value) throw new TypeError('Archive input must contain one JSON object.');
  return value;
}

function normalizeSearch(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string'
    || value.length > MAX_ARCHIVE_SEARCH_LENGTH
    || CONTROL_RE.test(value)) {
    throw new TypeError(`Archive search must be at most ${MAX_ARCHIVE_SEARCH_LENGTH} control-free characters.`);
  }
  const normalized = canonicalSearchValue(value);
  if (!normalized) throw new TypeError('Archive search must not be empty.');
  return normalized;
}

function canonicalSearchValue(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.+$/u, '');
  if (!normalized) return '';
  const ascii = domainToASCII(normalized);
  return ascii || normalized;
}

function valueDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function archiveContentDigest(
  sections: Awaited<ReturnType<typeof readWorkspaceArchive>>['sections'],
): string {
  const identity = sections.map((section) => ({
    id: section.id,
    schema: section.schema,
    version: section.version,
    recordCount: section.recordCount,
    content: (() => {
      if (!section.data || typeof section.data !== 'object' || Array.isArray(section.data)) {
        return section.data;
      }
      const { exportedAt: _exportedAt, generatedAt: _generatedAt, ...content } = section.data as Record<string, unknown>;
      return content;
    })(),
  }));
  return `sha256:${createHash('sha256').update(canonicalArtifactJson(identity), 'utf8').digest('hex')}`;
}

function expectedContentDigest(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !SHA256_DIGEST_RE.test(value)) {
    throw new TypeError('Expected archive content digest must use the form sha256 followed by 64 lowercase hexadecimal characters.');
  }
  return value;
}

function searchSection(
  section: string,
  value: unknown,
  search: string,
  reveal: boolean,
  results: ArchiveSearchMatch[],
  state: { visited: number; truncated: boolean },
): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length && results.length < MAX_ARCHIVE_SEARCH_MATCHES) {
    const current = stack.pop();
    if (!current) continue;
    if (current.depth > 16) {
      state.truncated = true;
      continue;
    }
    if (state.visited >= MAX_ARCHIVE_SEARCH_NODES) {
      state.truncated = true;
      return;
    }
    state.visited += 1;
    const object = record(current.value);
    if (object) {
      const entries = Object.entries(object);
      if (entries.length > 300) state.truncated = true;
      for (const [field, child] of entries.slice(0, 300)) {
        if (SEARCHABLE_FIELDS.has(field) && typeof child === 'string') {
          const normalized = canonicalSearchValue(child);
          if (normalized === search) {
            results.push(Object.freeze({
              section,
              field,
              valueDigestSha256: valueDigest(normalized),
              ...(reveal ? { value: child.slice(0, MAX_ARCHIVE_SEARCH_LENGTH) } : {}),
            }));
            if (results.length >= MAX_ARCHIVE_SEARCH_MATCHES) {
              state.truncated = true;
              return;
            }
          }
        }
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    } else if (Array.isArray(current.value)) {
      if (current.value.length > 5_000) state.truncated = true;
      for (const child of current.value.slice(0, 5_000)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
}

export async function inspectWorkspaceArchive(
  raw: string,
  options: Readonly<{
    passphrase?: string | null;
    search?: string | null;
    reveal?: boolean;
    requireMatch?: boolean;
    expectedContentDigest?: string | null;
  }> = {},
): Promise<ArchiveInspectionReport> {
  const parsed = parseJson(raw);
  const encrypted = isEncryptedWorkspaceArchive(parsed);
  if (encrypted && !options.passphrase) {
    throw new TypeError('Encrypted archive inspection requires a separate passphrase file.');
  }
  await verifyOfflineArtifact(raw, options.passphrase === undefined
    ? {}
    : { passphrase: options.passphrase });
  const archiveValue = encrypted
    ? await decryptWorkspaceArchive(parsed, options.passphrase as string)
    : parsed;
  const archive = await readWorkspaceArchive(archiveValue);
  const contentDigestSha256 = archiveContentDigest(archive.sections);
  const expectedDigest = expectedContentDigest(options.expectedContentDigest);
  if (expectedDigest && expectedDigest !== contentDigestSha256) {
    throw new TypeError('Workspace archive content digest did not match the expected value.');
  }
  const search = normalizeSearch(options.search);
  const reveal = options.reveal === true;
  if (reveal && !search) throw new TypeError('--reveal requires --search.');
  const results: ArchiveSearchMatch[] = [];
  const searchState = { visited: 0, truncated: false };
  if (search) {
    for (const section of archive.sections) {
      searchSection(section.id, section.data, search, reveal, results, searchState);
      if (results.length >= MAX_ARCHIVE_SEARCH_MATCHES || searchState.truncated) break;
    }
  }
  if (options.requireMatch === true && search && results.length === 0) {
    if (searchState.truncated) {
      throw new TypeError('Archive search reached a configured bound before an exact canonical match could be established.');
    }
    throw new TypeError('Archive search found no exact canonical match.');
  }
  return Object.freeze({
    schema: ARCHIVE_INSPECTION_SCHEMA,
    version: ARCHIVE_INSPECTION_VERSION,
    mode: 'offline_local',
    archive: Object.freeze({
      encrypted,
      schema: WORKSPACE_ARCHIVE_SCHEMA,
      version: archive.sourceVersion,
      readerVersion: archive.version,
    }),
    summary: Object.freeze({
      inputBytes: Buffer.byteLength(raw, 'utf8'),
      sectionCount: archive.sections.length,
      recordCount: archive.sections.reduce((sum, section) => sum + section.recordCount, 0),
      contentDigestSha256,
    }),
    sections: Object.freeze(archive.sections.map((section) => Object.freeze({
      id: section.id,
      label: section.label,
      schema: section.schema,
      version: section.version,
      status: section.status,
      recordCount: section.recordCount,
      bytes: section.bytes,
      checksum: section.checksum,
    }))),
    search: Object.freeze({
      requested: search !== null,
      revealValues: reveal,
      matchCount: results.length,
      truncated: searchState.truncated || results.length >= MAX_ARCHIVE_SEARCH_MATCHES,
      results: Object.freeze(results),
    }),
    limitations: Object.freeze([
      'Inspection validates the archive and reports bounded section metadata without printing retained evidence by default.',
      'The content digest covers ordered section identities and normalised content after excluding each section export timestamp. Equality detects matching retained archive content but does not authenticate its source or accuracy.',
      'Search checks exact values in a small allowlist of target fields and never searches analyst notes, contacts, or raw evidence.',
      ...(reveal
        ? ['Search values were revealed only because the operator supplied --reveal; handle the output as sensitive evidence.']
        : ['Search results contain field names and digests only. A digest does not authenticate or establish the accuracy of a retained value.']),
      ...(searchState.truncated
        ? ['Archive search reached a configured traversal or result boundary; zero retained matches is inconclusive.']
        : []),
    ]),
  });
}

export function formatArchiveInspection(report: ArchiveInspectionReport): string {
  const lines = [
    'WHOISleuth workspace archive inspection',
    `Archive: ${report.archive.encrypted ? 'encrypted' : 'plain'} · v${report.archive.version}`,
    `Sections: ${report.summary.sectionCount}`,
    `Records: ${report.summary.recordCount}`,
    `Content digest: ${report.summary.contentDigestSha256}`,
  ];
  for (const section of report.sections) {
    lines.push(`${safeTerminalValue(section.label)}: ${section.recordCount} records · ${safeTerminalValue(section.status)} · ${section.bytes} bytes`);
  }
  if (report.search.requested) {
    lines.push(`Search matches: ${report.search.matchCount}${report.search.truncated ? ' (truncated)' : ''}`);
    for (const match of report.search.results) {
      lines.push(
        `${safeTerminalValue(match.section)}.${safeTerminalValue(match.field)}: ${safeTerminalValue(match.value ?? `sha256:${match.valueDigestSha256}`)}`,
      );
    }
  }
  for (const limitation of report.limitations) lines.push(`Limitation: ${safeTerminalValue(limitation)}`);
  return `${lines.join('\n')}\n`;
}

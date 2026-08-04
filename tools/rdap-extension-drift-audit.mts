#!/usr/bin/env node

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RDAP_EXTENSION_REGISTRY_FIXTURE } from '../fixtures/rdap-extension-registry.mts';
import {
  reviewedRdapExtensionCatalog,
  type ReviewedRdapExtensionCatalogEntry,
} from '../lib/rdap-capabilities.mts';
import { readTextCapped, safeFetchDetailed } from '../lib/safe-fetch.mts';

export const RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA = 'whoisleuth.rdap-extension-drift-audit';
export const RDAP_EXTENSION_DRIFT_AUDIT_VERSION = 1;
export const MAX_RDAP_EXTENSION_SOURCE_BYTES = 128 * 1024;
export const MAX_RDAP_EXTENSION_ROWS = 128;
export const RDAP_EXTENSION_SOURCE_URL = RDAP_EXTENSION_REGISTRY_FIXTURE.source;

type RegistryEntry = Readonly<{
  identifier: string;
  canonicalIdentifier: string;
  status: 'current' | 'obsolete';
}>;

type RdapExtensionDriftAudit = Readonly<{
  schema: typeof RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA;
  version: typeof RDAP_EXTENSION_DRIFT_AUDIT_VERSION;
  generatedAt: string;
  mode: 'fixture' | 'live';
  status: 'current' | 'drift';
  source: Readonly<{
    url: string;
    lastUpdatedAt: string;
    capturedAt: string;
    expectedDigestSha256: string;
    observedDigestSha256: string;
    digestMatchesFixture: boolean;
    entries: number;
  }>;
  changes: Readonly<{
    added: readonly string[];
    removed: readonly string[];
    renamed: readonly Readonly<{ from: string; to: string }>[];
    statusChanged: readonly Readonly<{ identifier: string; from: string; to: string }>[];
    unrecognized: readonly string[];
    localOnly: readonly string[];
  }>;
  limitations: readonly string[];
}>;

type AuditOptions = Readonly<{
  liveSourceText?: string;
  now?: () => Date;
  localCatalog?: readonly ReviewedRdapExtensionCatalogEntry[];
}>;

type WritableLike = { write(value: string): unknown };
type MainOptions = Readonly<{
  fetchSource?: () => Promise<string>;
  now?: () => Date;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const OBSOLETE_SUFFIX_RE = /\s+\(OBSOLETED\)$/iu;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 160 || CONTROL_RE.test(value)) return '';
  const normalized = value.replace(OBSOLETE_SUFFIX_RE, '').trim().toLowerCase();
  return /^[a-z0-9_]+$/u.test(normalized) ? normalized : '';
}

function parseCsv(value: string): string[][] {
  if (Buffer.byteLength(value, 'utf8') > MAX_RDAP_EXTENSION_SOURCE_BYTES) {
    throw new RangeError(`The RDAP extension registry exceeds ${MAX_RDAP_EXTENSION_SOURCE_BYTES} bytes.`);
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_RDAP_EXTENSION_ROWS + 1) {
        throw new RangeError(`The RDAP extension registry exceeds ${MAX_RDAP_EXTENSION_ROWS} rows.`);
      }
    } else {
      field += character;
    }
  }
  if (quoted) throw new TypeError('The RDAP extension registry contains an unterminated CSV field.');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseRdapExtensionRegistryCsv(value: string): RegistryEntry[] {
  const rows = parseCsv(value);
  const header = rows.shift();
  if (
    !header
    || header.length !== 5
    || header[0] !== 'Extension Identifier'
    || header[1] !== 'Registry Operator'
  ) {
    throw new TypeError('The RDAP extension registry header is not recognised.');
  }
  const output: RegistryEntry[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (row.length === 1 && !row[0]) continue;
    if (row.length !== 5) throw new TypeError(`RDAP extension row ${index + 2} is malformed.`);
    const identifier = row[0]?.trim() ?? '';
    const canonical = canonicalIdentifier(identifier);
    if (!canonical) throw new TypeError(`RDAP extension row ${index + 2} has an invalid identifier.`);
    if (seen.has(canonical)) throw new TypeError(`RDAP extension ${canonical} is duplicated.`);
    seen.add(canonical);
    output.push(Object.freeze({
      identifier: identifier.replace(OBSOLETE_SUFFIX_RE, '').trim(),
      canonicalIdentifier: canonical,
      status: OBSOLETE_SUFFIX_RE.test(identifier) ? 'obsolete' : 'current',
    }));
  }
  if (!output.length) throw new TypeError('The RDAP extension registry contains no entries.');
  return output.sort((left, right) => left.canonicalIdentifier.localeCompare(right.canonicalIdentifier));
}

function fixtureEntries(): RegistryEntry[] {
  return RDAP_EXTENSION_REGISTRY_FIXTURE.entries.map(([identifier, status]) => Object.freeze({
    identifier,
    canonicalIdentifier: identifier.toLowerCase(),
    status,
  }));
}

export function auditRdapExtensionRegistry(options: AuditOptions = {}): RdapExtensionDriftAudit {
  const baseline = fixtureEntries();
  const observed = options.liveSourceText === undefined
    ? baseline
    : parseRdapExtensionRegistryCsv(options.liveSourceText);
  const local = options.localCatalog ?? reviewedRdapExtensionCatalog();
  const baselineById = new Map(baseline.map((entry) => [entry.canonicalIdentifier, entry]));
  const observedById = new Map(observed.map((entry) => [entry.canonicalIdentifier, entry]));
  const localById = new Map(local.map((entry) => [entry.identifier.toLowerCase(), entry]));
  const added = observed.filter((entry) => !baselineById.has(entry.canonicalIdentifier))
    .map((entry) => entry.identifier);
  const removed = baseline.filter((entry) => !observedById.has(entry.canonicalIdentifier))
    .map((entry) => entry.identifier);
  const renamed = observed.flatMap((entry) => {
    const previous = baselineById.get(entry.canonicalIdentifier);
    return previous && previous.identifier !== entry.identifier
      ? [Object.freeze({ from: previous.identifier, to: entry.identifier })]
      : [];
  });
  const statusChanged = observed.flatMap((entry) => {
    const previous = baselineById.get(entry.canonicalIdentifier);
    return previous && previous.status !== entry.status
      ? [Object.freeze({ identifier: entry.identifier, from: previous.status, to: entry.status })]
      : [];
  });
  const unrecognized = observed.filter((entry) => !localById.has(entry.canonicalIdentifier))
    .map((entry) => entry.identifier);
  const localOnly = local.filter((entry) => !observedById.has(entry.identifier.toLowerCase()))
    .map((entry) => entry.identifier);
  const observedDigestSha256 = options.liveSourceText === undefined
    ? RDAP_EXTENSION_REGISTRY_FIXTURE.sourceDigestSha256
    : sha256(options.liveSourceText);
  const status = added.length || removed.length || renamed.length || statusChanged.length || unrecognized.length || localOnly.length
    ? 'drift'
    : 'current';
  return Object.freeze({
    schema: RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA,
    version: RDAP_EXTENSION_DRIFT_AUDIT_VERSION,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    mode: options.liveSourceText === undefined ? 'fixture' : 'live',
    status,
    source: Object.freeze({
      url: RDAP_EXTENSION_REGISTRY_FIXTURE.source,
      lastUpdatedAt: RDAP_EXTENSION_REGISTRY_FIXTURE.sourceLastUpdatedAt,
      capturedAt: RDAP_EXTENSION_REGISTRY_FIXTURE.capturedAt,
      expectedDigestSha256: RDAP_EXTENSION_REGISTRY_FIXTURE.sourceDigestSha256,
      observedDigestSha256,
      digestMatchesFixture: observedDigestSha256 === RDAP_EXTENSION_REGISTRY_FIXTURE.sourceDigestSha256,
      entries: observed.length,
    }),
    changes: Object.freeze({
      added: Object.freeze(added),
      removed: Object.freeze(removed),
      renamed: Object.freeze(renamed),
      statusChanged: Object.freeze(statusChanged),
      unrecognized: Object.freeze(unrecognized),
      localOnly: Object.freeze(localOnly),
    }),
    limitations: Object.freeze([
      'This audit compares a pinned official registry snapshot, an optional manually fetched copy, and the reviewed local interpretation catalogue.',
      'Drift requires manual specification and fixture review. It never enables an extension, changes lookup authority, starts reverse search, or changes Risk.',
      'Identifier spelling and obsolete status are compared exactly after conservative case-insensitive matching.',
    ]),
  });
}

function format(report: RdapExtensionDriftAudit): string {
  const lines = [
    'WHOISleuth RDAP extension drift audit',
    `Mode: ${report.mode}`,
    `Status: ${report.status}`,
    `Entries: ${report.source.entries}`,
    `Fixture digest match: ${report.source.digestMatchesFixture ? 'yes' : 'no'}`,
  ];
  for (const [label, values] of [
    ['Added', report.changes.added],
    ['Removed', report.changes.removed],
    ['Unrecognized', report.changes.unrecognized],
    ['Local only', report.changes.localOnly],
  ] as const) {
    lines.push(`${label}: ${values.length ? values.join(', ') : 'none'}`);
  }
  lines.push(`Renamed: ${report.changes.renamed.length ? report.changes.renamed.map((item) => `${item.from} -> ${item.to}`).join(', ') : 'none'}`);
  lines.push(`Status changed: ${report.changes.statusChanged.length ? report.changes.statusChanged.map((item) => `${item.identifier} ${item.from} -> ${item.to}`).join(', ') : 'none'}`);
  lines.push('No runtime extension behaviour was changed.');
  return `${lines.join('\n')}\n`;
}

async function defaultFetchSource(): Promise<string> {
  const result = await safeFetchDetailed(RDAP_EXTENSION_SOURCE_URL, {
    headers: { Accept: 'text/csv' },
    redirect: 'manual',
  }, { maxRedirects: 2 });
  if (!result.response.ok) {
    await result.response.body?.cancel().catch(() => {});
    throw new Error(`The official RDAP extension registry returned HTTP ${result.response.status}.`);
  }
  return (await readTextCapped(result.response, MAX_RDAP_EXTENSION_SOURCE_BYTES)).text;
}

function parseArgs(args: readonly string[]): { json: boolean; live: boolean } {
  let json = false;
  let live = false;
  for (const argument of args) {
    if (argument === '--json' && !json) json = true;
    else if (argument === '--live' && !live) live = true;
    else throw new TypeError(`Unknown or repeated option: ${argument}`);
  }
  return { json, live };
}

async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  try {
    const parsed = parseArgs(args);
    const liveSourceText = parsed.live ? await (options.fetchSource ?? defaultFetchSource)() : undefined;
    const report = auditRdapExtensionRegistry({
      ...(liveSourceText === undefined ? {} : { liveSourceText }),
      ...(options.now ? { now: options.now } : {}),
    });
    (options.stdout ?? process.stdout).write(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : format(report));
    return report.status === 'current' ? 0 : 1;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'RDAP extension audit failed.';
    (options.stderr ?? process.stderr).write(`${message.replace(/[\u0000-\u001f\u007f]+/gu, ' ').slice(0, 320)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; });
}

export { format, main };

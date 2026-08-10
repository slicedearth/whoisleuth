#!/usr/bin/env node

// Verifies locally rebuilt reference artefacts against the checked-in,
// target-free technology provenance catalogue. The report never includes
// artefact paths, page content, response values, or container output.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TECHNOLOGY_REVIEWED_SOURCES,
  type TechnologyReviewedSource,
} from '../fixtures/technology-reviewed-sources.mts';
import {
  MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES,
  technologyExampleArtifactDigest,
  technologyResponseMetadataDigest,
} from './technology-example-review.mts';
import { readBoundedRegularFile } from '../lib/bounded-file.mts';
import {
  boundedControlFreeText as boundedText,
  exactObjectKeys as exactKeys,
  optionalJsonRecord as record,
} from './maintainer-tool-helpers.mts';

export const TECHNOLOGY_SOURCE_VERIFICATION_SCHEMA = 'whoisleuth.technology-source-verification';
export const TECHNOLOGY_SOURCE_VERIFICATION_VERSION = 1;
export const TECHNOLOGY_SOURCE_MANIFEST_SCHEMA = 'whoisleuth.technology-source-verification-manifest';
export const TECHNOLOGY_SOURCE_MANIFEST_VERSION = 1;
export const MAX_TECHNOLOGY_SOURCE_MANIFEST_BYTES = 64 * 1024;
export const MAX_TECHNOLOGY_SOURCE_MANIFEST_ENTRIES = 64;

type UnknownRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type VerificationEntry = Readonly<{
  fixtureId: string;
  artifactPath: string;
  httpServer?: string | null;
  responseHeaders?: Readonly<Record<string, string>>;
}>;
type VerificationManifest = Readonly<{
  schema: typeof TECHNOLOGY_SOURCE_MANIFEST_SCHEMA;
  version: typeof TECHNOLOGY_SOURCE_MANIFEST_VERSION;
  entries: readonly VerificationEntry[];
}>;
type VerificationOptions = Readonly<{
  requireAll?: boolean;
  sources?: readonly TechnologyReviewedSource[];
  readArtifact?: (artifactPath: string) => Promise<string>;
}>;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MANIFEST_KEYS = new Set(['schema', 'version', 'entries']);
const ENTRY_KEYS = new Set(['fixtureId', 'artifactPath', 'httpServer', 'responseHeaders']);

function parseManifest(value: unknown): VerificationManifest {
  const input = record(value);
  if (!input || input.schema !== TECHNOLOGY_SOURCE_MANIFEST_SCHEMA
    || input.version !== TECHNOLOGY_SOURCE_MANIFEST_VERSION) {
    throw new TypeError('Technology source verification manifest uses an unsupported contract.');
  }
  exactKeys(input, MANIFEST_KEYS, 'Technology source verification manifest');
  if (!Array.isArray(input.entries) || input.entries.length === 0
    || input.entries.length > MAX_TECHNOLOGY_SOURCE_MANIFEST_ENTRIES) {
    throw new TypeError(`Technology source verification manifest must contain 1-${MAX_TECHNOLOGY_SOURCE_MANIFEST_ENTRIES} entries.`);
  }
  const seen = new Set<string>();
  const entries = input.entries.map((rawEntry, index) => {
    const entry = record(rawEntry);
    if (!entry) throw new TypeError(`Technology source verification entry ${index + 1} must be an object.`);
    exactKeys(entry, ENTRY_KEYS, `Technology source verification entry ${index + 1}`);
    const fixtureId = boundedText(entry.fixtureId, 'Fixture id', 80).toLowerCase();
    if (!ID_RE.test(fixtureId) || seen.has(fixtureId)) {
      throw new TypeError('Technology source verification fixture ids must be unique lowercase identifiers.');
    }
    seen.add(fixtureId);
    const artifactPath = boundedText(entry.artifactPath, 'Artefact path', 4_096);
    const responseHeaders = record(entry.responseHeaders);
    if (entry.responseHeaders !== undefined && !responseHeaders) {
      throw new TypeError('Response headers must be an object.');
    }
    return Object.freeze({
      fixtureId,
      artifactPath,
      ...(entry.httpServer !== undefined ? { httpServer: entry.httpServer as string | null } : {}),
      ...(responseHeaders ? { responseHeaders: Object.freeze({ ...responseHeaders }) as Readonly<Record<string, string>> } : {}),
    });
  });
  return Object.freeze({
    schema: TECHNOLOGY_SOURCE_MANIFEST_SCHEMA,
    version: TECHNOLOGY_SOURCE_MANIFEST_VERSION,
    entries: Object.freeze(entries),
  });
}

async function readBoundedArtifact(artifactPath: string): Promise<string> {
  try {
    const buffer = await readBoundedRegularFile(artifactPath, {
      minimumBytes: 1,
      maximumBytes: MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES,
      label: 'Reference HTML',
      allowSymbolicLink: true,
    });
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new TypeError('Reference HTML must use valid UTF-8 encoding.');
    }
  } catch (error) {
    if (error instanceof TypeError && /smaller than|exceeds/iu.test(error.message)) {
      throw new TypeError(`Reference HTML must be between 1 byte and ${MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES} bytes.`);
    }
    throw error;
  }
}

async function readBoundedManifest(manifestPath: string): Promise<unknown> {
  try {
    const buffer = await readBoundedRegularFile(manifestPath, {
      minimumBytes: 1,
      maximumBytes: MAX_TECHNOLOGY_SOURCE_MANIFEST_BYTES,
      label: 'Verification manifest',
      allowSymbolicLink: true,
    });
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError) throw new TypeError('Verification manifest must contain valid JSON.');
      throw new TypeError('Verification manifest must use valid UTF-8 encoding.');
    }
  } catch (error) {
    if (error instanceof TypeError && /smaller than|exceeds/iu.test(error.message)) {
      throw new TypeError(`Verification manifest must be between 1 byte and ${MAX_TECHNOLOGY_SOURCE_MANIFEST_BYTES} bytes.`);
    }
    throw error;
  }
}

export async function verifyTechnologySources(
  rawManifest: unknown,
  options: VerificationOptions = {},
) {
  const manifest = parseManifest(rawManifest);
  const sources = options.sources ?? TECHNOLOGY_REVIEWED_SOURCES;
  const sourceById = new Map(sources.map((source) => [source.fixtureId, source]));
  const suppliedIds = new Set(manifest.entries.map((entry) => entry.fixtureId));
  const unknownIds = [...suppliedIds].filter((id) => !sourceById.has(id)).sort();
  if (unknownIds.length) throw new TypeError(`Verification manifest references unknown fixtures: ${unknownIds.join(', ')}.`);
  const missingIds = options.requireAll
    ? [...sourceById.keys()].filter((id) => !suppliedIds.has(id)).sort()
    : [];
  if (missingIds.length) throw new TypeError(`Verification manifest omits fixtures: ${missingIds.join(', ')}.`);

  const readArtifact = options.readArtifact ?? readBoundedArtifact;
  const results = [];
  for (const entry of manifest.entries) {
    const source = sourceById.get(entry.fixtureId);
    if (!source) continue;
    const html = await readArtifact(entry.artifactPath);
    const artifactMatch = technologyExampleArtifactDigest(html) === source.artifactSha256;
    const responseMetadataMatch = technologyResponseMetadataDigest({
      ...(entry.httpServer !== undefined ? { httpServer: entry.httpServer } : {}),
      ...(entry.responseHeaders !== undefined ? { responseHeaders: entry.responseHeaders } : {}),
    }) === source.responseMetadataSha256;
    results.push(Object.freeze({
      fixtureId: entry.fixtureId,
      status: artifactMatch && responseMetadataMatch ? 'match' : 'mismatch',
      artifactMatch,
      responseMetadataMatch,
    }));
  }
  const mismatches = results.filter((result) => result.status === 'mismatch').length;
  return Object.freeze({
    schema: TECHNOLOGY_SOURCE_VERIFICATION_SCHEMA,
    version: TECHNOLOGY_SOURCE_VERIFICATION_VERSION,
    mode: 'offline_local_artifact_verification',
    summary: Object.freeze({
      supplied: results.length,
      matches: results.length - mismatches,
      mismatches,
      catalogueSources: sources.length,
      complete: results.length === sources.length,
      ready: mismatches === 0 && (!options.requireAll || results.length === sources.length),
    }),
    results: Object.freeze(results),
    bounds: Object.freeze({
      manifestBytes: MAX_TECHNOLOGY_SOURCE_MANIFEST_BYTES,
      entries: MAX_TECHNOLOGY_SOURCE_MANIFEST_ENTRIES,
      artifactBytes: MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES,
      networkRequests: 0,
      writes: 0,
    }),
    limitations: Object.freeze([
      'A matching digest confirms the supplied artefact and response metadata match the reviewed capture; it does not prove wider technology coverage.',
      'Source collection, container execution, and reference builds remain maintainer-controlled steps outside this read-only verifier.',
    ]),
  });
}

function parseArguments(args: readonly string[]): Readonly<{ manifestPath: string; requireAll: boolean; json: boolean }> {
  const [manifestPath, ...flags] = args;
  if (!manifestPath || manifestPath.startsWith('-') || flags.some((flag) => !['--require-all', '--json'].includes(flag))
    || new Set(flags).size !== flags.length) {
    throw new TypeError('Usage: node tools/technology-source-verify.mts MANIFEST.json [--require-all] [--json]');
  }
  return Object.freeze({ manifestPath, requireAll: flags.includes('--require-all'), json: flags.includes('--json') });
}

function formatReport(report: Awaited<ReturnType<typeof verifyTechnologySources>>): string {
  const lines = [
    'WHOISleuth technology source verification',
    `Verified: ${report.summary.matches}/${report.summary.supplied}; mismatches: ${report.summary.mismatches}`,
    `Catalogue coverage: ${report.summary.supplied}/${report.summary.catalogueSources}`,
  ];
  for (const result of report.results.filter((item) => item.status === 'mismatch')) {
    lines.push(`MISMATCH ${result.fixtureId}: artefact=${result.artifactMatch ? 'match' : 'different'}; response metadata=${result.responseMetadataMatch ? 'match' : 'different'}`);
  }
  lines.push('No artefact paths, page content, or response values are included in this report.');
  return `${lines.join('\n')}\n`;
}

export async function main(
  args = process.argv.slice(2),
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
): Promise<number> {
  try {
    const parsed = parseArguments(args);
    const manifest = await readBoundedManifest(parsed.manifestPath);
    const report = await verifyTechnologySources(manifest, { requireAll: parsed.requireAll });
    output.write(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
    return report.summary.ready ? 0 : 1;
  } catch (error) {
    errors.write(`${error instanceof Error ? error.message : 'Technology source verification failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

export { formatReport as formatTechnologySourceVerification, parseArguments as parseTechnologySourceVerificationArguments };
export type { VerificationEntry, VerificationManifest, VerificationOptions };

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REGISTRY_FIXTURE_PROVENANCE,
  REGISTRY_FIXTURE_PROVENANCE_SCHEMA,
  REGISTRY_FIXTURE_PROVENANCE_VERSION,
  type RegistryFixtureProvenance,
} from '../fixtures/registry-fixture-provenance.mts';
import {
  registryCompatibilityMatrix,
  type RegistryCompatibilityRow,
} from '../lib/registry-capabilities.mts';

type FreshnessState = 'current' | 'stale' | 'changed' | 'inconclusive';
type ReadFixture = (absolutePath: string) => Promise<Uint8Array>;
type WritableLike = { write(value: string): unknown };
type FreshnessOptions = Readonly<{
  repositoryRoot?: string;
  now?: () => Date;
  maxAgeDays?: number;
  provenance?: readonly RegistryFixtureProvenance[];
  capabilities?: readonly RegistryCompatibilityRow[];
  readFixture?: ReadFixture;
}>;
type MainOptions = FreshnessOptions & Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

export const REGISTRY_FIXTURE_FRESHNESS_SCHEMA = 'whoisleuth.registry-fixture-freshness';
export const REGISTRY_FIXTURE_FRESHNESS_VERSION = 1;
export const DEFAULT_REGISTRY_FIXTURE_MAX_AGE_DAYS = 180;
export const MAX_REGISTRY_FIXTURE_MAX_AGE_DAYS = 730;
export const MAX_REGISTRY_FIXTURE_FILES = 32;
export const MAX_REGISTRY_FIXTURE_PROFILES = 2_000;
export const MAX_REGISTRY_FIXTURE_BYTES = 8 * 1024 * 1024;

const SAFE_PATH_RE = /^(?:fixtures|test)\/[A-Za-z0-9._/-]{1,240}\.(?:mts|ts)$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

function boundedAge(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_REGISTRY_FIXTURE_MAX_AGE_DAYS) {
    throw new TypeError(`Fixture maximum age must be an integer from 1 to ${MAX_REGISTRY_FIXTURE_MAX_AGE_DAYS} days.`);
  }
  return parsed;
}

function canonicalDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TypeError(`${label} must be an ISO calendar date.`);
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${label} must be an ISO calendar date.`);
  }
  return value;
}

function validatedProvenance(
  entries: readonly RegistryFixtureProvenance[],
): readonly RegistryFixtureProvenance[] {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_REGISTRY_FIXTURE_FILES) {
    throw new RangeError(`Registry fixture provenance must contain 1-${MAX_REGISTRY_FIXTURE_FILES} files.`);
  }
  const seen = new Set<string>();
  return Object.freeze(entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new TypeError(`Fixture provenance entry ${index + 1} is invalid.`);
    if (!SAFE_PATH_RE.test(entry.path) || entry.path.includes('..') || path.isAbsolute(entry.path)) {
      throw new TypeError(`Fixture provenance entry ${index + 1} has an unsafe path.`);
    }
    if (seen.has(entry.path)) throw new TypeError(`Fixture provenance repeats ${entry.path}.`);
    seen.add(entry.path);
    canonicalDate(entry.sourceDate, `Fixture source date for ${entry.path}`);
    canonicalDate(entry.verifiedAt, `Fixture verification date for ${entry.path}`);
    if (!SHA256_RE.test(entry.sha256)) throw new TypeError(`Fixture provenance digest for ${entry.path} is invalid.`);
    if (!Array.isArray(entry.sourceUrls) || entry.sourceUrls.length < 1 || entry.sourceUrls.length > 20) {
      throw new TypeError(`Fixture provenance sources for ${entry.path} are invalid.`);
    }
    for (const sourceUrl of entry.sourceUrls) {
      let parsed: URL;
      try {
        parsed = new URL(sourceUrl);
      } catch {
        throw new TypeError(`Fixture provenance source for ${entry.path} is invalid.`);
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || sourceUrl.length > 2_048) {
        throw new TypeError(`Fixture provenance source for ${entry.path} must be a bounded HTTPS URL.`);
      }
    }
    if (
      typeof entry.interpretation !== 'string'
      || entry.interpretation.length < 1
      || entry.interpretation.length > 500
      || /[\u0000-\u001f\u007f]/u.test(entry.interpretation)
    ) {
      throw new TypeError(`Fixture provenance interpretation for ${entry.path} is invalid.`);
    }
    return Object.freeze({
      path: entry.path,
      sourceDate: entry.sourceDate,
      verifiedAt: entry.verifiedAt,
      sha256: entry.sha256,
      sourceUrls: Object.freeze([...entry.sourceUrls]),
      interpretation: entry.interpretation,
    });
  }));
}

function ageInDays(verifiedAt: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(`${verifiedAt}T00:00:00.000Z`)) / DAY_MS);
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function stateRank(value: FreshnessState): number {
  return ({ current: 0, stale: 1, inconclusive: 2, changed: 3 })[value];
}

function worstState(values: readonly FreshnessState[]): FreshnessState {
  return values.reduce<FreshnessState>(
    (worst, value) => stateRank(value) > stateRank(worst) ? value : worst,
    'current',
  );
}

export async function buildRegistryFixtureFreshnessReport(options: FreshnessOptions = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || path.resolve(fileURLToPath(new URL('..', import.meta.url))));
  const now = (options.now || (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Fixture report time is invalid.');
  const maxAgeDays = boundedAge(options.maxAgeDays ?? DEFAULT_REGISTRY_FIXTURE_MAX_AGE_DAYS);
  const provenance = validatedProvenance(options.provenance || REGISTRY_FIXTURE_PROVENANCE);
  const capabilities = options.capabilities || registryCompatibilityMatrix();
  if (!Array.isArray(capabilities) || capabilities.length > MAX_REGISTRY_FIXTURE_PROFILES) {
    throw new RangeError(`Registry capabilities exceeded ${MAX_REGISTRY_FIXTURE_PROFILES} rows.`);
  }
  const readFixture = options.readFixture || (async (absolutePath: string) => {
    const value = await readFile(absolutePath);
    if (value.byteLength > MAX_REGISTRY_FIXTURE_BYTES) {
      throw new RangeError(`Registry fixture file exceeded ${MAX_REGISTRY_FIXTURE_BYTES} bytes.`);
    }
    return value;
  });

  const files = [];
  const fileState = new Map<string, FreshnessState>();
  for (const entry of provenance) {
    let observedDigest: string | null = null;
    let error: string | null = null;
    try {
      const value = await readFixture(path.resolve(repositoryRoot, entry.path));
      if (!(value instanceof Uint8Array) || value.byteLength > MAX_REGISTRY_FIXTURE_BYTES) {
        throw new RangeError(`Registry fixture file exceeded ${MAX_REGISTRY_FIXTURE_BYTES} bytes.`);
      }
      observedDigest = digest(value);
    } catch {
      error = 'The tracked fixture file could not be read within its byte limit.';
    }
    const ageDays = ageInDays(entry.verifiedAt, now);
    const state: FreshnessState = error
      ? 'inconclusive'
      : observedDigest !== entry.sha256
        ? 'changed'
        : ageDays < 0 || ageDays > maxAgeDays
          ? 'stale'
          : 'current';
    fileState.set(entry.path, state);
    files.push(Object.freeze({
      path: entry.path,
      sourceDate: entry.sourceDate,
      verifiedAt: entry.verifiedAt,
      ageDays,
      expectedSha256: entry.sha256,
      observedSha256: observedDigest,
      state,
      sourceUrls: entry.sourceUrls,
      interpretation: entry.interpretation,
      error,
    }));
  }

  const profiles = capabilities
    .filter((profile) => profile.coverageState === 'fixture_verified')
    .map((profile) => {
      const verificationFiles = [...profile.verificationFiles].sort();
      const states = verificationFiles.map((file) => fileState.get(file) || 'inconclusive');
      return Object.freeze({
        id: profile.id,
        suffixes: Object.freeze([...profile.suffixes]),
        verificationFiles: Object.freeze(verificationFiles),
        state: verificationFiles.length ? worstState(states) : 'inconclusive' as const,
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const fileStates: Record<FreshnessState, number> = { current: 0, stale: 0, changed: 0, inconclusive: 0 };
  const profileStates: Record<FreshnessState, number> = { current: 0, stale: 0, changed: 0, inconclusive: 0 };
  for (const file of files) fileStates[file.state] += 1;
  for (const profile of profiles) profileStates[profile.state] += 1;
  return Object.freeze({
    schema: REGISTRY_FIXTURE_FRESHNESS_SCHEMA,
    version: REGISTRY_FIXTURE_FRESHNESS_VERSION,
    generatedAt: now.toISOString(),
    provenance: Object.freeze({
      schema: REGISTRY_FIXTURE_PROVENANCE_SCHEMA,
      version: REGISTRY_FIXTURE_PROVENANCE_VERSION,
    }),
    policy: Object.freeze({
      maxAgeDays,
      interpretation: 'Age is a maintenance-review threshold. Current status does not establish live reachability, field publication, registration, availability, ownership, safety, or maliciousness.',
    }),
    summary: Object.freeze({
      files: files.length,
      profiles: profiles.length,
      fileStates: Object.freeze(fileStates),
      profileStates: Object.freeze(profileStates),
    }),
    files: Object.freeze(files),
    profiles: Object.freeze(profiles),
  });
}

export function formatRegistryFixtureFreshnessReport(
  report: Awaited<ReturnType<typeof buildRegistryFixtureFreshnessReport>>,
): string {
  const lines = [
    'WHOISleuth registry fixture freshness',
    `Generated: ${report.generatedAt}`,
    `Review threshold: ${report.policy.maxAgeDays} days`,
    `Files: ${report.summary.fileStates.current} current, ${report.summary.fileStates.stale} stale, ${report.summary.fileStates.changed} changed, ${report.summary.fileStates.inconclusive} inconclusive`,
    `Profiles: ${report.summary.profileStates.current} current, ${report.summary.profileStates.stale} stale, ${report.summary.profileStates.changed} changed, ${report.summary.profileStates.inconclusive} inconclusive`,
    '',
  ];
  for (const file of report.files) {
    lines.push(`${file.state.toUpperCase().padEnd(13)} ${file.path}`);
    lines.push(`  Source reviewed ${file.sourceDate}; verified ${file.verifiedAt}; age ${file.ageDays} days; digest ${file.observedSha256 === file.expectedSha256 ? 'matches' : file.observedSha256 ? 'changed' : 'unavailable'}`);
  }
  lines.push(
    '',
    'Freshness is a maintenance signal only. It does not test a live registry or decide domain availability.',
  );
  return `${lines.join('\n')}\n`;
}

function parseArguments(args: readonly string[]): { json: boolean; maxAgeDays: number } {
  let json = false;
  let maxAgeDays = DEFAULT_REGISTRY_FIXTURE_MAX_AGE_DAYS;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      if (json) throw new TypeError('--json may be supplied only once.');
      json = true;
    } else if (arg === '--max-age-days') {
      const value = args[index + 1];
      if (value === undefined) throw new TypeError('--max-age-days requires a value.');
      maxAgeDays = boundedAge(value);
      index += 1;
    } else {
      throw new TypeError(`Unknown option: ${arg}`);
    }
  }
  return { json, maxAgeDays };
}

export async function main(
  args = process.argv.slice(2),
  options: MainOptions = {},
): Promise<number> {
  try {
    const parsed = parseArguments(args);
    const report = await buildRegistryFixtureFreshnessReport({ ...options, maxAgeDays: parsed.maxAgeDays });
    (options.stdout || process.stdout).write(parsed.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatRegistryFixtureFreshnessReport(report));
    if (
      report.summary.fileStates.changed > 0
      || report.summary.fileStates.inconclusive > 0
      || report.summary.profileStates.changed > 0
      || report.summary.profileStates.inconclusive > 0
    ) return 2;
    return report.summary.fileStates.stale > 0 || report.summary.profileStates.stale > 0 ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registry fixture freshness failed.';
    (options.stderr || process.stderr).write(`${message.replace(/[\r\n]+/gu, ' ').slice(0, 500)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; });
}

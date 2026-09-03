#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTestDurationData } from './test-duration-reporter.mts';

export const VERIFICATION_TIMING_PROFILE_VERSION = 1;
export const VERIFICATION_TIMING_PROFILE_PATH = 'fixtures/verification-timing-profile-v1.json';
export const VERIFICATION_BROWSER_SHARD_COUNT = 4;
export const MAX_TIMING_PROFILE_BYTES = 256 * 1024;
export const MAX_TIMING_REPORT_BYTES = 4 * 1024 * 1024;
export const MAX_TIMING_FILES = 1_000;
export const MAX_TIMING_PROVENANCE = 16;
export const MAX_TIMING_PATH_LENGTH = 240;
export const MAX_TIMING_TEXT_LENGTH = 180;
export const MAX_TIMING_FILE_DURATION_MS = 30 * 60 * 1_000;
export const MAX_TIMING_AGGREGATE_MS = 24 * 60 * 60 * 1_000;

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_KEYS = new Set(['profileVersion', 'inventoryFingerprint', 'provenance', 'files']);
const PROVENANCE_KEYS = new Set(['id', 'lane', 'environmentClass', 'sampleBasis', 'sampleCount']);
const FILE_KEYS = new Set(['file', 'lane', 'weightMs', 'sampleCount', 'provenanceId']);
const BROWSER_AGGREGATE_KEYS = new Set(['reportVersion', 'inventoryFingerprint', 'files']);
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,79})$/u;
const SAFE_FINGERPRINT = /^[0-9a-f]{64}$/u;
const SAFE_TEST_PATH = /^(?:test\/[a-zA-Z0-9._-]+\.test\.mts|e2e\/[a-zA-Z0-9._-]+\.(?:spec\.ts|setup\.ts))$/u;

export type VerificationTimingLane = 'unit' | 'browser' | 'browser_setup';

export type VerificationTimingProvenance = Readonly<{
  id: string;
  lane: VerificationTimingLane;
  environmentClass: string;
  sampleBasis: string;
  sampleCount: number;
}>;

export type VerificationTimingFile = Readonly<{
  file: string;
  lane: VerificationTimingLane;
  weightMs: number;
  sampleCount: number;
  provenanceId: string;
}>;

export type VerificationTimingProfile = Readonly<{
  profileVersion: 1;
  inventoryFingerprint: string;
  provenance: readonly VerificationTimingProvenance[];
  files: readonly VerificationTimingFile[];
}>;

export type VerificationBrowserShard = Readonly<{
  shard: number;
  files: readonly string[];
  plannedWeightMs: number;
}>;

export type VerificationBrowserShardPlan = Readonly<{
  profileVersion: 1;
  inventoryFingerprint: string;
  shardCount: number;
  setupFiles: readonly string[];
  setupWeightMs: number;
  shards: readonly VerificationBrowserShard[];
  totalPlannedWeightMs: number;
  unavoidableImbalanceMs: number;
  imbalanceRatio: number;
}>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, keys: ReadonlySet<string>, label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) {
    throw new TypeError(`${label} must use only the documented fields.`);
  }
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_TIMING_TEXT_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be a bounded printable string.`);
  }
  return value;
}

function boundedInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new TypeError(`${label} must be an integer between 1 and ${maximum}.`);
  }
  return Number(value);
}

function testLane(file: string): VerificationTimingLane {
  if (file.startsWith('test/')) return 'unit';
  if (file.endsWith('.setup.ts')) return 'browser_setup';
  return 'browser';
}

function normaliseTestPath(value: unknown, label = 'Timing file'): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_TIMING_PATH_LENGTH || !SAFE_TEST_PATH.test(value)) {
    throw new TypeError(`${label} must be a repository-relative maintained test identity.`);
  }
  return value;
}

function normalisePlaywrightTestPath(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Playwright test file must be a string.');
  const normalized = value.replaceAll('\\', '/');
  const candidate = path.isAbsolute(value)
    ? path.relative(REPOSITORY_ROOT, value).split(path.sep).join('/')
    : normalized.startsWith('e2e/') ? normalized : `e2e/${normalized}`;
  return normaliseTestPath(candidate, 'Playwright test file');
}

function collectTestFiles(directory: string, suffix: RegExp, prefix: string): string[] {
  const results: string[] = [];
  const visit = (current: string): void => {
    const entries = readdirSync(path.join(REPOSITORY_ROOT, current), { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = `${current}/${entry.name}`;
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile() && suffix.test(entry.name)) {
        results.push(relative.startsWith(prefix) ? relative : `${prefix}/${entry.name}`);
        if (results.length > MAX_TIMING_FILES) throw new TypeError('Timing inventory exceeds the maintained file bound.');
      }
    }
  };
  visit(directory);
  return results;
}

export function readVerificationTestInventory(): readonly string[] {
  const unit = readdirSync(path.join(REPOSITORY_ROOT, 'test'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[a-zA-Z0-9._-]+\.test\.mts$/u.test(entry.name))
    .map((entry) => `test/${entry.name}`)
    .sort();
  const browser = collectTestFiles('e2e', /\.(?:spec|setup)\.ts$/u, 'e2e');
  const inventory = [...unit, ...browser].sort();
  if (inventory.length < 1 || new Set(inventory).size !== inventory.length) {
    throw new TypeError('Verification test inventory must be non-empty and unique.');
  }
  return Object.freeze(inventory);
}

export function verificationTestInventoryFingerprint(inventory: readonly string[] = readVerificationTestInventory()): string {
  const normalized = [...inventory].sort();
  if (normalized.length < 1 || new Set(normalized).size !== normalized.length) {
    throw new TypeError('Verification test inventory must be non-empty and unique before fingerprinting.');
  }
  return createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

function parseProfileValue(value: unknown, inventory: readonly string[]): VerificationTimingProfile {
  if (!isRecord(value)) throw new TypeError('Timing profile must be an object.');
  exactKeys(value, PROFILE_KEYS, 'Timing profile');
  if (value.profileVersion !== VERIFICATION_TIMING_PROFILE_VERSION) {
    throw new TypeError(`Timing profile must use version ${VERIFICATION_TIMING_PROFILE_VERSION}.`);
  }
  if (typeof value.inventoryFingerprint !== 'string' || !SAFE_FINGERPRINT.test(value.inventoryFingerprint)) {
    throw new TypeError('Timing profile inventory fingerprint must be a lowercase SHA-256 digest.');
  }
  if (value.inventoryFingerprint !== verificationTestInventoryFingerprint(inventory)) {
    throw new TypeError('Timing profile inventory fingerprint does not match the maintained test inventory.');
  }
  if (!Array.isArray(value.provenance) || value.provenance.length < 1 || value.provenance.length > MAX_TIMING_PROVENANCE) {
    throw new TypeError(`Timing profile must retain 1 to ${MAX_TIMING_PROVENANCE} provenance records.`);
  }
  const provenance = value.provenance.map((raw, index): VerificationTimingProvenance => {
    if (!isRecord(raw)) throw new TypeError(`Timing provenance ${index + 1} must be an object.`);
    exactKeys(raw, PROVENANCE_KEYS, `Timing provenance ${index + 1}`);
    const id = boundedText(raw.id, `Timing provenance ${index + 1} ID`);
    if (!SAFE_ID.test(id)) throw new TypeError('Timing provenance IDs must be lower-case stable identifiers.');
    if (raw.lane !== 'unit' && raw.lane !== 'browser' && raw.lane !== 'browser_setup') {
      throw new TypeError('Timing provenance lane is unsupported.');
    }
    return Object.freeze({
      id,
      lane: raw.lane,
      environmentClass: boundedText(raw.environmentClass, 'Timing environment class'),
      sampleBasis: boundedText(raw.sampleBasis, 'Timing sample basis'),
      sampleCount: boundedInteger(raw.sampleCount, 'Timing provenance sample count', 10_000),
    });
  });
  const provenanceIds = provenance.map((item) => item.id);
  if (new Set(provenanceIds).size !== provenanceIds.length) throw new TypeError('Timing provenance IDs must be unique.');
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > MAX_TIMING_FILES) {
    throw new TypeError(`Timing profile must retain 1 to ${MAX_TIMING_FILES} measured files.`);
  }
  let aggregate = 0;
  const files = value.files.map((raw, index): VerificationTimingFile => {
    if (!isRecord(raw)) throw new TypeError(`Timing file ${index + 1} must be an object.`);
    exactKeys(raw, FILE_KEYS, `Timing file ${index + 1}`);
    const file = normaliseTestPath(raw.file);
    const lane = testLane(file);
    if (raw.lane !== lane) throw new TypeError(`Timing lane does not match ${file}.`);
    const provenanceItem = provenance.find((item) => item.id === raw.provenanceId);
    if (!provenanceItem || (provenanceItem.lane !== lane && !(lane === 'browser_setup' && provenanceItem.lane === 'browser'))) {
      throw new TypeError(`Timing provenance does not cover ${file}.`);
    }
    const weightMs = boundedInteger(raw.weightMs, `Timing weight for ${file}`, MAX_TIMING_FILE_DURATION_MS);
    const sampleCount = boundedInteger(raw.sampleCount, `Timing sample count for ${file}`, 10_000);
    if (sampleCount > provenanceItem.sampleCount) throw new TypeError(`Timing sample count exceeds its provenance for ${file}.`);
    aggregate += weightMs;
    if (aggregate > MAX_TIMING_AGGREGATE_MS) throw new TypeError('Timing profile aggregate exceeds the maintained bound.');
    return Object.freeze({ file, lane, weightMs, sampleCount, provenanceId: provenanceItem.id });
  });
  const identities = files.map((item) => item.file);
  if (new Set(identities).size !== identities.length) throw new TypeError('Timing profile test identities must not repeat.');
  const expected = new Set(inventory);
  const missing = inventory.filter((file) => !identities.includes(file));
  const unknown = identities.filter((file) => !expected.has(file));
  if (missing.length || unknown.length) {
    throw new TypeError(`Timing profile inventory mismatch: ${missing.length} missing and ${unknown.length} unknown test identities.`);
  }
  return Object.freeze({
    profileVersion: VERIFICATION_TIMING_PROFILE_VERSION,
    inventoryFingerprint: value.inventoryFingerprint,
    provenance: Object.freeze(provenance),
    files: Object.freeze([...files].sort((left, right) => left.file.localeCompare(right.file))),
  });
}

export function parseVerificationTimingProfile(
  input: string | Buffer,
  inventory: readonly string[] = readVerificationTestInventory(),
): VerificationTimingProfile {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  if (bytes.length < 1 || bytes.length > MAX_TIMING_PROFILE_BYTES) {
    throw new TypeError(`Timing profile must be between 1 and ${MAX_TIMING_PROFILE_BYTES} bytes.`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8')) as unknown; } catch { throw new TypeError('Timing profile must be valid JSON.'); }
  return parseProfileValue(parsed, inventory);
}

export function readVerificationTimingProfile(): VerificationTimingProfile {
  const profilePath = path.join(REPOSITORY_ROOT, VERIFICATION_TIMING_PROFILE_PATH);
  const size = statSync(profilePath).size;
  if (size < 1 || size > MAX_TIMING_PROFILE_BYTES) throw new TypeError('Retained timing profile has an invalid byte count.');
  return parseVerificationTimingProfile(readFileSync(profilePath));
}

export function buildBalancedBrowserShardPlan(
  profile: VerificationTimingProfile,
  shardCount = VERIFICATION_BROWSER_SHARD_COUNT,
): VerificationBrowserShardPlan {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 16) {
    throw new TypeError('Browser shard count must be between 1 and 16.');
  }
  const browser = profile.files.filter((item) => item.lane === 'browser');
  if (browser.length < shardCount) throw new TypeError('Browser inventory is smaller than the requested shard count.');
  const working = Array.from({ length: shardCount }, (_, index) => ({ shard: index + 1, files: [] as string[], weight: 0 }));
  for (const item of [...browser].sort((left, right) => right.weightMs - left.weightMs || left.file.localeCompare(right.file))) {
    const target = [...working].sort((left, right) => left.weight - right.weight || left.shard - right.shard)[0];
    if (!target) throw new TypeError('Browser shard planner could not select a target shard.');
    target.files.push(item.file);
    target.weight += item.weightMs;
  }
  const assigned = working.flatMap((item) => item.files);
  if (assigned.length !== browser.length || new Set(assigned).size !== browser.length) {
    throw new TypeError('Browser shard plan must assign every browser specification exactly once.');
  }
  const shards = working.map((item) => Object.freeze({
    shard: item.shard,
    files: Object.freeze([...item.files].sort()),
    plannedWeightMs: item.weight,
  }));
  const weights = shards.map((item) => item.plannedWeightMs);
  const maximum = Math.max(...weights);
  const minimum = Math.min(...weights);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const setup = profile.files.filter((item) => item.lane === 'browser_setup');
  return Object.freeze({
    profileVersion: VERIFICATION_TIMING_PROFILE_VERSION,
    inventoryFingerprint: profile.inventoryFingerprint,
    shardCount,
    setupFiles: Object.freeze(setup.map((item) => item.file).sort()),
    setupWeightMs: setup.reduce((sum, item) => sum + item.weightMs, 0),
    shards: Object.freeze(shards),
    totalPlannedWeightMs: total,
    unavoidableImbalanceMs: maximum - minimum,
    imbalanceRatio: total === 0 ? 0 : Number(((maximum - minimum) / (total / shardCount)).toFixed(6)),
  });
}

function readBoundedReport(filename: string): string {
  if (!path.isAbsolute(filename)) throw new TypeError('Timing candidate reports must use explicit absolute paths.');
  const size = statSync(filename).size;
  if (size < 1 || size > MAX_TIMING_REPORT_BYTES) throw new TypeError(`Timing report must be between 1 and ${MAX_TIMING_REPORT_BYTES} bytes.`);
  return readFileSync(filename, 'utf8');
}

function readRetainedProfileForUpdate(): VerificationTimingProfile {
  const profilePath = path.join(REPOSITORY_ROOT, VERIFICATION_TIMING_PROFILE_PATH);
  const input = readBoundedReport(profilePath);
  let parsed: unknown;
  try { parsed = JSON.parse(input) as unknown; } catch { throw new TypeError('Retained timing profile must be valid JSON.'); }
  if (!isRecord(parsed) || !Array.isArray(parsed.files)) throw new TypeError('Retained timing profile is malformed.');
  const retainedInventory = parsed.files.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`Retained timing file ${index + 1} is malformed.`);
    return normaliseTestPath(item.file, `Retained timing file ${index + 1}`);
  });
  return parseProfileValue(parsed, retainedInventory);
}

function decodeXml(value: string): string {
  return value.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function parseUnitJunit(filename: string): Map<string, number> {
  const input = readBoundedReport(filename);
  const summary = Object.fromEntries(
    [...input.matchAll(/<!-- (tests|pass|fail|cancelled|skipped|todo) (\d+) -->/gu)]
      .map((match) => [match[1], Number(match[2])]),
  );
  if (!Number.isSafeInteger(summary.tests) || Number(summary.tests) < 1
    || summary.tests !== summary.pass || summary.fail !== 0 || summary.cancelled !== 0
    || summary.skipped !== 0 || summary.todo !== 0) {
    throw new TypeError('JUnit timing candidate must be a complete passing, non-cancelled, non-skipped run.');
  }
  const totals = new Map<string, number>();
  let measuredTests = 0;
  const pattern = /<testcase\b[^>]*\btime="([0-9]+(?:\.[0-9]+)?)"[^>]*\bfile="([^"]+)"[^>]*\/?>(?:<\/testcase>)?/gu;
  for (const match of input.matchAll(pattern)) {
    const absolute = decodeXml(match[2] ?? '');
    const relative = path.relative(REPOSITORY_ROOT, absolute).split(path.sep).join('/');
    const file = normaliseTestPath(relative, 'JUnit test file');
    if (testLane(file) !== 'unit') throw new TypeError('JUnit candidate may contain only maintained unit tests.');
    const milliseconds = Math.max(1, Math.round(Number(match[1]) * 1_000));
    if (!Number.isSafeInteger(milliseconds) || milliseconds > MAX_TIMING_FILE_DURATION_MS) throw new TypeError('JUnit duration is out of bounds.');
    totals.set(file, (totals.get(file) ?? 0) + milliseconds);
    measuredTests += 1;
    if (totals.size > MAX_TIMING_FILES) throw new TypeError('JUnit candidate exceeds the file bound.');
  }
  if (!totals.size || measuredTests > summary.tests || summary.tests - measuredTests > totals.size) {
    throw new TypeError('JUnit candidate does not cover its declared accepted tests.');
  }
  return totals;
}

export function parsePlaywrightTimingData(parsed: unknown): Map<string, number> {
  if (!isRecord(parsed) || !Array.isArray(parsed.suites) || !isRecord(parsed.stats)
    || Number(parsed.stats.unexpected) !== 0 || Number(parsed.stats.flaky) !== 0 || Number(parsed.stats.skipped) !== 0) {
    throw new TypeError('Playwright timing candidate must be a complete passing, non-flaky, non-skipped run.');
  }
  const totals = new Map<string, number>();
  let measuredTests = 0;
  const visit = (suites: unknown[], depth: number): void => {
    if (depth > 32) throw new TypeError('Playwright timing report exceeds the suite-depth bound.');
    for (const suite of suites) {
      if (!isRecord(suite)) throw new TypeError('Playwright timing suite is malformed.');
      if (Array.isArray(suite.specs)) for (const spec of suite.specs) {
        if (!isRecord(spec) || typeof spec.file !== 'string' || !Array.isArray(spec.tests)) throw new TypeError('Playwright timing specification is malformed.');
        const file = normalisePlaywrightTestPath(spec.file);
        for (const test of spec.tests) {
          if (!isRecord(test) || !Array.isArray(test.results) || test.status !== 'expected') throw new TypeError('Playwright timing test is not an accepted pass.');
          const accepted = test.results.filter((result): result is UnknownRecord => isRecord(result) && result.status === 'passed');
          if (accepted.length !== 1 || test.results.length !== 1) throw new TypeError('Playwright timing candidate must use no retries or extra attempts.');
          const duration = accepted[0]?.duration;
          if (!Number.isSafeInteger(duration) || Number(duration) < 0 || Number(duration) > MAX_TIMING_FILE_DURATION_MS) throw new TypeError('Playwright duration is out of bounds.');
          totals.set(file, (totals.get(file) ?? 0) + Math.max(1, Number(duration)));
          measuredTests += 1;
        }
      }
      if (Array.isArray(suite.suites)) visit(suite.suites, depth + 1);
    }
  };
  visit(parsed.suites, 0);
  if (!totals.size || Number(parsed.stats.expected) !== measuredTests) {
    throw new TypeError('Playwright timing candidate does not cover its declared accepted tests.');
  }
  return totals;
}

function parseBrowserJson(filename: string): Map<string, number> {
  const input = readBoundedReport(filename);
  let parsed: unknown;
  try { parsed = JSON.parse(input) as unknown; } catch { throw new TypeError('Playwright timing report must be valid JSON.'); }
  return parsePlaywrightTimingData(parsed);
}

type TimingMeasurement = Readonly<{ weightMs: number; sampleCount: number }>;

function median(values: readonly number[]): number {
  if (values.length < 1) throw new TypeError('Timing median requires at least one measurement.');
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? Math.round(ordered[middle] as number)
    : Math.round(((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2);
}

function parseUnitDurationReports(filenames: readonly string[]): Map<string, TimingMeasurement> {
  if (filenames.length !== 3) throw new TypeError('Unit timing updates require exactly three complete duration reports.');
  const runs = filenames.map((filename) => parseTestDurationData(readBoundedReport(filename)));
  const first = runs[0];
  if (!first) throw new TypeError('Unit timing reports are unavailable.');
  const identities = first.files.map((item) => item.file).sort();
  for (const [index, run] of runs.entries()) {
    const actual = run.files.map((item) => item.file).sort();
    if (JSON.stringify(actual) !== JSON.stringify(identities)) {
      throw new TypeError(`Unit timing report ${index + 1} does not match the other accepted runs.`);
    }
    if (run.totals.passed !== first.totals.passed) {
      throw new TypeError('Unit timing reports must retain the same accepted test total.');
    }
  }
  return new Map(identities.map((file) => [file, Object.freeze({
    weightMs: Math.max(1, median(runs.map((run) => run.files.find((item) => item.file === file)!.durationMs))),
    sampleCount: runs.length,
  })]));
}

function parseBrowserAggregateReport(filename: string): Readonly<{
  inventoryFingerprint: string;
  measurements: Map<string, TimingMeasurement>;
}> {
  const input = readBoundedReport(filename);
  let parsed: unknown;
  try { parsed = JSON.parse(input) as unknown; } catch { throw new TypeError('Browser shard aggregate must be valid JSON.'); }
  if (!isRecord(parsed) || parsed.reportVersion !== 1 || !SAFE_FINGERPRINT.test(String(parsed.inventoryFingerprint ?? ''))
    || !Array.isArray(parsed.files) || parsed.files.length < 1 || parsed.files.length > MAX_TIMING_FILES) {
    throw new TypeError('Browser shard aggregate is malformed.');
  }
  exactKeys(parsed, BROWSER_AGGREGATE_KEYS, 'Browser shard aggregate');
  const measurements = new Map<string, TimingMeasurement>();
  for (const [index, raw] of parsed.files.entries()) {
    if (!isRecord(raw) || Object.keys(raw).length !== 4
      || !Object.hasOwn(raw, 'file') || !Object.hasOwn(raw, 'lane')
      || !Object.hasOwn(raw, 'weightMs') || !Object.hasOwn(raw, 'sampleCount')) {
      throw new TypeError(`Browser shard aggregate file ${index + 1} is malformed.`);
    }
    const file = normaliseTestPath(raw.file, `Browser shard aggregate file ${index + 1}`);
    const lane = testLane(file);
    if ((lane !== 'browser' && lane !== 'browser_setup') || raw.lane !== lane) {
      throw new TypeError(`Browser shard aggregate lane does not match ${file}.`);
    }
    if (measurements.has(file)) throw new TypeError('Browser shard aggregate test identities must be unique.');
    measurements.set(file, Object.freeze({
      weightMs: boundedInteger(raw.weightMs, `Browser shard aggregate weight for ${file}`, MAX_TIMING_FILE_DURATION_MS),
      sampleCount: boundedInteger(raw.sampleCount, `Browser shard aggregate sample count for ${file}`, 16),
    }));
  }
  return Object.freeze({
    inventoryFingerprint: String(parsed.inventoryFingerprint),
    measurements,
  });
}

function candidateOption(args: readonly string[], name: string): string {
  const prefix = `--${name}=`;
  const matches = args.filter((arg) => arg.startsWith(prefix));
  if (matches.length !== 1) throw new TypeError(`Timing candidate requires exactly one ${prefix}VALUE option.`);
  return boundedText(matches[0]!.slice(prefix.length), `Timing candidate ${name}`);
}

function candidateOptions(args: readonly string[], name: string): readonly string[] {
  const prefix = `--${name}=`;
  return Object.freeze(args.filter((arg) => arg.startsWith(prefix)).map((arg) => (
    boundedText(arg.slice(prefix.length), `Timing candidate ${name}`)
  )));
}

export function buildVerificationTimingCandidate(args: readonly string[]): VerificationTimingProfile {
  if (args.length !== 9 || args[0] !== '--candidate') throw new TypeError('Timing candidate arguments are incomplete or unexpected.');
  const unitReport = candidateOption(args, 'unit-report');
  const browserReport = candidateOption(args, 'browser-report');
  const unitId = candidateOption(args, 'unit-provenance-id');
  const browserId = candidateOption(args, 'browser-provenance-id');
  if (!SAFE_ID.test(unitId) || !SAFE_ID.test(browserId) || unitId === browserId) throw new TypeError('Timing candidate provenance IDs are invalid or repeated.');
  const unitEnvironment = candidateOption(args, 'unit-environment');
  const browserEnvironment = candidateOption(args, 'browser-environment');
  const unitBasis = candidateOption(args, 'unit-sample-basis');
  const browserBasis = candidateOption(args, 'browser-sample-basis');
  const unit = parseUnitJunit(unitReport);
  const browser = parseBrowserJson(browserReport);
  const inventory = readVerificationTestInventory();
  const provenance: VerificationTimingProvenance[] = [
    Object.freeze({ id: unitId, lane: 'unit', environmentClass: unitEnvironment, sampleBasis: unitBasis, sampleCount: 1 }),
    Object.freeze({ id: browserId, lane: 'browser', environmentClass: browserEnvironment, sampleBasis: browserBasis, sampleCount: 1 }),
  ];
  const files = inventory.map((file): VerificationTimingFile => {
    const lane = testLane(file);
    const weightMs = (lane === 'unit' ? unit : browser).get(file);
    if (weightMs === undefined) throw new TypeError(`Timing candidate did not measure required test identity ${file}.`);
    return Object.freeze({ file, lane, weightMs, sampleCount: 1, provenanceId: lane === 'unit' ? unitId : browserId });
  });
  return parseProfileValue({
    profileVersion: 1,
    inventoryFingerprint: verificationTestInventoryFingerprint(inventory),
    provenance,
    files,
  }, inventory);
}

export function buildVerificationTimingUpdateCandidate(args: readonly string[]): VerificationTimingProfile {
  if (args[0] !== '--update-candidate') throw new TypeError('Timing update arguments are incomplete or unexpected.');
  const lane = candidateOption(args, 'lane');
  if (lane !== 'unit' && lane !== 'browser') throw new TypeError('Timing update lane must be unit or browser.');
  const reports = candidateOptions(args, 'report');
  const expectedArgumentCount = lane === 'unit' ? 8 : 6;
  if (args.length !== expectedArgumentCount || reports.length !== (lane === 'unit' ? 3 : 1)) {
    throw new TypeError(lane === 'unit'
      ? 'Unit timing updates require exactly three reports and bounded provenance metadata.'
      : 'Browser timing updates require exactly one shard aggregate and bounded provenance metadata.');
  }
  const id = candidateOption(args, 'provenance-id');
  if (!SAFE_ID.test(id)) throw new TypeError('Timing update provenance ID is invalid.');
  const environmentClass = candidateOption(args, 'environment');
  const sampleBasis = candidateOption(args, 'sample-basis');
  const retained = readRetainedProfileForUpdate();
  if (retained.provenance.some((item) => item.id === id)) throw new TypeError('Timing update provenance ID already exists.');
  const parsedBrowser = lane === 'browser' ? parseBrowserAggregateReport(reports[0]!) : null;
  const measurements = lane === 'unit'
    ? parseUnitDurationReports(reports)
    : parsedBrowser!.measurements;
  if (parsedBrowser && parsedBrowser.inventoryFingerprint !== retained.inventoryFingerprint) {
    throw new TypeError('Browser shard aggregate inventory fingerprint does not match the retained timing profile.');
  }
  if ([...measurements].some(([file]) => (lane === 'unit') !== (testLane(file) === 'unit'))) {
    throw new TypeError('Timing update report contains an identity from another lane.');
  }
  const inventory = readVerificationTestInventory();
  const expectedMeasurements = inventory.filter((file) => lane === 'unit'
    ? testLane(file) === 'unit'
    : testLane(file) !== 'unit');
  const measuredIdentities = [...measurements.keys()].sort();
  if (JSON.stringify(measuredIdentities) !== JSON.stringify([...expectedMeasurements].sort())) {
    throw new TypeError(`Timing update does not cover the complete maintained ${lane} inventory.`);
  }
  const currentByFile = new Map(retained.files.map((item) => [item.file, item]));
  const files = inventory.map((file): VerificationTimingFile => {
    const measured = measurements.get(file);
    const current = currentByFile.get(file);
    if (measured === undefined) {
      if (!current) throw new TypeError(`Timing update did not measure new required test identity ${file}.`);
      return current;
    }
    return Object.freeze({ file, lane: testLane(file), weightMs: measured.weightMs, sampleCount: measured.sampleCount, provenanceId: id });
  });
  const sampleCount = Math.max(...[...measurements.values()].map((measurement) => measurement.sampleCount));
  const retainedProvenanceIds = new Set(files.map((item) => item.provenanceId));
  const provenance = [
    ...retained.provenance.filter((item) => retainedProvenanceIds.has(item.id)),
    Object.freeze({ id, lane, environmentClass, sampleBasis, sampleCount }),
  ];
  return parseProfileValue({
    profileVersion: retained.profileVersion,
    inventoryFingerprint: verificationTestInventoryFingerprint(inventory),
    provenance,
    files,
  }, inventory);
}

function formatPlan(plan: VerificationBrowserShardPlan): string {
  const lines = [
    `Verification timing profile v${plan.profileVersion}; inventory ${plan.inventoryFingerprint.slice(0, 12)}`,
    `Browser setup: ${plan.setupFiles.length} file(s), ${plan.setupWeightMs} ms retained weight`,
    ...plan.shards.map((shard) => `Shard ${shard.shard}/${plan.shardCount}: ${shard.files.length} specs, ${shard.plannedWeightMs} ms planned weight`),
    `Projected imbalance: ${plan.unavoidableImbalanceMs} ms (${(plan.imbalanceRatio * 100).toFixed(2)}% of mean shard weight)`,
  ];
  return `${lines.join('\n')}\n`;
}

export function main(args = process.argv.slice(2)): number {
  try {
    if (args[0] === '--candidate') {
      process.stdout.write(`${JSON.stringify(buildVerificationTimingCandidate(args), null, 2)}\n`);
      return 0;
    }
    if (args[0] === '--update-candidate') {
      process.stdout.write(`${JSON.stringify(buildVerificationTimingUpdateCandidate(args), null, 2)}\n`);
      return 0;
    }
    if (args.length > 1 || (args.length === 1 && args[0] !== '--check' && args[0] !== '--json')) {
      throw new TypeError('Usage: node tools/verification-timing-profile.mts [--check|--json], --candidate, or --update-candidate with bounded report metadata.');
    }
    const profile = readVerificationTimingProfile();
    const plan = buildBalancedBrowserShardPlan(profile);
    process.stdout.write(args[0] === '--json' ? `${JSON.stringify(plan, null, 2)}\n` : formatPlan(plan));
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Verification timing profile failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

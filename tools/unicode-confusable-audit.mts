#!/usr/bin/env node

import { createRequire } from 'node:module';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { domainToASCII, fileURLToPath } from 'node:url';

import {
  GENERATED_CONFUSABLE_GROUPS,
  GENERATED_CONFUSABLE_MAPPING_VERSION,
  GENERATED_CONFUSABLE_POLICY,
  GENERATED_CONFUSABLE_SOURCE,
  GENERATED_CONFUSABLE_STATS,
  GENERATED_GENERATION_CONFUSABLE_GROUPS,
} from '../lib/generated/unicode-confusables-17.mts';
import {
  MAX_CONFUSABLE_SOURCE_BYTES,
  MAX_GENERATION_CONFUSABLES_PER_ASCII,
  MAX_PROJECTED_CONFUSABLES,
  MAX_SKELETON_CONFUSABLES_PER_ASCII,
  REVIEWED_GENERATION_CONFUSABLES,
  REVIEWED_SKELETON_CONFUSABLES,
} from '../lib/idn-confusable-policy.mts';
import {
  generateConfusableProjection,
  renderConfusableProjectionModule,
} from '../lib/unicode-confusable-projection.mts';

type WritableLike = { write(value: string): unknown };
type CalibrationCase = Readonly<{
  id: string;
  category: string;
  reference: string;
  observed: string;
  expectedMatch: boolean;
}>;
type Confusion = Readonly<{
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
}>;
type AuditArguments = Readonly<{ source: string | null; write: boolean; json: boolean }>;
type MainOptions = Readonly<{
  repositoryRoot?: string;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

export const UNICODE_CONFUSABLE_AUDIT_SCHEMA = 'whoisleuth.unicode-confusable-audit';
export const UNICODE_CONFUSABLE_AUDIT_VERSION = 2;
export const MAX_CONFUSABLE_CALIBRATION_CASES = 100;
export const MAX_CONFUSABLE_CALIBRATION_LABEL_CODEPOINTS = 63;
export const MAX_CONFUSABLE_CALIBRATION_ID_LENGTH = 80;
export const MAX_CONFUSABLE_CALIBRATION_CATEGORY_LENGTH = 40;
export const MAX_TOTAL_CANDIDATE_GROWTH_RATIO = 0.5;
export const MAX_SEED_CANDIDATE_GROWTH_RATIO = 0.75;
export const MAX_CALIBRATION_SEEDS = 20;

const require = createRequire(import.meta.url);
const CALIBRATION_CASES = require('../fixtures/idn-confusable-calibration.js') as unknown;
const CALIBRATION_SEEDS = Object.freeze([
  'scope',
  'figure',
  'gateway',
  'portal',
  'secure',
  'account',
  'billing',
  'market',
  'verify',
  'example',
]);
const MARK_RE = /\p{Mark}/u;
const SAFE_LABEL_RE = /^[\p{Letter}\p{Number}-]+$/u;
const SAFE_ID_RE = /^[a-z0-9-]+$/u;
const WHOLE_LABEL_SCRIPT_TESTS: ReadonlyArray<readonly [string, RegExp]> = Object.freeze([
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Coptic', /\p{Script=Coptic}/u],
  ['Deseret', /\p{Script=Deseret}/u],
  ['Lisu', /\p{Script=Lisu}/u],
]);

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function boundedLabel(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text.`);
  const codePointLength = [...value].length;
  if (
    codePointLength === 0
    || codePointLength > MAX_CONFUSABLE_CALIBRATION_LABEL_CODEPOINTS
    || !SAFE_LABEL_RE.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded domain-label value.`);
  }
  return value;
}

function normalizeCalibrationCases(value: unknown): CalibrationCase[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CONFUSABLE_CALIBRATION_CASES) {
    throw new TypeError('Unicode confusable calibration cases are missing or exceed the case limit.');
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`Unicode confusable calibration case ${index + 1} must be an object.`);
    }
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id : '';
    const category = typeof candidate.category === 'string' ? candidate.category : '';
    if (
      !SAFE_ID_RE.test(id)
      || id.length > MAX_CONFUSABLE_CALIBRATION_ID_LENGTH
      || ids.has(id)
      || category.length === 0
      || category.length > MAX_CONFUSABLE_CALIBRATION_CATEGORY_LENGTH
      || candidate.expectedMatch !== Boolean(candidate.expectedMatch)
    ) {
      throw new TypeError(`Unicode confusable calibration case ${index + 1} has invalid metadata.`);
    }
    ids.add(id);
    return Object.freeze({
      id,
      category,
      reference: boundedLabel(candidate.reference, `Calibration case ${id} reference`),
      observed: boundedLabel(candidate.observed, `Calibration case ${id} observation`),
      expectedMatch: candidate.expectedMatch as boolean,
    });
  });
}

export function skeletonWithConfusableGroups(
  value: unknown,
  groups: Readonly<Record<string, string>>,
): string | null {
  if (typeof value !== 'string' || [...value].length > MAX_CONFUSABLE_CALIBRATION_LABEL_CODEPOINTS) return null;
  const reverse = new Map<string, string>();
  for (const [ascii, substitutions] of Object.entries(groups)) {
    if (!/^[a-z]$/u.test(ascii) || [...substitutions].length > MAX_SKELETON_CONFUSABLES_PER_ASCII) return null;
    for (const substitution of substitutions) {
      if (reverse.has(substitution) && reverse.get(substitution) !== ascii) return null;
      reverse.set(substitution, ascii);
    }
  }
  let output = '';
  for (const character of value.normalize('NFKD').toLowerCase()) {
    if (MARK_RE.test(character)) continue;
    output += reverse.get(character)
      || (character === '0' ? 'o' : character === '1' || character === '|' ? 'l' : character);
    if ([...output].length > MAX_CONFUSABLE_CALIBRATION_LABEL_CODEPOINTS * 2) return null;
  }
  return output;
}

function confusionFor(
  cases: readonly CalibrationCase[],
  groups: Readonly<Record<string, string>>,
): Confusion {
  const result = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
  for (const calibration of cases) {
    const matched = skeletonWithConfusableGroups(calibration.reference, groups)
      === skeletonWithConfusableGroups(calibration.observed, groups);
    if (calibration.expectedMatch && matched) result.truePositive += 1;
    else if (!calibration.expectedMatch && !matched) result.trueNegative += 1;
    else if (matched) result.falsePositive += 1;
    else result.falseNegative += 1;
  }
  return Object.freeze(result);
}

function candidateCounts(label: string, groups: Readonly<Record<string, string>>) {
  const singleSubstitutionCandidates = new Set<string>();
  for (let index = 0; index < label.length; index += 1) {
    for (const substitution of [...(groups[label[index]] || '')].slice(0, MAX_GENERATION_CONFUSABLES_PER_ASCII)) {
      const unicode = `${label.slice(0, index)}${substitution}${label.slice(index + 1)}`;
      const ascii = domainToASCII(`${unicode}.example`).replace(/\.example$/u, '');
      if (ascii.startsWith('xn--')) singleSubstitutionCandidates.add(ascii);
    }
  }
  const wholeLabelCandidates = new Set<string>();
  for (const [, expression] of WHOLE_LABEL_SCRIPT_TESTS) {
    let unicode = '';
    let complete = true;
    for (const character of label) {
      if (!/^[a-z]$/u.test(character)) {
        unicode += character;
        continue;
      }
      const substitution = [...(groups[character] || '')]
        .slice(0, MAX_GENERATION_CONFUSABLES_PER_ASCII)
        .find((candidate) => expression.test(candidate));
      if (!substitution) {
        complete = false;
        break;
      }
      unicode += substitution;
    }
    if (!complete) continue;
    const ascii = domainToASCII(`${unicode}.example`).replace(/\.example$/u, '');
    if (ascii.startsWith('xn--')) wholeLabelCandidates.add(ascii);
  }
  return Object.freeze({
    singleSubstitutionCandidates: singleSubstitutionCandidates.size,
    wholeLabelCandidates: wholeLabelCandidates.size,
    totalCandidates: new Set([...singleSubstitutionCandidates, ...wholeLabelCandidates]).size,
  });
}

function validateCheckedInProjection(): string[] {
  const failures: string[] = [];
  const skeletonEntries = Object.values(GENERATED_CONFUSABLE_GROUPS)
    .reduce((total, values) => total + [...values].length, 0);
  const generationEntries = Object.values(GENERATED_GENERATION_CONFUSABLE_GROUPS)
    .reduce((total, values) => total + [...values].length, 0);
  if (skeletonEntries > MAX_PROJECTED_CONFUSABLES) failures.push('The checked-in skeleton projection exceeds its total mapping limit.');
  if (skeletonEntries !== GENERATED_CONFUSABLE_STATS.projectedMappings) failures.push('The checked-in skeleton count does not match its metadata.');
  if (generationEntries !== GENERATED_CONFUSABLE_STATS.generationMappings) failures.push('The checked-in generation count does not match its metadata.');
  for (const [ascii, values] of Object.entries(GENERATED_CONFUSABLE_GROUPS)) {
    if (!/^[a-z]$/u.test(ascii) || [...values].length > MAX_SKELETON_CONFUSABLES_PER_ASCII) {
      failures.push(`Skeleton group ${ascii} violates its per-letter limit.`);
    }
  }
  for (const [ascii, values] of Object.entries(GENERATED_GENERATION_CONFUSABLE_GROUPS)) {
    if (!/^[a-z]$/u.test(ascii) || [...values].length > MAX_GENERATION_CONFUSABLES_PER_ASCII) {
      failures.push(`Generation group ${ascii} violates its per-letter limit.`);
      continue;
    }
    for (const substitution of values) {
      if (!GENERATED_CONFUSABLE_GROUPS[ascii]?.includes(substitution)) {
        failures.push(`Generation character U+${substitution.codePointAt(0)?.toString(16).toUpperCase()} is absent from skeleton group ${ascii}.`);
      }
      if (!domainToASCII(`${substitution}.example`).startsWith('xn--')) {
        failures.push(`Generation character U+${substitution.codePointAt(0)?.toString(16).toUpperCase()} is not an IDNA candidate.`);
      }
      if (skeletonWithConfusableGroups(substitution, GENERATED_CONFUSABLE_GROUPS) !== ascii) {
        failures.push(`Generation character U+${substitution.codePointAt(0)?.toString(16).toUpperCase()} does not round-trip to ${ascii}.`);
      }
    }
  }
  return failures.slice(0, 20);
}

export function buildUnicodeConfusableAudit(calibrationValue: unknown = CALIBRATION_CASES) {
  const cases = normalizeCalibrationCases(calibrationValue);
  const current = confusionFor(cases, REVIEWED_SKELETON_CONFUSABLES);
  const proposed = confusionFor(cases, GENERATED_CONFUSABLE_GROUPS);
  const seeds = CALIBRATION_SEEDS.slice(0, MAX_CALIBRATION_SEEDS).map((seed) => {
    const currentVolume = candidateCounts(seed, REVIEWED_GENERATION_CONFUSABLES);
    const proposedVolume = candidateCounts(seed, GENERATED_GENERATION_CONFUSABLE_GROUPS);
    return Object.freeze({
      seed,
      currentCandidates: currentVolume.totalCandidates,
      proposedCandidates: proposedVolume.totalCandidates,
      currentSingleSubstitutionCandidates: currentVolume.singleSubstitutionCandidates,
      proposedSingleSubstitutionCandidates: proposedVolume.singleSubstitutionCandidates,
      currentWholeLabelCandidates: currentVolume.wholeLabelCandidates,
      proposedWholeLabelCandidates: proposedVolume.wholeLabelCandidates,
      growthRatio: ratio(
        proposedVolume.totalCandidates - currentVolume.totalCandidates,
        currentVolume.totalCandidates,
      ),
    });
  });
  const currentCandidates = seeds.reduce((total, item) => total + item.currentCandidates, 0);
  const proposedCandidates = seeds.reduce((total, item) => total + item.proposedCandidates, 0);
  const totalGrowthRatio = ratio(proposedCandidates - currentCandidates, currentCandidates);
  const maximumSeedGrowthRatio = Math.max(...seeds.map((item) => item.growthRatio), 0);
  const projectionFailures = validateCheckedInProjection();
  const gates = Object.freeze({
    coverageImproved: proposed.truePositive > current.truePositive,
    noNewFalsePositives: proposed.falsePositive <= current.falsePositive,
    labelledPositiveCoverageComplete: proposed.falseNegative === 0,
    totalCandidateGrowthBounded: totalGrowthRatio <= MAX_TOTAL_CANDIDATE_GROWTH_RATIO,
    perSeedCandidateGrowthBounded: maximumSeedGrowthRatio <= MAX_SEED_CANDIDATE_GROWTH_RATIO,
    projectionBoundsValid: projectionFailures.length === 0,
  });
  return Object.freeze({
    schema: UNICODE_CONFUSABLE_AUDIT_SCHEMA,
    version: UNICODE_CONFUSABLE_AUDIT_VERSION,
    mappingVersion: GENERATED_CONFUSABLE_MAPPING_VERSION,
    status: Object.values(gates).every(Boolean) ? 'pass' : 'fail',
    source: GENERATED_CONFUSABLE_SOURCE,
    policy: GENERATED_CONFUSABLE_POLICY,
    projection: GENERATED_CONFUSABLE_STATS,
    calibration: Object.freeze({
      cases: cases.length,
      positiveCases: cases.filter((item) => item.expectedMatch).length,
      negativeCases: cases.filter((item) => !item.expectedMatch).length,
      current,
      proposed,
    }),
    candidateVolume: Object.freeze({
      seeds,
      currentCandidates,
      proposedCandidates,
      totalGrowthRatio,
      maximumSeedGrowthRatio,
      totalGrowthLimit: MAX_TOTAL_CANDIDATE_GROWTH_RATIO,
      perSeedGrowthLimit: MAX_SEED_CANDIDATE_GROWTH_RATIO,
    }),
    gates,
    failures: Object.freeze(projectionFailures),
  });
}

export function parseArguments(args: readonly string[]): AuditArguments {
  if (args.length > 4) throw new TypeError('Usage: npm run unicode:confusables [-- --source <path> [--write] [--json]]');
  let source: string | null = null;
  let write = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--source') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new TypeError('--source requires a file path.');
      source = value;
      index += 1;
    } else if (argument === '--write') {
      write = true;
    } else if (argument === '--json') {
      json = true;
    } else {
      throw new TypeError(`Unknown Unicode confusable audit option: ${argument}`);
    }
  }
  if (write && !source) throw new TypeError('--write requires --source.');
  return Object.freeze({ source, write, json });
}

async function readBoundedSource(filename: string): Promise<string> {
  const metadata = await stat(filename);
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_CONFUSABLE_SOURCE_BYTES) {
    throw new TypeError('Unicode confusables source is missing or exceeds the byte limit.');
  }
  return readFile(filename, 'utf8');
}

function checkedInProjectionShape() {
  return {
    mappingVersion: GENERATED_CONFUSABLE_MAPPING_VERSION,
    source: GENERATED_CONFUSABLE_SOURCE,
    policy: GENERATED_CONFUSABLE_POLICY,
    skeletonGroups: GENERATED_CONFUSABLE_GROUPS,
    generationGroups: GENERATED_GENERATION_CONFUSABLE_GROUPS,
    stats: GENERATED_CONFUSABLE_STATS,
  };
}

function formatAudit(report: ReturnType<typeof buildUnicodeConfusableAudit>, sourceCheck: string): string {
  return [
    'WHOISleuth Unicode confusable audit',
    `Status: ${report.status}`,
    `Mapping: ${report.mappingVersion}`,
    `Projection: ${report.projection.projectedMappings} skeleton mappings; ${report.projection.generationMappings} generation mappings`,
    `Calibration: ${report.calibration.current.truePositive} -> ${report.calibration.proposed.truePositive} true positives; ${report.calibration.proposed.falsePositive} false positives`,
    `Candidate volume: ${report.candidateVolume.currentCandidates} -> ${report.candidateVolume.proposedCandidates} (${Math.round(report.candidateVolume.totalGrowthRatio * 100)}% growth)`,
    `Largest seed growth: ${Math.round(report.candidateVolume.maximumSeedGrowthRatio * 100)}%`,
    `Pinned source: ${sourceCheck}`,
  ].join('\n');
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    const parsed = parseArguments(args);
    const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
    let sourceCheck = 'not supplied';
    if (parsed.source) {
      const source = await readBoundedSource(path.resolve(repositoryRoot, parsed.source));
      const projection = generateConfusableProjection(source);
      sourceCheck = isDeepStrictEqual(
        {
          mappingVersion: projection.mappingVersion,
          source: projection.source,
          policy: projection.policy,
          skeletonGroups: projection.skeletonGroups,
          generationGroups: projection.generationGroups,
          stats: projection.stats,
        },
        checkedInProjectionShape(),
      ) ? 'matches checked-in projection' : 'drift detected';
      if (parsed.write) {
        const outputPath = path.join(repositoryRoot, 'lib/generated/unicode-confusables-17.mts');
        await writeFile(outputPath, renderConfusableProjectionModule(projection), 'utf8');
        sourceCheck = 'wrote checked-in projection';
      }
    }
    const report = buildUnicodeConfusableAudit();
    stdout.write(parsed.json
      ? `${JSON.stringify({ ...report, sourceCheck }, null, 2)}\n`
      : `${formatAudit(report, sourceCheck)}\n`);
    return report.status === 'pass' && sourceCheck !== 'drift detected' ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Unicode confusable audit failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) process.exitCode = await main();

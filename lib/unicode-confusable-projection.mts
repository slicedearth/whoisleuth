import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

import {
  ACCEPTED_CONFUSABLE_SCRIPTS,
  CONFUSABLE_PROJECTION_SCHEMA,
  CONFUSABLE_PROJECTION_VERSION,
  MAX_CONFUSABLE_ASCII_TARGETS,
  MAX_CONFUSABLE_SOURCE_BYTES,
  MAX_CONFUSABLE_SOURCE_CODEPOINTS,
  MAX_CONFUSABLE_SOURCE_LINE_LENGTH,
  MAX_CONFUSABLE_SOURCE_LINES,
  MAX_CONFUSABLE_TARGET_CODEPOINTS,
  MAX_GENERATION_CONFUSABLES_PER_ASCII,
  MAX_PROJECTED_CONFUSABLES,
  MAX_SKELETON_CONFUSABLES_PER_ASCII,
  REVIEWED_GENERATION_CONFUSABLES,
  REVIEWED_SKELETON_CONFUSABLES,
  UNICODE_CONFUSABLE_DATA_VERSION,
  UNICODE_CONFUSABLE_LICENSE,
  UNICODE_CONFUSABLE_SOURCE_SHA256,
  UNICODE_CONFUSABLE_SOURCE_URL,
} from './idn-confusable-policy.mts';

type ConfusableScript = (typeof ACCEPTED_CONFUSABLE_SCRIPTS)[number];
type ParsedMapping = Readonly<{
  source: string;
  target: string;
  sourceCodePoint: number;
  script: ConfusableScript;
}>;
type ProjectionStats = Readonly<{
  sourceBytes: number;
  sourceLines: number;
  parsedMappings: number;
  eligibleMappings: number;
  projectedMappings: number;
  generationMappings: number;
  rejectedMalformedLines: number;
  rejectedOutsidePolicy: number;
  skeletonCapHits: number;
  generationCapHits: number;
}>;
export type ConfusableSourcePolicy = Readonly<{
  unicodeVersion: string;
  url: string;
  sha256: string;
  license: string;
  mappingVersion: string;
}>;
export type ConfusableProjection = Readonly<{
  schema: typeof CONFUSABLE_PROJECTION_SCHEMA;
  version: typeof CONFUSABLE_PROJECTION_VERSION;
  mappingVersion: string;
  source: Readonly<{
    standard: 'Unicode UTS #39';
    unicodeVersion: string;
    url: string;
    sha256: string;
    license: string;
  }>;
  policy: Readonly<{
    acceptedScripts: readonly ConfusableScript[];
    sourceCodePoints: number;
    skeletonPerAscii: number;
    generationPerAscii: number;
    totalMappings: number;
  }>;
  skeletonGroups: Readonly<Record<string, string>>;
  generationGroups: Readonly<Record<string, string>>;
  stats: ProjectionStats;
}>;

const ASCII_TARGETS = 'abcdefghijklmnopqrstuvwxyz';
const HEX_SEQUENCE_RE = /^[0-9A-F]{4,6}(?: [0-9A-F]{4,6})*$/u;
const VERSION_RE = /^# Version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/mu;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SOURCE_VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const SOURCE_URL_RE = /^https:\/\/[A-Za-z0-9./_-]{1,500}$/u;
const SOURCE_LABEL_RE = /^[A-Za-z0-9.+_-]{1,100}$/u;
const PINNED_SOURCE_POLICY: ConfusableSourcePolicy = Object.freeze({
  unicodeVersion: UNICODE_CONFUSABLE_DATA_VERSION,
  url: UNICODE_CONFUSABLE_SOURCE_URL,
  sha256: UNICODE_CONFUSABLE_SOURCE_SHA256,
  license: UNICODE_CONFUSABLE_LICENSE,
  mappingVersion: `tr39-${UNICODE_CONFUSABLE_DATA_VERSION}-bounded-ascii-v3`,
});
const SCRIPT_TESTS: ReadonlyArray<readonly [ConfusableScript, RegExp]> = Object.freeze([
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Coptic', /\p{Script=Coptic}/u],
  ['Deseret', /\p{Script=Deseret}/u],
  ['Lisu', /\p{Script=Lisu}/u],
]);

function codePoints(value: string): number[] {
  return value.split(' ').map((part) => Number.parseInt(part, 16));
}

function decodeSequence(value: string): string {
  return String.fromCodePoint(...codePoints(value));
}

function scriptFor(character: string): ConfusableScript | null {
  for (const [script, expression] of SCRIPT_TESTS) {
    if (expression.test(character)) return script;
  }
  return null;
}

function normalizeSource(source: string): string | null {
  const normalized = source.normalize('NFKD').toLowerCase();
  return [...normalized].length === 1 ? normalized : null;
}

function isIdnaGenerationCandidate(source: string): boolean {
  const ascii = domainToASCII(`${source}.example`);
  return ascii.startsWith('xn--') && ascii.endsWith('.example');
}

function addUnique(target: string[], values: string, maximum: number): number {
  let capHits = 0;
  for (const value of values) {
    if (target.includes(value)) continue;
    if (target.length >= maximum) {
      capHits += 1;
      continue;
    }
    target.push(value);
  }
  return capHits;
}

function officialSkeleton(value: string, mappings: ReadonlyMap<string, string>): string {
  let result = '';
  for (const character of value.normalize('NFD').toLowerCase()) {
    result += mappings.get(character) || character;
  }
  return result.normalize('NFD');
}

function stableMappingOrder(left: ParsedMapping, right: ParsedMapping): number {
  const scriptDifference = ACCEPTED_CONFUSABLE_SCRIPTS.indexOf(left.script)
    - ACCEPTED_CONFUSABLE_SCRIPTS.indexOf(right.script);
  return scriptDifference || left.sourceCodePoint - right.sourceCodePoint;
}

function immutableGroups(groups: Record<string, string>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value])));
}

export function generateConfusableProjection(sourceText: unknown): ConfusableProjection {
  return generateConfusableProjectionWithPolicy(sourceText, PINNED_SOURCE_POLICY);
}

export function generateConfusableProjectionWithPolicy(
  sourceText: unknown,
  sourcePolicy: ConfusableSourcePolicy,
): ConfusableProjection {
  if (
    !sourcePolicy
    || !SOURCE_VERSION_RE.test(sourcePolicy.unicodeVersion)
    || !SOURCE_URL_RE.test(sourcePolicy.url)
    || !SHA256_RE.test(sourcePolicy.sha256)
    || !SOURCE_LABEL_RE.test(sourcePolicy.license)
    || !SOURCE_LABEL_RE.test(sourcePolicy.mappingVersion)
  ) {
    throw new TypeError('Unicode confusables source policy is invalid.');
  }
  if (typeof sourceText !== 'string') throw new TypeError('Unicode confusables source must be text.');
  const sourceBytes = Buffer.byteLength(sourceText, 'utf8');
  if (sourceBytes === 0 || sourceBytes > MAX_CONFUSABLE_SOURCE_BYTES) {
    throw new TypeError('Unicode confusables source is empty or exceeds the byte limit.');
  }
  const sourceHash = createHash('sha256').update(sourceText, 'utf8').digest('hex');
  if (sourceHash !== sourcePolicy.sha256) {
    throw new TypeError('Unicode confusables source does not match the pinned SHA-256 digest.');
  }
  const declaredVersion = sourceText.match(VERSION_RE)?.[1];
  if (declaredVersion !== sourcePolicy.unicodeVersion) {
    throw new TypeError('Unicode confusables source does not declare the pinned Unicode version.');
  }

  const lines = sourceText.split(/\r?\n/u);
  if (lines.length > MAX_CONFUSABLE_SOURCE_LINES) {
    throw new TypeError('Unicode confusables source exceeds the line limit.');
  }

  const officialMappings = new Map<string, string>();
  const candidates: ParsedMapping[] = [];
  let parsedMappings = 0;
  let rejectedMalformedLines = 0;
  let rejectedOutsidePolicy = 0;

  for (const line of lines) {
    if (line.length > MAX_CONFUSABLE_SOURCE_LINE_LENGTH) {
      rejectedMalformedLines += 1;
      continue;
    }
    const data = line.split('#', 1)[0].trim();
    if (!data) continue;
    const fields = data.split(';').map((value) => value.trim());
    if (fields.length !== 3 || fields[2] !== 'MA' || !HEX_SEQUENCE_RE.test(fields[0]) || !HEX_SEQUENCE_RE.test(fields[1])) {
      rejectedMalformedLines += 1;
      continue;
    }
    const sourcePoints = codePoints(fields[0]);
    const targetPoints = codePoints(fields[1]);
    if (
      sourcePoints.some((point) => !Number.isInteger(point) || point < 0 || point > 0x10ffff)
      || targetPoints.some((point) => !Number.isInteger(point) || point < 0 || point > 0x10ffff)
      || sourcePoints.length > MAX_CONFUSABLE_SOURCE_CODEPOINTS
      || targetPoints.length > MAX_CONFUSABLE_TARGET_CODEPOINTS
    ) {
      rejectedOutsidePolicy += 1;
      continue;
    }
    const source = decodeSequence(fields[0]);
    const target = decodeSequence(fields[1]);
    officialMappings.set(source, target);
    parsedMappings += 1;
  }

  for (const [originalSource, target] of officialMappings) {
    const source = normalizeSource(originalSource);
    if (!source || source === target || !isIdnaGenerationCandidate(source)) {
      rejectedOutsidePolicy += 1;
      continue;
    }
    const script = scriptFor(source);
    const sourceCodePoint = source.codePointAt(0);
    if (!script || sourceCodePoint === undefined) {
      rejectedOutsidePolicy += 1;
      continue;
    }
    candidates.push(Object.freeze({ source, target, sourceCodePoint, script }));
  }

  const eligible = new Map<string, ParsedMapping[]>();
  for (const ascii of ASCII_TARGETS) eligible.set(ascii, []);
  for (const candidate of candidates) {
    for (const ascii of ASCII_TARGETS) {
      if (officialSkeleton(candidate.source, officialMappings) === officialSkeleton(ascii, officialMappings)) {
        eligible.get(ascii)?.push(candidate);
      }
    }
  }

  const skeletonGroups: Record<string, string> = {};
  const generationGroups: Record<string, string> = {};
  let skeletonCapHits = 0;
  let generationCapHits = 0;
  for (const ascii of ASCII_TARGETS) {
    const projectedSkeleton = [...(REVIEWED_SKELETON_CONFUSABLES[ascii] || '')];
    const projectedGeneration = [...(REVIEWED_GENERATION_CONFUSABLES[ascii] || '')];
    const additions = [...new Map(
      (eligible.get(ascii) || []).sort(stableMappingOrder).map((item) => [item.source, item]),
    ).values()];
    skeletonCapHits += addUnique(
      projectedSkeleton,
      additions.map((item) => item.source).join(''),
      MAX_SKELETON_CONFUSABLES_PER_ASCII,
    );
    generationCapHits += addUnique(
      projectedGeneration,
      additions.map((item) => item.source).join(''),
      MAX_GENERATION_CONFUSABLES_PER_ASCII,
    );
    if (projectedSkeleton.length) skeletonGroups[ascii] = projectedSkeleton.join('');
    if (projectedGeneration.length) generationGroups[ascii] = projectedGeneration.join('');
  }

  const projectedMappings = Object.values(skeletonGroups).reduce((total, value) => total + [...value].length, 0);
  const generationMappings = Object.values(generationGroups).reduce((total, value) => total + [...value].length, 0);
  if (
    Object.keys(skeletonGroups).length > MAX_CONFUSABLE_ASCII_TARGETS
    || projectedMappings > MAX_PROJECTED_CONFUSABLES
  ) {
    throw new TypeError('Generated Unicode confusable projection exceeded its policy bounds.');
  }

  return Object.freeze({
    schema: CONFUSABLE_PROJECTION_SCHEMA,
    version: CONFUSABLE_PROJECTION_VERSION,
    mappingVersion: sourcePolicy.mappingVersion,
    source: Object.freeze({
      standard: 'Unicode UTS #39',
      unicodeVersion: sourcePolicy.unicodeVersion,
      url: sourcePolicy.url,
      sha256: sourcePolicy.sha256,
      license: sourcePolicy.license,
    }),
    policy: Object.freeze({
      acceptedScripts: ACCEPTED_CONFUSABLE_SCRIPTS,
      sourceCodePoints: MAX_CONFUSABLE_SOURCE_CODEPOINTS,
      skeletonPerAscii: MAX_SKELETON_CONFUSABLES_PER_ASCII,
      generationPerAscii: MAX_GENERATION_CONFUSABLES_PER_ASCII,
      totalMappings: MAX_PROJECTED_CONFUSABLES,
    }),
    skeletonGroups: immutableGroups(skeletonGroups),
    generationGroups: immutableGroups(generationGroups),
    stats: Object.freeze({
      sourceBytes,
      sourceLines: lines.length,
      parsedMappings,
      eligibleMappings: [...eligible.values()].reduce((total, items) => total + items.length, 0),
      projectedMappings,
      generationMappings,
      rejectedMalformedLines,
      rejectedOutsidePolicy,
      skeletonCapHits,
      generationCapHits,
    }),
  });
}

function quoted(value: string): string {
  return JSON.stringify(value).replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
}

function renderGroups(name: string, groups: Readonly<Record<string, string>>): string {
  const entries = Object.entries(groups).map(([ascii, values]) => `  ${ascii}: ${quoted(values)},`);
  return `export const ${name}: Readonly<Record<string, string>> = Object.freeze({\n${entries.join('\n')}\n});`;
}

export function renderConfusableProjectionModule(projection: ConfusableProjection): string {
  return [
    '// Generated by tools/unicode-confusable-audit.mts from the pinned Unicode',
    '// UTS #39 data file. Do not edit this projection by hand.',
    '',
    `export const GENERATED_CONFUSABLE_MAPPING_VERSION = ${quoted(projection.mappingVersion)};`,
    `export const GENERATED_CONFUSABLE_SOURCE = Object.freeze(${JSON.stringify(projection.source, null, 2)});`,
    `export const GENERATED_CONFUSABLE_POLICY = Object.freeze(${JSON.stringify(projection.policy, null, 2)});`,
    `export const GENERATED_CONFUSABLE_STATS = Object.freeze(${JSON.stringify(projection.stats, null, 2)});`,
    '',
    renderGroups('GENERATED_CONFUSABLE_GROUPS', projection.skeletonGroups),
    '',
    renderGroups('GENERATED_GENERATION_CONFUSABLE_GROUPS', projection.generationGroups),
    '',
  ].join('\n');
}

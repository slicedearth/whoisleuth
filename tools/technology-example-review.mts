#!/usr/bin/env node

// Converts one bounded local HTML artefact from a reviewed reference source
// into a target-free technology fixture and a separate provenance record. The
// source artefact is read locally, never copied into output, and evaluated
// without making a network request.

import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TECHNOLOGY_REVIEWED_FIXTURES,
  TECHNOLOGY_REVIEW_INPUT_SCHEMA,
  TECHNOLOGY_REVIEW_INPUT_VERSION,
  MAX_TECHNOLOGY_REVIEW_IDS,
  type TechnologyReviewedFixture,
  type TechnologyReviewLicenceBasis,
} from '../fixtures/technology-reviewed-fixtures.mts';
import {
  TECHNOLOGY_REVIEWED_SOURCES,
  TECHNOLOGY_REVIEWED_SOURCE_SCHEMA,
  TECHNOLOGY_REVIEWED_SOURCE_VERSION,
  type TechnologyReviewedSource,
} from '../fixtures/technology-reviewed-sources.mts';
import { extractHtmlSignals } from '../lib/html-signals.mts';
import { normalizeBoundedSemanticVersion } from '../lib/semantic-version.mts';
import {
  PASSIVE_TECHNOLOGY_HEADER_NAMES,
  TECHNOLOGY_SIGNATURE_CATALOGUE,
} from '../lib/website-technology.mts';
import {
  buildReviewedTechnologyFixture,
  buildTechnologyNegativeReviewMarkup,
} from './technology-fixture-review.mts';
import { reconstructTechnologyReviewProfile } from './technology-review-candidate.mts';

export const TECHNOLOGY_EXAMPLE_REVIEW_SCHEMA = 'whoisleuth.technology-example-review';
export const TECHNOLOGY_EXAMPLE_REVIEW_VERSION = 5;
export const MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES = 512 * 1024;
export const MAX_TECHNOLOGY_EXAMPLE_CORPUS_ENTRIES = 96;

type WritableLike = { write(value: string): unknown };
type BuildRecipe = TechnologyReviewedSource['buildRecipe'];
type SourceKind = TechnologyReviewedSource['sourceKind'];
type ExampleReviewOptions = Readonly<{
  id: string;
  expectedIds: readonly string[];
  negativeFor: readonly string[];
  licenceBasis: TechnologyReviewLicenceBasis;
  sourceReference: string;
  sourceRevision: string;
  sourceIntegrity: string | null;
  sourceLicence: string;
  runtimeReference: string | null;
  buildRecipe: BuildRecipe;
  buildEnvironment: string | null;
  supportingEnvironments?: readonly string[];
  httpServer?: string | null;
  responseHeaders?: Readonly<Record<string, string>>;
  observedAt: string;
  reviewedAt: string;
}>;
type ExampleReviewArguments = ExampleReviewOptions & Readonly<{ inputPath: string }>;
type ExampleReviewCorpus = Readonly<{
  fixtures: readonly TechnologyReviewedFixture[];
  sources: readonly TechnologyReviewedSource[];
}>;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PACKAGE_REFERENCE_RE = /^npm:(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const REPOSITORY_REFERENCE_RE = /^git:[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u;
const CONTAINER_REFERENCE_RE = /^oci:(?:[a-z0-9.-]+\/)*[a-z0-9._-]+$/u;
const DEMONSTRATION_REFERENCE_RE = /^official:[a-z0-9][a-z0-9._/-]*$/u;
const EXACT_RUNTIME_VERSION_RE = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const REPOSITORY_REVISION_RE = /^[a-f0-9]{40}$/u;
const CONTAINER_TAG_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const CONTAINER_DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const PACKAGE_INTEGRITY_RE = /^sha512-[A-Za-z0-9+/]{80,96}={0,2}$/u;
const SPDX_RE = /^[A-Za-z0-9][A-Za-z0-9.+() -]{0,79}$/u;
const RUNTIME_RE = /^([a-z][a-z0-9._-]*)@(.+)$/u;
const OCI_BUILD_ENVIRONMENT_RE = /^oci:(?:[a-z0-9.-]+\/)*[a-z0-9._-]+:[a-z0-9._-]+@sha256:[a-f0-9]{64}$/u;
const MAX_SUPPORTING_ENVIRONMENTS = 4;
const PASSIVE_HEADERS = new Set<string>(PASSIVE_TECHNOLOGY_HEADER_NAMES);
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const REFERENCE_LICENCE_BASES = new Set<TechnologyReviewLicenceBasis>([
  'minimized-with-permission',
  'public-domain',
  'permissively-licensed-source',
  'copyleft-licensed-source',
  'official-demonstration-terms',
]);
const BUILD_RECIPES = new Set<BuildRecipe>([
  'official-default-starter',
  'official-documentation-example',
  'official-repository-build',
  'reviewed-repository-artifact',
  'official-container-default',
  'official-public-demonstration',
]);
const CATALOGUE_IDS = new Set(TECHNOLOGY_SIGNATURE_CATALOGUE.map((entry) => entry.id));

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || CONTROL_RE.test(value)) {
    throw new TypeError(`${label} must be control-free text no longer than ${maximum} characters.`);
  }
  return value.trim();
}

function timestamp(value: unknown, label: string): string {
  const parsed = Date.parse(boundedText(value, label, 64));
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid timestamp.`);
  return new Date(parsed).toISOString();
}

function technologyIds(values: readonly string[], label: string): string[] {
  if (values.length > MAX_TECHNOLOGY_REVIEW_IDS) {
    throw new TypeError(`${label} must contain at most ${MAX_TECHNOLOGY_REVIEW_IDS} entries.`);
  }
  const ids = [...new Set(values.map((value) => boundedText(value, label, 64).toLowerCase()))].sort();
  if (ids.some((id) => !CATALOGUE_IDS.has(id))) {
    throw new TypeError(`${label} must reference current catalogue entries.`);
  }
  return ids;
}

function sourceIdentity(options: ExampleReviewOptions): Readonly<{
  kind: SourceKind;
  reference: string;
  revision: string;
  integrity: string | null;
}> {
  const reference = boundedText(options.sourceReference, 'Source reference', 160).toLowerCase();
  const revision = boundedText(options.sourceRevision, 'Source revision', 80);
  if (PACKAGE_REFERENCE_RE.test(reference)) {
    const packageRevision = boundedText(
      normalizeBoundedSemanticVersion(options.sourceRevision, 'Package revision'),
      'Package revision',
      80,
    );
    if (typeof options.sourceIntegrity !== 'string' || !options.sourceIntegrity.trim()) {
      throw new TypeError('Package sources require a sha512 npm integrity value.');
    }
    const integrity = boundedText(options.sourceIntegrity, 'Package integrity', 160);
    if (!PACKAGE_INTEGRITY_RE.test(integrity)) throw new TypeError('Package sources require a sha512 npm integrity value.');
    return Object.freeze({ kind: 'package', reference, revision: packageRevision, integrity });
  }
  if (REPOSITORY_REFERENCE_RE.test(reference)) {
    if (!REPOSITORY_REVISION_RE.test(revision)) throw new TypeError('Repository sources require a full lowercase commit hash.');
    if (options.sourceIntegrity !== null) throw new TypeError('Repository provenance uses its commit hash and must not declare package integrity.');
    return Object.freeze({ kind: 'repository', reference, revision, integrity: null });
  }
  if (CONTAINER_REFERENCE_RE.test(reference)) {
    if (!CONTAINER_TAG_RE.test(revision)) throw new TypeError('Container sources require an explicit image tag.');
    if (typeof options.sourceIntegrity !== 'string' || !options.sourceIntegrity.trim()) {
      throw new TypeError('Container sources require a sha256 image digest.');
    }
    const integrity = boundedText(options.sourceIntegrity, 'Container digest', 80).toLowerCase();
    if (!CONTAINER_DIGEST_RE.test(integrity)) throw new TypeError('Container sources require a sha256 image digest.');
    return Object.freeze({ kind: 'container', reference, revision, integrity });
  }
  if (DEMONSTRATION_REFERENCE_RE.test(reference)) {
    if (!Number.isFinite(Date.parse(revision))) {
      throw new TypeError('Official demonstration revisions must be observation timestamps.');
    }
    if (options.sourceIntegrity !== null) {
      throw new TypeError('Official demonstration provenance uses artefact digests and must not declare source integrity.');
    }
    return Object.freeze({
      kind: 'demonstration',
      reference,
      revision: new Date(Date.parse(revision)).toISOString(),
      integrity: null,
    });
  }
  throw new TypeError('Source reference must be a target-free npm package, repository, OCI image, or official demonstration identifier.');
}

type ReviewedResponseMetadata = Readonly<{
  httpServer: string | null;
  responseHeaders: Readonly<Record<string, string>>;
}>;
type ResponseMetadataOptions = Pick<ExampleReviewOptions, 'httpServer' | 'responseHeaders'>;

function reviewedResponseMetadata(options: ResponseMetadataOptions): ReviewedResponseMetadata {
  const httpServer = options.httpServer === undefined || options.httpServer === null || options.httpServer === ''
    ? null
    : boundedText(options.httpServer, 'HTTP server value', 240);
  const rawHeaders = options.responseHeaders ?? {};
  const entries = Object.entries(rawHeaders);
  if (entries.length > PASSIVE_HEADERS.size) {
    throw new TypeError(`Response metadata must contain at most ${PASSIVE_HEADERS.size} recognised headers.`);
  }
  const responseHeaders: Record<string, string> = {};
  for (const [rawName, rawValue] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    const name = boundedText(rawName, 'Response header name', 80).toLowerCase();
    if (!PASSIVE_HEADERS.has(name)) throw new TypeError(`Response metadata does not support ${name}.`);
    responseHeaders[name] = boundedText(rawValue, `${name} response header`, 240);
  }
  return Object.freeze({
    httpServer,
    responseHeaders: Object.freeze(responseHeaders),
  });
}

function responseMetadataDigest(metadata: ReviewedResponseMetadata): string | null {
  if (metadata.httpServer === null && Object.keys(metadata.responseHeaders).length === 0) return null;
  return createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
}

export function technologyResponseMetadataDigest(options: ResponseMetadataOptions): string | null {
  return responseMetadataDigest(reviewedResponseMetadata(options));
}

export function technologyExampleArtifactDigest(html: string): string {
  return createHash('sha256').update(Buffer.from(html, 'utf8')).digest('hex');
}

function sourceOrigin(source: Pick<TechnologyReviewedSource, 'sourceKind' | 'sourceReference'>): string {
  return `${source.sourceKind}:${source.sourceReference}`;
}

function buildProvenanceContext(
  fixture: TechnologyReviewedFixture,
  provenance: TechnologyReviewedSource,
  corpus: ExampleReviewCorpus,
) {
  const sources = corpus.sources.slice(0, MAX_TECHNOLOGY_EXAMPLE_CORPUS_ENTRIES);
  const fixtures = corpus.fixtures
    .slice(0, MAX_TECHNOLOGY_EXAMPLE_CORPUS_ENTRIES)
    .filter((entry) => entry.id !== fixture.id);
  const sourceByFixtureId = new Map(sources.map((source) => [source.fixtureId, source]));
  const candidateOrigin = sourceOrigin(provenance);
  const originForFixture = (entry: TechnologyReviewedFixture): string => {
    const source = sourceByFixtureId.get(entry.id);
    return source ? sourceOrigin(source) : `unbound:${entry.licenseBasis}`;
  };
  const existingFixtureIdsAtSourceOrigin = fixtures
    .filter((entry) => originForFixture(entry) === candidateOrigin)
    .map((entry) => entry.id)
    .sort();
  const firstObservedExpectedIds: string[] = [];
  const independentSourceOriginExpectedIds: string[] = [];
  const repeatedSourceOriginExpectedIds: string[] = [];
  for (const id of fixture.expectedIds) {
    const existingOrigins = new Set(
      fixtures
        .filter((entry) => entry.expectedIds.includes(id))
        .map(originForFixture),
    );
    if (existingOrigins.size === 0) firstObservedExpectedIds.push(id);
    else if (existingOrigins.has(candidateOrigin)) repeatedSourceOriginExpectedIds.push(id);
    else independentSourceOriginExpectedIds.push(id);
  }
  return Object.freeze({
    comparisonExcludesCandidateFixtureId: true,
    existingFixtureIdsAtSourceOrigin: Object.freeze(existingFixtureIdsAtSourceOrigin),
    firstObservedExpectedIds: Object.freeze(firstObservedExpectedIds),
    independentSourceOriginExpectedIds: Object.freeze(independentSourceOriginExpectedIds),
    repeatedSourceOriginExpectedIds: Object.freeze(repeatedSourceOriginExpectedIds),
  });
}

function validateOptions(options: ExampleReviewOptions) {
  const id = boundedText(options.id, 'Fixture id', 80).toLowerCase();
  if (!ID_RE.test(id)) throw new TypeError('Fixture id must be a lowercase hyphenated identifier.');
  const expectedIds = technologyIds(options.expectedIds, 'Expected technology id');
  const negativeFor = technologyIds(options.negativeFor, 'Negative-control technology id');
  if (!expectedIds.length && !negativeFor.length) {
    throw new TypeError('Declare expected or negative-control technology ids.');
  }
  if (expectedIds.some((expected) => negativeFor.includes(expected))) {
    throw new TypeError('A technology id cannot be both expected and forbidden.');
  }
  if (!REFERENCE_LICENCE_BASES.has(options.licenceBasis)) {
    throw new TypeError('Reference builds require explicit permission, a reviewed source licence, or approved demonstration terms.');
  }
  const source = sourceIdentity(options);
  const sourceLicence = boundedText(options.sourceLicence, 'Source licence', 80);
  if (source.kind === 'demonstration') {
    if (sourceLicence !== 'official-demonstration-terms') {
      throw new TypeError('Official demonstrations must record the reviewed demonstration terms basis.');
    }
  } else {
    if (options.licenceBasis === 'official-demonstration-terms') {
      throw new TypeError('Official demonstration terms apply only to an official demonstration source.');
    }
    if (!SPDX_RE.test(sourceLicence)) throw new TypeError('Source licence must be a bounded licence identifier or expression.');
  }
  const runtimeReference = options.runtimeReference === null
    ? null
    : boundedText(options.runtimeReference, 'Runtime reference', 80).toLowerCase();
  const isRepositoryArtifact = options.buildRecipe === 'reviewed-repository-artifact';
  if (source.kind === 'demonstration') {
    if (options.licenceBasis !== 'official-demonstration-terms'
      || options.buildRecipe !== 'official-public-demonstration'
      || runtimeReference !== null) {
      throw new TypeError('Official demonstrations require reviewed demonstration terms, the demonstration recipe, and no inferred runtime version.');
    }
  } else if (isRepositoryArtifact) {
    if (source.kind !== 'repository' || runtimeReference !== null) {
      throw new TypeError('Reviewed repository artefacts require a repository source and no inferred runtime version.');
    }
  } else {
    const runtimeMatch = RUNTIME_RE.exec(runtimeReference ?? '');
    if (!runtimeMatch?.[1] || !runtimeMatch[2] || !EXACT_RUNTIME_VERSION_RE.test(runtimeMatch[2])) {
      throw new TypeError('Runtime reference must identify a runtime and exact three- or four-part version.');
    }
  }
  if (!BUILD_RECIPES.has(options.buildRecipe)) throw new TypeError('Build recipe is not supported.');
  const buildEnvironment = options.buildEnvironment === null
    ? null
    : boundedText(options.buildEnvironment, 'Build environment', 180).toLowerCase();
  if (buildEnvironment !== null && !OCI_BUILD_ENVIRONMENT_RE.test(buildEnvironment)) {
    throw new TypeError('Build environment must be an immutable OCI image reference with a sha256 digest.');
  }
  if (options.buildRecipe === 'official-container-default' && buildEnvironment === null) {
    throw new TypeError('Container builds require an immutable OCI build environment.');
  }
  if (isRepositoryArtifact && (buildEnvironment !== null || (options.supportingEnvironments?.length ?? 0) > 0)) {
    throw new TypeError('Reviewed repository artefacts must not claim an unobserved build environment.');
  }
  if (source.kind === 'container') {
    const sourceEnvironment = `${source.reference}:${source.revision}@${source.integrity}`;
    if (options.buildRecipe !== 'official-container-default' || buildEnvironment !== sourceEnvironment) {
      throw new TypeError('Container sources must use the same immutable image as their build environment.');
    }
  }
  if (source.kind === 'demonstration' && (buildEnvironment !== null || (options.supportingEnvironments?.length ?? 0) > 0)) {
    throw new TypeError('Official demonstrations must not claim local build environments.');
  }
  const supportingEnvironments = [...new Set((options.supportingEnvironments ?? []).map((value) => (
    boundedText(value, 'Supporting environment', 180).toLowerCase()
  )))].sort();
  if (supportingEnvironments.length > MAX_SUPPORTING_ENVIRONMENTS
    || supportingEnvironments.some((value) => !OCI_BUILD_ENVIRONMENT_RE.test(value))) {
    throw new TypeError(`Supporting environments must contain at most ${MAX_SUPPORTING_ENVIRONMENTS} immutable OCI image references.`);
  }
  const responseMetadata = reviewedResponseMetadata(options);
  const observedAt = timestamp(options.observedAt, 'Observation time');
  const reviewedAt = timestamp(options.reviewedAt, 'Review time');
  if (Date.parse(observedAt) > Date.parse(reviewedAt)) throw new TypeError('Observation time must not follow review time.');
  return Object.freeze({
    id,
    expectedIds: Object.freeze(expectedIds),
    negativeFor: Object.freeze(negativeFor),
    source,
    sourceLicence,
    runtimeReference,
    buildEnvironment,
    supportingEnvironments: Object.freeze(supportingEnvironments),
    responseMetadata,
    observedAt,
    reviewedAt,
  });
}

export function buildTechnologyExampleReview(
  html: string,
  options: ExampleReviewOptions,
  corpus: ExampleReviewCorpus = {
    fixtures: TECHNOLOGY_REVIEWED_FIXTURES,
    sources: TECHNOLOGY_REVIEWED_SOURCES,
  },
) {
  const checked = validateOptions(options);
  const artifactBytes = Buffer.from(html, 'utf8');
  if (!artifactBytes.byteLength || artifactBytes.byteLength > MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES) {
    throw new TypeError(`Reference HTML must be between 1 byte and ${MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES} bytes.`);
  }
  const signals = extractHtmlSignals(html, 'fixture.invalid', {
    baseUrl: 'https://fixture.invalid/',
    httpServer: checked.responseMetadata.httpServer,
    responseHeaders: checked.responseMetadata.responseHeaders,
    observedAt: checked.observedAt,
    sourceTruncated: false,
  });
  const profile = signals.technologyProfile;
  let reviewInput: Record<string, unknown>;
  if (checked.expectedIds.length) {
    const reconstructed = reconstructTechnologyReviewProfile(profile, checked.expectedIds);
    reviewInput = {
      schema: TECHNOLOGY_REVIEW_INPUT_SCHEMA,
      version: TECHNOLOGY_REVIEW_INPUT_VERSION,
      id: checked.id,
      reviewedAt: checked.reviewedAt,
      observedAt: reconstructed.observedAt,
      licenseBasis: options.licenceBasis,
      expectedIds: reconstructed.expectedIds,
      negativeFor: checked.negativeFor,
      input: reconstructed.input,
    };
  } else {
    if (!profile || profile.status !== 'success' || profile.complete !== true || profile.truncated === true) {
      throw new TypeError('Negative controls require complete, successful technology evidence.');
    }
    if (profile.findings.length > 0) {
      throw new TypeError(`Negative control unexpectedly detected: ${profile.findings.map((finding) => finding.id).sort().join(', ')}.`);
    }
    reviewInput = {
      schema: TECHNOLOGY_REVIEW_INPUT_SCHEMA,
      version: TECHNOLOGY_REVIEW_INPUT_VERSION,
      id: checked.id,
      reviewedAt: checked.reviewedAt,
      observedAt: checked.observedAt,
      licenseBasis: options.licenceBasis,
      expectedIds: [],
      negativeFor: checked.negativeFor,
      input: { html: buildTechnologyNegativeReviewMarkup(checked.negativeFor) },
    };
  }
  const fixture = buildReviewedTechnologyFixture(reviewInput);
  const provenance: TechnologyReviewedSource = Object.freeze({
    schema: TECHNOLOGY_REVIEWED_SOURCE_SCHEMA,
    version: TECHNOLOGY_REVIEWED_SOURCE_VERSION,
    fixtureId: fixture.id,
    sourceKind: checked.source.kind,
    sourceReference: checked.source.reference,
    sourceRevision: checked.source.revision,
    sourceIntegrity: checked.source.integrity,
    sourceLicence: checked.sourceLicence,
    licenceReviewedAt: checked.reviewedAt,
    runtimeReference: checked.runtimeReference,
    buildRecipe: options.buildRecipe,
    buildEnvironment: checked.buildEnvironment,
    supportingEnvironments: checked.supportingEnvironments,
    artifactSha256: technologyExampleArtifactDigest(html),
    responseMetadataSha256: responseMetadataDigest(checked.responseMetadata),
    derivation: checked.source.kind === 'demonstration'
      ? 'reviewed-public-demonstration'
      : options.buildRecipe === 'reviewed-repository-artifact'
        ? 'reviewed-repository-artifact'
        : 'offline-local-build',
    networkRequestsDuringFixtureEvaluation: 0,
    rawArtifactIncluded: false,
  });
  return Object.freeze({
    schema: TECHNOLOGY_EXAMPLE_REVIEW_SCHEMA,
    version: TECHNOLOGY_EXAMPLE_REVIEW_VERSION,
    fixture,
    provenance,
    provenanceContext: buildProvenanceContext(fixture, provenance, corpus),
  });
}

export function parseArguments(args: readonly string[]): ExampleReviewArguments {
  const [inputPath, ...flags] = args;
  if (!inputPath || inputPath.startsWith('-')) {
    throw new TypeError('Usage: node tools/technology-example-review.mts PAGE.html --id=ID (--expected=ID[,ID] | --negative-for=ID[,ID]) --licence-basis=BASIS --source-reference=REF --source-revision=REVISION [--source-integrity=DIGEST] --source-licence=SPDX [--runtime-reference=RUNTIME@VERSION] --build-recipe=RECIPE [--build-environment=OCI@SHA256] [--supporting-environment=OCI@SHA256 ...] [--http-server=VALUE] [--response-header=NAME:VALUE] --observed-at=TIMESTAMP --reviewed-at=TIMESTAMP');
  }
  const values = new Map<string, string>();
  const supportingEnvironments: string[] = [];
  for (const flag of flags) {
    const match = /^--([a-z-]+)=(.*)$/u.exec(flag);
    if (!match?.[1]) throw new TypeError(`Invalid or repeated option: ${flag}`);
    if (match[1] === 'supporting-environment') {
      supportingEnvironments.push(match[2] ?? '');
      continue;
    }
    if (values.has(match[1])) throw new TypeError(`Invalid or repeated option: ${flag}`);
    values.set(match[1], match[2] ?? '');
  }
  const allowed = new Set([
    'id', 'expected', 'negative-for', 'licence-basis', 'source-reference',
    'source-revision', 'source-integrity', 'source-licence', 'runtime-reference',
    'build-recipe', 'build-environment', 'supporting-environment', 'http-server',
    'response-header', 'observed-at', 'reviewed-at',
  ]);
  const unknown = [...values.keys()].filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`Unknown option: --${unknown[0]}`);
  const responseHeader = values.get('response-header');
  const responseHeaders: Record<string, string> = {};
  if (responseHeader !== undefined) {
    const separator = responseHeader.indexOf(':');
    if (separator <= 0 || separator === responseHeader.length - 1) {
      throw new TypeError('Response header must use NAME:VALUE format.');
    }
    responseHeaders[responseHeader.slice(0, separator)] = responseHeader.slice(separator + 1);
  }
  return {
    inputPath,
    id: values.get('id') ?? '',
    expectedIds: (values.get('expected') ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    negativeFor: (values.get('negative-for') ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    licenceBasis: values.get('licence-basis') as TechnologyReviewLicenceBasis,
    sourceReference: values.get('source-reference') ?? '',
    sourceRevision: values.get('source-revision') ?? '',
    sourceIntegrity: values.has('source-integrity') ? values.get('source-integrity') ?? '' : null,
    sourceLicence: values.get('source-licence') ?? '',
    runtimeReference: values.has('runtime-reference') ? values.get('runtime-reference') ?? '' : null,
    buildRecipe: values.get('build-recipe') as BuildRecipe,
    buildEnvironment: values.has('build-environment') ? values.get('build-environment') ?? '' : null,
    supportingEnvironments,
    httpServer: values.has('http-server') ? values.get('http-server') ?? '' : null,
    responseHeaders,
    observedAt: values.get('observed-at') ?? '',
    reviewedAt: values.get('reviewed-at') ?? '',
  };
}

async function readBoundedHtml(inputPath: string): Promise<string> {
  const handle = await open(inputPath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (!bytesRead || bytesRead > MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES) {
      throw new TypeError(`Reference HTML must be between 1 byte and ${MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES} bytes.`);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
    } catch {
      throw new TypeError('Reference HTML must use valid UTF-8 encoding.');
    }
  } finally {
    await handle.close();
  }
}

export async function main(
  args = process.argv.slice(2),
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
): Promise<number> {
  try {
    const { inputPath, ...options } = parseArguments(args);
    const html = await readBoundedHtml(inputPath);
    output.write(`${JSON.stringify(buildTechnologyExampleReview(html, options), null, 2)}\n`);
    return 0;
  } catch (error) {
    errors.write(`${error instanceof Error ? error.message : 'Technology example review failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

export type { ExampleReviewArguments, ExampleReviewCorpus, ExampleReviewOptions };

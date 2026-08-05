#!/usr/bin/env node

// Deterministic, offline quality gate for the curated technology-signature
// catalogue. Reports contain only fixture identifiers and aggregate metrics;
// the synthetic HTML and other signature inputs are never copied into output.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_EVIDENCE_PER_TECHNOLOGY,
  MAX_TECHNOLOGY_EVIDENCE_DESCRIPTION_LENGTH,
  TECHNOLOGY_SIGNATURE_CATALOGUE,
  analyzeWebsiteTechnology,
} from '../lib/website-technology.mts';
import {
  TECHNOLOGY_SIGNATURE_FIXTURE_SCHEMA,
  TECHNOLOGY_SIGNATURE_FIXTURE_VERSION,
  TECHNOLOGY_SIGNATURE_FIXTURES,
} from '../fixtures/technology-signature-fixtures.mts';
import {
  TECHNOLOGY_REVIEWED_FIXTURE_SCHEMA,
  TECHNOLOGY_REVIEWED_FIXTURE_VERSION,
  TECHNOLOGY_REVIEWED_FIXTURES,
  TECHNOLOGY_REVIEW_LICENCE_BASES,
} from '../fixtures/technology-reviewed-fixtures.mts';

type WritableLike = { write(value: string): unknown };
type BenchmarkOptions = Readonly<{ now?: () => Date }>;
type BenchmarkMainOptions = BenchmarkOptions & Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;
type BenchmarkArguments = Readonly<{
  json: boolean;
  requireReviewed: boolean;
}>;
type UnknownRecord = Record<string, unknown>;
type FixtureResult = Readonly<{
  id: string;
  label: string;
  kind: string;
  status: 'pass' | 'fail';
  expectedIds: readonly string[];
  observedIds: readonly string[];
  missingIds: readonly string[];
  unexpectedIds: readonly string[];
  forbiddenObservedIds: readonly string[];
  expectedProfileStatus: string;
  observedProfileStatus: string;
}>;

export const TECHNOLOGY_SIGNATURE_BENCHMARK_SCHEMA = 'whoisleuth.technology-signature-benchmark';
export const TECHNOLOGY_SIGNATURE_BENCHMARK_VERSION = 3;
export const MAX_TECHNOLOGY_BENCHMARK_SIGNATURES = 64;
export const MAX_TECHNOLOGY_BENCHMARK_FIXTURES = 96;
export const MAX_TECHNOLOGY_REVIEWED_BENCHMARK_FIXTURES = 96;
export const MAX_TECHNOLOGY_BENCHMARK_IDS_PER_FIXTURE = 64;
export const MAX_TECHNOLOGY_BENCHMARK_LINT_ERRORS = 100;
export const MAX_TECHNOLOGY_BENCHMARK_LABEL_LENGTH = 120;
export const TECHNOLOGY_REVIEW_FRESHNESS_DAYS = 365;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const CATEGORIES = new Set([
  'application runtime',
  'content management',
  'commerce',
  'site builder',
  'web framework',
  'static site generator',
  'web server',
  'delivery platform',
]);
const CONFIDENCE_LEVELS = new Set(['high', 'medium']);
const EVIDENCE_SOURCES = new Set([
  'generator metadata',
  'static HTML',
  'resource origin',
  'HTTP server header',
  'passive response header',
]);
const FIXTURE_KINDS = new Set(['positive', 'negative', 'overlap', 'mixed', 'truncation']);

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.slice(0, MAX_TECHNOLOGY_BENCHMARK_IDS_PER_FIXTURE).filter((item): item is string => typeof item === 'string')
    : [];
}

function boundedText(value: unknown, fallback: string, maximum = MAX_TECHNOLOGY_BENCHMARK_LABEL_LENGTH): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return (normalized || fallback).slice(0, maximum);
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new TypeError('Technology benchmark generation time must be valid.');
  return new Date(parsed).toISOString();
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

export function lintTechnologySignatureBenchmark(
  rawCatalogue: readonly unknown[],
  rawFixtures: readonly unknown[],
): string[] {
  const errors: string[] = [];
  const add = (message: string) => {
    if (errors.length < MAX_TECHNOLOGY_BENCHMARK_LINT_ERRORS) errors.push(boundedText(message, 'Invalid benchmark contract.'));
  };
  if (rawCatalogue.length > MAX_TECHNOLOGY_BENCHMARK_SIGNATURES) {
    add(`Catalogue exceeds the ${MAX_TECHNOLOGY_BENCHMARK_SIGNATURES}-signature bound.`);
  }
  if (rawFixtures.length > MAX_TECHNOLOGY_BENCHMARK_FIXTURES) {
    add(`Fixture corpus exceeds the ${MAX_TECHNOLOGY_BENCHMARK_FIXTURES}-fixture bound.`);
  }

  const catalogue = rawCatalogue.slice(0, MAX_TECHNOLOGY_BENCHMARK_SIGNATURES).map(record);
  const fixtures = rawFixtures.slice(0, MAX_TECHNOLOGY_BENCHMARK_FIXTURES).map(record);
  const catalogueIds = new Set<string>();
  for (const signature of catalogue) {
    const id = typeof signature.id === 'string' ? signature.id : '';
    if (!ID_RE.test(id)) add(`Catalogue signature has an invalid id: ${id || '(missing)'}.`);
    else if (catalogueIds.has(id)) add(`Catalogue contains duplicate signature id: ${id}.`);
    else catalogueIds.add(id);
    if (typeof signature.name !== 'string' || !signature.name.trim() || signature.name.length > 120 || CONTROL_RE.test(signature.name)) {
      add(`${id || '(missing)'} has an invalid fixed name.`);
    }
    if (!CATEGORIES.has(String(signature.category))) add(`${id || '(missing)'} has an invalid category.`);
    if (![1, 2].includes(Number(signature.minimumEvidenceMatches))) add(`${id || '(missing)'} has an invalid evidence threshold.`);
    if (typeof signature.requiresNonResourceEvidence !== 'boolean') add(`${id || '(missing)'} has an invalid resource-evidence policy.`);
    const evidence = Array.isArray(signature.evidence) ? signature.evidence : [];
    if (evidence.length === 0) add(`${id || '(missing)'} has no evidence rules.`);
    if (evidence.length > MAX_EVIDENCE_PER_TECHNOLOGY) {
      add(`${id || '(missing)'} exceeds the ${MAX_EVIDENCE_PER_TECHNOLOGY}-evidence bound.`);
    }
    if (Number(signature.minimumEvidenceMatches) > evidence.length) add(`${id || '(missing)'} requires more evidence than it declares.`);
    let hasNonResourceEvidence = false;
    for (const rawEvidence of evidence.slice(0, MAX_EVIDENCE_PER_TECHNOLOGY + 1)) {
      const item = record(rawEvidence);
      if (!EVIDENCE_SOURCES.has(String(item.source))) add(`${id || '(missing)'} has an invalid evidence source.`);
      if (!CONFIDENCE_LEVELS.has(String(item.confidence))) add(`${id || '(missing)'} has an invalid confidence.`);
      if (item.source !== 'resource origin') hasNonResourceEvidence = true;
      if (
        typeof item.description !== 'string'
        || !item.description.trim()
        || item.description.length > MAX_TECHNOLOGY_EVIDENCE_DESCRIPTION_LENGTH
        || CONTROL_RE.test(item.description)
      ) add(`${id || '(missing)'} has an invalid or uncapped fixed explanation.`);
    }
    if (signature.requiresNonResourceEvidence === true && !hasNonResourceEvidence) {
      add(`${id || '(missing)'} requires non-resource evidence but declares none.`);
    }
  }

  const fixtureIds = new Set<string>();
  const positiveCoverage = new Set<string>();
  const negativeCoverage = new Set<string>();
  for (const fixture of fixtures) {
    const id = typeof fixture.id === 'string' ? fixture.id : '';
    if (!ID_RE.test(id)) add(`Fixture has an invalid id: ${id || '(missing)'}.`);
    else if (fixtureIds.has(id)) add(`Fixture corpus contains duplicate id: ${id}.`);
    else fixtureIds.add(id);
    if (
      typeof fixture.label !== 'string'
      || !fixture.label.trim()
      || fixture.label.length > MAX_TECHNOLOGY_BENCHMARK_LABEL_LENGTH
      || CONTROL_RE.test(fixture.label)
    ) add(`${id || '(missing)'} has an invalid label.`);
    if (!FIXTURE_KINDS.has(String(fixture.kind))) add(`${id || '(missing)'} has an invalid fixture kind.`);
    if (fixture.expectedStatus !== undefined && !['success', 'partial'].includes(String(fixture.expectedStatus))) {
      add(`${id || '(missing)'} has an invalid expected profile status.`);
    }
    for (const key of ['expectedIds', 'positiveFor', 'negativeFor'] as const) {
      if (!Array.isArray(fixture[key])) add(`${id || '(missing)'} is missing ${key}.`);
      else if (fixture[key].length > MAX_TECHNOLOGY_BENCHMARK_IDS_PER_FIXTURE) {
        add(`${id || '(missing)'} exceeds the ${key} bound.`);
      }
    }
    const expected = new Set(stringArray(fixture.expectedIds));
    const positiveFor = stringArray(fixture.positiveFor);
    const negativeFor = stringArray(fixture.negativeFor);
    for (const referencedId of [...expected, ...positiveFor, ...negativeFor]) {
      if (!catalogueIds.has(referencedId)) add(`${id || '(missing)'} references unknown signature ${referencedId}.`);
    }
    for (const signatureId of positiveFor) {
      if (!expected.has(signatureId)) add(`${id || '(missing)'} marks ${signatureId} positive without expecting it.`);
      positiveCoverage.add(signatureId);
    }
    for (const signatureId of negativeFor) {
      if (expected.has(signatureId)) add(`${id || '(missing)'} both expects and forbids ${signatureId}.`);
      negativeCoverage.add(signatureId);
    }
  }
  for (const id of catalogueIds) {
    if (!positiveCoverage.has(id)) add(`${id} has no positive fixture.`);
    if (!negativeCoverage.has(id)) add(`${id} has no negative fixture.`);
  }
  return errors;
}

function evaluateFixture(rawFixture: unknown): FixtureResult {
  const fixture = record(rawFixture);
  const expectedIds = stringArray(fixture.expectedIds).sort();
  const expected = new Set(expectedIds);
  const forbidden = new Set(stringArray(fixture.negativeFor));
  const result = analyzeWebsiteTechnology(record(fixture.input));
  const observedIds = result.findings.map((finding) => finding.id).sort();
  const observed = new Set(observedIds);
  const missingIds = expectedIds.filter((id) => !observed.has(id));
  const unexpectedIds = observedIds.filter((id) => !expected.has(id));
  const forbiddenObservedIds = observedIds.filter((id) => forbidden.has(id));
  const expectedProfileStatus = typeof fixture.expectedStatus === 'string' ? fixture.expectedStatus : 'success';
  return Object.freeze({
    id: boundedText(fixture.id, 'invalid-fixture'),
    label: boundedText(fixture.label, 'Unnamed fixture'),
    kind: boundedText(fixture.kind, 'unknown', 24),
    status: missingIds.length === 0
      && unexpectedIds.length === 0
      && forbiddenObservedIds.length === 0
      && result.status === expectedProfileStatus
      ? 'pass'
      : 'fail',
    expectedIds: Object.freeze(expectedIds),
    observedIds: Object.freeze(observedIds),
    missingIds: Object.freeze(missingIds),
    unexpectedIds: Object.freeze(unexpectedIds),
    forbiddenObservedIds: Object.freeze(forbiddenObservedIds),
    expectedProfileStatus,
    observedProfileStatus: result.status,
  });
}

export function buildTechnologySignatureBenchmark(options: BenchmarkOptions = {}) {
  const lintErrors = lintTechnologySignatureBenchmark(
    TECHNOLOGY_SIGNATURE_CATALOGUE,
    TECHNOLOGY_SIGNATURE_FIXTURES,
  );
  const fixtures = Object.freeze(
    TECHNOLOGY_SIGNATURE_FIXTURES.slice(0, MAX_TECHNOLOGY_BENCHMARK_FIXTURES).map(evaluateFixture),
  );
  if (TECHNOLOGY_REVIEWED_FIXTURES.length > MAX_TECHNOLOGY_REVIEWED_BENCHMARK_FIXTURES) {
    lintErrors.push(
      `Reviewed corpus exceeds the ${MAX_TECHNOLOGY_REVIEWED_BENCHMARK_FIXTURES}-fixture bound.`,
    );
  }
  const reviewedFixtures = Object.freeze(
    TECHNOLOGY_REVIEWED_FIXTURES
      .slice(0, MAX_TECHNOLOGY_REVIEWED_BENCHMARK_FIXTURES)
      .map((fixture) => evaluateFixture({
        id: fixture.id,
        label: fixture.label,
        kind: fixture.kind,
        expectedIds: fixture.expectedIds,
        negativeFor: fixture.negativeFor,
        expectedStatus: 'success',
        input: fixture.input,
      })),
  );
  const catalogueById = new Map(TECHNOLOGY_SIGNATURE_CATALOGUE.map((signature) => [signature.id, signature]));
  const categoryNames = [...CATEGORIES].sort();
  const byCategory = Object.freeze(Object.fromEntries(categoryNames.map((category) => {
    const signatureIds = new Set(
      TECHNOLOGY_SIGNATURE_CATALOGUE.filter((signature) => signature.category === category).map((signature) => signature.id),
    );
    const expectedMatches = fixtures.flatMap((fixture) => fixture.expectedIds).filter((id) => signatureIds.has(id)).length;
    const observedMatches = fixtures.flatMap((fixture) => fixture.observedIds).filter((id) => signatureIds.has(id)).length;
    const missedMatches = fixtures.flatMap((fixture) => fixture.missingIds).filter((id) => signatureIds.has(id)).length;
    const unexpectedMatches = fixtures.flatMap((fixture) => fixture.unexpectedIds).filter((id) => signatureIds.has(id)).length;
    const deliberateNonmatches = TECHNOLOGY_SIGNATURE_FIXTURES
      .flatMap((fixture) => fixture.negativeFor)
      .filter((id) => signatureIds.has(id)).length;
    const overlapExpectedMatches = fixtures
      .filter((fixture) => fixture.kind === 'overlap')
      .flatMap((fixture) => fixture.expectedIds)
      .filter((id) => signatureIds.has(id)).length;
    const falsePositiveMatches = fixtures
      .flatMap((fixture) => [...new Set([...fixture.unexpectedIds, ...fixture.forbiddenObservedIds])])
      .filter((id) => signatureIds.has(id)).length;
    return [category, Object.freeze({
      signatures: signatureIds.size,
      evidenceRules: TECHNOLOGY_SIGNATURE_CATALOGUE
        .filter((signature) => signature.category === category)
        .reduce((sum, signature) => sum + signature.evidence.length, 0),
      expectedMatches,
      observedMatches,
      missedMatches,
      unexpectedMatches,
      deliberateNonmatches,
      overlapExpectedMatches,
      collisionMatches: unexpectedMatches,
      falsePositiveMatches,
      collisionRate: ratio(unexpectedMatches, observedMatches),
      falsePositiveRate: ratio(falsePositiveMatches, deliberateNonmatches),
    })];
  })));
  const expectedMatches = fixtures.reduce((sum, fixture) => sum + fixture.expectedIds.length, 0);
  const observedMatches = fixtures.reduce((sum, fixture) => sum + fixture.observedIds.length, 0);
  const missedMatches = fixtures.reduce((sum, fixture) => sum + fixture.missingIds.length, 0);
  const unexpectedMatches = fixtures.reduce((sum, fixture) => sum + fixture.unexpectedIds.length, 0);
  const deliberateNonmatches = TECHNOLOGY_SIGNATURE_FIXTURES.reduce(
    (sum, fixture) => sum + fixture.negativeFor.length,
    0,
  );
  const falsePositiveMatches = fixtures
    .reduce((sum, fixture) => sum + new Set([
      ...fixture.unexpectedIds,
      ...fixture.forbiddenObservedIds,
    ]).size, 0);
  const failedFixtures = fixtures.filter((fixture) => fixture.status === 'fail').length;
  const failedReviewedFixtures = reviewedFixtures.filter((fixture) => fixture.status === 'fail').length;
  const passingReviewedFixtureIds = new Set(
    reviewedFixtures.filter((fixture) => fixture.status === 'pass').map((fixture) => fixture.id),
  );
  const passingReviewedFixtures = TECHNOLOGY_REVIEWED_FIXTURES.filter((fixture) => (
    passingReviewedFixtureIds.has(fixture.id)
  ));
  const passingReviewedPositiveFixtures = passingReviewedFixtures.filter((fixture) => fixture.kind !== 'negative');
  const reviewedSignatureIds = new Set(passingReviewedPositiveFixtures.flatMap((fixture) => fixture.expectedIds));
  const reviewedSignatureCoverage = TECHNOLOGY_SIGNATURE_CATALOGUE
    .filter((signature) => reviewedSignatureIds.has(signature.id))
    .length;
  const reviewedEvidenceRuleIds = new Set<string>();
  for (const fixture of passingReviewedPositiveFixtures) {
    for (const finding of analyzeWebsiteTechnology(fixture.input).findings) {
      const signature = catalogueById.get(finding.id);
      if (!signature) continue;
      for (const evidence of finding.evidence) {
        const index = signature.evidence.findIndex((candidate) => (
          candidate.source === evidence.source && candidate.description === evidence.description
        ));
        if (index >= 0) reviewedEvidenceRuleIds.add(`${finding.id}:${index + 1}`);
      }
    }
  }
  const totalEvidenceRules = TECHNOLOGY_SIGNATURE_CATALOGUE.reduce(
    (sum, signature) => sum + signature.evidence.length,
    0,
  );
  const generatedAt = timestamp(options.now?.() || new Date());
  const generatedAtMs = Date.parse(generatedAt);
  const reviewedFixtureAges = TECHNOLOGY_REVIEWED_FIXTURES.map((fixture) => ({
    id: fixture.id,
    ageDays: Math.max(0, Math.floor((generatedAtMs - Date.parse(fixture.reviewedAt)) / 86_400_000)),
  }));
  const reviewedStaleFixtureIds = reviewedFixtureAges
    .filter((fixture) => fixture.ageDays > TECHNOLOGY_REVIEW_FRESHNESS_DAYS)
    .map((fixture) => fixture.id)
    .sort();
  const reviewedUnsampledSignatureIds = TECHNOLOGY_SIGNATURE_CATALOGUE
    .map((signature) => signature.id)
    .filter((id) => !reviewedSignatureIds.has(id))
    .sort();
  const reviewedBySignature = Object.freeze(Object.fromEntries(
    TECHNOLOGY_SIGNATURE_CATALOGUE.map((signature) => {
      const observations = passingReviewedPositiveFixtures.filter((fixture) => fixture.expectedIds.includes(signature.id)).length;
      const sampledEvidenceRules = signature.evidence.filter((_evidence, index) => (
        reviewedEvidenceRuleIds.has(`${signature.id}:${index + 1}`)
      )).length;
      return [signature.id, Object.freeze({
        observations,
        repeated: observations >= 2,
        evidenceRules: signature.evidence.length,
        sampledEvidenceRules,
        evidenceCoverage: ratio(sampledEvidenceRules, signature.evidence.length),
      })];
    }),
  ));
  const reviewedRepeatCoverage = Object.values(reviewedBySignature).filter((entry) => entry.repeated).length;
  const reviewedUnderRepeatedSignatureIds = Object.entries(reviewedBySignature)
    .filter(([, entry]) => entry.observations < 2)
    .map(([id]) => id)
    .sort();
  const reviewedUnsampledEvidenceRuleIds = TECHNOLOGY_SIGNATURE_CATALOGUE.flatMap((signature) => (
    signature.evidence.flatMap((_evidence, index) => {
      const id = `${signature.id}:${index + 1}`;
      return reviewedEvidenceRuleIds.has(id) ? [] : [id];
    })
  ));
  const reviewedLicenseBases = Object.freeze(Object.fromEntries(
    TECHNOLOGY_REVIEW_LICENCE_BASES.map((licenseBasis) => [
      licenseBasis,
      TECHNOLOGY_REVIEWED_FIXTURES.filter((fixture) => fixture.licenseBasis === licenseBasis).length,
    ]),
  ));
  const reviewedByCategory = Object.freeze(Object.fromEntries(categoryNames.map((category) => {
    const categorySignatures = TECHNOLOGY_SIGNATURE_CATALOGUE.filter((signature) => signature.category === category);
    const sampled = categorySignatures.filter((signature) => reviewedSignatureIds.has(signature.id)).length;
    return [category, Object.freeze({
      signatures: categorySignatures.length,
      sampled,
      coverage: ratio(sampled, categorySignatures.length),
    })];
  })));
  const reviewedTiers = Object.freeze({
    initial: passingReviewedPositiveFixtures.length > 0 && failedReviewedFixtures === 0,
    catalogueSampled: reviewedSignatureCoverage === TECHNOLOGY_SIGNATURE_CATALOGUE.length
      && failedReviewedFixtures === 0,
    repeatSampled: reviewedSignatureCoverage === TECHNOLOGY_SIGNATURE_CATALOGUE.length
      && reviewedRepeatCoverage === TECHNOLOGY_SIGNATURE_CATALOGUE.length
      && failedReviewedFixtures === 0,
    evidenceCovered: reviewedSignatureCoverage === TECHNOLOGY_SIGNATURE_CATALOGUE.length
      && reviewedRepeatCoverage === TECHNOLOGY_SIGNATURE_CATALOGUE.length
      && reviewedEvidenceRuleIds.size === totalEvidenceRules
      && failedReviewedFixtures === 0,
    current: reviewedSignatureCoverage === TECHNOLOGY_SIGNATURE_CATALOGUE.length
      && reviewedRepeatCoverage === TECHNOLOGY_SIGNATURE_CATALOGUE.length
      && reviewedEvidenceRuleIds.size === totalEvidenceRules
      && reviewedStaleFixtureIds.length === 0
      && failedReviewedFixtures === 0,
  });
  const reviewedMaturity = reviewedTiers.current ? 'current'
    : reviewedTiers.evidenceCovered ? 'evidence-covered'
      : reviewedTiers.repeatSampled ? 'repeat-sampled'
        : reviewedTiers.catalogueSampled ? 'catalogue-sampled'
          : reviewedTiers.initial ? 'initial'
            : 'empty';
  const reviewedDeliberateNonmatches = TECHNOLOGY_REVIEWED_FIXTURES.reduce(
    (sum, fixture) => sum + fixture.negativeFor.length,
    0,
  );
  const reviewedFalsePositiveMatches = reviewedFixtures.reduce((sum, fixture) => sum + new Set([
    ...fixture.unexpectedIds,
    ...fixture.forbiddenObservedIds,
  ]).size, 0);
  const unknownObservedIds = fixtures
    .flatMap((fixture) => fixture.observedIds)
    .filter((id) => !catalogueById.has(id));
  return Object.freeze({
    schema: TECHNOLOGY_SIGNATURE_BENCHMARK_SCHEMA,
    version: TECHNOLOGY_SIGNATURE_BENCHMARK_VERSION,
    generatedAt,
    mode: 'offline_fixture_corpora',
    fixtureSource: Object.freeze({
      schema: TECHNOLOGY_SIGNATURE_FIXTURE_SCHEMA,
      version: TECHNOLOGY_SIGNATURE_FIXTURE_VERSION,
    }),
    reviewedFixtureSource: Object.freeze({
      schema: TECHNOLOGY_REVIEWED_FIXTURE_SCHEMA,
      version: TECHNOLOGY_REVIEWED_FIXTURE_VERSION,
    }),
    summary: Object.freeze({
      signatures: TECHNOLOGY_SIGNATURE_CATALOGUE.length,
      fixtures: fixtures.length,
      passedFixtures: fixtures.length - failedFixtures,
      failedFixtures,
      reviewedFixtures: reviewedFixtures.length,
      passedReviewedFixtures: reviewedFixtures.length - failedReviewedFixtures,
      failedReviewedFixtures,
      reviewedNegativeFixtures: reviewedFixtures.filter((fixture) => fixture.kind === 'negative').length,
      passedReviewedNegativeFixtures: reviewedFixtures.filter((fixture) => (
        fixture.kind === 'negative' && fixture.status === 'pass'
      )).length,
      reviewedMixedFixtures: reviewedFixtures.filter((fixture) => fixture.kind === 'mixed').length,
      passedReviewedMixedFixtures: reviewedFixtures.filter((fixture) => (
        fixture.kind === 'mixed' && fixture.status === 'pass'
      )).length,
      reviewedDeliberateNonmatches,
      reviewedFalsePositiveMatches,
      reviewedSignatureCoverage,
      reviewedRepeatCoverage,
      reviewedEvidenceRuleCoverage: reviewedEvidenceRuleIds.size,
      lintErrors: lintErrors.length,
      ready: failedFixtures === 0
        && failedReviewedFixtures === 0
        && lintErrors.length === 0,
    }),
    metrics: Object.freeze({
      expectedMatches,
      observedMatches,
      missedMatches,
      unexpectedMatches,
      falsePositiveMatches,
      deliberateNonmatches,
      positiveCoverage: TECHNOLOGY_SIGNATURE_CATALOGUE.filter((signature) => (
        TECHNOLOGY_SIGNATURE_FIXTURES.some((fixture) => fixture.positiveFor.includes(signature.id))
      )).length,
      negativeCoverage: TECHNOLOGY_SIGNATURE_CATALOGUE.filter((signature) => (
        TECHNOLOGY_SIGNATURE_FIXTURES.some((fixture) => fixture.negativeFor.includes(signature.id))
      )).length,
      overlapFixtures: fixtures.filter((fixture) => fixture.kind === 'overlap').length,
      overlapFixturesPassed: fixtures.filter((fixture) => fixture.kind === 'overlap' && fixture.status === 'pass').length,
      collisionRate: ratio(unexpectedMatches, observedMatches),
      falsePositiveRate: ratio(falsePositiveMatches, deliberateNonmatches),
      byCategory,
    }),
    reviewedProgramme: Object.freeze({
      freshnessDays: TECHNOLOGY_REVIEW_FRESHNESS_DAYS,
      staleFixtureIds: Object.freeze(reviewedStaleFixtureIds),
      unsampledSignatureIds: Object.freeze(reviewedUnsampledSignatureIds),
      underRepeatedSignatureIds: Object.freeze(reviewedUnderRepeatedSignatureIds),
      unsampledEvidenceRuleIds: Object.freeze(reviewedUnsampledEvidenceRuleIds),
      maturity: reviewedMaturity,
      tiers: reviewedTiers,
      totalEvidenceRules,
      sampledEvidenceRules: reviewedEvidenceRuleIds.size,
      licenseBases: reviewedLicenseBases,
      byCategory: reviewedByCategory,
      bySignature: reviewedBySignature,
      nextAction: reviewedUnsampledSignatureIds.length
        ? 'Add contributor-reviewed, minimised, licensed observations for unsampled signatures; do not use live test requests.'
        : reviewedUnderRepeatedSignatureIds.length
          ? 'Add a second separately reviewed observation for each under-sampled signature.'
          : reviewedUnsampledEvidenceRuleIds.length
            ? 'Add reviewed observations that exercise the remaining catalogue evidence rules.'
            : reviewedStaleFixtureIds.length
              ? 'Re-review stale minimised fixtures before relying on the corpus for current coverage claims.'
              : 'Maintain the current reviewed corpus and investigate any benchmark regression before expanding signatures.',
    }),
    bounds: Object.freeze({
      signatureLimit: MAX_TECHNOLOGY_BENCHMARK_SIGNATURES,
      fixtureLimit: MAX_TECHNOLOGY_BENCHMARK_FIXTURES,
      reviewedFixtureLimit: MAX_TECHNOLOGY_REVIEWED_BENCHMARK_FIXTURES,
      idsPerFixture: MAX_TECHNOLOGY_BENCHMARK_IDS_PER_FIXTURE,
      evidencePerSignature: MAX_EVIDENCE_PER_TECHNOLOGY,
      fixedExplanationCharacters: MAX_TECHNOLOGY_EVIDENCE_DESCRIPTION_LENGTH,
      networkRequests: 0,
    }),
    lintErrors: Object.freeze(lintErrors),
    unknownObservedIds: Object.freeze(unknownObservedIds),
    fixtures,
    reviewedFixtures,
    limitations: Object.freeze([
      'The synthetic corpus is an offline regression and calibration set, not a live technology-coverage measurement.',
      reviewedFixtures.length
        ? 'The reviewed corpus contains minimised contributor-reviewed observations. Its maturity tiers separately measure catalogue sampling, repeat observations, evidence-rule sampling, and review freshness; none establishes general accuracy on the wider web.'
        : 'The contributor-reviewed corpus is empty, so this report makes no claim about real-world technology coverage.',
      'A matched signature is an implementation clue from the selected response, not proof of ownership, safety, maliciousness, support status, or exploitability.',
      'Unmatched and truncated evidence remains inconclusive because technologies can be concealed, rendered by scripts, proxied, or absent from the captured prefix.',
      'The benchmark evaluates only the curated signature profile; the separate pinned browser-library advisory catalogue has its own tests and source-health contract.',
    ]),
  });
}

export function formatTechnologySignatureBenchmark(
  report: ReturnType<typeof buildTechnologySignatureBenchmark>,
): string {
  if (
    report.schema !== TECHNOLOGY_SIGNATURE_BENCHMARK_SCHEMA
    || report.version !== TECHNOLOGY_SIGNATURE_BENCHMARK_VERSION
  ) throw new TypeError('Technology-signature output requires the current benchmark contract.');
  const lines = [
    'WHOISleuth technology-signature benchmark',
    `Summary: ${report.summary.passedFixtures}/${report.summary.fixtures} fixtures passed; ${report.summary.lintErrors} catalogue lint errors`,
    `Reviewed observations: ${report.summary.passedReviewedFixtures}/${report.summary.reviewedFixtures} passed; ${report.summary.reviewedSignatureCoverage}/${report.summary.signatures} signatures sampled`,
    `Reviewed negative controls: ${report.summary.passedReviewedNegativeFixtures}/${report.summary.reviewedNegativeFixtures} passed`,
    `Reviewed mixed controls: ${report.summary.passedReviewedMixedFixtures}/${report.summary.reviewedMixedFixtures} passed; ${report.summary.reviewedFalsePositiveMatches}/${report.summary.reviewedDeliberateNonmatches} false positives`,
    `Reviewed corpus maturity: ${report.reviewedProgramme.maturity}`,
    `Repeat sampling: ${report.summary.reviewedRepeatCoverage}/${report.summary.signatures} signatures; evidence rules: ${report.reviewedProgramme.sampledEvidenceRules}/${report.reviewedProgramme.totalEvidenceRules}`,
    `Reviewed freshness: ${report.reviewedProgramme.staleFixtureIds.length} stale; ${report.reviewedProgramme.unsampledSignatureIds.length} unsampled signatures`,
    `Coverage: ${report.metrics.positiveCoverage}/${report.summary.signatures} positive; ${report.metrics.negativeCoverage}/${report.summary.signatures} negative`,
    `Matches: ${report.metrics.expectedMatches} expected; ${report.metrics.missedMatches} missed; ${report.metrics.unexpectedMatches} unexpected`,
    `False-positive controls: ${report.metrics.falsePositiveMatches}/${report.metrics.deliberateNonmatches}`,
    `Mode: ${report.mode}; network requests: ${report.bounds.networkRequests}`,
  ];
  for (const fixture of report.fixtures.filter((item) => item.status === 'fail')) {
    lines.push(
      `FAIL ${fixture.label}`,
      `  Missing: ${fixture.missingIds.join(', ') || 'none'}`,
      `  Unexpected: ${fixture.unexpectedIds.join(', ') || 'none'}`,
      `  Forbidden: ${fixture.forbiddenObservedIds.join(', ') || 'none'}`,
      `  Status: expected ${fixture.expectedProfileStatus}; observed ${fixture.observedProfileStatus}`,
    );
  }
  for (const fixture of report.reviewedFixtures.filter((item) => item.status === 'fail')) {
    lines.push(
      `REVIEWED FAIL ${fixture.label}`,
      `  Missing: ${fixture.missingIds.join(', ') || 'none'}`,
      `  Unexpected: ${fixture.unexpectedIds.join(', ') || 'none'}`,
      `  Status: expected ${fixture.expectedProfileStatus}; observed ${fixture.observedProfileStatus}`,
    );
  }
  for (const error of report.lintErrors) lines.push(`LINT ${error}`);
  lines.push('Use --json for per-category metrics, fixture results, bounds, and limitations.');
  return `${lines.join('\n')}\n`;
}

export function parseArguments(args: readonly string[]): BenchmarkArguments {
  let json = false;
  let requireReviewed = false;
  for (const arg of args) {
    if (arg === '--json') {
      if (json) throw new TypeError('--json may be supplied only once.');
      json = true;
    } else if (arg === '--require-reviewed') {
      if (requireReviewed) throw new TypeError('--require-reviewed may be supplied only once.');
      requireReviewed = true;
    } else throw new TypeError(`Unknown option: ${arg}`);
  }
  return { json, requireReviewed };
}

export function main(args = process.argv.slice(2), options: BenchmarkMainOptions = {}): number {
  try {
    const { json, requireReviewed } = parseArguments(args);
    const report = buildTechnologySignatureBenchmark(options);
    (options.stdout || process.stdout).write(
      json ? `${JSON.stringify(report, null, 2)}\n` : formatTechnologySignatureBenchmark(report),
    );
    return report.summary.ready
      && (!requireReviewed || report.reviewedProgramme.tiers.current)
      ? 0
      : 1;
  } catch (error) {
    (options.stderr || process.stderr).write(
      `${boundedText(error instanceof Error ? error.message : error, 'Technology-signature benchmark failed.')}\n`,
    );
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

export type { BenchmarkMainOptions, BenchmarkOptions, FixtureResult };

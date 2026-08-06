import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { describe, test } from 'node:test';

import {
  TECHNOLOGY_SIGNATURE_FIXTURES,
} from '../fixtures/technology-signature-fixtures.mts';
import { TECHNOLOGY_REVIEWED_FIXTURES } from '../fixtures/technology-reviewed-fixtures.mts';
import {
  MAX_EVIDENCE_PER_TECHNOLOGY,
  TECHNOLOGY_SIGNATURE_CATALOGUE,
} from '../lib/website-technology.mts';
import {
  TECHNOLOGY_SIGNATURE_BENCHMARK_SCHEMA,
  TECHNOLOGY_SIGNATURE_BENCHMARK_VERSION,
  buildTechnologySignatureBenchmark,
  formatTechnologySignatureBenchmark,
  lintTechnologySignatureBenchmark,
  main,
  parseArguments,
} from '../tools/technology-signature-benchmark.mts';

const GENERATED_AT = '2026-08-05T01:00:00.000Z';

function capture() {
  let value = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        value += chunk.toString();
        callback();
      },
    }),
    value: () => value,
  };
}

describe('technology signature benchmark', () => {
  test('passes the complete bounded fixture corpus with per-category metrics', () => {
    const report = buildTechnologySignatureBenchmark({ now: () => new Date(GENERATED_AT) });
    assert.equal(report.schema, TECHNOLOGY_SIGNATURE_BENCHMARK_SCHEMA);
    assert.equal(report.version, TECHNOLOGY_SIGNATURE_BENCHMARK_VERSION);
    assert.equal(report.generatedAt, GENERATED_AT);
    assert.equal(report.mode, 'offline_fixture_corpora');
    assert.equal(report.summary.signatures, TECHNOLOGY_SIGNATURE_CATALOGUE.length);
    assert.equal(report.summary.fixtures, TECHNOLOGY_SIGNATURE_FIXTURES.length);
    assert.equal(report.summary.passedFixtures, report.summary.fixtures);
    assert.equal(report.summary.failedFixtures, 0);
    assert.equal(report.summary.lintErrors, 0);
    assert.equal(report.summary.ready, true);
    assert.equal(report.summary.reviewedFixtures, TECHNOLOGY_REVIEWED_FIXTURES.length);
    assert.equal(report.summary.failedReviewedFixtures, 0);
    assert.equal(report.summary.reviewedSignatureCoverage, 42);
    assert.equal(report.summary.reviewedRepeatCoverage, 19);
    assert.equal(report.summary.reviewedIndependentRepeatCoverage, 19);
    assert.equal(report.summary.reviewedEvidenceRuleCoverage, 54);
    assert.equal(report.summary.reviewedNegativeFixtures, 2);
    assert.equal(report.summary.passedReviewedNegativeFixtures, 2);
    assert.equal(report.summary.reviewedMixedFixtures, 43);
    assert.equal(report.summary.passedReviewedMixedFixtures, 43);
    assert.equal(report.summary.reviewedDeliberateNonmatches, 149);
    assert.equal(report.summary.reviewedFalsePositiveMatches, 0);
    assert.equal(report.metrics.positiveCoverage, report.summary.signatures);
    assert.equal(report.metrics.negativeCoverage, report.summary.signatures);
    assert.equal(report.metrics.missedMatches, 0);
    assert.equal(report.metrics.unexpectedMatches, 0);
    assert.equal(report.metrics.falsePositiveMatches, 0);
    assert.equal(report.metrics.collisionRate, 0);
    assert.equal(report.metrics.falsePositiveRate, 0);
    assert.equal(report.bounds.networkRequests, 0);
    assert.ok(report.bounds.reviewedFixtureLimit > 0);
    assert.equal(report.reviewedFixtures.length, TECHNOLOGY_REVIEWED_FIXTURES.length);
    assert.equal(report.reviewedProgramme.staleFixtureIds.length, 0);
    assert.equal(report.reviewedProgramme.unsampledSignatureIds.length, 0);
    assert.equal(report.reviewedProgramme.underRepeatedSignatureIds.length, report.summary.signatures - 19);
    assert.equal(report.reviewedProgramme.underIndependentRepeatSignatureIds.length, report.summary.signatures - 19);
    assert.equal(report.reviewedProgramme.maturity, 'catalogue-sampled');
    assert.deepEqual(report.reviewedProgramme.tiers, {
      initial: true,
      catalogueSampled: true,
      repeatSampled: false,
      evidenceCovered: false,
      current: false,
    });
    assert.equal(report.reviewedProgramme.sampledEvidenceRules, 54);
    assert.ok(report.reviewedProgramme.totalEvidenceRules > report.reviewedProgramme.sampledEvidenceRules);
    const reviewedSvelteKit = report.reviewedProgramme.bySignature.sveltekit;
    assert.ok(reviewedSvelteKit);
    assert.equal(reviewedSvelteKit.observations, 1);
    assert.equal(reviewedSvelteKit.independentOrigins, 1);
    assert.equal(reviewedSvelteKit.independentlyRepeated, false);
    assert.equal(reviewedSvelteKit.sampledEvidenceRules, 1);
    assert.equal(report.reviewedProgramme.licenseBases['factual-observation'], 1);
    assert.equal(report.reviewedProgramme.licenseBases['public-domain'], 2);
    assert.equal(report.reviewedProgramme.licenseBases['permissively-licensed-source'], 35);
    assert.equal(report.reviewedProgramme.licenseBases['copyleft-licensed-source'], 14);
    assert.equal(report.reviewedProgramme.licenseBases['official-demonstration-terms'], 1);
    assert.equal(report.reviewedProgramme.licenseBases['minimized-with-permission'], 1);
    assert.equal(
      Object.values(report.reviewedProgramme.byCategory).reduce((sum, category) => sum + category.signatures, 0),
      report.summary.signatures,
    );
    assert.match(report.reviewedProgramme.nextAction, /second reviewed observation/u);
    assert.equal(
      Object.values(report.metrics.byCategory).reduce((sum, category) => sum + category.signatures, 0),
      report.summary.signatures,
    );
    assert.ok(Object.values(report.metrics.byCategory).every((category) => category.signatures > 0));
    assert.ok(Object.values(report.metrics.byCategory).every((category) => category.deliberateNonmatches > 0));
    assert.ok(Object.values(report.metrics.byCategory).every((category) => category.collisionMatches === 0));
    assert.ok(Object.values(report.metrics.byCategory).every((category) => category.falsePositiveMatches === 0));
    assert.ok(report.fixtures.some((fixture) => fixture.kind === 'overlap'));
    assert.ok(report.fixtures.some((fixture) => fixture.kind === 'truncation'));
    assert.ok(report.fixtures.every((fixture) => fixture.status === 'pass'));
  });

  test('does not copy synthetic HTML, headers, origins, or generator strings into output', () => {
    const report = buildTechnologySignatureBenchmark({ now: () => new Date(GENERATED_AT) });
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /__NEXT_DATA__|data-mage-init|wixstatic|private-build|WordPress 7\.1/);
    assert.doesNotMatch(serialized, /"resourceOrigins"|"responseHeaders"|"httpServer"|"generator"|"html"|fixture-input/);
    assert.doesNotMatch(serialized, /(?:npm|git|oci|official):/u);
  });

  test('catalogue lint rejects duplicate ids, missing fixtures, invalid confidence, and uncapped evidence', () => {
    const first = TECHNOLOGY_SIGNATURE_CATALOGUE[0];
    assert.ok(first);
    assert.ok(lintTechnologySignatureBenchmark(
      [first, structuredClone(first)],
      TECHNOLOGY_SIGNATURE_FIXTURES,
    ).some((error) => /duplicate signature id/.test(error)));

    assert.ok(lintTechnologySignatureBenchmark(
      TECHNOLOGY_SIGNATURE_CATALOGUE,
      TECHNOLOGY_SIGNATURE_FIXTURES.filter((fixture) => !fixture.positiveFor.includes(first.id)),
    ).some((error) => new RegExp(`${first.id} has no positive fixture`).test(error)));

    const invalidConfidence = {
      ...structuredClone(first),
      evidence: [{ ...structuredClone(first.evidence[0]), confidence: 'unknown' }],
    };
    assert.ok(lintTechnologySignatureBenchmark(
      [invalidConfidence, ...TECHNOLOGY_SIGNATURE_CATALOGUE.slice(1)],
      TECHNOLOGY_SIGNATURE_FIXTURES,
    ).some((error) => /invalid confidence/.test(error)));

    const uncappedEvidence = {
      ...structuredClone(first),
      evidence: Array.from({ length: MAX_EVIDENCE_PER_TECHNOLOGY + 1 }, () => structuredClone(first.evidence[0])),
    };
    assert.ok(lintTechnologySignatureBenchmark(
      [uncappedEvidence, ...TECHNOLOGY_SIGNATURE_CATALOGUE.slice(1)],
      TECHNOLOGY_SIGNATURE_FIXTURES,
    ).some((error) => /exceeds the .*evidence bound/.test(error)));
  });

  test('formats concise output and supports a bounded JSON CLI mode', () => {
    const report = buildTechnologySignatureBenchmark({ now: () => new Date(GENERATED_AT) });
    const output = formatTechnologySignatureBenchmark(report);
    assert.match(output, /technology-signature benchmark/i);
    assert.match(output, /fixtures passed/);
    assert.match(output, /42\/42 signatures sampled/);
    assert.match(output, /Reviewed negative controls: 2\/2 passed/);
    assert.match(output, /Reviewed mixed controls: 43\/43 passed/);
    assert.match(output, /Reviewed false-positive controls: 0\/149/);
    assert.match(output, /Reviewed corpus maturity: catalogue-sampled/);
    assert.match(output, /Repeat sampling: 19\/\d+ signatures; independent origins: 19\/\d+; evidence rules: 54\/\d+/);
    assert.match(output, /network requests: 0/);
    assert.deepEqual(parseArguments([]), { json: false, requireReviewed: false });
    assert.deepEqual(parseArguments(['--json']), { json: true, requireReviewed: false });
    assert.deepEqual(parseArguments(['--require-reviewed']), { json: false, requireReviewed: true });
    assert.throws(() => parseArguments(['--json', '--json']), /only once/);
    assert.throws(
      () => parseArguments(['--require-reviewed', '--require-reviewed']),
      /only once/,
    );
    assert.throws(() => parseArguments(['--unknown']), /Unknown option/);

    const stdout = capture();
    const stderr = capture();
    assert.equal(main(['--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => new Date(GENERATED_AT),
    }), 0);
    assert.equal(JSON.parse(stdout.value()).summary.ready, true);
    assert.equal(stderr.value(), '');

    const coverageStdout = capture();
    assert.equal(main(['--require-reviewed'], {
      stdout: coverageStdout.stream,
      stderr: stderr.stream,
      now: () => new Date(GENERATED_AT),
    }), 1);
    assert.match(coverageStdout.value(), /Reviewed corpus maturity: catalogue-sampled/);
  });
});

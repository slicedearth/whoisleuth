import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  REVIEWED_ACCURACY_INTAKE_SCHEMA,
  REVIEWED_ACCURACY_INTAKE_VERSION,
  buildReviewedAccuracyScaffold,
  main as scaffoldMain,
} from '../tools/reviewed-accuracy-scaffold.mts';
import {
  MINIMUM_LIMITED_CASES,
  MINIMUM_LIMITED_CASES_PER_CLASS,
  MINIMUM_MEASURED_CASES,
  MINIMUM_MEASURED_CASES_PER_CLASS,
  REVIEWED_ACCURACY_STATUS_SCHEMA,
  REVIEWED_ACCURACY_STATUS_VERSION,
  buildReviewedAccuracyStatus,
  main as statusMain,
} from '../tools/reviewed-accuracy-status.mts';

function writer() {
  let value = '';
  return { stream: { write(chunk: string) { value += chunk; } }, read: () => value };
}

describe('reviewed accuracy programme tooling', () => {
  test('reports every corpus without converting an empty corpus into an accuracy claim', () => {
    const report = buildReviewedAccuracyStatus(new Date('2026-08-04T00:00:00.000Z'));
    assert.equal(report.schema, REVIEWED_ACCURACY_STATUS_SCHEMA);
    assert.equal(report.version, REVIEWED_ACCURACY_STATUS_VERSION);
    assert.deepEqual(report.thresholds, {
      limited: { total: MINIMUM_LIMITED_CASES, perClass: MINIMUM_LIMITED_CASES_PER_CLASS },
      measured: { total: MINIMUM_MEASURED_CASES, perClass: MINIMUM_MEASURED_CASES_PER_CLASS },
    });
    assert.deepEqual(report.corpora.map((corpus) => corpus.key), [
      'lookalike-analysis',
      'page-similarity',
      'technology-detection',
      'service-deprovision-cues',
      'certificate-grouping',
    ]);
    const technology = report.corpora.find((corpus) => corpus.key === 'technology-detection');
    assert.ok(technology);
    assert.equal(technology.readiness, 'limited');
    assert.equal(technology.reviewedPositiveCases, 27);
    assert.equal(technology.reviewedBenignCases, 1);
    assert.ok(report.corpora.filter((corpus) => corpus.key !== 'technology-detection')
      .every((corpus) => corpus.readiness === 'unproven'));
    assert.equal(report.summary.limited, 1);
    assert.equal(report.summary.unproven, 4);
    assert.match(report.limitation, /do not establish general accuracy/iu);
  });

  test('emits a reserved, privacy-reviewed intake scaffold rather than captured evidence', () => {
    const scaffold = JSON.parse(buildReviewedAccuracyScaffold('page-similarity', 'reviewed-page-collision')) as Record<string, unknown>;
    assert.equal(scaffold.schema, REVIEWED_ACCURACY_INTAKE_SCHEMA);
    assert.equal(scaffold.version, REVIEWED_ACCURACY_INTAKE_VERSION);
    assert.equal(scaffold.category, 'page-similarity');
    assert.equal(scaffold.id, 'reviewed-page-collision');
    assert.match(JSON.stringify(scaffold), /fixture\.example\.invalid/u);
    assert.doesNotMatch(JSON.stringify(scaffold), /https?:\/\//iu);
    assert.doesNotMatch(JSON.stringify(scaffold), /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
  });

  test('rejects unsupported categories, unsafe ids, and unknown arguments', async () => {
    assert.throws(() => buildReviewedAccuracyScaffold('other', 'fixture'), /Category/iu);
    assert.throws(() => buildReviewedAccuracyScaffold('technology-detection', '../fixture'), /Fixture id/iu);
    const output = writer();
    const errors = writer();
    assert.equal(await scaffoldMain(['--category', 'page-similarity', '--unknown', 'fixture'], {
      stdout: output.stream,
      stderr: errors.stream,
    }), 2);
    assert.equal(output.read(), '');
    assert.match(errors.read(), /Unknown option/iu);
  });

  test('supports bounded human and JSON status output', async () => {
    const human = writer();
    assert.equal(await statusMain([], { stdout: human.stream }), 0);
    assert.match(human.read(), /Reviewed accuracy status/iu);
    assert.match(human.read(), /Technology detection: limited \(28 reviewed cases\)/iu);
    const json = writer();
    assert.equal(await statusMain(['--json'], { stdout: json.stream }), 0);
    assert.equal((JSON.parse(json.read()) as { schema: string }).schema, REVIEWED_ACCURACY_STATUS_SCHEMA);
    const errors = writer();
    assert.equal(await statusMain(['--json', '--json'], { stderr: errors.stream }), 2);
    assert.match(errors.read(), /Usage/iu);
  });
});

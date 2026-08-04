import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SYNTHETIC_ANALYST_JOURNEYS,
  SYNTHETIC_ANALYST_PERSONAS,
  SYNTHETIC_ANALYST_TASK_IDS,
} from '../fixtures/synthetic-analyst-journeys.mts';
import {
  SYNTHETIC_ANALYST_JOURNEY_DIGEST_SHA256,
  buildSyntheticAnalystCoverageReport,
  buildSyntheticAnalystReport,
  buildSyntheticAnalystResultTemplate,
  main,
} from '../tools/synthetic-analyst-journeys.mts';

type UnknownRecord = Record<string, unknown>;

function result(overrides: UnknownRecord = {}) {
  const template = buildSyntheticAnalystResultTemplate('first-domain-assessment', 'desktop');
  const journey = SYNTHETIC_ANALYST_JOURNEYS.find((candidate) => candidate.id === template.journeyId);
  assert.ok(journey);
  return {
    ...template,
    evidenceState: 'partial',
    completed: true,
    durationMs: 3_200,
    actions: 9,
    backtracks: 1,
    helpOpens: 0,
    scrollReversals: 2,
    milestones: [...journey.requiredMilestones],
    ...overrides,
  };
}

function capture() {
  let value = '';
  return {
    stream: { write(chunk: string) { value += chunk; } },
    value: () => value,
  };
}

describe('synthetic analyst journey contract', () => {
  test('covers every declared workflow task on desktop and mobile', () => {
    const report = buildSyntheticAnalystCoverageReport();
    assert.deepEqual(report.uncoveredTaskIds, []);
    assert.equal(report.taskCoverage.length, SYNTHETIC_ANALYST_TASK_IDS.length);
    assert.ok(report.taskCoverage.every((item) => (
      item.journeyIds.length > 0
      && item.devices.includes('desktop')
      && item.devices.includes('mobile')
    )));
    assert.equal(report.personaCount, SYNTHETIC_ANALYST_PERSONAS.length);
    assert.equal(report.journeyCount, SYNTHETIC_ANALYST_JOURNEYS.length);
    assert.equal(report.digestSha256, SYNTHETIC_ANALYST_JOURNEY_DIGEST_SHA256);
  });

  test('aggregates only controlled workflow measurements', () => {
    const report = buildSyntheticAnalystReport([
      result(),
      result({
        device: 'mobile',
        durationMs: 5_000,
        actions: 11,
        backtracks: 2,
        helpOpens: 1,
        scrollReversals: 4,
      }),
    ]);
    assert.equal(report.results, 2);
    assert.equal(report.completed, 2);
    assert.equal(report.completionRate, 1);
    assert.deepEqual(report.devices, { desktop: 1, mobile: 1 });
    assert.deepEqual(report.medians, {
      durationMs: 4_100,
      actions: 10,
      backtracks: 1.5,
      helpOpens: 0.5,
      scrollReversals: 3,
    });
    assert.deepEqual(report.privacy, {
      identitiesRetained: false,
      targetsRetained: false,
      queriesRetained: false,
      pageContentsRetained: false,
      recordingsRetained: false,
      freeTextRetained: false,
      uploaded: false,
    });
  });

  test('rejects identifiers, targets, free text, stale plans, and incomplete completion claims', () => {
    assert.throws(
      () => buildSyntheticAnalystReport([result({ identity: 'fixture-operator' })]),
      /documented fields/iu,
    );
    assert.throws(
      () => buildSyntheticAnalystReport([result({ target: 'private.example' })]),
      /documented fields/iu,
    );
    assert.throws(
      () => buildSyntheticAnalystReport([result({ notes: 'confusing' })]),
      /documented fields/iu,
    );
    assert.throws(
      () => buildSyntheticAnalystReport([result({ journeyDigestSha256: '0'.repeat(64) })]),
      /unsupported or invalid contract/iu,
    );
    assert.throws(
      () => buildSyntheticAnalystReport([result({ milestones: ['task-entry-found'] })]),
      /every required milestone/iu,
    );
    assert.throws(
      () => buildSyntheticAnalystReport([result({ actions: 99 })]),
      /journey budget/iu,
    );
  });

  test('rejects duplicate result coordinates and mismatched persona or evidence state', () => {
    assert.throws(
      () => buildSyntheticAnalystReport([result(), result()]),
      /repeats a journey/iu,
    );
    assert.throws(
      () => buildSyntheticAnalystReport([result({ personaId: 'brand_reviewer' })]),
      /declared journey/iu,
    );
    assert.throws(
      () => buildSyntheticAnalystReport([result({ evidenceState: 'complete' })]),
      /declared journey/iu,
    );
  });

  test('emits bounded plan and template documents from the CLI', async () => {
    const output = capture();
    const errors = capture();
    assert.equal(await main(['--plan'], output.stream, errors.stream), 0);
    assert.equal(JSON.parse(output.value()).schema, 'whoisleuth.synthetic-analyst-journeys');
    assert.equal(errors.value(), '');

    const templateOutput = capture();
    assert.equal(await main(
      ['--template=bulk-peer-triage:mobile'],
      templateOutput.stream,
      errors.stream,
    ), 0);
    const template = JSON.parse(templateOutput.value());
    assert.equal(template.schema, 'whoisleuth.synthetic-analyst-result');
    assert.equal(template.device, 'mobile');
    assert.equal(template.completed, false);
    assert.deepEqual(template.milestones, []);
    assert.doesNotMatch(templateOutput.value(), /identity|target|query|notes|recording/iu);
  });

  test('keeps every declared journey in the curated browser lane', async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const e2eRoot = path.join(repositoryRoot, 'e2e');
    const specs = (await readdir(e2eRoot))
      .filter((name) => name.endsWith('.spec.ts'))
      .sort();
    const source = (await Promise.all(specs.map((name) => readFile(path.join(e2eRoot, name), 'utf8'))))
      .join('\n');
    assert.match(source, /@analyst-journey/u);
    for (const journey of SYNTHETIC_ANALYST_JOURNEYS) {
      assert.match(source, new RegExp(`@journey-${journey.id}\\b`, 'u'), journey.id);
    }
  });
});

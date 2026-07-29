import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  FIRST_USE_ANALYST_STUDY_TASKS,
} from '../fixtures/first-use-analyst-study-tasks.mts';
import {
  FIRST_USE_STUDY_TASK_DIGEST_SHA256,
  buildFirstUseStudySessionTemplate,
  buildFirstUseStudyReport,
} from '../tools/first-use-analyst-study.mts';

function session(
  device: 'desktop' | 'mobile',
  observations: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return {
    schema: 'whoisleuth.first-use-study-session',
    version: 1,
    taskVersion: 1,
    taskDigestSha256: FIRST_USE_STUDY_TASK_DIGEST_SHA256,
    device,
    observations,
    ...extra,
  };
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'deep-lookup-first-pivot',
    completed: true,
    durationSeconds: 180,
    firstUsefulPivotSeconds: 95,
    errors: 0,
    backtracks: 1,
    terminologyIssues: ['pivot_vs_attribution'],
    ...overrides,
  };
}

describe('privacy-safe first-use analyst study kit', () => {
  test('covers all three guided recipes on desktop and mobile', () => {
    const taskIds = new Set(FIRST_USE_ANALYST_STUDY_TASKS.map((task) => task.id));
    assert.ok(taskIds.has('guided-new-domain-triage'));
    assert.ok(taskIds.has('guided-infrastructure-pivot'));
    assert.ok(taskIds.has('guided-brand-sweep'));
    assert.ok(FIRST_USE_ANALYST_STUDY_TASKS.every((task) => (
      task.allowedDevices.includes('desktop') && task.allowedDevices.includes('mobile')
    )));
  });

  test('aggregates completion, pivot time, errors, backtracking, and controlled terminology issues', () => {
    const report = buildFirstUseStudyReport([
      session('desktop', [observation()]),
      session('desktop', [observation({
        completed: false,
        durationSeconds: 240,
        firstUsefulPivotSeconds: null,
        errors: 2,
        backtracks: 3,
        terminologyIssues: ['source_state', 'pivot_vs_attribution'],
      })]),
      session('mobile', [observation({
        durationSeconds: 300,
        firstUsefulPivotSeconds: 160,
        backtracks: 4,
      })]),
    ]);
    assert.deepEqual(report.devices, { desktop: 2, mobile: 1 });
    assert.deepEqual(report.tasks[0], {
      device: 'desktop',
      taskId: 'deep-lookup-first-pivot',
      attempts: 2,
      completed: 1,
      completionRate: 0.5,
      medianDurationSeconds: 210,
      medianFirstUsefulPivotSeconds: 95,
      errors: 2,
      backtracks: 4,
      terminologyIssues: [
        { issue: 'source_state', count: 1 },
        { issue: 'pivot_vs_attribution', count: 2 },
      ],
    });
    assert.deepEqual(report.privacy, {
      participantIdentityRetained: false,
      targetsRetained: false,
      queriesRetained: false,
      recordingsRetained: false,
      freeTextRetained: false,
      uploaded: false,
    });
  });

  test('rejects undocumented fields, stale task contracts, repeated tasks, and uncontrolled values', () => {
    assert.throws(
      () => buildFirstUseStudyReport([
        session('desktop', [observation()], { participantId: 'participant-1' }),
      ]),
      /documented fields/iu,
    );
    assert.throws(
      () => buildFirstUseStudyReport([
        session('desktop', [observation(), observation()]),
      ]),
      /must not repeat/iu,
    );
    assert.throws(
      () => buildFirstUseStudyReport([
        session('desktop', [observation({ terminologyIssues: ['free-form concern'] })]),
      ]),
      /controlled vocabulary/iu,
    );
    assert.throws(
      () => buildFirstUseStudyReport([
        session('desktop', [observation()], { taskDigestSha256: '0'.repeat(64) }),
      ]),
      /unsupported or invalid contract/iu,
    );
    assert.throws(
      () => buildFirstUseStudyReport([
        session('desktop', [observation({ comment: 'free text' })]),
      ]),
      /documented fields/iu,
    );
    const duplicate = session('desktop', [observation()]);
    assert.throws(
      () => buildFirstUseStudyReport([duplicate, structuredClone(duplicate)]),
      /duplicate canonical session/iu,
    );
  });

  test('generates a version-bound privacy-safe recording template', () => {
    const template = buildFirstUseStudySessionTemplate('mobile');
    assert.equal(template.taskDigestSha256, FIRST_USE_STUDY_TASK_DIGEST_SHA256);
    assert.ok(template.observations.length > 0);
    assert.ok(template.observations.every((item) => (
      item.completed === false
      && item.durationSeconds === 0
      && item.firstUsefulPivotSeconds === null
      && item.terminologyIssues.length === 0
    )));
    assert.doesNotMatch(JSON.stringify(template), /participant|target|query|notes|recording/iu);
  });
});

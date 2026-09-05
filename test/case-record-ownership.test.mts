import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  CASE_DISPOSITIONS,
  CASE_STATUSES,
  CASE_AUDIENCE_SENSITIVE_FIELD_NAMES,
  CASE_FIELD_RULES,
  CASE_RECORD_FIELD_NAMES,
  buildCaseExport,
  caseDispositionSupportsDefensiveResponse,
  caseStatusOptionsForDirectEdit,
  caseStatusRequiresClosure,
  isReviewedCaseDisposition,
  normalizeCaseStore,
  projectCaseForAudience,
  projectCaseForDurableWrite,
  serializeCaseStore,
} from '../packages/cases/case-model.mts';
import { RULE_FIELD_DEFINITIONS } from '../packages/workspace/detection-rule-model.mts';

const NOW = '2026-08-22T00:00:00.000Z';
const CURRENT_CASE_FIXTURE = new URL('./fixtures/case-lifecycle/case-export-v15.json', import.meta.url);

async function currentCase() {
  const document = JSON.parse(await readFile(CURRENT_CASE_FIXTURE, 'utf8')) as unknown;
  const record = normalizeCaseStore(document).cases[0];
  assert.ok(record);
  return record;
}

describe('Case decision and projection ownership', () => {
  test('derives status and disposition consumers from the canonical identities', () => {
    const statusValues = CASE_STATUSES.map((option) => option.value);
    const dispositionValues = CASE_DISPOSITIONS.map((option) => option.value);
    const statusRule = RULE_FIELD_DEFINITIONS.find((field) => field.value === 'status');
    const dispositionRule = RULE_FIELD_DEFINITIONS.find((field) => field.value === 'disposition');

    assert.deepEqual(statusRule?.values, statusValues);
    assert.deepEqual(dispositionRule?.values, dispositionValues);
    for (const status of statusValues) {
      const ownOptions = caseStatusOptionsForDirectEdit(status).map((option) => option.value);
      assert.ok(ownOptions.includes(status));
      assert.equal(
        caseStatusOptionsForDirectEdit('new').some((option) => option.value === status),
        !caseStatusRequiresClosure(status),
      );
    }
    assert.equal(isReviewedCaseDisposition('unreviewed'), false);
    assert.equal(
      CASE_DISPOSITIONS.filter((option) => isReviewedCaseDisposition(option.value)).length,
      CASE_DISPOSITIONS.length - 1,
    );
    assert.equal(caseDispositionSupportsDefensiveResponse('suspicious'), true);
    assert.equal(caseDispositionSupportsDefensiveResponse('confirmed_abuse'), true);
    assert.equal(caseDispositionSupportsDefensiveResponse('false_positive'), false);
    assert.equal(caseDispositionSupportsDefensiveResponse('unsupported'), false);
  });

  test('classifies every current Case field before durable or audience projection', async () => {
    const record = await currentCase();
    const fields = Object.keys(record).sort();
    assert.deepEqual([...CASE_RECORD_FIELD_NAMES].sort(), fields);
    assert.equal(new Set(CASE_RECORD_FIELD_NAMES).size, fields.length);
    assert.equal(Object.isFrozen(CASE_FIELD_RULES), true);
    assert.ok(CASE_AUDIENCE_SENSITIVE_FIELD_NAMES.length > 0);

    for (const [field, rule] of Object.entries(CASE_FIELD_RULES)) {
      assert.equal(rule.key, field);
      assert.equal(Object.isFrozen(rule), true);
      assert.equal(Object.isFrozen(rule.treatment), true);
      assert.equal(Object.isFrozen(rule.nestedSensitiveFields), true);
      assert.equal(Object.isFrozen(rule.audienceExclusions), true);
      for (const audience of ['internal', 'trusted', 'public'] as const) {
        const requiresExplanation = rule.treatment[audience] === 'exclude'
          || rule.treatment[audience] === 'redact';
        assert.equal(Boolean(rule.audienceExclusions[audience]), requiresExplanation);
        if (rule.audienceExclusions[audience]) {
          assert.equal(Object.isFrozen(rule.audienceExclusions[audience]), true);
        }
      }
    }

    const durable = projectCaseForDurableWrite(record);
    assert.notEqual(durable, record);
    assert.deepEqual(durable, record);
    assert.deepEqual(JSON.parse(serializeCaseStore([record])).cases[0], durable);
    assert.deepEqual(buildCaseExport([record], NOW).cases[0], durable);
    for (const audience of ['internal', 'trusted', 'public'] as const) {
      const projected = projectCaseForAudience(record, audience);
      assert.deepEqual(Object.keys(projected).sort(), fields);
      assert.deepEqual(projectCaseForAudience(projected, audience), projected);
    }
  });
});

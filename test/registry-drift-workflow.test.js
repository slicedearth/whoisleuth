'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'registry-drift.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8');

describe('official registry drift workflow', () => {
  test('runs only on a fixed weekly schedule or explicit dispatch', () => {
    assert.match(WORKFLOW, /^\s{2}workflow_dispatch:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}schedule:\s*\n\s{4}- cron: '17 2 \* \* 1'$/mu);
    assert.doesNotMatch(WORKFLOW, /^\s{2}(push|pull_request|repository_dispatch):/mu);
  });

  test('uses read-only permissions, fixed action revisions, and no secrets', () => {
    assert.match(WORKFLOW, /^permissions:\s*\n\s{2}contents: read$/mu);
    assert.doesNotMatch(WORKFLOW, /\b(?:contents|issues|pull-requests|actions): write\b/u);
    assert.doesNotMatch(WORKFLOW, /\bsecrets\./u);

    const actions = [...WORKFLOW.matchAll(/^\s+uses: ([^@\s]+)@([^\s#]+)/gmu)]
      .map((match) => ({ action: match[1], revision: match[2] }));
    assert.deepEqual(actions.map(({ action }) => action), [
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
    ]);
    for (const { revision } of actions) assert.match(revision, /^[a-f0-9]{40}$/u);
  });

  test('runs the existing bounded command and retains only reviewable reports', () => {
    assert.match(WORKFLOW, /^\s{4}timeout-minutes: 10$/mu);
    assert.match(WORKFLOW, /npm ci --include=optional --ignore-scripts/u);
    assert.match(WORKFLOW, /npm run --silent registry:drift -- --json > registry-drift-report\.json/u);
    assert.match(WORKFLOW, /if: steps\.audit\.outputs\.exit_code != '0'[\s\S]+actions\/upload-artifact@/u);
    assert.match(WORKFLOW, /name: registry-drift-report/u);
    assert.match(WORKFLOW, /path: registry-drift-report\.json/u);
    assert.match(WORKFLOW, /retention-days: 7/u);
    assert.match(WORKFLOW, /name: Require manual review[\s\S]+run: exit 1/u);
    assert.doesNotMatch(WORKFLOW, /\b(?:gh issue|git commit|git push)\b/u);
  });
});

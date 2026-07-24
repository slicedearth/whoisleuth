'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8');

describe('continuous integration workflow', () => {
  test('runs once for pull requests and again after changes reach main', () => {
    assert.match(WORKFLOW, /^on:\s*\n\s{2}push:\s*\n\s{4}branches:\s*\n\s{6}- main\s*\n\s{2}pull_request:\s*$/mu);
    assert.doesNotMatch(WORKFLOW, /^\s{6}- ['"]?\*['"]?\s*$/mu);
  });

  test('keeps the required verification job read-only and comprehensive', () => {
    assert.match(WORKFLOW, /^permissions:\s*\n\s{2}contents: read$/mu);
    assert.doesNotMatch(WORKFLOW, /\b(?:contents|issues|pull-requests|actions): write\b/u);
    assert.match(WORKFLOW, /^\s{2}verify:\s*$/mu);
    const actions = [...WORKFLOW.matchAll(/^\s+uses: ([^@\s]+)@([^\s#]+)/gmu)]
      .map((match) => ({ action: match[1], revision: match[2] }));
    assert.deepEqual(actions.map(({ action }) => action), [
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
    ]);
    for (const { revision } of actions) assert.match(revision, /^[a-f0-9]{40}$/u);
    for (const command of [
      'npm run release:check',
      'npm run licenses:check',
      'npm audit --omit=dev',
      'npm test',
      'npm run typecheck',
      'npm run check',
      'npm run build',
      'npm run test:e2e',
    ]) {
      assert.match(WORKFLOW, new RegExp(`^\\s+run: ${command.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, 'mu'));
    }
  });
});

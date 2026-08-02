import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const WORKFLOW = readFileSync(new URL('../.github/workflows/dependency-review.yml', import.meta.url), 'utf8');

describe('dependency review workflow', () => {
  test('runs only for pull requests with read-only repository permissions', () => {
    assert.match(WORKFLOW, /^on:\s*\n\s{2}pull_request:\s*$/mu);
    assert.doesNotMatch(WORKFLOW, /^\s{2}(?:push|workflow_dispatch|schedule|repository_dispatch):/mu);
    assert.match(WORKFLOW, /^permissions:\s*\n\s{2}contents: read$/mu);
    assert.doesNotMatch(WORKFLOW, /\b(?:contents|issues|pull-requests|actions|packages|security-events): write\b/u);
  });

  test('pins the checkout and review actions and blocks moderate vulnerabilities', () => {
    const actions = [...WORKFLOW.matchAll(/^\s+uses: ([^@\s]+)@([^\s#]+)/gmu)]
      .map((match) => {
        const action = match[1];
        const revision = match[2];
        assert.ok(action && revision, 'workflow action entries must include a name and revision');
        return { action, revision };
      });
    assert.deepEqual(actions.map(({ action }) => action), [
      'actions/checkout',
      'actions/dependency-review-action',
    ]);
    for (const { revision } of actions) assert.match(revision, /^[a-f0-9]{40}$/u);
    assert.match(WORKFLOW, /^\s{10}persist-credentials: false$/mu);
    assert.match(WORKFLOW, /^\s{10}fail-on-severity: moderate$/mu);
  });
});

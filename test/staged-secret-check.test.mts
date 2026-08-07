import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_STAGED_DIFF_BYTES, scanAddedDiff } from '../tools/staged-secret-check.mts';

describe('staged secret check', () => {
  test('reports only the location and rule for high-confidence staged additions', () => {
    const fixtureCredential = ['npm_', '1'.repeat(36)].join('');
    const value = ['diff --git a/config.txt b/config.txt', '+++ b/config.txt', '@@ -0,0 +1,2 @@', '+mode=private', `+token="${fixtureCredential}"`].join('\n');
    assert.deepEqual(scanAddedDiff(value), [{ file: 'config.txt', addedLine: 2, rule: 'npm-token' }]);
  });

  test('allows documented placeholders and ignores removed values', () => {
    const fixtureCredential = ['npm_', '1'.repeat(36)].join('');
    const value = ['diff --git a/.env.example b/.env.example', '+++ b/.env.example', '@@ -1 +1 @@', `-token="${fixtureCredential}"`, '+token="replace_me"'].join('\n');
    assert.deepEqual(scanAddedDiff(value), []);
  });

  test('rejects an oversized staged diff before scanning it', () => {
    assert.throws(() => scanAddedDiff('x'.repeat(MAX_STAGED_DIFF_BYTES + 1)), /secret-scan boundary/u);
  });
});

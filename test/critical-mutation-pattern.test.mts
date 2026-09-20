import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertUniqueCriticalMutationPattern } from '../tools/critical-mutation-manifest.mts';

test('a mutation remains located by its unique statement after unrelated lines are inserted', () => {
  const statement = 'if (!complete) return "unknown";';
  for (const prefix of ['', '\n\n', '// A nearby helper was extracted.\n\nfunction helper() {}\n']) {
    assert.doesNotThrow(() => assertUniqueCriticalMutationPattern(`${prefix}${statement}\nreturn "ready";`, statement));
  }
});

test('missing, empty and ambiguous mutation patterns fail before a test can be counted as a kill', () => {
  for (const [source, search] of [
    ['return "ready";', 'return "unknown";'],
    ['return "ready";', ''],
    ['return value;\nreturn value;', 'return value;'],
    ['aaa', 'aa'],
  ]) {
    assert.throws(() => assertUniqueCriticalMutationPattern(source!, search!), /one unique source pattern/u);
  }
});

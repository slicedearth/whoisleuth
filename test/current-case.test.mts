import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentCaseFixture, currentCaseCollection, CURRENT_CASE_TIME } from './support/current-case.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

test('current Case setup is deterministic and detached, including nested overrides', () => {
  const first = currentCaseFixture();
  const second = currentCaseFixture();
  assert.deepEqual(first, second);
  assert.notEqual(first.notes, second.notes);
  assert.equal(first.createdAt, CURRENT_CASE_TIME);
  assert.equal(first.domain, 'example.test');
  const tags = ['review'];
  const record = currentCaseFixture({ id: 'another-case', tags });
  tags.push('not retained');
  assert.deepEqual(record.tags, ['review']);
  const store = currentCaseCollection([record]);
  assert.equal(store.version, CASE_SCHEMA_VERSION);
  assert.deepEqual(store.cases, [record]);
  assert.notEqual(store.cases[0], record);
});

test('invalid current setup fails instead of losing the intended test condition', () => {
  assert.throws(() => currentCaseFixture({ domain: 'not a domain' }), /fixture overrides/u);
  assert.throws(() => currentCaseFixture({ status: 'resolved' }), /fixture overrides/u);
  assert.throws(() => currentCaseFixture({ createdAt: 'not a timestamp' }), /fixture overrides/u);
  assert.throws(() => currentCaseFixture({ tags: ['same', 'same'] }), /fixture overrides/u);
});

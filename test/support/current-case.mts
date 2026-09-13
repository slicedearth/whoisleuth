import assert from 'node:assert/strict';
import { normalizeCase } from '../../packages/cases/case-record-operations.mts';
import type { CaseRecord } from '../../packages/cases/case-record-contracts.mts';
import { CASE_SCHEMA_VERSION } from '../../packages/contracts/case-portability.mts';

export const CURRENT_CASE_TIME = '2026-09-01T00:00:00.000Z';

/** Current-behaviour setup, not an independent compatibility expectation. */
export function currentCaseFixture(overrides: Partial<CaseRecord> = {}): CaseRecord {
  const defaults = normalizeCase({
    id: 'case-example', domain: 'example.test', source: 'lookup',
    createdAt: CURRENT_CASE_TIME, updatedAt: CURRENT_CASE_TIME,
  }, undefined, CURRENT_CASE_TIME, CASE_SCHEMA_VERSION)!;
  const record = { ...defaults, ...structuredClone(overrides) };
  // Do not let normalisation silently discard the condition a test intends to
  // exercise. Deliberately malformed input belongs in the test itself.
  assert.deepEqual(normalizeCase(record, undefined, CURRENT_CASE_TIME, CASE_SCHEMA_VERSION), record,
    'Current Case fixture overrides must already satisfy the current contract.');
  return record;
}

export function currentCaseCollection(records: readonly CaseRecord[]) {
  return { version: CASE_SCHEMA_VERSION, cases: structuredClone(records) };
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caseRecordVersionInput } from '../packages/cases/case-record-version-input.mts';

test('historical Case input adaptation does not invent later fields or mutate retained input', () => {
  const input = { title: 'Later title', observedEffects: { reviews: [] }, closures: { records: [] }, notes: [] };
  const original = structuredClone(input);
  const legacy = caseRecordVersionInput(input, 12);
  assert.deepEqual(legacy.record, { ...input, title: '', observedEffects: undefined, closures: undefined });
  assert.deepEqual(legacy.timestampOptions, { legacyTimestamps: true, sourceVersion: 12 });
  const lifecycle = caseRecordVersionInput(input, 13);
  assert.deepEqual(lifecycle.record, { ...input, title: '' });
  assert.deepEqual(input, original);
  assert.notEqual(legacy.record, input);
});

test('current recovery keeps current fields and distinguishes undeclared from historical timestamps', () => {
  const input = { title: 'Current incident', observedEffects: { reviews: [] }, evidenceLinks: [] };
  for (const version of [undefined, null, 17]) {
    const current = caseRecordVersionInput(input, version);
    assert.deepEqual(current.record, input);
    assert.equal(current.timestampOptions.legacyTimestamps, false);
    assert.equal(Object.hasOwn(current.timestampOptions, 'sourceVersion'), version !== undefined);
  }
  assert.deepEqual(caseRecordVersionInput({ title: 'Incident' }, 16).record, { title: 'Incident' });
  assert.equal(caseRecordVersionInput({}, 14).timestampOptions.legacyTimestamps, true);
  assert.equal(caseRecordVersionInput({}, 15).timestampOptions.legacyTimestamps, false);
});

test('later evidence links are rejected under an older declaration, not silently discarded', () => {
  for (const version of [12, 13, 14, 15, 16]) {
    assert.throws(() => caseRecordVersionInput({ evidenceLinks: [] }, version), /Evidence relationships require/);
  }
});

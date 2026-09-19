import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeSnapshot, normalizeEvidenceHistory, compareCaseEvidence, caseEvidenceTimeline } from '../packages/cases/case-evidence-model.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

const historical = JSON.parse(readFileSync(new URL('./fixtures/case-snapshot-factor-order-v1.json', import.meta.url), 'utf8'));

test('new snapshot factor identities are independent of locale and survive current normalisation', (context) => {
  const { id: _id, fingerprint: _fingerprint, ...capture } = historical;
  const collator = context.mock.method(String.prototype, 'localeCompare', () => { throw new Error('locale must not select current factor order'); });
  const current = normalizeSnapshot(capture);
  assert.ok(current);
  assert.equal(current.factorOrder, 'code-unit-v1');
  assert.deepEqual(current.riskFactors.map(factor => factor.label), ['Z', 'a', 'ä']);
  assert.deepEqual(normalizeSnapshot(JSON.parse(JSON.stringify(current)), { sourceVersion: CASE_SCHEMA_VERSION }), current);
  assert.deepEqual(normalizeSnapshot({ ...capture, riskFactors: [...capture.riskFactors].reverse() }), current);
  collator.mock.restore();
});

test('historical identities remain verifiable while ordering alone is not new evidence', () => {
  assert.equal(historical.fingerprint, '1alcz4f');
  assert.deepEqual(normalizeSnapshot(historical, { sourceVersion: 15 }), historical);
  assert.deepEqual(normalizeSnapshot(historical, { sourceVersion: CASE_SCHEMA_VERSION }), historical);
  const { id: _id, fingerprint: _fingerprint, ...capture } = historical;
  const current = normalizeSnapshot({ ...capture, capturedAt: '2026-01-02T00:00:00.000Z' });
  assert.ok(current);
  assert.notEqual(current.fingerprint, historical.fingerprint);
  assert.deepEqual(compareCaseEvidence(historical, current), []);
  const timeline = caseEvidenceTimeline([historical, current]);
  assert.equal(timeline[1]?.hasIncomparableChange, false);
  const merged = normalizeEvidenceHistory([historical, current]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.fingerprint, historical.fingerprint);
  assert.equal(merged[0]?.capturedAt, current.capturedAt);
  assert.deepEqual(normalizeEvidenceHistory([current, historical]), merged);
  assert.deepEqual(normalizeEvidenceHistory(JSON.parse(JSON.stringify(merged))), merged);
  const changed = normalizeSnapshot({ ...current, riskFactors: [{ label: 'Z', points: 7 }] });
  assert.ok(changed);
  assert.equal(normalizeEvidenceHistory([historical, changed]).length, 2);
  assert.ok(compareCaseEvidence(historical, changed).some(change => change.field === 'riskFactors'));
});

test('unsupported factor declarations are never silently interpreted under another version', () => {
  for (const factorOrder of ['code-unit-v2', 1, null, {}]) {
    assert.equal(normalizeSnapshot({ ...historical, factorOrder }), null);
  }
  assert.equal(normalizeSnapshot({ ...historical, factorOrder: 'code-unit-v1' }, { sourceVersion: 15 }), null);
});

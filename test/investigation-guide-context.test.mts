import assert from 'node:assert/strict';
import { test } from 'node:test';
import { investigationGuideEvidenceContext, investigationGuideCaseContext } from '../frontend/src/lib/analysis/investigation-guide-context.ts';
import { buildInvestigationProjection } from '../packages/investigation/investigation-projection.mts';
import { createCase } from '../packages/cases/case-model.mts';

const NOW = '2026-06-05T00:00:00.000Z';
function fixture() {
  const record = createCase({ domain: 'guide.example', evidence: { inputHostname: 'login.guide.example', availability: 'registered', scanDepth: 'deep' } }, '2026-06-01T00:00:00.000Z');
  const projection = buildInvestigationProjection({ cases: [record] });
  return { record, projection };
}

test('guide context uses exact-target evidence clocks rather than record updates or lexical order', () => {
  const { projection } = fixture();
  const capture = projection.observations.find((item) => item.kind === 'case_evidence');
  const metadata = projection.observations.find((item) => item.kind === 'case_record');
  assert.ok(capture); assert.ok(metadata);
  metadata.observedAt = NOW;
  capture.observedAt = '2026-06-02T00:30:00+10:00';
  const second = { ...capture, id: 'later', observedAt: '2026-06-01T23:30:00Z' };
  projection.observations.push(second);
  for (const entity of projection.entities.filter((item) => item.observationIds.includes(capture.id))) entity.observationIds.push(second.id);
  const context = investigationGuideEvidenceContext(projection, 'login.guide.example', NOW);
  assert.equal(context.observations, 2);
  assert.match(context.timeLabel, /Latest capture 1 June 2026 UTC/);
  assert.equal(investigationGuideEvidenceContext(projection, 'sibling.guide.example', NOW).observations, 0);
  capture.observedAt = '';
  assert.match(investigationGuideEvidenceContext(projection, 'login.guide.example', NOW).timeLabel, /Latest known.*1 undated/);
  second.observedAt = '2027-01-01T00:00:00Z';
  assert.match(investigationGuideEvidenceContext(projection, 'login.guide.example', NOW).timeLabel, /future-dated/);
  second.observedAt = '';
  assert.match(investigationGuideEvidenceContext(projection, 'login.guide.example', NOW).timeLabel, /Retained evidence; capture time unavailable/);
});

test('metadata-only context is not reported as fresh evidence and source omission survives', () => {
  const record = createCase({ domain: 'guide.example' }, NOW);
  const projection = buildInvestigationProjection({ cases: [record] });
  const context = investigationGuideEvidenceContext(projection, 'guide.example', NOW);
  assert.equal(context.observations, 0);
  assert.match(context.timeLabel, /Retained context only/);
  projection.truncated = true;
  assert.equal(investigationGuideEvidenceContext(projection, 'absent.example', NOW).truncated, true);
});

test('a guide honours explicit Case identity and does not choose between hostname and parent Cases', () => {
  const first = fixture().record;
  const second = { ...first, id: 'second', domain: 'login.guide.example' };
  const other = { ...first, id: 'other', domain: 'other.example' };
  for (const records of [[first, second, other], [other, second, first]]) {
    assert.equal(investigationGuideCaseContext(records, 'login.guide.example', second.id).record?.id, second.id);
    assert.match(investigationGuideCaseContext(records, 'login.guide.example', null).label, /Choose a Case \(2/);
    assert.equal(investigationGuideCaseContext(records, 'guide.example', other.id).record, null);
    assert.match(investigationGuideCaseContext(records, 'guide.example', 'missing').label, /no longer retained/);
    assert.deepEqual(investigationGuideCaseContext(records, 'guide.example', other.id).choices, [{ id: first.id, domain: 'guide.example' }]);
    assert.deepEqual(investigationGuideCaseContext(records, 'login.guide.example', null).choices.map((item) => item.id).sort(), [first.id, second.id].sort());
  }
  assert.equal(investigationGuideCaseContext([first], 'login.guide.example', null).record?.id, first.id);
  assert.deepEqual(investigationGuideCaseContext([], '', null), { record: null, choices: [], label: 'Not retained' });
});

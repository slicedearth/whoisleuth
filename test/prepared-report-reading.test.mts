import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase } from '../packages/cases/case-model.mts';
import { prepareCaseReportPreview } from '../packages/cases/case-report-preview.mts';
import { preparedDecisionBrief, preparedStatementReferences } from '../packages/cases/prepared-report-reading.mts';
import type { CaseAssertionRecord, CaseDecisionRecord, CaseEvidencePin } from '../packages/cases/case-response-records.mts';

const NOW = '2026-10-01T00:00:00.000Z';
const options = { applicationVersion: '2.6.0', includeNotes: false, includeAttribution: true };
const pin: CaseEvidencePin = { id: 'reference-one', checkpointId: null, field: 'http.status', category: 'http',
  label: 'Prepared response', value: 'Original prepared observation', source: 'Independent fixture', sourceState: 'partial',
  sourceSchema: null, observedAt: null, collectionDepth: 'deep', completeness: 'partial', truncated: true,
  transitionExpectation: null, limitations: ['One incomplete retained observation.'], createdAt: NOW };
const assertion: CaseAssertionRecord = { id: 'assessment-one', kind: 'hypothesis', state: 'open',
  statement: 'Which observation applies?', rationale: 'The source scope needs review.', evidencePinIds: ['reference-one'],
  evidenceRelations: [{ evidencePinId: 'reference-one', stance: 'supports' }, { evidencePinId: 'missing-reference', stance: 'contradicts' }],
  createdAt: NOW, updatedAt: NOW };
const decision: CaseDecisionRecord = { id: 'decision-one', summary: 'Continue evidence review', rationale: 'Unresolved source context.',
  confidence: 'low', confidenceBasis: 'Declared reasoning', evidencePinIds: ['reference-one', 'missing-reference'], createdAt: NOW };

function fixture() {
  const record = createCase({ domain: 'prepared-reading.example' }, NOW);
  record.evidencePins = [structuredClone(pin)];
  record.assertions = [structuredClone(assertion)];
  record.decisions = [structuredClone(decision)];
  return record;
}

test('prepared references preserve relation-only and missing identities without consulting a newer live record', () => {
  const record = fixture();
  const preview = prepareCaseReportPreview(record, options, NOW);
  const before = [preview.files.json.content, preview.files.md.content];
  record.evidencePins[0]!.value = 'Newer live content must not replace the prepared observation';
  const rows = preparedStatementReferences(preview.report.json, { kind: 'assertion', id: assertion.id });
  assert.deepEqual(rows?.map(value => [value.id, value.stance, value.pin?.value ?? null]), [
    ['reference-one', 'supports', 'Original prepared observation'], ['missing-reference', 'contradicts', null],
  ]);
  assert.deepEqual(rows?.[0]?.pin?.limitations, ['One incomplete retained observation.']);
  assert.equal(rows?.[0]?.pin?.observedAt, null); assert.equal(rows?.[0]?.pin?.truncated, true);
  const conclusion = preparedStatementReferences(preview.report.json, { kind: 'decision', id: decision.id });
  assert.deepEqual(conclusion?.map(value => [value.id, value.stance]), [['reference-one', null], ['missing-reference', null]]);
  assert.equal(preparedStatementReferences(preview.report.json, { kind: 'assertion', id: 'not-prepared' }), null);
  assert.deepEqual([preview.files.json.content, preview.files.md.content], before);
});

test('brief retains equal-time and undated conclusions rather than assigning one winner or treating undated as older', () => {
  const record = fixture();
  record.decisions = [
    { ...decision, id: 'earlier', createdAt: '2026-09-01T00:00:00.000Z' },
    decision, { ...decision, id: 'equal-time', createdAt: '2026-10-01T10:00:00+10:00' },
    { ...decision, id: 'undated', createdAt: 'time unavailable' },
  ];
  const report = prepareCaseReportPreview(record, options, NOW).report.json;
  const before = JSON.stringify(report);
  const brief = preparedDecisionBrief(report);
  assert.deepEqual(brief.latestConclusions.map(value => value.id), ['decision-one', 'equal-time']);
  assert.deepEqual(brief.undatedConclusions.map(value => value.id), ['undated']);
  assert.equal(brief.earlierConclusions, 1);
  assert.equal(JSON.stringify(report), before);
});

test('brief separates open assessments and recorded next steps without inventing a question or truncating reasoning', () => {
  const record = fixture();
  const longReason = 'Retain the complete reasoning and caveat. '.repeat(30) + 'FINAL-CAVEAT';
  record.assertions = [
    { ...assertion, rationale: longReason },
    { ...assertion, id: 'closed-assessment', state: 'resolved' },
    { ...assertion, id: 'next-step', kind: 'next_step', statement: 'Review the retained source context' },
  ];
  const report = prepareCaseReportPreview(record, options, NOW).report.json;
  const brief = preparedDecisionBrief(report);
  assert.deepEqual(brief.assessments.map(value => value.assertion.id), ['assessment-one']);
  assert.deepEqual(brief.nextSteps.map(value => value.assertion.id), ['next-step']);
  assert.equal(brief.assessments[0]?.assertion.rationale, longReason);
  assert.equal(brief.limitations, report.limitations);
  const empty = preparedDecisionBrief(prepareCaseReportPreview(createCase({ domain: 'empty-report.example' }, NOW), options, NOW).report.json);
  assert.deepEqual(empty.assessments, []); assert.deepEqual(empty.latestConclusions, []); assert.deepEqual(empty.undatedConclusions, []);
});

test('ambiguous prepared pin identities remain unresolved instead of selecting an arbitrary source', () => {
  const record = fixture(); record.evidencePins.push({ ...pin, value: 'Different same-ID observation' });
  const report = prepareCaseReportPreview(record, options, NOW).report.json;
  assert.equal(preparedStatementReferences(report, { kind: 'assertion', id: assertion.id })?.[0]?.pin, null);
});

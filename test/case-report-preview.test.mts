import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareCaseReportPreview, caseReportPreviewIsCurrent } from '../packages/cases/case-report-preview.mts';
import { updateCase } from '../packages/cases/case-record-operations.mts';
import { currentCaseFixture, CURRENT_CASE_TIME } from './support/current-case.mts';

const options = { applicationVersion: '2.5.0', includeNotes: false, includeAttribution: true };

test('report preview and both downloads share one detached projection and timestamp', () => {
  const record = updateCase([currentCaseFixture()], 'case-example', { note: 'private-note-sentinel', evidencePin: {
    label: 'Observed form', value: 'A form was present.', source: 'Selected capture', observedAt: CURRENT_CASE_TIME,
    completeness: 'partial', limitations: ['One selected page.'],
  } }, CURRENT_CASE_TIME).record;
  const preview = prepareCaseReportPreview(record, options, CURRENT_CASE_TIME);
  assert.deepEqual(JSON.parse(preview.files.json.content), preview.report.json);
  assert.equal(preview.files.md.content, preview.report.markdown);
  for (const file of Object.values(preview.files)) {
    assert.equal(file.bytes, Buffer.byteLength(file.content));
    assert.ok(!file.content.includes('private-note-sentinel'));
    assert.ok(file.content.includes('One selected page.'));
  }
  assert.equal(preview.report.json.generatedAt, CURRENT_CASE_TIME);
  assert.equal(caseReportPreviewIsCurrent(preview, record, options), true);
  record.evidencePins[0]!.limitations.push('Changed without a timestamp update.');
  assert.equal(caseReportPreviewIsCurrent(preview, record, options), false);
  assert.deepEqual(preview.report.json.analystResponse.evidencePins[0]!.limitations, ['One selected page.']);
});

test('preview invalidation includes note selection and generator options, not just record timestamps', () => {
  const record = updateCase([currentCaseFixture()], 'case-example', { note: 'Selected note.' }, CURRENT_CASE_TIME).record;
  const preview = prepareCaseReportPreview(record, { ...options, includeNotes: true }, CURRENT_CASE_TIME);
  assert.ok(preview.files.md.content.includes('Selected note.'));
  assert.equal(caseReportPreviewIsCurrent(preview, record, options), false);
  assert.equal(caseReportPreviewIsCurrent(preview, record, { ...options, includeNotes: true, includeAttribution: false }), false);
  assert.equal(caseReportPreviewIsCurrent(preview, record, { ...options, includeNotes: true, applicationVersion: '2.5.1' }), false);
});

test('preview exposes every imported restriction without treating unknown markings as public', () => {
  const record = updateCase([currentCaseFixture()], 'case-example', { assertion: {
    kind: 'hypothesis', statement: 'Imported source claim.', state: 'open', evidencePinIds: [],
    provenance: { origin: 'external_import', format: 'stix', sourceName: 'Selected source', sourceDigestSha256: 'a'.repeat(64), publisher: null,
      externalId: null, entityType: 'domain', entityValue: 'example.test', observedAt: null, createdAt: null, modifiedAt: null,
      confidence: null, labels: [], markings: ['TLP:AMBER', 'TLP:RED', 'Source-specific restriction'] },
  } }, CURRENT_CASE_TIME).record;
  const preview = prepareCaseReportPreview(record, options, CURRENT_CASE_TIME);
  assert.deepEqual(preview.markings, ['TLP:AMBER', 'TLP:RED', 'Source-specific restriction']);
  assert.equal(preview.strictestMarking, 'TLP:RED');
  assert.deepEqual(preview.unknownMarkings, ['Source-specific restriction']);
  for (const marking of preview.markings) assert.ok(preview.files.json.content.includes(marking));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCaseTypeEvidenceReadiness } from '../frontend/src/lib/analysis/case-type-evidence-readiness.ts';
import { caseIncidentTargetAssertion, caseTagsWithTypes } from '../packages/cases/case-workflow-metadata.mts';
import { createCase, updateCase } from '../frontend/src/lib/analysis/case-model.ts';

const NOW = '2026-09-01T08:00:00.000Z';

test('type guidance remains empty until the analyst selects a Case type', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  const readiness = buildCaseTypeEvidenceReadiness(record);
  assert.deepEqual(readiness.selectedTypes, []);
  assert.deepEqual(readiness.rows, []);
  assert.deepEqual(readiness.counts, { present: 0, missingRequired: 0, missingRecommended: 0 });
  assert.match(readiness.limitation, /Select at least one Case type/iu);
});

test('phishing guidance distinguishes retained observations from missing message and route evidence', () => {
  let record = createCase({
    domain: 'review.example',
    tags: caseTagsWithTypes([], ['phishing']),
  }, NOW);
  record = updateCase([record], record.id, {
    assertion: caseIncidentTargetAssertion('https://review.example/sign-in'),
    evidencePin: {
      label: 'Observed credential form',
      field: 'web.page.form',
      category: 'web',
      source: 'Reviewed browser capture',
      value: 'A login form requested account credentials.',
      observedAt: NOW,
    },
    decision: {
      summary: 'Escalate for review',
      rationale: 'The retained page observation requires a response decision.',
    },
  }, NOW).record;
  const pinId = record.evidencePins[0]!.id;
  record = updateCase([record], record.id, {
    decision: {
      summary: 'Evidence-linked assessment',
      rationale: 'The selected page observation supports the reviewed assessment.',
      confidence: 'moderate',
      confidenceBasis: 'One retained point-in-time page observation.',
      evidencePinIds: [pinId],
    },
  }, NOW).record;

  const readiness = buildCaseTypeEvidenceReadiness(record);
  assert.deepEqual(readiness.selectedTypes, ['phishing']);
  assert.equal(readiness.rows.find((row) => row.id === 'exact_incident_target')?.state, 'present');
  assert.equal(readiness.rows.find((row) => row.id === 'observed_behaviour')?.state, 'present');
  assert.equal(readiness.rows.find((row) => row.id === 'analyst_decision')?.state, 'present');
  assert.equal(readiness.rows.find((row) => row.id === 'message_delivery')?.state, 'missing');
  assert.equal(readiness.rows.find((row) => row.id === 'reviewed_response_route')?.state, 'missing');
  assert.match(readiness.limitation, /does not establish maliciousness/iu);
});

test('multiple selected types merge checks without downgrading a required check', () => {
  const record = createCase({
    domain: 'review.example',
    tags: caseTagsWithTypes([], ['phishing', 'malware_distribution']),
  }, NOW);
  const readiness = buildCaseTypeEvidenceReadiness(record);
  assert.deepEqual(readiness.selectedTypes, ['phishing', 'malware_distribution']);
  assert.equal(new Set(readiness.rows.map((row) => row.id)).size, readiness.rows.length);
  assert.equal(readiness.rows.find((row) => row.id === 'observed_behaviour')?.importance, 'required');
  assert.equal(readiness.rows.find((row) => row.id === 'technical_payload')?.importance, 'required');
  assert.deepEqual(
    readiness.rows.find((row) => row.id === 'domain_context')?.appliesTo,
    ['Phishing', 'Malware distribution'],
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCaseDecisionQualityReport } from '../frontend/src/lib/analysis/case-decision-quality.ts';
import { buildCaseTypeEvidenceReadiness } from '../frontend/src/lib/analysis/case-type-evidence-readiness.ts';
import { createCase, updateCase } from '../frontend/src/lib/analysis/case-model.ts';
import type { CaseDisposition, CaseRecord } from '../frontend/src/lib/analysis/case-record-contracts.ts';
import { caseIncidentTargetAssertion, caseTagsWithTypes } from '../packages/cases/case-workflow-metadata.mts';

const NOW = '2026-09-01T08:00:00.000Z';

function caseRecord(id: string, domain: string, disposition: CaseDisposition): CaseRecord {
  return {
    id, domain, disposition, status: 'reviewing', reviewReasonCode: null, brandProfileIds: [], tags: [], notes: [], source: 'lookup',
    evidenceHistory: [{
      id: `e-${id}`, fingerprint: 'same-evidence', firstCapturedAt: '2026-08-01T00:00:00.000Z', capturedAt: '2026-08-05T00:00:00.000Z',
      source: 'lookup', inputHostname: null, scanDepth: 'deep', availability: 'registered', confidence: 'high', riskModelVersion: 1, riskScore: 50,
      opportunityModelVersion: 1, opportunityScore: 10, riskFactors: [], opportunityFactors: [], registrar: null, createdDate: null,
      expiryDate: null, nameservers: [], hasMx: null, hasSpf: null, hasDmarc: null, activityStatus: null,
      websiteProbeDetail: null, pageTitle: null, httpSummaryVersion: null, httpEvidenceStatus: null, httpFinalOrigin: null,
      httpResponseStatus: null, httpTransportSecurity: null, httpRedirectCount: null, httpCrossOriginRedirect: null,
      httpHttpsDowngrade: null, httpContentType: null, httpSecurityHeaders: null, faviconMatch: null, faviconNearMatch: null,
      reusesOfficialAssets: null, hasPasswordField: null, hasExternalFormAction: null, phishingLanguageMatch: null,
      mutationTypes: [],
    }],
    evidencePins: [],
    decisions: [{ id: `decision-${id}`, summary: 'Reviewed', rationale: 'Analyst rationale', confidence: 'unknown', confidenceBasis: '', evidencePinIds: [], createdAt: '2026-08-02T00:00:00.000Z' }],
    actions: [],
    assertions: [{ id: `assertion-${id}`, kind: 'hypothesis', statement: 'Review hypothesis', rationale: null, evidencePinIds: [], state: 'open', createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' }],
    manualTrail: [],
    sightings: [],
    observedEffects: { reviews: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    closures: { records: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z',
  };
}

test('case decision quality finds inconsistent dispositions and unsupported reasoning without changing cases', () => {
  const records = [caseRecord('one', 'one.example', 'expected'), caseRecord('two', 'two.example', 'suspicious')];
  const before = JSON.stringify(records);
  const report = buildCaseDecisionQualityReport(records);
  assert.equal(report.counts.inconsistent_disposition, 1);
  assert.equal(report.counts.disposition_without_reason, 2);
  assert.equal(report.counts.decision_without_evidence, 2);
  assert.equal(report.counts.strong_disposition_without_evidence, 0);
  assert.equal(report.counts.assertion_without_evidence, 2);
  assert.equal(report.counts.assertion_predates_evidence, 2);
  assert.equal(JSON.stringify(records), before);
  assert.match(report.limitation, /does not decide/u);
});

test('flags strong or operational states that have no supporting decision path', () => {
  const confirmed = caseRecord('confirmed', 'confirmed.example', 'confirmed_abuse');
  const escalated: CaseRecord = { ...caseRecord('escalated', 'escalated.example', 'suspicious'), status: 'escalated', reviewReasonCode: 'other' };
  const monitoring: CaseRecord = { ...caseRecord('monitoring', 'monitoring.example', 'suspicious'), status: 'monitoring', reviewReasonCode: 'other' };
  const report = buildCaseDecisionQualityReport([confirmed, escalated, monitoring]);
  assert.equal(report.counts.strong_disposition_without_evidence, 1);
  assert.equal(report.counts.escalation_without_action, 1);
  assert.equal(report.counts.monitoring_without_follow_up, 1);
});

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

test('free-text plans and negated assertions do not satisfy typed malware evidence', () => {
  let record = createCase({
    domain: 'review.example',
    tags: caseTagsWithTypes([], ['malware_distribution']),
  }, NOW);
  record = updateCase([record], record.id, {
    assertion: {
      kind: 'next_step',
      statement: 'Collect a payload hash later; no malware file was observed.',
      rationale: 'This is a collection plan, not retained technical evidence.',
    },
  }, NOW).record;
  assert.equal(buildCaseTypeEvidenceReadiness(record).rows.find((row) => row.id === 'technical_payload')?.state, 'missing');

  record = updateCase([record], record.id, {
    evidencePin: {
      label: 'Reviewed file digest',
      field: 'file.sha256',
      category: 'malware',
      source: 'Analyst-selected local artefact',
      value: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      observedAt: NOW,
    },
  }, NOW).record;
  assert.equal(buildCaseTypeEvidenceReadiness(record).rows.find((row) => row.id === 'technical_payload')?.state, 'present');
});

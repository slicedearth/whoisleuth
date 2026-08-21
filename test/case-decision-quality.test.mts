import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCaseDecisionQualityReport } from '../frontend/src/lib/analysis/case-decision-quality.ts';
import type { CaseRecord } from '../frontend/src/lib/analysis/case-record-contracts.ts';

function caseRecord(id: string, domain: string, disposition: string): CaseRecord {
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
    decisions: [{ id: `decision-${id}`, summary: 'Reviewed', rationale: 'Analyst rationale', evidencePinIds: [], createdAt: '2026-08-02T00:00:00.000Z' }],
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
  assert.equal(report.counts.assertion_without_evidence, 2);
  assert.equal(report.counts.assertion_predates_evidence, 2);
  assert.equal(JSON.stringify(records), before);
  assert.match(report.limitation, /does not decide/u);
});

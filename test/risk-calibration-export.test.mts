import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CaseRecord } from '../frontend/src/lib/analysis/case-record-model.ts';
import {
  buildRiskCalibrationDatasetExport,
  MAX_RISK_CALIBRATION_EXPORT_RECORDS,
} from '../frontend/src/lib/analysis/risk-calibration-export.ts';
import { parseRiskCalibrationDataset } from '../cli/risk-calibration.mts';

function caseRecord(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: 'case-1',
    domain: 'candidate.example',
    status: 'reviewing',
    disposition: 'confirmed_abuse',
    tags: ['private-tag'],
    notes: [{ id: 'note-1', body: 'private analyst note', createdAt: '2026-07-28T00:00:00.000Z' }],
    source: 'lookup',
    evidenceHistory: [{
      id: 'evidence-1',
      fingerprint: 'private-fingerprint',
      firstCapturedAt: '2026-07-28T00:00:00.000Z',
      capturedAt: '2026-07-28T00:00:00.000Z',
      source: 'lookup',
      scanDepth: 'deep',
      availability: 'registered',
      confidence: 'high',
      riskModelVersion: 5,
      riskScore: 88,
      opportunityScore: 20,
      riskFactors: [{ label: 'private factor label', points: 20 }],
      opportunityFactors: [],
      registrar: 'Private registrar',
      createdDate: '2026-07-20T00:00:00.000Z',
      expiryDate: null,
      nameservers: ['private.nameserver.example'],
      hasMx: true,
      hasSpf: false,
      hasDmarc: false,
      activityStatus: 'active',
      websiteProbeDetail: 'private probe detail',
      pageTitle: 'Private title',
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'complete',
      httpFinalOrigin: 'https://private.example',
      httpResponseStatus: 200,
      httpTransportSecurity: 'https',
      httpRedirectCount: 0,
      httpCrossOriginRedirect: false,
      httpHttpsDowngrade: false,
      httpContentType: 'text/html',
      httpSecurityHeaders: ['strict-transport-security'],
      faviconMatch: true,
      faviconNearMatch: false,
      reusesOfficialAssets: true,
      hasPasswordField: true,
      phishingLanguageMatch: 'private phrase',
      mutationTypes: ['dictionary', 'unsupported-private-mutation'],
    }],
    evidencePins: [],
    decisions: [],
    actions: [],
    assertions: [],
    manualTrail: [],
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('reviewed Risk calibration dataset export', () => {
  test('projects only selected reviewed cases into the existing CLI contract', () => {
    const selected = caseRecord();
    const unselected = caseRecord({ id: 'case-2', domain: 'other.example', disposition: 'false_positive' });
    const exported = buildRiskCalibrationDatasetExport([selected, unselected], ['case-1']);
    assert.equal(exported.records.length, 1);
    assert.deepEqual(exported.records[0]?.evidence, {
      availability: 'registered',
      activityStatus: 'active',
      mutationTypes: ['dictionary'],
      domainAgeDays: 8,
      faviconMatch: true,
      faviconNearMatch: false,
      reusesOfficialAssets: true,
      hasPasswordField: true,
      hasMx: true,
      hasSpf: false,
      hasDmarc: false,
    });
    const parsed = parseRiskCalibrationDataset(JSON.stringify(exported));
    assert.equal(parsed.records[0]?.domain, 'candidate.example');
    assert.equal(parsed.records[0]?.analystDisposition, 'confirmed_abuse');
  });

  test('does not export analyst notes, tags, scores, source payload details, or unsupported mutations', () => {
    const serialized = JSON.stringify(buildRiskCalibrationDatasetExport([caseRecord()], ['case-1']));
    for (const excluded of [
      'private analyst note', 'private-tag', 'private-fingerprint', 'private factor label',
      'Private registrar', 'private.nameserver.example', 'private probe detail', 'Private title',
      'https://private.example', 'private phrase', 'unsupported-private-mutation', '"riskScore"',
    ]) {
      assert.equal(serialized.includes(excluded), false, excluded);
    }
  });

  test('reports unreviewed, missing, duplicate, unsupported, and over-limit selections', () => {
    const records = Array.from({ length: MAX_RISK_CALIBRATION_EXPORT_RECORDS + 1 }, (_, index) => caseRecord({
      id: `case-${index}`,
      domain: `candidate-${index}.example`,
    }));
    records.push(caseRecord({ id: 'unreviewed', domain: 'unreviewed.example', disposition: 'unreviewed' }));
    records.push(caseRecord({ id: 'missing', domain: 'missing.example', evidenceHistory: [] }));
    records.push(caseRecord({
      id: 'unsupported',
      domain: 'unsupported.example',
      evidenceHistory: [{ ...caseRecord().evidenceHistory[0]!, availability: 'inconclusive' }],
    }));
    const selected = [...records.map((record) => record.id), 'case-0'];
    const exported = buildRiskCalibrationDatasetExport(records, selected);
    assert.equal(exported.records.length, MAX_RISK_CALIBRATION_EXPORT_RECORDS);
    assert.ok(exported.export.exclusions.some((item) => item.reason === 'record_limit'));
    assert.ok(exported.export.exclusions.some((item) => item.reason === 'duplicate_selection'));
  });
});

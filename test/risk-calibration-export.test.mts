import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CaseRecord } from '../frontend/src/lib/analysis/case-record-model.ts';
import {
  buildRiskCalibrationDatasetExport,
  MAX_RISK_CALIBRATION_EXPORT_RECORDS,
} from '../frontend/src/lib/analysis/risk-calibration-export.ts';
import { parseRiskCalibrationDataset } from '../cli/risk-calibration.mts';
import { MAX_RISK_CALIBRATION_RECORD_ID_LENGTH } from '../packages/contracts/risk-calibration.mts';

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
      inputHostname: null,
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
      hasExternalFormAction: true,
      phishingLanguageMatch: 'private phrase',
      mutationTypes: ['dictionary', 'unsupported-private-mutation'],
    }],
    evidencePins: [],
    decisions: [],
    actions: [],
    assertions: [],
    manualTrail: [],
    sightings: [],
    observedEffects: { reviews: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    closures: { records: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
    brandProfileIds: overrides.brandProfileIds ?? [],
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
      phishingLanguageMatch: 'matched',
      hasExternalFormAction: true,
      scanDepth: 'deep',
      observedAt: '2026-07-28T00:00:00.000Z',
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

  test('reports unreviewed, missing, duplicate, and unsupported selections', () => {
    const records = [
      caseRecord(),
      caseRecord({ id: 'unreviewed', domain: 'unreviewed.example', disposition: 'unreviewed' }),
      caseRecord({ id: 'missing', domain: 'missing.example', evidenceHistory: [] }),
      caseRecord({
      id: 'unsupported',
      domain: 'unsupported.example',
      evidenceHistory: [{ ...caseRecord().evidenceHistory[0]!, availability: 'inconclusive' }],
      }),
    ];
    const exported = buildRiskCalibrationDatasetExport(
      records,
      ['case-1', 'unreviewed', 'missing', 'unsupported', 'case-1'],
    );
    assert.equal(exported.records.length, 1);
    assert.ok(exported.export.exclusions.some((item) => item.reason === 'duplicate_selection'));
    assert.ok(exported.export.exclusions.some((item) => item.reason === 'unreviewed'));
    assert.ok(exported.export.exclusions.some((item) => item.reason === 'missing_evidence'));
    assert.ok(exported.export.exclusions.some((item) => item.reason === 'unsupported_availability'));
  });

  test('rejects an oversized selection before inspecting case records', () => {
    let caseReads = 0;
    const cases = new Proxy([] as CaseRecord[], {
      get(target, property, receiver) {
        caseReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(
      () => buildRiskCalibrationDatasetExport(
        cases,
        Array.from({ length: MAX_RISK_CALIBRATION_EXPORT_RECORDS + 1 }, (_, index) => `case-${index}`),
      ),
      /limited to 500 selected cases/u,
    );
    assert.equal(caseReads, 0);
  });

  test('snapshots one ordinary selection length and never consults iteration hooks', () => {
    let lengthDescriptors = 0;
    let lengthReads = 0;
    let iteratorReads = 0;
    const selected = new Proxy(['case-1'], {
      get(target, property, receiver) {
        if (property === 'length') lengthReads += 1;
        if (property === Symbol.iterator) iteratorReads += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        if (property === 'length') {
          lengthDescriptors += 1;
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
          return lengthDescriptors === 1 || !descriptor
            ? descriptor
            : { ...descriptor, value: MAX_RISK_CALIBRATION_EXPORT_RECORDS + 1 };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const exported = buildRiskCalibrationDatasetExport([caseRecord()], selected);
    assert.equal(exported.export.selected, 1);
    assert.equal(exported.export.included, 1);
    assert.equal(lengthDescriptors, 1);
    assert.equal(lengthReads, 0);
    assert.equal(iteratorReads, 0);
  });

  test('rejects empty, control-bearing, and overlength selected identifiers before Case access', () => {
    for (const identifier of [
      '',
      '   ',
      'case\n1',
      'x'.repeat(MAX_RISK_CALIBRATION_RECORD_ID_LENGTH + 1),
    ]) {
      let caseReads = 0;
      const cases = new Proxy([] as CaseRecord[], {
        get(target, property, receiver) {
          caseReads += 1;
          return Reflect.get(target, property, receiver);
        },
      });
      assert.throws(
        () => buildRiskCalibrationDatasetExport(cases, [identifier]),
        /bounded dense ordinary array/u,
      );
      assert.equal(caseReads, 0, JSON.stringify(identifier));
    }
  });

  test('rejects non-ordinary selections without invoking accessors or an over-limit tail', () => {
    const accessorSelection = ['case-1'];
    let accessorReads = 0;
    Object.defineProperty(accessorSelection, '0', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'case-1';
      },
    });
    assert.throws(
      () => buildRiskCalibrationDatasetExport([caseRecord()], accessorSelection),
      /bounded dense ordinary array/u,
    );
    assert.equal(accessorReads, 0);

    const oversized = Array.from(
      { length: MAX_RISK_CALIBRATION_EXPORT_RECORDS + 1 },
      (_, index) => `case-${index}`,
    );
    let tailDescriptors = 0;
    const hostileTail = new Proxy(oversized, {
      getOwnPropertyDescriptor(target, property) {
        if (property === String(MAX_RISK_CALIBRATION_EXPORT_RECORDS)) tailDescriptors += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    assert.throws(
      () => buildRiskCalibrationDatasetExport([caseRecord()], hostileTail),
      /limited to 500 selected cases/u,
    );
    assert.equal(tailDescriptors, 0);

    const sparse = new Array<string>(1);
    assert.throws(() => buildRiskCalibrationDatasetExport([caseRecord()], sparse), /dense ordinary array/u);
    const extra = ['case-1'] as string[] & { privateMarker?: string };
    extra.privateMarker = 'blocked';
    assert.throws(() => buildRiskCalibrationDatasetExport([caseRecord()], extra), /dense ordinary array/u);
    const customIterator = ['case-1'];
    Object.defineProperty(customIterator, Symbol.iterator, { value: function* iterator() { yield 'case-1'; } });
    assert.throws(() => buildRiskCalibrationDatasetExport([caseRecord()], customIterator), /dense ordinary array/u);
    const customPrototype = ['case-1'];
    Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
    assert.throws(() => buildRiskCalibrationDatasetExport([caseRecord()], customPrototype), /dense ordinary array/u);
    const revoked = Proxy.revocable(['case-1'], {});
    revoked.revoke();
    assert.throws(() => buildRiskCalibrationDatasetExport([caseRecord()], revoked.proxy), /dense ordinary array/u);
  });

  test('detaches and recursively freezes every emitted dataset value', () => {
    const source = caseRecord();
    const exported = buildRiskCalibrationDatasetExport([source], ['case-1']);
    const exportedMutations = exported.records[0]?.evidence.mutationTypes;
    assert.deepEqual(exportedMutations, ['dictionary']);
    source.evidenceHistory[0]!.mutationTypes.push('bitsquatting');
    assert.deepEqual(exportedMutations, ['dictionary']);
    assert.equal(Object.isFrozen(exported), true);
    assert.equal(Object.isFrozen(exported.records), true);
    assert.equal(Object.isFrozen(exported.records[0]), true);
    assert.equal(Object.isFrozen(exported.records[0]?.evidence), true);
    assert.equal(Object.isFrozen(exportedMutations), true);
    assert.equal(Object.isFrozen(exported.export), true);
    assert.equal(Object.isFrozen(exported.export.exclusions), true);
    assert.equal(Object.isFrozen(exported.limitations), true);
    assert.throws(() => (exportedMutations as string[]).push('homoglyph'));
  });
});

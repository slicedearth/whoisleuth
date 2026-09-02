import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as model from '../frontend/src/lib/analysis/case-model.ts';
import { buildCaseReport } from '../frontend/src/lib/analysis/case-report.ts';
import { requiredValue } from './value-assertions.mts';

const FIRST = '2026-08-20T00:00:00.000Z';
const SECOND = '2026-08-21T00:00:00.000Z';

function retainedEvidence(inputHostname: unknown) {
  return {
    inputHostname,
    scanDepth: 'deep',
    availability: 'registered',
    confidence: 'high',
    registrar: 'Reserved Registrar',
  };
}

describe('Case v14 exact submitted hostname', () => {
  test('normalises strict Unicode input to canonical lower-case A-label form and binds it to the Case parent', () => {
    assert.equal(
      model.normalizeEvidenceHostnameForCase('CAFÉ.Example.Test', 'example.test'),
      'xn--caf-dma.example.test',
    );
    assert.equal(
      model.normalizeEvidenceHostnameForCase('LOGIN.EXAMPLE.TEST.', 'example.test'),
      'login.example.test',
    );
  });

  test('rejects URI syntax, controls, malformed labels, oversized inputs, numeric pseudo-TLDs, and parent mismatches', () => {
    const invalid = [
      'https://login.example.test',
      'user:pass@login.example.test',
      'login.example.test:443',
      'login.example.test/path',
      'login.example.test?query=1',
      'login.example.test#fragment',
      ' login.example.test',
      'login.example.test ',
      'login\texample.test',
      'login\u0000.example.test',
      'bad_label.example.test',
      '-bad.example.test',
      'bad-.example.test',
      'bad..example.test',
      `${'a'.repeat(64)}.example.test`,
      `a.${'b'.repeat(model.MAX_EVIDENCE_DOMAIN_INPUT_LENGTH)}.test`,
      'login.example.123',
      'login.other.test',
    ];
    for (const value of invalid) {
      assert.equal(model.normalizeEvidenceHostnameForCase(value, 'example.test'), null, value);
    }
    assert.equal(model.normalizeEvidenceHostnameForCase('login.example.test', 'child.example.test'), null);
  });

  test('keeps Case identity registrable while deliberate create and refresh retain distinct exact hostnames', () => {
    const opened = model.createCase({
      domain: 'example.test',
      source: 'lookup',
      evidence: retainedEvidence('login.example.test'),
    }, FIRST);
    assert.equal(opened.domain, 'example.test');
    assert.equal(opened.evidenceHistory[0]?.inputHostname, 'login.example.test');

    const refreshed = model.updateCase([opened], opened.id, {
      source: 'lookup',
      evidence: retainedEvidence('account.example.test'),
    }, SECOND).record;
    assert.equal(refreshed.domain, 'example.test');
    assert.deepEqual(refreshed.evidenceHistory.map((snapshot) => snapshot.inputHostname), [
      'login.example.test',
      'account.example.test',
    ]);
    assert.notEqual(refreshed.evidenceHistory[0]?.fingerprint, refreshed.evidenceHistory[1]?.fingerprint);
    assert.deepEqual(
      model.compareCaseEvidence(refreshed.evidenceHistory[0], refreshed.evidenceHistory[1]),
      [],
    );
    assert.deepEqual(
      model.caseEvidenceIncomparableReasons(refreshed.evidenceHistory[0], refreshed.evidenceHistory[1]),
      ['observation-context'],
    );
  });

  test('does not keep an otherwise empty snapshot alive solely for hostname context', () => {
    assert.equal(model.normalizeSnapshot({
      inputHostname: 'login.example.test',
      capturedAt: FIRST,
    }, { caseDomain: 'example.test' }), null);
  });

  test('rechecks the latest exact hostname without borrowing an older hostname when context is unknown', () => {
    const first = model.createCase({
      domain: 'example.test', source: 'lookup', evidence: retainedEvidence('login.example.test'),
    }, FIRST);
    assert.equal(model.caseLookupTarget(first), 'login.example.test');
    const current = { ...first, evidenceHistory: [...first.evidenceHistory, { ...first.evidenceHistory[0]!, id: 'new', inputHostname: null, capturedAt: SECOND }] };
    assert.equal(model.caseLookupTarget(current), 'example.test');
  });

  test('migrates published Case versions without reconstructing a hostname from the Case domain or URL evidence', () => {
    const publishedV2 = model.normalizeCaseStore({
      version: 13,
      cases: [{
        domain: 'example.test',
        evidenceHistory: [{
          scanDepth: 'deep',
          availability: 'registered',
          confidence: 'high',
          registrar: 'Reserved Registrar',
          capturedAt: FIRST,
        }],
        createdAt: FIRST,
        updatedAt: FIRST,
      }],
    });
    assert.equal(publishedV2.version, 14);
    assert.equal(publishedV2.cases[0]?.evidenceHistory[0]?.inputHostname, null);

    const migrated = model.normalizeCaseStore({
      version: 12,
      cases: [{
        domain: 'example.test',
        evidenceHistory: [{
          scanDepth: 'deep',
          availability: 'registered',
          confidence: 'high',
          registrar: 'Reserved Registrar',
          httpSummaryVersion: 1,
          httpEvidenceStatus: 'success',
          httpFinalOrigin: 'https://redirect.example.test',
          capturedAt: FIRST,
        }],
        createdAt: FIRST,
        updatedAt: FIRST,
      }],
    });
    assert.equal(migrated.version, 14);
    assert.equal(migrated.cases[0]?.evidenceHistory[0]?.inputHostname, null);

    const current = model.normalizeCaseStore({
      version: 14,
      cases: [{
        domain: 'example.test',
        evidenceHistory: [{ ...retainedEvidence('login.example.test'), capturedAt: FIRST }],
        createdAt: FIRST,
        updatedAt: FIRST,
      }],
    });
    assert.equal(current.cases[0]?.evidenceHistory[0]?.inputHostname, 'login.example.test');
  });

  test('round-trips the field while report v10 excludes it and makes no environmental-change claim', () => {
    const first = model.createCase({
      domain: 'example.test',
      source: 'lookup',
      evidence: retainedEvidence('login.example.test'),
    }, FIRST);
    const record = model.updateCase([first], first.id, {
      source: 'lookup',
      evidence: retainedEvidence('account.example.test'),
    }, SECOND).record;
    const exported = model.buildCaseExport([record], SECOND);
    const imported = requiredValue(model.mergeCases([], exported).cases[0]);
    assert.deepEqual(imported.evidenceHistory.map((snapshot) => snapshot.inputHostname), [
      'login.example.test',
      'account.example.test',
    ]);

    const report = buildCaseReport(imported, { generatedAt: SECOND });
    const serialized = JSON.stringify(report.json);
    assert.equal(serialized.includes('login.example.test'), false);
    assert.equal(serialized.includes('account.example.test'), false);
    assert.equal(report.json.evidenceTimeline[1]?.changes, null);
    assert.equal(report.json.evidenceTimeline[1]?.hasIncomparableChange, false);
    assert.deepEqual(report.json.evidenceTimeline[1]?.incomparableReasons, []);
  });
});

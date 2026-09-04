import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  caseInvestigationContextAssertion,
  type CaseRecord,
} from '../packages/cases/case-model.mts';
import {
  CASE_TYPE_TAG_PREFIX,
  caseFreeformTags,
  caseIncidentTargetAssertion,
  caseIncidentTargets,
  caseNumber,
  caseResponseIncidentUrls,
  caseTagsWithTypes,
  caseTypeIds,
  caseTypeSummary,
  formattedCaseNumber,
  normalizeCaseIncidentTargetUrl,
} from '../packages/cases/case-workflow-metadata.mts';

const NOW = '2026-09-04T00:00:00.000Z';

function caseRecord(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: '018f4e5a-9b2c-7d3e-8f10-112233445566',
    domain: 'example.test',
    status: 'reviewing',
    disposition: 'suspicious',
    reviewReasonCode: null,
    brandProfileIds: [],
    tags: [],
    notes: [],
    source: 'manual',
    evidenceHistory: [],
    evidencePins: [],
    decisions: [],
    actions: [],
    assertions: [],
    manualTrail: [],
    sightings: [],
    observedEffects: { reviews: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    closures: { records: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    branches: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('Case workflow metadata', () => {
  test('keeps controlled Case types separate from ordinary tags', () => {
    const tags = caseTagsWithTypes(['campaign-a', `${CASE_TYPE_TAG_PREFIX}phishing`, 'priority'], [
      'impersonation',
      'copyright_infringement',
      'invalid',
    ]);
    assert.deepEqual(caseTypeIds(tags), ['impersonation', 'copyright_infringement']);
    assert.deepEqual(caseFreeformTags(tags), ['campaign-a', 'priority']);
    assert.equal(caseTypeSummary(tags), 'Impersonation and Copyright infringement');
    assert.deepEqual(caseFreeformTags(['case-type:future-type']), ['case-type:future-type']);
    assert.throws(
      () => caseTagsWithTypes(Array.from({ length: 20 }, (_, index) => `tag-${index}`), ['phishing']),
      /limited to 20 combined values/iu,
    );
    assert.equal(
      caseTagsWithTypes(['Priority', 'priority'], Array.from({ length: 19 }, () => 'phishing')).length,
      2,
    );
  });

  test('derives a stable, readable Case number from the complete immutable id', () => {
    const first = caseNumber('018f4e5a-9b2c-7d3e-8f10-112233445566');
    const second = caseNumber('018f4e5a-9b2c-7d3e-8f10-112233445567');
    assert.match(first, /^WS-[0-7][0-9A-HJKMNP-TV-Z]{25}$/u);
    assert.notEqual(first, second);
    assert.equal(caseNumber('018f4e5a-9b2c-7d3e-8f10-112233445566'), first);
    assert.equal(formattedCaseNumber('018f4e5a-9b2c-7d3e-8f10-112233445566').replaceAll('-', ''), first.replaceAll('-', ''));
    assert.match(caseNumber('legacy-case-id'), /^WS-L[0-9A-HJKMNP-TV-Z]{2}-[0-9A-HJKMNP-TV-Z]+$/u);
    assert.notEqual(caseNumber('legacy-case-id'), caseNumber('legacy-case-ie'));
  });

  test('normalises exact HTTP URLs and rejects credentials or non-web schemes', () => {
    assert.equal(normalizeCaseIncidentTargetUrl(' HTTPS://Social.Example/path?id=1#post '), 'https://social.example/path?id=1#post');
    assert.equal(normalizeCaseIncidentTargetUrl('https://user:secret@social.example/path'), null);
    assert.equal(normalizeCaseIncidentTargetUrl('javascript:alert(1)'), null);
    assert.equal(normalizeCaseIncidentTargetUrl('not a url'), null);
  });

  test('projects active incident targets without converting them into verified facts', () => {
    const input = caseIncidentTargetAssertion('https://social.example/post/7');
    const context = caseInvestigationContextAssertion({
      objective: 'Review login.',
      incidentUrl: 'https://example.test/login',
      retainExactUrl: true,
    });
    assert.equal(input.kind, 'unknown');
    const record = caseRecord({
      assertions: [
        { id: 'target-open', ...input, rationale: input.rationale, evidencePinIds: [], createdAt: NOW, updatedAt: NOW },
        { id: 'target-resolved', ...caseIncidentTargetAssertion('https://social.example/post/8'), rationale: input.rationale, evidencePinIds: [], state: 'resolved', createdAt: NOW, updatedAt: NOW },
        { id: 'context', kind: 'next_step', statement: context.statement, rationale: context.rationale, evidencePinIds: [], evidenceRelations: [], state: 'open', createdAt: NOW, updatedAt: NOW },
      ],
    });
    assert.deepEqual(caseIncidentTargets(record).map((item) => item.url), ['https://social.example/post/7']);
    assert.equal(caseIncidentTargets(record, { includeResolved: true }).length, 2);
    assert.deepEqual(caseResponseIncidentUrls(record), [
      'https://social.example/post/7',
      'https://example.test/login',
    ]);
  });
});

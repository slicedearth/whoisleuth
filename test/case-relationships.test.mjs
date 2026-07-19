import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildInvestigationCaseRelationships,
  buildCaseRelationships,
  CASE_RELATIONSHIP_VERSION,
  MAX_CASE_RELATIONSHIP_GROUPS,
  MAX_CASES_PER_RELATIONSHIP,
  MAX_RELATIONSHIP_CASES,
  filterInvestigationCaseRelationships,
} from '../frontend/src/lib/analysis/case-relationships.js';
import {
  buildInvestigationProjection,
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
} from '../frontend/src/lib/analysis/investigation-projection.ts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model.js';
import { CAMPAIGN_SCHEMA_VERSION } from '../frontend/src/lib/analysis/campaign-model.js';

const CAPTURED = '2026-07-01T00:00:00.000Z';

function snapshot(overrides = {}) {
  return {
    capturedAt: CAPTURED,
    scanDepth: 'deep',
    availability: 'registered',
    nameservers: [],
    ...overrides,
  };
}

function caseRecord(id, domain, evidenceHistory = [snapshot()]) {
  return {
    id,
    domain,
    status: 'reviewing',
    disposition: 'unreviewed',
    source: 'lookup',
    evidenceHistory,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: CAPTURED,
  };
}

function investigationFixture() {
  const historical = (source, capturedAt, riskScore) => snapshot({
    capturedAt,
    firstCapturedAt: capturedAt,
    source,
    nameservers: ['ns.shared.invalid'],
    riskModelVersion: 5,
    riskScore,
  });
  const current = (domain) => snapshot({
    capturedAt: '2026-07-18T00:00:00.000Z',
    source: 'lookup',
    nameservers: ['ns.shared.invalid'],
    riskModelVersion: 5,
    riskScore: 20,
    httpSummaryVersion: 1,
    httpEvidenceStatus: 'success',
    httpFinalOrigin: `https://shared-origin.invalid/${domain}`,
    httpResponseStatus: 200,
  });
  return buildInvestigationProjection({
    cases: {
      version: CASE_SCHEMA_VERSION,
      cases: [
        caseRecord('case-a', 'a.invalid', [historical('import', '2026-07-01T00:00:00.000Z', 10), current('a')]),
        caseRecord('case-b', 'b.invalid', [historical('monitor', '2026-07-02T00:00:00.000Z', 11), current('b')]),
      ],
    },
    campaigns: {
      version: CAMPAIGN_SCHEMA_VERSION,
      campaigns: [{
        id: 'campaign-one',
        name: 'Shared infrastructure review',
        description: '',
        domains: ['a.invalid', 'b.invalid'],
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      }],
    },
  }, { generatedAt: '2026-07-19T00:00:00.000Z' });
}

describe('cross-case relationships', () => {
  test('returns a stable empty versioned result for non-array input', () => {
    assert.deepEqual(buildCaseRelationships(null), {
      version: CASE_RELATIONSHIP_VERSION,
      groups: [],
      truncated: false,
      limitations: [
        'Cross-case relationships compare only the latest compact evidence already stored in this browser and make no new network requests.',
        'Shared infrastructure or destinations are investigation pivots, not proof of common ownership, coordination, intent, or maliciousness.',
        'Older evidence snapshots may contain different observations; this comparison is not a historical campaign reconstruction.',
      ],
    });
  });

  test('groups exact normalized nameserver sets independent of input order and casing', () => {
    const result = buildCaseRelationships([
      caseRecord('case-a', 'A.INVALID', [snapshot({ nameservers: ['NS2.SHARED.INVALID.', 'ns1.shared.invalid'] })]),
      caseRecord('case-b', 'b.invalid', [snapshot({ nameservers: ['NS1.SHARED.INVALID.', 'ns2.shared.invalid.'] })]),
    ]);
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].type, 'nameserver_set');
    assert.equal(result.groups[0].value, 'ns1.shared.invalid · ns2.shared.invalid');
    assert.deepEqual(result.groups[0].cases.map((item) => item.domain), ['a.invalid', 'b.invalid']);
  });

  test('does not group partial or merely overlapping nameserver sets', () => {
    const result = buildCaseRelationships([
      caseRecord('case-a', 'a.invalid', [snapshot({ nameservers: ['ns1.shared.invalid', 'ns2.shared.invalid'] })]),
      caseRecord('case-b', 'b.invalid', [snapshot({ nameservers: ['ns1.shared.invalid'] })]),
    ]);
    assert.deepEqual(result.groups, []);
  });

  test('groups exact final origins only from comparable deep HTTP evidence', () => {
    const shared = {
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://landing.invalid',
      httpResponseStatus: 200,
    };
    const result = buildCaseRelationships([
      caseRecord('case-a', 'a.invalid', [snapshot(shared)]),
      caseRecord('case-b', 'b.invalid', [snapshot({ ...shared, httpEvidenceStatus: 'partial' })]),
      caseRecord('case-c', 'c.invalid', [snapshot({ ...shared, scanDepth: 'fast' })]),
    ]);
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].type, 'http_final_origin');
    assert.deepEqual(result.groups[0].cases.map((item) => item.domain), ['a.invalid', 'b.invalid']);
  });

  test('rejects failed, credentialed, and malformed final origins', () => {
    const values = [
      { httpEvidenceStatus: 'failed', httpFinalOrigin: 'https://landing.invalid', httpResponseStatus: 200 },
      { httpEvidenceStatus: 'success', httpFinalOrigin: 'https://user:pass@landing.invalid', httpResponseStatus: 200 },
      { httpEvidenceStatus: 'success', httpFinalOrigin: 'not an origin', httpResponseStatus: 200 },
    ];
    const cases = values.flatMap((value, index) => [
      caseRecord(`a-${index}`, `a${index}.invalid`, [snapshot({ httpSummaryVersion: 1, ...value })]),
      caseRecord(`b-${index}`, `b${index}.invalid`, [snapshot({ httpSummaryVersion: 1, ...value })]),
    ]);
    assert.deepEqual(buildCaseRelationships(cases).groups, []);
  });

  test('compares only the retained origin when an imported summary contains a path', () => {
    const evidence = snapshot({
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://landing.invalid/private/path?token=discarded',
      httpResponseStatus: 200,
    });
    const result = buildCaseRelationships([
      caseRecord('case-a', 'a.invalid', [evidence]),
      caseRecord('case-b', 'b.invalid', [evidence]),
    ]);
    assert.equal(result.groups[0].value, 'https://landing.invalid');
  });

  test('uses the newest valid snapshot instead of array position', () => {
    const older = snapshot({ capturedAt: '2026-06-01T00:00:00.000Z', nameservers: ['ns.old.invalid'] });
    const newer = snapshot({ capturedAt: '2026-07-01T00:00:00.000Z', nameservers: ['ns.new.invalid'] });
    const result = buildCaseRelationships([
      caseRecord('case-a', 'a.invalid', [newer, older]),
      caseRecord('case-b', 'b.invalid', [snapshot({ nameservers: ['ns.new.invalid'] })]),
    ]);
    assert.equal(result.groups[0].value, 'ns.new.invalid');
  });

  test('revalidates malformed case ids, domains, and snapshots at the comparison boundary', () => {
    const valid = caseRecord('case-a', 'a.invalid', [snapshot({ nameservers: ['ns.shared.invalid'] })]);
    const malformed = [
      caseRecord('bad id', 'b.invalid', [snapshot({ nameservers: ['ns.shared.invalid'] })]),
      caseRecord('case-c', 'not a domain', [snapshot({ nameservers: ['ns.shared.invalid'] })]),
      { id: 'case-d', domain: 'd.invalid', evidenceHistory: [{ capturedAt: 'bad', nameservers: ['ns.shared.invalid'] }] },
    ];
    assert.deepEqual(buildCaseRelationships([valid, ...malformed]).groups, []);
  });

  test('refuses over-limit histories and duplicate case identities instead of comparing partial input', () => {
    const oversizedHistory = Array.from({ length: 26 }, (_, index) => snapshot({
      capturedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      nameservers: ['ns.shared.invalid'],
    }));
    const result = buildCaseRelationships([
      caseRecord('case-a', 'a.invalid', oversizedHistory),
      caseRecord('case-b', 'b.invalid', [snapshot({ nameservers: ['ns.shared.invalid'] })]),
      caseRecord('case-b', 'duplicate.invalid', [snapshot({ nameservers: ['ns.shared.invalid'] })]),
    ]);
    assert.deepEqual(result.groups, []);
    assert.equal(result.truncated, true);
  });

  test('does not mutate source case records', () => {
    const source = [
      caseRecord('case-a', 'a.invalid', [snapshot({ nameservers: ['NS.SHARED.INVALID'] })]),
      caseRecord('case-b', 'b.invalid', [snapshot({ nameservers: ['ns.shared.invalid'] })]),
    ];
    const before = structuredClone(source);
    buildCaseRelationships(source);
    assert.deepEqual(source, before);
  });

  test('sorts groups deterministically by relationship family then value', () => {
    const commonHttp = { httpSummaryVersion: 1, httpEvidenceStatus: 'success', httpFinalOrigin: 'https://shared.invalid', httpResponseStatus: 200 };
    const result = buildCaseRelationships([
      caseRecord('case-a', 'a.invalid', [snapshot({ nameservers: ['ns.z.invalid'], ...commonHttp })]),
      caseRecord('case-b', 'b.invalid', [snapshot({ nameservers: ['ns.z.invalid'], ...commonHttp })]),
      caseRecord('case-c', 'c.invalid', [snapshot({ nameservers: ['ns.a.invalid'] })]),
      caseRecord('case-d', 'd.invalid', [snapshot({ nameservers: ['ns.a.invalid'] })]),
    ]);
    assert.deepEqual(result.groups.map((group) => `${group.type}:${group.value}`), [
      'nameserver_set:ns.a.invalid',
      'nameserver_set:ns.z.invalid',
      'http_final_origin:https://shared.invalid',
    ]);
  });

  test('caps input cases and discloses truncation', () => {
    const cases = Array.from({ length: MAX_RELATIONSHIP_CASES + 1 }, (_, index) => (
      caseRecord(`case-${index}`, `d${index}.invalid`, [snapshot({ nameservers: ['ns.shared.invalid'] })])
    ));
    const result = buildCaseRelationships(cases);
    assert.equal(result.truncated, true);
    assert.equal(result.groups[0].cases.length, MAX_CASES_PER_RELATIONSHIP);
  });

  test('caps relationship groups after deterministic sorting', () => {
    const cases = [];
    for (let index = 0; index < MAX_CASE_RELATIONSHIP_GROUPS + 1; index += 1) {
      cases.push(
        caseRecord(`a-${index}`, `a${index}.invalid`, [snapshot({ nameservers: [`ns${index}.invalid`] })]),
        caseRecord(`b-${index}`, `b${index}.invalid`, [snapshot({ nameservers: [`ns${index}.invalid`] })]),
      );
    }
    const result = buildCaseRelationships(cases);
    assert.equal(result.groups.length, MAX_CASE_RELATIONSHIP_GROUPS);
    assert.equal(result.truncated, true);
  });
});

describe('projection-backed cross-case relationships', () => {
  test('groups retained historical observations with bounded source provenance and campaign scope', () => {
    const projection = investigationFixture();
    const before = structuredClone(projection);
    const result = buildInvestigationCaseRelationships(projection);
    assert.equal(result.state, 'ready');
    assert.equal(result.projectionVersion, INVESTIGATION_PROJECTION_VERSION);
    assert.equal(result.groups.length, 2);
    const nameservers = result.groups.find((group) => group.type === 'nameserver_set');
    assert.deepEqual(nameservers.cases.map((item) => item.domain), ['a.invalid', 'b.invalid']);
    assert.deepEqual(nameservers.campaigns.map((item) => item.label), ['Shared infrastructure review']);
    assert.deepEqual(nameservers.sources, ['import', 'lookup', 'monitor']);
    assert.equal(nameservers.firstObservedAt, '2026-07-01T00:00:00.000Z');
    assert.equal(nameservers.lastObservedAt, '2026-07-18T00:00:00.000Z');
    assert.equal(nameservers.complete, null);
    assert.ok(nameservers.observations.every((item) => item.store === 'cases'));
    assert.deepEqual(result.scopeOptions.map((item) => item.value), ['case:case-a', 'case:case-b', 'campaign:campaign-one']);
    assert.deepEqual(projection, before);
  });

  test('applies source, time, completeness, type, and case or campaign filters together', () => {
    const summary = buildInvestigationCaseRelationships(investigationFixture());
    const filtered = filterInvestigationCaseRelationships(summary, {
      type: 'nameserver_set',
      source: 'import',
      period: '30d',
      completeness: 'unknown',
      scope: 'campaign:campaign-one',
    });
    assert.equal(filtered.groups.length, 1);
    assert.deepEqual(filtered.filters, {
      type: 'nameserver_set',
      source: 'import',
      period: '30d',
      completeness: 'unknown',
      scope: 'campaign:campaign-one',
    });
    assert.equal(filterInvestigationCaseRelationships(summary, { source: 'not-retained' }).filters.source, 'all');
    assert.equal(filterInvestigationCaseRelationships(summary, { period: 'bad' }).filters.period, 'all');
  });

  test('reports absent, malformed, and future projection contracts without interpreting them', () => {
    assert.equal(buildInvestigationCaseRelationships(null).state, 'absent');
    assert.equal(buildInvestigationCaseRelationships({ schema: 'wrong', version: 1 }).state, 'invalid');
    const future = buildInvestigationCaseRelationships({
      schema: INVESTIGATION_PROJECTION_SCHEMA,
      version: INVESTIGATION_PROJECTION_VERSION + 1,
    });
    assert.equal(future.state, 'unsupported');
    assert.match(future.limitations[0], /newer than supported/);
  });

  test('does not treat a historical pivot as current when it falls outside the requested period', () => {
    const projection = buildInvestigationProjection({
      cases: {
        version: CASE_SCHEMA_VERSION,
        cases: [
          caseRecord('old-a', 'old-a.invalid', [snapshot({ capturedAt: '2025-01-01T00:00:00.000Z', nameservers: ['ns.old.invalid'] })]),
          caseRecord('old-b', 'old-b.invalid', [snapshot({ capturedAt: '2025-01-02T00:00:00.000Z', nameservers: ['ns.old.invalid'] })]),
        ],
      },
    }, { generatedAt: '2026-07-19T00:00:00.000Z' });
    const summary = buildInvestigationCaseRelationships(projection);
    assert.equal(summary.groups.length, 1);
    assert.equal(filterInvestigationCaseRelationships(summary, { period: '365d' }).groups.length, 0);
    assert.equal(filterInvestigationCaseRelationships(summary, { period: 'all' }).groups.length, 1);
  });

  test('marks a group and summary partial when referenced provenance is unavailable', () => {
    const projection = investigationFixture();
    const relationship = projection.relationships.find((item) => item.type === 'domain_uses_nameserver_set');
    relationship.sourceObservationIds.push('observation:missing');
    const summary = buildInvestigationCaseRelationships(projection);
    const nameservers = summary.groups.find((group) => group.type === 'nameserver_set');
    assert.equal(nameservers.truncated, true);
    assert.equal(summary.truncated, true);
    assert.equal(filterInvestigationCaseRelationships(summary, { completeness: 'partial' }).groups.length, 1);
  });
});

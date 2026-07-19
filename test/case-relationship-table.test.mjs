import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCaseRelationshipTable,
  CASE_RELATIONSHIP_TABLE_VERSION,
  MAX_RELATIONSHIP_TABLE_MEMBERS,
  MAX_RELATIONSHIP_TABLE_QUERY_LENGTH,
  MAX_RELATIONSHIP_TABLE_ROWS,
  projectCaseRelationshipTable,
} from '../frontend/src/lib/analysis/case-relationship-table.js';
import { buildCaseRelationships } from '../frontend/src/lib/analysis/case-relationships.js';

const CAPTURED = '2026-07-14T00:00:00.000Z';

function snapshot(overrides = {}) {
  return { capturedAt: CAPTURED, scanDepth: 'deep', availability: 'registered', nameservers: [], ...overrides };
}

function caseRecord(id, domain, evidence = snapshot()) {
  return { id, domain, evidenceHistory: [evidence] };
}

function relationshipFixture() {
  const http = { httpSummaryVersion: 1, httpEvidenceStatus: 'success', httpFinalOrigin: 'https://shared.invalid', httpResponseStatus: 200 };
  return [
    caseRecord('ns-a', 'alpha.invalid', snapshot({ nameservers: ['ns.shared.invalid'] })),
    caseRecord('ns-b', 'bravo.invalid', snapshot({ nameservers: ['ns.shared.invalid'] })),
    caseRecord('http-a', 'charlie.invalid', snapshot(http)),
    caseRecord('http-b', 'delta.invalid', snapshot(http)),
  ];
}

describe('case relationship table projection', () => {
  test('returns a stable empty contract for non-array input', () => {
    const result = buildCaseRelationshipTable(null);
    assert.equal(result.version, CASE_RELATIONSHIP_TABLE_VERSION);
    assert.deepEqual(result.rows, []);
    assert.equal(result.totalRelationships, 0);
    assert.equal(result.matchingRelationships, 0);
    assert.equal(result.currentPage, 1);
    assert.equal(result.pageCount, 1);
    assert.equal(result.pageSize, MAX_RELATIONSHIP_TABLE_ROWS);
    assert.equal(result.rangeStart, 0);
    assert.equal(result.rangeEnd, 0);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.filters, { type: 'all', query: '', sort: 'type', direction: 'asc' });
  });

  test('projects every relationship with full counts and bounded members', () => {
    const result = buildCaseRelationshipTable(relationshipFixture());
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows.map((row) => row.type), ['nameserver_set', 'http_final_origin']);
    assert.ok(result.rows.every((row) => row.caseCount === 2 && row.omittedCases === 0));
  });

  test('projecting a prebuilt summary matches the compatible raw-case wrapper', () => {
    const cases = relationshipFixture();
    const options = { type: 'http_final_origin', query: 'shared', sort: 'value', direction: 'desc' };
    assert.deepEqual(
      projectCaseRelationshipTable(buildCaseRelationships(cases), options),
      buildCaseRelationshipTable(cases, options),
    );
  });

  test('filters by exact relationship family', () => {
    const result = buildCaseRelationshipTable(relationshipFixture(), { type: 'http_final_origin' });
    assert.equal(result.matchingRelationships, 1);
    assert.equal(result.rows[0].type, 'http_final_origin');
  });

  test('search matches values, methods, labels, and member domains case-insensitively', () => {
    assert.equal(buildCaseRelationshipTable(relationshipFixture(), { query: 'SHARED.INVALID' }).matchingRelationships, 2);
    assert.equal(buildCaseRelationshipTable(relationshipFixture(), { query: 'normalized set' }).rows[0].type, 'nameserver_set');
    assert.equal(buildCaseRelationshipTable(relationshipFixture(), { query: 'final website' }).rows[0].type, 'http_final_origin');
    assert.equal(buildCaseRelationshipTable(relationshipFixture(), { query: 'bravo.invalid' }).rows[0].type, 'nameserver_set');
  });

  test('normalizes and bounds hostile query text', () => {
    const query = `\u0000\n  ${'X'.repeat(MAX_RELATIONSHIP_TABLE_QUERY_LENGTH + 20)}  `;
    const result = buildCaseRelationshipTable(relationshipFixture(), { query });
    assert.equal(result.filters.query.length, MAX_RELATIONSHIP_TABLE_QUERY_LENGTH);
    assert.equal(result.filters.query, 'x'.repeat(MAX_RELATIONSHIP_TABLE_QUERY_LENGTH));
  });

  test('sorts by value in either direction with stable tiebreakers', () => {
    const asc = buildCaseRelationshipTable(relationshipFixture(), { sort: 'value', direction: 'asc' });
    const desc = buildCaseRelationshipTable(relationshipFixture(), { sort: 'value', direction: 'desc' });
    assert.deepEqual(desc.rows.map((row) => row.value), [...asc.rows.map((row) => row.value)].reverse());
  });

  test('sorts by member count without changing the retained members', () => {
    const cases = [
      ...relationshipFixture(),
      caseRecord('ns-c', 'echo.invalid', snapshot({ nameservers: ['ns.shared.invalid'] })),
    ];
    const result = buildCaseRelationshipTable(cases, { sort: 'member_count', direction: 'desc' });
    assert.deepEqual(result.rows.map((row) => row.caseCount), [3, 2]);
    assert.deepEqual(result.rows[0].cases.map((item) => item.domain), ['alpha.invalid', 'bravo.invalid', 'echo.invalid']);
  });

  test('invalid option values fall back to documented defaults', () => {
    const result = buildCaseRelationshipTable(relationshipFixture(), { type: 'bad', sort: 42, direction: 'sideways' });
    assert.deepEqual(result.filters, { type: 'all', query: '', sort: 'type', direction: 'asc' });
  });

  test('caps case pivots per row and discloses omissions', () => {
    const cases = Array.from({ length: MAX_RELATIONSHIP_TABLE_MEMBERS + 3 }, (_, index) => (
      caseRecord(`shared-${index}`, `shared-${index}.invalid`, snapshot({ nameservers: ['ns.large.invalid'] }))
    ));
    const result = buildCaseRelationshipTable(cases);
    assert.equal(result.rows[0].caseCount, MAX_RELATIONSHIP_TABLE_MEMBERS + 3);
    assert.equal(result.rows[0].cases.length, MAX_RELATIONSHIP_TABLE_MEMBERS);
    assert.equal(result.rows[0].omittedCases, 3);
    assert.equal(result.truncated, true);
  });

  test('paginates table rows after filtering and sorting without reporting ordinary pages as partial', () => {
    const cases = [];
    for (let index = 0; index < MAX_RELATIONSHIP_TABLE_ROWS + 2; index++) {
      cases.push(
        caseRecord(`a-${index}`, `a-${index}.invalid`, snapshot({ nameservers: [`ns-${index}.invalid`] })),
        caseRecord(`b-${index}`, `b-${index}.invalid`, snapshot({ nameservers: [`ns-${index}.invalid`] })),
      );
    }
    const first = buildCaseRelationshipTable(cases);
    assert.equal(first.totalRelationships, MAX_RELATIONSHIP_TABLE_ROWS + 2);
    assert.equal(first.matchingRelationships, MAX_RELATIONSHIP_TABLE_ROWS + 2);
    assert.equal(first.rows.length, MAX_RELATIONSHIP_TABLE_ROWS);
    assert.equal(first.currentPage, 1);
    assert.equal(first.pageCount, 2);
    assert.equal(first.rangeStart, 1);
    assert.equal(first.rangeEnd, MAX_RELATIONSHIP_TABLE_ROWS);
    assert.equal(first.truncated, false);

    const second = buildCaseRelationshipTable(cases, { page: 2 });
    assert.equal(second.rows.length, 2);
    assert.equal(second.currentPage, 2);
    assert.equal(second.pageCount, 2);
    assert.equal(second.rangeStart, MAX_RELATIONSHIP_TABLE_ROWS + 1);
    assert.equal(second.rangeEnd, MAX_RELATIONSHIP_TABLE_ROWS + 2);
    assert.equal(second.truncated, false);

    assert.equal(buildCaseRelationshipTable(cases, { page: 99 }).currentPage, 2);
    assert.equal(buildCaseRelationshipTable(cases, { page: 0 }).currentPage, 1);
    assert.equal(buildCaseRelationshipTable(cases, { page: 1.5 }).currentPage, 1);
  });

  test('a restrictive filter can reduce an otherwise capped table cleanly', () => {
    const cases = [];
    for (let index = 0; index < MAX_RELATIONSHIP_TABLE_ROWS + 2; index++) {
      cases.push(
        caseRecord(`a-${index}`, `a-${index}.invalid`, snapshot({ nameservers: [`ns-${index}.invalid`] })),
        caseRecord(`b-${index}`, `b-${index}.invalid`, snapshot({ nameservers: [`ns-${index}.invalid`] })),
      );
    }
    const result = buildCaseRelationshipTable(cases, { query: 'ns-51.invalid' });
    assert.equal(result.matchingRelationships, 1);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].value, 'ns-51.invalid');
  });

  test('preserves source truncation from the underlying comparison boundary', () => {
    const cases = Array.from({ length: 501 }, (_, index) => (
      caseRecord(`case-${index}`, `case-${index}.invalid`, snapshot({ nameservers: ['ns.all.invalid'] }))
    ));
    const result = buildCaseRelationshipTable(cases);
    assert.equal(result.truncated, true);
  });

  test('does not mutate source records or option objects', () => {
    const cases = relationshipFixture();
    const options = { query: 'shared', sort: 'member_count', direction: 'desc' };
    const beforeCases = structuredClone(cases);
    const beforeOptions = structuredClone(options);
    buildCaseRelationshipTable(cases, options);
    assert.deepEqual(cases, beforeCases);
    assert.deepEqual(options, beforeOptions);
  });

  test('filters projection-backed rows without dropping their retained provenance', () => {
    const group = {
      type: 'nameserver_set',
      label: 'Shared nameserver set',
      method: 'Exact retained set',
      value: 'ns.shared.invalid',
      cases: [{ id: 'alpha', domain: 'alpha.invalid' }, { id: 'bravo', domain: 'bravo.invalid' }],
      campaigns: [{ id: 'campaign-one', label: 'Review' }],
      description: 'Retained pivot.',
      sources: ['monitor'],
      scanDepths: ['deep'],
      classifications: ['normalized'],
      firstObservedAt: CAPTURED,
      lastObservedAt: CAPTURED,
      complete: null,
      truncated: false,
      observations: [{ id: 'obs-1', source: 'monitor', store: 'cases', observedAt: CAPTURED }],
      omittedObservations: 0,
      limitations: [],
    };
    const result = projectCaseRelationshipTable({
      state: 'ready',
      generatedAt: CAPTURED,
      groups: [group],
      sources: ['monitor'],
      scopeOptions: [{ value: 'campaign:campaign-one', kind: 'campaign', label: 'Review' }],
      truncated: false,
      limitations: [],
    }, { source: 'monitor', scope: 'campaign:campaign-one', completeness: 'unknown', query: 'review' });
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0].observations, group.observations);
    assert.deepEqual(result.rows[0].campaigns, group.campaigns);
    assert.equal(result.filters.source, 'monitor');
    assert.equal(result.filters.scope, 'campaign:campaign-one');
  });
});

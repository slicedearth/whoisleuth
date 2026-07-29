import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyCaseRelationshipClusterAdjustments,
  buildCaseRelationshipClusterExport,
  buildCaseRelationshipClusters,
  COMMON_INFRASTRUCTURE_CASE_THRESHOLD,
} from '../frontend/src/lib/analysis/case-relationship-clusters.ts';
import type {
  CaseRelationshipGroup,
  CaseRelationshipSummary,
} from '../frontend/src/lib/analysis/case-relationships.ts';

const NOW = '2026-07-29T00:00:00.000Z';

function relationship(
  type: string,
  value: string,
  cases: string[],
  overrides: Partial<CaseRelationshipGroup> = {},
): CaseRelationshipGroup {
  return {
    type,
    label: `Shared ${type}`,
    method: 'Exact retained fixture',
    value,
    cases: cases.map((domain) => ({ id: domain.replaceAll('.', '-'), domain })),
    description: 'Fixture relationship.',
    sources: ['fixture_source'],
    firstObservedAt: NOW,
    lastObservedAt: NOW,
    complete: true,
    truncated: false,
    limitations: [],
    ...overrides,
  };
}

function summary(groups: CaseRelationshipGroup[]): CaseRelationshipSummary {
  return {
    version: 1,
    groups,
    truncated: false,
    limitations: ['Fixture limitation.'],
  };
}

describe('case relationship clusters', () => {
  test('builds deterministic connected components while retaining source groups', () => {
    const source = summary([
      relationship('nameserver_set', 'ns.shared.invalid', ['one.invalid', 'two.invalid']),
      relationship('certificate', 'sha256:fixture', ['two.invalid', 'three.invalid']),
      relationship('tracking_identifier', 'tracker-fixture', ['separate.invalid', 'other.invalid']),
    ]);

    const first = buildCaseRelationshipClusters(source);
    const second = buildCaseRelationshipClusters({ ...source, groups: [...source.groups].reverse() });

    assert.equal(first.clusters.length, 2);
    assert.deepEqual(
      first.clusters.map((cluster) => cluster.cases.map((item) => item.domain)),
      [
        ['one.invalid', 'three.invalid', 'two.invalid'],
        ['other.invalid', 'separate.invalid'],
      ],
    );
    assert.deepEqual(
      first.clusters.map((cluster) => cluster.id).sort(),
      second.clusters.map((cluster) => cluster.id).sort(),
    );
    assert.equal(first.clusters[0]?.groups.length, 2);
    assert.deepEqual(first.clusters[0]?.sources, ['fixture_source']);
    assert.equal(first.clusters[0]?.complete, true);
  });

  test('qualifies high-degree common infrastructure without discarding it', () => {
    const cases = Array.from(
      { length: COMMON_INFRASTRUCTURE_CASE_THRESHOLD },
      (_, index) => `common-${index}.invalid`,
    );
    const result = buildCaseRelationshipClusters(summary([
      relationship('ip_address', '192.0.2.1', cases),
    ]));

    assert.equal(result.clusters[0]?.confidence, 'shared_infrastructure');
    assert.match(result.clusters[0]?.limitations[0] ?? '', /shared by many cases/iu);
  });

  test('applies review-only labels, split, merge, and dismissal controls', () => {
    const source = buildCaseRelationshipClusters(summary([
      relationship('certificate', 'certificate-a', ['one.invalid', 'two.invalid']),
      relationship('tracking_identifier', 'tracker-b', ['three.invalid', 'four.invalid']),
    ]));
    const [first, second] = source.clusters;
    assert.ok(first);
    assert.ok(second);

    const reviewed = applyCaseRelationshipClusterAdjustments(source, {
      labels: { [first.id]: 'Reviewed campaign' },
      dismissed: [second.id],
      merged: [[first.id, second.id]],
      splitCases: { [first.id]: [first.cases[0]!.id] },
    });

    assert.equal(reviewed.clusters.length, 1);
    assert.equal(reviewed.clusters[0]?.label, 'Reviewed campaign');
    assert.equal(reviewed.clusters[0]?.dismissed, false);
    assert.equal(reviewed.clusters[0]?.cases.length, 3);
    assert.equal(reviewed.clusters[0]?.sourceClusterIds.length, 2);
    assert.equal(source.clusters[0]?.cases.length, 2, 'source evidence remains unchanged');
  });

  test('exports the bounded reviewed view with explicit limitations', () => {
    const source = buildCaseRelationshipClusters(summary([
      relationship('favicon', 'favicon-a', ['one.invalid', 'two.invalid']),
    ]));
    const exported = buildCaseRelationshipClusterExport(source, {
      labels: {},
      dismissed: [],
      merged: [],
      splitCases: {},
    }, NOW);

    assert.equal(exported.schema, 'whoisleuth.reviewed-relationship-clusters');
    assert.equal(exported.generatedAt, NOW);
    assert.ok(Array.isArray(exported.limitations));
    assert.match(JSON.stringify(exported), /not ownership/iu);
  });
});

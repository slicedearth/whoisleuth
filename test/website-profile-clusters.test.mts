import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildWebsiteClusterAssertion,
  buildWebsiteProfileClusters,
  filterWebsiteProfileClusters,
} from '../frontend/src/lib/analysis/website-profile-clusters.ts';
import type { WebsiteProfileSnapshot } from '../frontend/src/lib/analysis/website-snapshot-model.ts';

function snapshot(
  domain: string,
  id: string,
  observedAt: string,
  technology = 'commerce',
  digest = 'a'.repeat(64),
): WebsiteProfileSnapshot {
  return {
    id,
    domain,
    observedAt,
    savedAt: observedAt,
    complete: true,
    truncated: false,
    technologies: [{ id: technology, name: 'Example platform', category: 'commerce', confidence: 'high' }],
    posture: [],
    identity: {
      normalizedHtml: digest,
      visibleText: null,
      domStructure: null,
      formStructure: null,
      resourceHosts: null,
      trackingIdentifiers: null,
      faviconHash: null,
    },
    identityValues: {
      resourceHosts: [],
      trackingIdentifiers: [],
      formActionOrigins: [],
    },
    sources: [{ source: 'http', state: 'success' }],
  };
}

describe('website-profile clusters', () => {
  test('groups the latest snapshot per domain by exact technology and identity', () => {
    const summary = buildWebsiteProfileClusters([
      snapshot('one.example', 'old', '2026-01-01T00:00:00.000Z', 'old', 'b'.repeat(64)),
      snapshot('one.example', 'new', '2026-02-01T00:00:00.000Z'),
      snapshot('two.example', 'two', '2026-02-02T00:00:00.000Z'),
    ]);
    assert.equal(summary.domainsReviewed, 2);
    assert.equal(summary.clusters.some((item) => item.kind === 'technology' && item.domains.length === 2), true);
    assert.equal(summary.clusters.some((item) => item.kind === 'identity' && item.domains.length === 2), true);
    const identity = summary.clusters.find((item) => item.kind === 'identity');
    assert.equal(identity?.firstObservedAt, '2026-02-01T00:00:00.000Z');
    assert.equal(identity?.lastObservedAt, '2026-02-02T00:00:00.000Z');
  });

  test('does not create a cross-domain cluster from repeated snapshots of one domain', () => {
    const summary = buildWebsiteProfileClusters([
      snapshot('one.example', 'one', '2026-01-01T00:00:00.000Z'),
      snapshot('one.example', 'two', '2026-02-01T00:00:00.000Z'),
    ]);
    assert.equal(summary.clusters.length, 0);
  });

  test('searches by domain, technology, and relationship kind', () => {
    const summary = buildWebsiteProfileClusters([
      snapshot('one.example', 'one', '2026-02-01T00:00:00.000Z'),
      snapshot('two.example', 'two', '2026-02-02T00:00:00.000Z'),
    ]);
    assert.equal(filterWebsiteProfileClusters(summary, 'two.example').length, 2);
    assert.equal(filterWebsiteProfileClusters(summary, 'Example platform').length, 1);
    assert.equal(filterWebsiteProfileClusters(summary, 'identity').length, 1);
  });

  test('keeps incomplete source quality explicit in a cluster', () => {
    const first = { ...snapshot('one.example', 'one', '2026-02-01T00:00:00.000Z'), complete: false };
    const summary = buildWebsiteProfileClusters([
      first,
      snapshot('two.example', 'two', '2026-02-02T00:00:00.000Z'),
    ]);
    assert.equal(summary.clusters.every((item) => item.complete === false), true);
    assert.match(summary.limitations.join(' '), /not converted into absence/i);
  });

  test('builds explainable weighted relationships from compatible latest components', () => {
    const first = snapshot('one.example', 'one', '2026-02-01T00:00:00.000Z');
    const second = {
      ...snapshot('two.example', 'two', '2026-02-02T00:00:00.000Z', 'different', 'b'.repeat(64)),
      identity: {
        ...snapshot('two.example', 'two', '2026-02-02T00:00:00.000Z').identity,
        normalizedHtml: 'c'.repeat(64),
        faviconHash: 'd'.repeat(64),
        formStructure: 'e'.repeat(64),
      },
      identityValues: {
        resourceHosts: ['shared-cdn.example'],
        trackingIdentifiers: [{ type: 'analytics', value: 'TRACK-1' }],
        formActionOrigins: ['https://forms.example'],
      },
    };
    const withValues = {
      ...first,
      identity: { ...first.identity, faviconHash: 'd'.repeat(64), formStructure: 'e'.repeat(64) },
      identityValues: {
        resourceHosts: ['shared-cdn.example'],
        trackingIdentifiers: [{ type: 'analytics', value: 'TRACK-1' }],
        formActionOrigins: ['https://forms.example'],
      },
    };
    const summary = buildWebsiteProfileClusters([withValues, second]);
    const weighted = summary.clusters.find((item) => item.kind === 'similarity');
    assert.ok(weighted);
    assert.ok((weighted.score ?? 0) >= 30);
    assert.equal(weighted.contributingFields.some((item) => item.field === 'identityValues.formActionOrigins'), true);
    assert.match(weighted.limitations.join(' '), /does not prove ownership/i);

    const assertion = buildWebsiteClusterAssertion(weighted, 'one.example');
    assert.equal(assertion.kind, 'hypothesis');
    assert.match(assertion.rationale, /review lead only/i);
  });
});

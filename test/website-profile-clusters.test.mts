import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildWebsiteClusterAssertion,
  buildWebsiteProfileClusters,
  filterWebsiteProfileClusters,
  WEBSITE_PROFILE_CLUSTER_VERSION,
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
    profileProvenance: { technology: { version: 11, state: 'known' }, securityPosture: { version: 2, state: 'known' }, pageFingerprint: { version: 1, state: 'known' } },
    technologies: [{ id: technology, name: 'Example platform', category: 'commerce', confidence: 'high', roles: ['application_platform'] }],
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
    dependencies: [],
    certificate: null,
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

  test('excludes every weighted component from incomplete input while retaining qualified exact pivots', () => {
    const rich = (domain: string): WebsiteProfileSnapshot => ({
      ...snapshot(domain, domain, '2026-02-01T00:00:00.000Z'),
      identity: {
        normalizedHtml: 'a'.repeat(64), visibleText: '0123456789abcdef',
        domStructure: 'b'.repeat(64), formStructure: 'c'.repeat(64),
        resourceHosts: 'd'.repeat(64), trackingIdentifiers: 'e'.repeat(64), faviconHash: 'f'.repeat(64),
      },
      identityValues: {
        resourceHosts: ['shared.example'],
        trackingIdentifiers: [{ type: 'analytics', value: 'TRACK-1' }],
        formActionOrigins: ['https://forms.example'],
      },
    });
    const first = rich('one.example');
    const second = rich('two.example');
    const control = buildWebsiteProfileClusters([first, second]);
    assert.equal(control.version, WEBSITE_PROFILE_CLUSTER_VERSION);
    assert.deepEqual(control.clusters.find((item) => item.kind === 'similarity')?.contributingFields.map((field) => field.field), [
      'identity.faviconHash', 'identity.normalizedHtml', 'identity.trackingIdentifiers',
      'identity.formStructure', 'identity.resourceHosts', 'identity.domStructure',
      'identityValues.trackingIdentifiers', 'identityValues.formActionOrigins', 'identityValues.resourceHosts',
      'technologies', 'identity.visibleText',
    ]);
    const incomplete = [
      { ...first, complete: false }, { ...first, truncated: true },
      ...['partial', 'blocked', 'error', 'unsupported', 'not_found'].map((state) => ({
        ...first, sources: [{ source: 'http', state }],
      })),
      { ...first, sources: [{ source: 'http', state: 'success' }, { source: 'HTTP', state: 'partial' }] },
    ];
    for (const candidate of incomplete) for (const pair of [[candidate, second], [second, candidate]]) {
      const summary = buildWebsiteProfileClusters(pair);
      assert.equal(summary.clusters.some((item) => item.kind === 'similarity'), false);
      assert.ok(summary.clusters.length > 0, 'positive exact observations remain reviewable');
      assert.ok(summary.clusters.every((item) => item.score === null && !item.complete));
      for (const cluster of summary.clusters) {
        assert.equal(cluster.observations.find((item) => item.domain === first.domain)?.complete, false);
      }
    }
  });

  test('the reported fifty-point pair requires complete HTTP but not unrelated sources', () => {
    const first = snapshot('one.example', 'one', '2026-02-01T00:00:00.000Z');
    const second = snapshot('two.example', 'two', '2026-02-02T00:00:00.000Z');
    const withIcon = (value: WebsiteProfileSnapshot) => ({ ...value, identity: { ...value.identity, faviconHash: 'd'.repeat(64) } });
    const left = withIcon(first);
    const right = withIcon(second);
    assert.equal(buildWebsiteProfileClusters([left, right]).clusters.find((item) => item.kind === 'similarity')?.score, 50);
    const unrelated = { ...left, sources: [...left.sources, { source: 'dns', state: 'partial' }, { source: 'tls', state: 'unavailable' }] };
    assert.equal(buildWebsiteProfileClusters([unrelated, right]).clusters.find((item) => item.kind === 'similarity')?.score, 50);
    assert.equal(buildWebsiteProfileClusters([{ ...left, complete: false, truncated: true }, right])
      .clusters.some((item) => item.kind === 'similarity'), false);
  });

  test('detector compatibility gates only technology weight and admits equal historical versions', () => {
    const first = snapshot('one.example', 'one', '2026-02-01T00:00:00.000Z');
    const second = snapshot('two.example', 'two', '2026-02-02T00:00:00.000Z');
    const pair = [first, second].map((item) => ({ ...item, identity: { ...item.identity, faviconHash: 'd'.repeat(64) } }));
    const left = pair[0]!;
    const right = pair[1]!;
    for (const technology of [{ version: 12, state: 'known' }, { version: null, state: 'legacy_unknown' }] as const) {
      const candidate = { ...left, profileProvenance: { ...left.profileProvenance, technology } };
      for (const inputs of [[candidate, right], [right, candidate]]) {
        const summary = buildWebsiteProfileClusters(inputs);
        const weighted = summary.clusters.find((item) => item.kind === 'similarity');
        assert.ok(weighted);
        assert.equal(weighted.score, 44);
        assert.deepEqual(weighted.contributingFields.map((item) => item.field), ['identity.faviconHash', 'identity.normalizedHtml']);
        assert.ok(summary.clusters.some((item) => item.kind === 'technology'), 'exact observed identifier remains a qualified pivot');
      }
    }
    const historical = pair.map((item) => ({ ...item, profileProvenance: {
      ...item.profileProvenance, technology: { version: 5, state: 'known' as const },
    } }));
    assert.equal(buildWebsiteProfileClusters(historical).clusters.find((item) => item.kind === 'similarity')?.score, 50);
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

  test('weights the complete unique shared set rather than its display prefix', () => {
    const hosts = Array.from({ length: 30 }, (_, index) => `resource-${index}.example`);
    const withHosts = (domain: string, values: string[]): WebsiteProfileSnapshot => ({
      ...snapshot(domain, domain, '2026-02-01T00:00:00.000Z', domain),
      identity: { ...snapshot(domain, domain, '2026-02-01T00:00:00.000Z').identity, faviconHash: 'f'.repeat(64) },
      identityValues: { resourceHosts: values, trackingIdentifiers: [], formActionOrigins: [] },
    });
    const pair = [withHosts('one.example', hosts), withHosts('two.example', [...hosts].reverse())];
    const before = structuredClone(pair);
    const summary = buildWebsiteProfileClusters(pair);
    const weighted = summary.clusters.find((item) => item.kind === 'similarity');
    assert.ok(weighted);
    assert.equal(summary.version, 4);
    assert.equal(weighted.score, 54, '24 favicon + 20 page digest + 10 complete resource set');
    const contribution = weighted.contributingFields.find((field) => field.field === 'identityValues.resourceHosts');
    assert.equal(contribution?.weight, 10);
    assert.deepEqual(contribution?.sharedValues, [...hosts].sort());
    assert.match(contribution?.detail ?? '', /^30 shared values/u);
    assert.ok(filterWebsiteProfileClusters(summary, 'resource-29.example').some((item) => item.id === weighted.id));
    assert.deepEqual(pair, before);

    const duplicates = buildWebsiteProfileClusters([
      withHosts('one.example', Array.from({ length: 30 }, () => 'shared.example')),
      withHosts('two.example', ['shared.example']),
    ]).clusters.find((item) => item.kind === 'similarity');
    assert.equal(duplicates?.score, 54, 'duplicate input values do not change set cardinality');
    const half = buildWebsiteProfileClusters([pair[0]!, withHosts('two.example', hosts.slice(0, 15))])
      .clusters.find((item) => item.kind === 'similarity');
    assert.equal(half?.score, 49);
    const disjoint = buildWebsiteProfileClusters([pair[0]!, withHosts('two.example', ['unshared.example'])])
      .clusters.find((item) => item.kind === 'similarity');
    assert.equal(disjoint?.score, 44);
  });

  test('a complete thirty-value overlap can establish the minimum weighted review lead', () => {
    const pair = ['one.example', 'two.example'].map((domain): WebsiteProfileSnapshot => ({
      ...snapshot(domain, domain, '2026-02-01T00:00:00.000Z', domain),
      technologies: [],
      identity: { ...snapshot(domain, domain, '2026-02-01T00:00:00.000Z').identity, normalizedHtml: null, faviconHash: 'f'.repeat(64) },
      identityValues: { resourceHosts: Array.from({ length: 30 }, (_, index) => `resource-${index}.example`), trackingIdentifiers: [], formActionOrigins: [] },
    }));
    assert.equal(buildWebsiteProfileClusters(pair).clusters.find((item) => item.kind === 'similarity')?.score, 34);
  });

  test('retains every pair and exact member of a full sixty-domain saved workspace', () => {
    const snapshots = Array.from({ length: 60 }, (_, index) => {
      const domain = `target-${String(index).padStart(2, '0')}.example`;
      const item = snapshot(domain, domain, '2026-02-01T00:00:00.000Z');
      return { ...item, identity: { ...item.identity, faviconHash: 'f'.repeat(64) } };
    });
    const summary = buildWebsiteProfileClusters(snapshots);
    assert.equal(summary.snapshotsReviewed, 60);
    assert.equal(summary.domainsReviewed, 60);
    assert.equal(summary.truncated, false);
    const pairs = summary.clusters.filter((item) => item.kind === 'similarity');
    const exact = summary.clusters.filter((item) => item.kind !== 'similarity');
    assert.equal(pairs.length, 60 * 59 / 2);
    assert.equal(exact.length, 3);
    assert.ok(exact.every((item) => item.domains.length === 60 && item.observations.length === 60 && !item.truncated));
    assert.ok(pairs.some((item) => item.domains.join(',') === 'target-58.example,target-59.example'));
    assert.equal(filterWebsiteProfileClusters(summary, 'target-59.example').length, 59 + 3);
    assert.equal(new Set(summary.clusters.map((item) => item.id)).size, summary.clusters.length);
  });

  test('reports uninspected snapshots separately from complete retained relationships', () => {
    const snapshots = Array.from({ length: 121 }, (_, index) => snapshot(`target-${index}.example`, `snapshot-${index}`, '2026-02-01T00:00:00.000Z'));
    const summary = buildWebsiteProfileClusters(snapshots);
    assert.equal(summary.snapshotsReviewed, 120);
    assert.equal(summary.domainsReviewed, 120);
    assert.equal(summary.truncated, true);
    assert.match(summary.limitations[0] ?? '', /reviewed 120 of 121 supplied snapshots; 1 were not inspected/u);
    assert.ok(summary.clusters.every((item) => item.domains.length === 120 && item.complete && !item.truncated));
    assert.equal(filterWebsiteProfileClusters(summary, 'target-120.example').length, 0);
  });

  test('field admission counts omissions and withholds weights from the affected snapshot', () => {
    const first = snapshot('one.example', 'one', '2026-02-01T00:00:00.000Z');
    const second = snapshot('two.example', 'two', '2026-02-01T00:00:00.000Z');
    const oversized = {
      ...first,
      technologies: Array.from({ length: 41 }, () => first.technologies[0]!),
      identityValues: {
        resourceHosts: Array.from({ length: 33 }, (_, index) => `resource-${index}.example`),
        trackingIdentifiers: Array.from({ length: 32 }, (_, index) => ({ type: 'analytics', value: `TRACK-${index}` })),
        formActionOrigins: Array.from({ length: 24 }, (_, index) => `https://form-${index}.example`),
      },
    };
    const summary = buildWebsiteProfileClusters([oversized, second]);
    assert.equal(summary.truncated, true);
    const details = summary.limitations.join(' ');
    for (const text of ['1 additional technology values', '3 additional resource hosts', '2 additional tracking identifiers', '4 additional form-action origins']) assert.ok(details.includes(text));
    assert.ok(summary.clusters.length > 0);
    assert.ok(summary.clusters.every((item) => item.score === null && !item.complete && item.truncated));
    assert.ok(summary.clusters.every((item) => item.observations.find((row) => row.domain === 'one.example')?.truncated));
  });
});

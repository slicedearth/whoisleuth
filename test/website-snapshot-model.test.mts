import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_WEBSITE_SNAPSHOTS,
  WEBSITE_SNAPSHOT_SCHEMA,
  WEBSITE_SNAPSHOT_SCHEMA_VERSION,
  buildWebsiteSnapshotExport,
  compareWebsiteSnapshots,
  deleteWebsiteSnapshot,
  mergeWebsiteSnapshots,
  normalizeWebsiteProfileSnapshot,
  normalizeWebsiteSnapshotStore,
  saveWebsiteSnapshot,
  serializeWebsiteSnapshotStore,
} from '../frontend/src/lib/analysis/website-snapshot-model.ts';

const EARLIER = '2026-07-27T02:00:00.000Z';
const LATER = '2026-07-28T02:00:00.000Z';

function snapshot(
  id: string,
  observedAt = EARLIER,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    domain: 'snapshot.invalid',
    observedAt,
    savedAt: observedAt,
    complete: true,
    truncated: false,
    technologies: [{ id: 'cms-one', name: 'CMS One', category: 'cms', confidence: 'high', raw: 'excluded' }],
    posture: [{ id: 'https', state: 'observed', explanation: 'excluded' }],
    identity: {
      normalizedHtml: 'a'.repeat(64),
      visibleText: 'b'.repeat(64),
      domStructure: null,
      formStructure: null,
      resourceHosts: null,
      trackingIdentifiers: null,
      faviconHash: null,
      rawHtml: '<html>excluded</html>',
    },
    identityValues: {
      resourceHosts: ['assets.snapshot.invalid', 'not a host'],
      trackingIdentifiers: [{ type: 'analytics', value: 'TRACK-1' }, { type: 'invalid!', value: 'drop' }],
      formActionOrigins: ['https://forms.snapshot.invalid', 'https://forms.snapshot.invalid/path?secret=1'],
      rawAction: 'excluded',
    },
    sources: [{ source: 'page', state: 'success', response: 'excluded' }],
    dependencies: [{ recordType: 'CNAME', target: 'service.example.net', state: 'active', qualification: 'inconclusive', serviceFamily: 'Hosted service', raw: 'excluded' }],
    certificate: {
      fingerprintSha256: 'c'.repeat(64),
      spkiFingerprintSha256: 'd'.repeat(64),
      subject: 'snapshot.invalid',
      issuer: 'Fixture issuing authority',
      serialNumber: '00a1',
      validFrom: EARLIER,
      validTo: LATER,
      authorized: true,
      hostnameMatches: true,
      validity: 'valid',
      complete: true,
      truncated: false,
      rawCertificate: 'excluded',
    },
    rawWhois: 'excluded',
    ...overrides,
  };
}

describe('website profile snapshots', () => {
  test('normalizes only the bounded curated evidence contract', () => {
    const normalized = normalizeWebsiteProfileSnapshot(snapshot('snapshot-one'));

    assert.ok(normalized);
    assert.equal(normalized.domain, 'snapshot.invalid');
    assert.deepEqual(normalized.technologies, [{
      id: 'cms-one',
      name: 'CMS One',
      category: 'cms',
      confidence: 'high',
    }]);
    assert.deepEqual(normalized.posture, [{ id: 'https', state: 'observed' }]);
    assert.deepEqual(normalized.sources, [{ source: 'page', state: 'success' }]);
    assert.deepEqual(normalized.dependencies, [{ recordType: 'CNAME', target: 'service.example.net', state: 'active', qualification: 'inconclusive', serviceFamily: 'Hosted service' }]);
    assert.deepEqual(normalized.identityValues, {
      resourceHosts: ['assets.snapshot.invalid'],
      trackingIdentifiers: [{ type: 'analytics', value: 'TRACK-1' }],
      formActionOrigins: ['https://forms.snapshot.invalid'],
    });
    assert.deepEqual(normalized.certificate, {
      observationVersion: 1,
      source: 'tls',
      collectionDepth: 'deep',
      fingerprintSha256: 'c'.repeat(64),
      spkiFingerprintSha256: 'd'.repeat(64),
      subject: 'snapshot.invalid',
      issuer: 'Fixture issuing authority',
      serialNumber: '00a1',
      validFrom: EARLIER,
      validTo: LATER,
      authorized: true,
      hostnameMatches: true,
      validity: 'valid',
      complete: true,
      truncated: false,
    });
    assert.equal(JSON.stringify(normalized).includes('rawWhois'), false);
    assert.equal(JSON.stringify(normalized).includes('rawHtml'), false);
    assert.equal(JSON.stringify(normalized).includes('response'), false);
  });

  test('compares compatible observations without inferring compromise', () => {
    const result = compareWebsiteSnapshots(
      snapshot('snapshot-one'),
      snapshot('snapshot-two', LATER, {
        technologies: [{ id: 'commerce-one', name: 'Commerce One', category: 'commerce', confidence: 'medium' }],
        posture: [{ id: 'https', state: 'not_observed' }],
        sources: [{ source: 'page', state: 'partial' }],
        dependencies: [{ recordType: 'CNAME', target: 'service.example.net', state: 'unresolved', qualification: 'known_deprovision_pattern', serviceFamily: 'Hosted service' }],
        identity: {
          normalizedHtml: 'c'.repeat(64),
          visibleText: null,
          domStructure: null,
          formStructure: null,
          resourceHosts: null,
          trackingIdentifiers: null,
          faviconHash: null,
        },
        identityValues: {
          resourceHosts: ['new.snapshot.invalid'],
          trackingIdentifiers: [],
          formActionOrigins: [],
        },
        certificate: {
          fingerprintSha256: 'e'.repeat(64),
          spkiFingerprintSha256: 'f'.repeat(64),
          subject: 'snapshot.invalid',
          issuer: 'Replacement fixture authority',
          serialNumber: '00a2',
          validFrom: EARLIER,
          validTo: LATER,
          authorized: true,
          hostnameMatches: true,
          validity: 'valid',
          complete: true,
          truncated: false,
        },
      }),
    );

    assert.equal(result.compatible, true);
    assert.ok(result.changes.some((change) => change.field === 'technology.cms-one' && change.state === 'removed'));
    assert.ok(result.changes.some((change) => change.field === 'technology.commerce-one' && change.state === 'added'));
    assert.ok(result.changes.some((change) => change.field === 'posture.https' && change.state === 'changed'));
    assert.ok(result.changes.some((change) => change.field === 'source.page' && change.state === 'changed'));
    assert.equal(result.dependencyTransitions[0]?.state, 'active_to_deprovision_cue');
    assert.match(result.dependencyTransitions[0]?.detail ?? '', /does not establish claimability/u);
    assert.ok(result.changes.some((change) => change.field === 'identity.visibleText' && change.state === 'unavailable'));
    assert.ok(result.changes.some((change) => change.field === 'identityValues.resourceHosts.assets.snapshot.invalid' && change.state === 'removed'));
    assert.ok(result.changes.some((change) => change.field === 'certificate.fingerprintSha256' && change.state === 'changed'));
    assert.ok(result.changes.some((change) => change.field === 'certificate.issuer' && change.state === 'changed'));
  });

  test('reports different domains and collection completeness as incomparable', () => {
    const differentDomain = compareWebsiteSnapshots(
      snapshot('snapshot-one'),
      snapshot('snapshot-two', LATER, { domain: 'other.invalid' }),
    );
    assert.equal(differentDomain.compatible, false);
    assert.equal(differentDomain.changes[0]?.state, 'incomparable');

    const partial = compareWebsiteSnapshots(
      snapshot('snapshot-one'),
      snapshot('snapshot-two', LATER, { complete: false, truncated: true }),
    );
    assert.ok(partial.changes.some((change) => change.field === 'completeness' && change.state === 'incomparable'));
  });

  test('enforces global and per-domain retention caps and supports explicit deletion', () => {
    let retained: unknown = [];
    for (let index = 0; index < MAX_WEBSITE_SNAPSHOTS + 20; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      retained = saveWebsiteSnapshot(retained, snapshot(`snapshot-${index}`, `2026-06-${day}T02:00:00.000Z`, {
        domain: `snapshot-${index % 8}.invalid`,
      }));
    }
    const normalized = normalizeWebsiteSnapshotStore(retained);
    assert.ok(normalized.snapshots.length <= MAX_WEBSITE_SNAPSHOTS);
    assert.ok([...new Set(normalized.snapshots.map((item) => item.domain))]
      .every((domain) => normalized.snapshots.filter((item) => item.domain === domain).length <= 12));

    const first = normalized.snapshots[0];
    assert.ok(first);
    assert.equal(deleteWebsiteSnapshot(normalized, first.id).some((item) => item.id === first.id), false);
    assert.doesNotThrow(() => serializeWebsiteSnapshotStore(normalized));
  });

  test('merges import records non-destructively and refuses future schemas', () => {
    const local = [snapshot('snapshot-one')];
    const incoming = buildWebsiteSnapshotExport([
      snapshot('snapshot-one', LATER),
      snapshot('snapshot-two', LATER),
    ], LATER);
    const result = mergeWebsiteSnapshots(local, incoming);

    assert.deepEqual({ added: result.added, updated: result.updated, skipped: result.skipped }, {
      added: 1,
      updated: 1,
      skipped: 0,
    });
    assert.equal(result.snapshots.length, 2);
    assert.throws(
      () => normalizeWebsiteSnapshotStore({
        schema: WEBSITE_SNAPSHOT_SCHEMA,
        version: WEBSITE_SNAPSHOT_SCHEMA_VERSION + 1,
        snapshots: [],
      }),
      /newer schema/,
    );
  });

  test('rejects reader-only versions without partial interpretation', () => {
    for (const version of [1, 2, 3]) {
      const unsupported = { schema: WEBSITE_SNAPSHOT_SCHEMA, version, snapshots: [snapshot('private-snapshot')] };
      const before = structuredClone(unsupported);
      assert.throws(() => normalizeWebsiteSnapshotStore(unsupported), /unsupported schema/u);
      assert.deepEqual(unsupported, before);
    }
  });
});

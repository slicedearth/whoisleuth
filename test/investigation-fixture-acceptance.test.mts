import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { INVESTIGATION_PORTABILITY_LIFECYCLE_FAMILY } from '../packages/contracts/investigation-portability.mts';
import { sha256ArtifactDigestV2 } from '../packages/evidence/artifact-integrity.mts';
import { buildBulkReviewManifest } from '../packages/investigation/bulk-review-export.mts';

const fixtureRaw = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const currentPath = 'test/fixtures/investigation-portability/bulk-review-manifest-v3.json';
const publicPath = 'test/fixtures/investigation-portability/bulk-review-manifest-v2-current.json';
const invalidPath = 'test/fixtures/investigation-portability/bulk-review-manifest-v2.json';

test('declared whole-integrity investigation fixtures pass the executable verifier, not only metadata checks', async (context) => {
  const family = INVESTIGATION_PORTABILITY_LIFECYCLE_FAMILY;
  const contracts = family.contracts.filter((contract) => contract.readable && contract.canonicalisation === 'sorted-json-v2');
  assert.ok(contracts.length > 0);
  for (const contract of contracts) {
    assert.ok(contract.fixtureIds.length > 0, `${contract.schema} v${contract.version} requires independent bytes`);
    for (const id of contract.fixtureIds) {
      await context.test(id, async () => {
        const fixture = family.fixtures.find((candidate) => candidate.id === id);
        assert.ok(fixture);
        const report = await verifyOfflineArtifact(await fixtureRaw(fixture.path));
        assert.equal(report.artifact.schema, contract.schema);
        assert.equal(report.artifact.version, contract.version);
        assert.equal(report.checks.structure, 'verified');
        assert.equal(report.checks.contentIntegrity, 'verified');
        assert.equal(report.checks.contentIntegrityScope, 'whole_artifact');
      });
    }
  }
});

test('the populated Bulk fixture matches the current writer and independently preserves selection, uncertainty and privacy', async () => {
  const view = {
    primaryFilter: 'all', mutationFilter: '', signalFilters: [], sourceFilter: '' as const, lifecycleFilter: '' as const,
    ageFilter: '' as const, mailFilter: '' as const, registrarFilter: '', caseDispositionFilter: '', reviewStateFilter: '' as const,
    groupBy: '' as const, sortKey: 'risk' as const, sortDirection: -1 as const,
  };
  const built = await buildBulkReviewManifest({
    generatedAt: '2026-09-01T01:00:00.000Z', lookupProfile: 'deep', view,
    rows: [
      { domain: 'review.example', status: 'complete', scanDepth: 'deep', observedAt: '2026-09-01T00:05:00.000Z', sourceCoverage: [{ source: 'rdap', state: 'partial', observedAt: '2026-09-01T00:00:00.000Z' }, { source: 'dns', state: 'unavailable', observedAt: null }],
        profileContext: { sourceState: 'unavailable', activeProfileId: null, profileUpdatedAt: null, limitation: 'Profile context was unavailable.' },
        raw: 'private-source-sentinel', contacts: ['private-contact-sentinel'], notes: 'private-note-sentinel' },
      { domain: 'failed.example', status: 'error', scanDepth: 'deep', sourceCoverage: [],
        profileContext: { sourceState: 'ready', activeProfileId: null, profileUpdatedAt: null, limitation: '' } },
    ],
    reviewStates: [{ domain: 'review.example', state: 'reviewed' }],
  });
  const raw = await fixtureRaw(currentPath);
  assert.equal(built.content, raw);
  assert.deepEqual(built.document.selection, { count: 2, domains: ['review.example', 'failed.example'] });
  assert.deepEqual(built.document.view, view);
  assert.deepEqual(built.document.rows.map((row) => [row.domain, row.reviewState, row.resultState]), [
    ['review.example', 'reviewed', 'complete'], ['failed.example', 'unreviewed', 'error'],
  ]);
  assert.equal(built.document.observedAt, null);
  assert.deepEqual(built.document.rows.map((row) => row.observedAt), ['2026-09-01T00:05:00.000Z', null]);
  assert.deepEqual(built.document.rows[0]!.sourceCoverage, [{ source: 'rdap', state: 'partial', observedAt: '2026-09-01T00:00:00.000Z' }, { source: 'dns', state: 'unavailable', observedAt: null }]);
  assert.equal(built.document.rows[0]!.profileContext.sourceState, 'unavailable');
  assert.doesNotMatch(raw, /private-(?:source|contact|note)-sentinel/u);
  const tampered = JSON.parse(raw);
  tampered.generatedAt = '2026-09-02T01:00:00.000Z';
  await assert.rejects(verifyOfflineArtifact(JSON.stringify(tampered)), /failed its SHA-256/iu);
});

test('the exact published Bulk format remains readable without adding clocks or accepting a newer row shape', async () => {
  const raw = await fixtureRaw(publicPath);
  assert.equal(createHash('sha256').update(raw).digest('hex'), 'b4e209df9bc0e1c8be8a34d4f4aac486df9d0a4e1a1f750b9a21ab6e0d35b7b6');
  const value = JSON.parse(raw);
  assert.equal(value.version, 2);
  assert.deepEqual(value.rows[0].sourceCoverage, [{ source: 'rdap', state: 'partial' }, { source: 'dns', state: 'unavailable' }]);
  assert.equal(Object.hasOwn(value.rows[0], 'observedAt'), false);
  const report = await verifyOfflineArtifact(raw);
  assert.equal(report.artifact.version, 2);
  assert.equal(report.checks.contentIntegrity, 'verified');
  const confidence = structuredClone(value);
  confidence.view.sortKey = 'confidence';
  const { integrity: priorIntegrity, ...confidenceBody } = confidence;
  const confidenceReport = await verifyOfflineArtifact(JSON.stringify({
    ...confidenceBody, integrity: { ...priorIntegrity, digestSha256: await sha256ArtifactDigestV2(confidenceBody) },
  }));
  assert.equal(confidenceReport.checks.contentIntegrity, 'verified');
  const { integrity, ...unsigned } = value;
  unsigned.rows[0].observedAt = null;
  const changed = { ...unsigned, integrity: { ...integrity, digestSha256: await sha256ArtifactDigestV2(unsigned) } };
  await assert.rejects(verifyOfflineArtifact(JSON.stringify(changed)), /Bulk review manifest row.*malformed structure/u);
});

test('the retained string-view example remains checksum-consistent but structurally rejected', async () => {
  const raw = await fixtureRaw(invalidPath);
  assert.equal(createHash('sha256').update(raw).digest('hex'), '1c90f4d0661357fc277360cc924f2464e463f9c8bd815a6b45408e95e1caf7d3');
  const { integrity, ...document } = JSON.parse(raw);
  assert.equal(document.view, 'all');
  assert.equal(await sha256ArtifactDigestV2(document), integrity.digestSha256);
  assert.equal(INVESTIGATION_PORTABILITY_LIFECYCLE_FAMILY.fixtures.some((fixture) => fixture.path === invalidPath), false);
  await assert.rejects(verifyOfflineArtifact(raw), /Bulk review manifest view.*malformed structure/u);
});

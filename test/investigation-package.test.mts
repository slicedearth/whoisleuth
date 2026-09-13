import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { buildInvestigationManifest, readInvestigationManifest, MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES, MAX_INVESTIGATION_MANIFEST_ARTIFACTS, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES } from '../packages/investigation/investigation-manifest.mts';
import { buildInvestigationPackage, inspectInvestigationPackage, investigationPackageEntryPath, MAX_INVESTIGATION_PACKAGE_BYTES } from '../packages/investigation/investigation-package.mts';
import { sha256ArtifactDigestV2 } from '../packages/evidence/artifact-integrity.mts';
import { buildInvestigationCapsule } from '../packages/investigation/investigation-capsule.mts';
import { verifyOfflineInvestigationPackage } from '../cli/investigation-package-review.mts';
import { buildLookupEvidence } from '../lib/evidence-export.mts';
import { lookupGraphCapacityFixture } from './lookup-graph-capacity-fixture.mts';

const NOW = '2026-09-11T00:00:00.000Z';
const VERSION = '2.3.1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const options = { workflow: 'evidence handoff', configurationDigestSha256: null } as const;
const raw = '{"schema":"whoisleuth.fixture","version":1,"observedAt":"2026-08-01T00:00:00.000Z","value":"retained exactly"}\n';
const rawDigest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('an immutable version-2 manifest remains readable without adding current fields', async () => {
  const fixture = readFileSync(new URL('./fixtures/investigation-manifest-v2.json', import.meta.url), 'utf8');
  const parsed = await readInvestigationManifest(fixture);
  assert.equal(parsed.version, 2);
  assert.equal(Object.hasOwn(parsed, 'audience'), false);
  assert.equal(Object.hasOwn(parsed.artifacts[0]!, 'mediaType'), false);
  assert.equal(parsed.artifacts[0]!.byteLength, 110);
  assert.equal(parsed.artifacts[0]!.contentDigestSha256, 'sha256:60560e843a66bcb5d993aa02e5c6fa4ed37e2deaec7b3ef94a9e690d11535722');
  const report = await verifyOfflineArtifact(fixture);
  assert.equal(report.artifact.version, 2);
  assert.equal(report.state, 'verified');
  assert.deepEqual(parsed, JSON.parse(fixture));
});

test('a package preserves exact JSON and opaque bytes with separate declared sources and packaging time', async () => {
  const opaque = new Uint8Array([0, 255, 128, ...encoder.encode('<ScRiPt>private file contents</ScRiPt>')]);
  const built = await buildInvestigationPackage({ ...options, artifacts: [
    { content: raw, source: { identity: 'Source observation', observedAt: '2026-08-01T00:00:00.000Z' } },
    { content: opaque, mediaType: 'image/png', source: { identity: 'Analyst supplied capture', observedAt: null } },
  ] }, NOW, VERSION);
  const files = unzipSync(built.bytes);
  assert.deepEqual(Object.keys(files).sort(), ['artifacts/artifact-1', 'artifacts/artifact-2', 'manifest.json']);
  assert.equal(decoder.decode(files['artifacts/artifact-1']), raw);
  assert.deepEqual(files['artifacts/artifact-2'], opaque);
  assert.equal(built.manifest.artifacts[0]!.contentDigestSha256, rawDigest(encoder.encode(raw)));
  assert.equal(built.manifest.artifacts[1]!.contentDigestSha256, rawDigest(opaque));
  assert.equal(built.manifest.artifacts[1]!.canonicalDigestSha256, null);
  assert.equal(built.manifest.artifacts[1]!.schema, null);
  assert.equal(built.manifest.artifacts[1]!.source.observedAt, null);
  assert.deepEqual(built.manifest.steps.map((step) => [step.action, step.occurredAt]), [['packaged', NOW], ['packaged', NOW]]);
  assert.equal(built.manifest.audience, 'private');
  assert.doesNotMatch(JSON.stringify(built.manifest), /retained exactly|private file contents|<script>/iu);
  const preview = await inspectInvestigationPackage(built.bytes);
  assert.equal(preview.identityVerified, true);
  assert.deepEqual(preview.entries.map((item) => item.interpretation), ['not_checked', 'opaque']);
  assert.deepEqual(preview.entries[1]!.checks, { byteLength: true, rawDigest: true, canonicalDigest: null, schema: null, version: null });
  assert.equal(preview.storageEffect, 'none');
  assert.equal(preview.signatureTrust, 'not_checked');
  assert.equal(preview.timestampAssurance, 'not_checked');
  assert.equal(preview.factualAccuracy, 'not_established');
  assert.deepEqual(preview.contents.get('artifact-2'), opaque);
  assert.deepEqual((await buildInvestigationPackage({ ...options, artifacts: [{ content: raw }] }, NOW, VERSION)).bytes,
    (await buildInvestigationPackage({ ...options, artifacts: [{ content: raw }] }, NOW, VERSION)).bytes);
});

test('file ownership is captured before async work and false image declarations do not become image validation', async () => {
  const selected = new Uint8Array([1, 2, 3]);
  const source = { identity: 'Original source', observedAt: null };
  const pending = buildInvestigationPackage({ ...options, artifacts: [{ content: selected, mediaType: 'image/png', source }] }, NOW, VERSION);
  selected.fill(9);
  source.identity = 'Changed source';
  const preview = await inspectInvestigationPackage((await pending).bytes);
  assert.deepEqual(preview.contents.get('artifact-1'), new Uint8Array([1, 2, 3]));
  assert.equal(preview.entries[0]!.interpretation, 'opaque');
  assert.equal('source' in preview.entries[0]!.entry && preview.entries[0]!.entry.source.identity, 'Original source');
});

test('valid JSON values remain byte-identical even without a usable source-format declaration', async () => {
  const values = ['null', 'true', '42', '"retained"', '[1,{"capture":"unaltered"}]', '{"schema":42,"version":1}', JSON.stringify({ schema: 'x'.repeat(161), version: 1 })];
  const built = await buildInvestigationPackage({ ...options, artifacts: values.map(content => ({ content })) }, NOW, VERSION);
  const reviewed = await inspectInvestigationPackage(built.bytes);
  assert.equal(reviewed.identityVerified, true);
  for (const [index, value] of values.entries()) {
    assert.equal(decoder.decode(reviewed.contents.get(`artifact-${index + 1}`)), value);
    assert.equal(reviewed.entries[index]!.entry.schema, null);
  }
  assert.deepEqual(reviewed.entries.slice(0, 5).map(entry => entry.interpretation), Array(5).fill('unsupported_json_value'));
  const report = await verifyOfflineInvestigationPackage(built.bytes);
  assert.equal(report.state, 'partial');
  assert.ok(report.package!.entries.every(entry => entry.identity === 'verified' && entry.state === 'unsupported'));
  assert.ok(report.package!.entries.every(entry => entry.issue));
});

test('capsule source admission binds the complete included source, exact hostname, version and source clock', async () => {
  const retained = JSON.parse(readFileSync(new URL('./fixtures/investigation-portability/investigation-capsule-v4.json', import.meta.url), 'utf8'));
  const source = buildLookupEvidence(lookupGraphCapacityFixture(), { applicationVersion: VERSION, generatedAt: NOW });
  const capsule = await buildInvestigationCapsule({ applicationVersion: VERSION, lookupEvidence: source,
    brief: retained.investigationBrief, graph: retained.graphSnapshot, generatedAt: NOW });
  const pack = (values: readonly unknown[]) => buildInvestigationPackage({ ...options, artifacts: values.map(value => ({ content: JSON.stringify(value) })) }, NOW, VERSION);
  const built = await pack([capsule, source]);
  const verified = await verifyOfflineInvestigationPackage(built.bytes);
  assert.equal(verified.state, 'verified');
  assert.deepEqual(verified.package!.entries.map(entry => entry.state), ['admitted', 'admitted']);
  assert.deepEqual(verified.package!.links, [{ capsuleEntryId: 'artifact-1', sourceEntryId: 'artifact-2', state: 'linked' }]);
  assert.equal((await inspectInvestigationPackage((await pack([capsule])).bytes)).links[0]!.state, 'missing');
  assert.equal((await inspectInvestigationPackage((await pack([capsule, source, source])).bytes)).links[0]!.state, 'ambiguous');
  const changedClock = structuredClone(source);
  changedClock.sources.rdap.fetchedAt = '2026-09-02T00:00:00.000Z';
  assert.equal((await inspectInvestigationPackage((await pack([capsule, changedClock])).bytes)).links[0]!.state, 'mismatch');
  for (const referenceChange of [{ version: source.schemaVersion + 1 }, { embedded: true }]) {
    const changed = structuredClone(capsule);
    Object.assign(changed.sourceContracts[0]!, referenceChange);
    assert.equal((await inspectInvestigationPackage((await pack([changed, source])).bytes)).links[0]!.state, 'mismatch');
  }
  const wrongSchemaSource = { ...source, schema: 'whoisleuth.unrelated-source' };
  const wrongSchemaCapsule = structuredClone(capsule);
  Object.assign(wrongSchemaCapsule.sourceContracts[0]!, { schema: wrongSchemaSource.schema, digest: await sha256ArtifactDigestV2(wrongSchemaSource) });
  assert.equal((await inspectInvestigationPackage((await pack([wrongSchemaCapsule, wrongSchemaSource])).bytes)).links[0]!.state, 'mismatch');
  const hostnameSource = structuredClone(source);
  hostnameSource.query = { submitted: 'login.example.test', type: 'domain', registrableDomain: 'example.test', inputHostname: 'login.example.test', isSubdomain: true };
  const mismatchedCapsule = structuredClone(capsule);
  Object.assign(mismatchedCapsule.sourceContracts[0]!, { digest: await sha256ArtifactDigestV2(hostnameSource) });
  assert.equal((await inspectInvestigationPackage((await pack([mismatchedCapsule, hostnameSource])).bytes)).links[0]!.state, 'mismatch');
  // Raw identity can still pass for malformed source JSON. The independent
  // format validator must not inherit that result as source admission.
  const malformed = { schema: source.schema, schemaVersion: source.schemaVersion, query: source.query };
  Object.assign(mismatchedCapsule.sourceContracts[0]!, { digest: await sha256ArtifactDigestV2(malformed) });
  const malformedReport = await verifyOfflineInvestigationPackage((await pack([mismatchedCapsule, malformed])).bytes);
  assert.equal(malformedReport.state, 'partial');
  assert.equal(malformedReport.package!.entries[1]!.state, 'rejected');
});

test('ZIP and manifest failures are distinct from file-identity rejection', async () => {
  const built = await buildInvestigationPackage({ ...options, artifacts: [{ content: raw }, { content: new Uint8Array([4, 5, 6]) }] }, NOW, VERSION);
  const files = unzipSync(built.bytes);
  files['artifacts/artifact-1'] = encoder.encode(raw.replace('retained exactly', 'modified value!'));
  const mismatched = await inspectInvestigationPackage(zipSync(files));
  assert.equal(mismatched.identityVerified, false);
  assert.equal(mismatched.entries[0]!.state, 'rejected');
  assert.equal(mismatched.contents.has('artifact-1'), false);
  assert.equal(mismatched.entries[1]!.state, 'identity_verified');
  assert.deepEqual(mismatched.contents.get('artifact-2'), new Uint8Array([4, 5, 6]));
  files['artifacts/artifact-1'] = new Uint8Array([0xff]);
  const malformed = await inspectInvestigationPackage(zipSync(files));
  assert.equal(malformed.entries[0]!.state, 'rejected');
  assert.match(malformed.entries[0]!.issue!, /UTF-8/u);
  const missing = { ...files };
  delete missing['artifacts/artifact-2'];
  await assert.rejects(inspectInvestigationPackage(zipSync(missing)), /missing or unlisted/u);
  await assert.rejects(inspectInvestigationPackage(zipSync({ ...files, 'artifacts/artifact-3': new Uint8Array([7]) })), /missing or unlisted/u);
  for (const name of ['../manifest.json', '/manifest.json', 'artifacts/../artifact-1', 'artifacts\\artifact-1', 'artifacts/artifact-0', `artifacts/artifact-${MAX_INVESTIGATION_MANIFEST_ARTIFACTS + 1}`]) {
    await assert.rejects(inspectInvestigationPackage(zipSync({ ...files, [name]: new Uint8Array([7]) })), /path|identity/u);
  }
  const corrupt = built.bytes.slice();
  const view = new DataView(corrupt.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const firstData = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  corrupt[firstData] = corrupt[firstData]! ^ 1;
  await assert.rejects(inspectInvestigationPackage(corrupt), /CRC/u);
});

test('future and tampered manifests fail before exposing any admitted content', async () => {
  const built = await buildInvestigationPackage({ ...options, artifacts: [{ content: raw }] }, NOW, VERSION);
  const files = unzipSync(built.bytes);
  const changed = JSON.parse(decoder.decode(files['manifest.json']));
  changed.version += 1;
  const { integrity: _integrity, ...unsigned } = changed;
  changed.integrity.digestSha256 = await sha256ArtifactDigestV2(unsigned);
  files['manifest.json'] = encoder.encode(JSON.stringify(changed));
  await assert.rejects(inspectInvestigationPackage(zipSync(files)), /version/u);
  changed.version -= 1;
  changed.workflow = 'different workflow';
  files['manifest.json'] = encoder.encode(JSON.stringify(changed));
  await assert.rejects(inspectInvestigationPackage(zipSync(files)), /integrity/u);
  await assert.rejects(buildInvestigationManifest({ ...options, artifacts: [{ content: raw, source: { identity: 'source', observedAt: '2026-02-30T00:00:00.000Z' } }] }, NOW, VERSION), /time/u);
  await assert.rejects(buildInvestigationManifest({ ...options, artifacts: [{ content: new Uint8Array([255]), mediaType: 'application/json' }] }, NOW, VERSION), /encoded|encoding/u);
});

test('full supported file and aggregate capacities retain every byte and reject excess without truncation', async () => {
  const block = new Uint8Array(MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES / 2);
  block[0] = 19;
  block[block.length - 1] = 23;
  const built = await buildInvestigationPackage({ ...options, artifacts: [{ content: block }, { content: block }] }, NOW, VERSION);
  assert.equal(built.manifest.summary.totalBytes, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES);
  assert.ok(built.bytes.byteLength <= MAX_INVESTIGATION_PACKAGE_BYTES);
  const preview = await inspectInvestigationPackage(built.bytes);
  assert.equal(preview.identityVerified, true);
  for (const id of ['artifact-1', 'artifact-2']) {
    assert.equal(preview.contents.get(id)!.length, block.length);
    assert.equal(preview.contents.get(id)![0], 19);
    assert.equal(preview.contents.get(id)!.at(-1), 23);
    assert.equal(rawDigest(preview.contents.get(id)!), rawDigest(block));
  }
  await assert.rejects(buildInvestigationPackage({ ...options, artifacts: [{ content: new Uint8Array(MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES + 1) }] }, NOW, VERSION), /limit/u);
  await assert.rejects(buildInvestigationPackage({ ...options, artifacts: [{ content: block }, { content: block }, { content: new Uint8Array([1]) }] }, NOW, VERSION), /combined limit/u);
  const small = Array.from({ length: MAX_INVESTIGATION_MANIFEST_ARTIFACTS }, () => ({ content: '{}' }));
  const maximum = await inspectInvestigationPackage((await buildInvestigationPackage({ ...options, artifacts: small }, NOW, VERSION)).bytes);
  assert.equal(maximum.entries.length, small.length);
  assert.equal(maximum.contents.size, small.length);
  assert.equal(maximum.identityVerified, true);
  await assert.rejects(buildInvestigationPackage({ ...options, artifacts: [...small, { content: '{}' }] }, NOW, VERSION), /artefacts/u);
  assert.equal(investigationPackageEntryPath(`artifact-${small.length}`), `artifacts/artifact-${small.length}`);
});

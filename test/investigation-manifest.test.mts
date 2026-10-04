import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import {
  MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES,
  MAX_INVESTIGATION_MANIFEST_ARTIFACTS,
  INVESTIGATION_MANIFEST_SCHEMA,
  buildInvestigationManifest,
  readInvestigationManifest, formatInvestigationManifest,
  investigationImageParentIncluded,
} from '../cli/investigation-manifest.mts';
import { sha256ArtifactBytes, sha256ArtifactDigestV2 } from '../packages/evidence/artifact-integrity.mts';
import { buildInvestigationPackage, inspectInvestigationPackage } from '../packages/investigation/investigation-package.mts';
import { MAX_BOUNDED_JSON_DEPTH } from '../cli/bounded-json.mts';

const NOW = '2026-08-05T08:00:00.000Z';

test('image parent disclosure follows the prepared and verified package selection by exact digest and size', async () => {
  const parent = new Uint8Array([1, 2, 3]), derivative = new Uint8Array([4, 5]);
  const imageDerivation = { method: 'png-regions-v1' as const, source: { digestSha256: await sha256ArtifactBytes(parent), byteLength: parent.byteLength }, operations: ['redact' as const] };
  for (const included of [false, true]) {
    const packaged = await buildInvestigationPackage({ workflow: 'Selected images', configurationDigestSha256: null,
      artifacts: [...(included ? [{ content: parent, mediaType: 'image/png' as const }] : []), { content: derivative, mediaType: 'image/png', imageDerivation }] }, NOW, '2.6.0');
    const review = await inspectInvestigationPackage(packaged.bytes);
    const entry = requiredManifestEntry(review.manifest.artifacts.at(-1));
    assert.equal(investigationImageParentIncluded(review.manifest, entry), included);
    assert.match(formatInvestigationManifest(review.manifest), included ? /Parent entry: declared in this manifest/ : /Parent entry: not declared in this manifest/);
    const wrongSize = { ...entry, imageDerivation: { ...imageDerivation, source: { ...imageDerivation.source, byteLength: parent.byteLength + 1 } } };
    assert.equal(investigationImageParentIncluded(review.manifest, wrongSize), false);
    assert.equal(investigationImageParentIncluded(review.manifest, { ...entry, imageDerivation: null }), null);
  }
});

function requiredManifestEntry<T>(value: T | undefined): T { assert.ok(value); return value; }

test('manifest v4 binds minimal image declarations, snapshots inputs and rejects malformed or historical additions', async () => {
  const imageDerivation = { method: 'png-regions-v1' as const, source: { digestSha256: `sha256:${'a'.repeat(64)}`, byteLength: 100 }, operations: ['redact' as const] };
  const expected = structuredClone(imageDerivation);
  const input = { workflow: 'Selected image', configurationDigestSha256: null,
    artifacts: [{ content: new Uint8Array([1, 2, 3]), mediaType: 'image/png' as const, imageDerivation }] };
  const pending = buildInvestigationManifest(input, NOW, '2.6.0');
  imageDerivation.source.byteLength = 101; imageDerivation.operations.length = 0;
  const document = await pending;
  assert.equal(document.version, 4);
  assert.deepEqual(document.artifacts[0]!.imageDerivation, expected);
  assert.deepEqual(await readInvestigationManifest(JSON.stringify(document)), document);
  assert.match(formatInvestigationManifest(document), /Declared image derivation: png-regions-v1; redact/);
  const altered = JSON.parse(JSON.stringify(document)); altered.artifacts[0].imageDerivation.source.byteLength = 101;
  await assert.rejects(readInvestigationManifest(JSON.stringify(altered)), /integrity check/);
  for (const change of [
    (value: any) => { value.artifacts[0].imageDerivation.operations = ['blur']; },
    (value: any) => { value.artifacts[0].imageDerivation.plan = { regions: [] }; },
    (value: any) => { value.artifacts[0].mediaType = 'image/jpeg'; },
    (value: any) => { delete value.artifacts[0].imageDerivation; },
    (value: any) => { value.version = 3; },
    (value: any) => { value.version = 5; },
  ]) {
    const invalid = JSON.parse(JSON.stringify(document)); change(invalid);
    const { integrity: _integrity, ...unsigned } = invalid;
    invalid.integrity.digestSha256 = await sha256ArtifactDigestV2(unsigned);
    await assert.rejects(readInvestigationManifest(JSON.stringify(invalid)));
  }
  await assert.rejects(buildInvestigationManifest({ ...input, artifacts: [{ content: new Uint8Array([1]), mediaType: 'image/jpeg', imageDerivation: expected }] }, NOW, '2.6.0'), /PNG/);
  const undeclared = await buildInvestigationManifest({ ...input, artifacts: [{ content: new Uint8Array([1]), mediaType: 'image/png' }] }, NOW, '2.6.0');
  assert.equal(undeclared.artifacts[0]!.imageDerivation, null);
  assert.match(formatInvestigationManifest(undeclared), /Editing history: not declared/);
});

describe('investigation manifest', () => {
  test('records ordered content identities without retaining paths or values', async () => {
    const document = await buildInvestigationManifest({
      workflow: 'domain review',
      configurationDigestSha256: `sha256:${'a'.repeat(64)}`,
      artifacts: [
        { content: '{\n  "schema": "whoisleuth.fixture", "version": 1, "secretValue": "omitted from manifest"\n}' },
        { content: '{"schema":"whoisleuth.other-fixture","schemaVersion":2}' },
      ],
    }, NOW, '1.40.0');
    assert.equal(document.schema, INVESTIGATION_MANIFEST_SCHEMA);
    assert.deepEqual(document.artifacts.map((item) => item.sequence), [1, 2]);
    assert.equal(document.artifacts[0]?.schema, 'whoisleuth.fixture');
    assert.equal(document.artifacts[1]?.version, 2);
    assert.notEqual(document.artifacts[0]?.contentDigestSha256, document.artifacts[0]?.canonicalDigestSha256);
    assert.doesNotMatch(JSON.stringify(document), /secretValue|omitted from manifest|\.json/iu);
    assert.equal((await verifyOfflineArtifact(JSON.stringify(document))).state, 'verified');
  });

  test('rejects invalid JSON, duplicate keys, deep input, aggregate overflow, and malformed configuration digests', async () => {
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [{ content: 'not-json' }],
    }, NOW, '1.40.0'), /valid JSON/iu);
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null,
      artifacts: [{ content: '{"schema":"whoisleuth.fixture","schema":"whoisleuth.other"}' }],
    }, NOW, '1.40.0'), /duplicate object key/iu);
    const deep = `${'{"nested":'.repeat(MAX_BOUNDED_JSON_DEPTH + 1)}null${'}'.repeat(MAX_BOUNDED_JSON_DEPTH + 1)}`;
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [{ content: deep }],
    }, NOW, '1.40.0'), /nesting limit/iu);
    const large = JSON.stringify({ data: 'x'.repeat(Math.floor(MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES / 3) + 1) });
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null,
      artifacts: [{ content: large }, { content: large }, { content: large }],
    }, NOW, '1.40.0'), /combined limit/iu);
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: 'sha256:invalid', artifacts: [{ content: '{}' }],
    }, NOW, '1.40.0'), /configurationDigestSha256/iu);
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [],
    }, NOW, '1.40.0'), new RegExp(`between 1 and ${MAX_INVESTIGATION_MANIFEST_ARTIFACTS}`, 'u'));
  });

  test('uses the shared semantic-version boundary', async () => {
    const document = await buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [{ content: '{}' }],
    }, NOW, '1.40.0-rc.1+local.2');
    assert.equal(document.application.version, '1.40.0-rc.1+local.2');
    await assert.rejects(() => buildInvestigationManifest({
      workflow: 'review', configurationDigestSha256: null, artifacts: [{ content: '{}' }],
    }, NOW, '01.40.0'), /leading zeroes/iu);
  });
});

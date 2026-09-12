import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { captureReviewFixture } from './capture-review-fixture.mts';
import { readWebCaptureManifest, parseWebCaptureManifest } from '../packages/interchange/web-capture-import.mts';
import { buildInvestigationPackage, inspectInvestigationPackage } from '../packages/investigation/investigation-package.mts';
import { runInvestigationPackageOperation } from '../frontend/src/lib/investigation-package-worker-model.ts';
import { verifyOfflineInvestigationPackage } from '../cli/investigation-package-review.mts';
import { formatOfflineArtifactVerification } from '../cli/artifact-verify.mts';
import { MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES } from '../packages/investigation/investigation-manifest.mts';

test('manifest projection and attachment declarations come from the same admission without storing verification claims', () => {
  const { manifest } = captureReviewFixture();
  const read = readWebCaptureManifest(manifest);
  assert.deepEqual(read.document, parseWebCaptureManifest(manifest));
  assert.equal(read.artifacts.length, 2);
  assert.ok(read.document.findings.every(finding => finding.limitations.some(limit => /separate byte checks are not retained/u.test(limit))));
  assert.equal(read.artifacts[0]?.sha256, manifest.captures[0]?.artifacts[0]?.sha256);
});

test('attachment review matches actual bytes rather than names and reports all identical copies and missing evidence', async () => {
  const { manifestBytes, screenshot, dom } = captureReviewFixture();
  const response = await runInvestigationPackageOperation({ kind: 'capture', input: {
    manifest: new Blob([manifestBytes]), files: [new Blob([screenshot]), new Blob([dom]), new Blob([screenshot]), new Blob(['unused'])],
  } });
  if (response.kind !== 'capture') assert.fail('Expected a capture review.');
  assert.deepEqual(response.result.matches, [
    { capture: 1, kind: 'screenshot', state: 'matched', matchingIds: ['file-1', 'file-3'] },
    { capture: 1, kind: 'dom_digest', state: 'matched', matchingIds: ['file-2'] },
  ]);
  assert.deepEqual(response.result.unusedIds, ['file-4']);
  assert.equal(response.result.contents.size, 3);
  const missing = await runInvestigationPackageOperation({ kind: 'capture', input: {
    manifest: new Blob([manifestBytes]), files: [new Blob([screenshot]), new Blob(['changed digest bytes'])],
  } });
  if (missing.kind !== 'capture') assert.fail('Expected a missing-attachment review.');
  assert.equal(missing.result.matches[1]?.state, 'not_found');
  assert.deepEqual(missing.result.matches[1]?.matchingIds, []);
  assert.equal(missing.result.contents.size, 1);
});

test('capture attachment admission rejects excess before reading and hides invalid input in error messages', async () => {
  let reads = 0;
  const manifest = new Blob(['private-example-content']);
  Object.defineProperty(manifest, 'arrayBuffer', { value() { reads++; throw new Error('private-example-content'); } });
  const file = new Blob(['x']);
  Object.defineProperty(file, 'size', { value: MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES + 1 });
  const response = await runInvestigationPackageOperation({ kind: 'capture', input: { manifest, files: [file] } });
  assert.equal(response.kind, 'error');
  assert.equal(reads, 0);
  assert.doesNotMatch(JSON.stringify(response), /private-example-content/u);
});

test('browser and CLI package inspection share attachment checks without treating matched files as authenticated sources', async () => {
  const { manifestBytes, screenshot, dom } = captureReviewFixture();
  const built = await buildInvestigationPackage({ workflow: 'Capture review', configurationDigestSha256: null, artifacts: [
    { content: manifestBytes, mediaType: 'application/json' }, { content: screenshot, mediaType: 'image/png' }, { content: dom, mediaType: 'application/json' },
  ] }, '2026-09-01T00:00:00.000Z', '2.3.1');
  const inspection = await inspectInvestigationPackage(built.bytes);
  assert.equal(inspection.captureManifests[0]?.state, 'matched');
  const cli = await verifyOfflineInvestigationPackage(built.bytes);
  assert.deepEqual(cli.package?.captureManifests, inspection.captureManifests);
  assert.equal(cli.package?.signatureTrust, 'not_checked');
  assert.equal(cli.package?.factualAccuracy, 'not_established');
  assert.equal(cli.state, 'partial'); // No claim of general source-format admission.
  const text = formatOfflineArtifactVerification(cli);
  assert.match(text, /Capture manifest artifact-1: matched/u);
  assert.doesNotMatch(text, /capture\.example|screenshot\.png|Example page/u);
  const files = unzipSync(built.bytes);
  files['artifacts/artifact-2'] = new Uint8Array([1, 2, 3]);
  const rejected = await inspectInvestigationPackage(zipSync(files));
  assert.equal(rejected.captureManifests[0]?.state, 'missing_attachments');
  assert.equal(rejected.captureManifests[0]?.artifacts[0]?.state, 'not_found');
  assert.equal(rejected.contents.has('artifact-2'), false);
});

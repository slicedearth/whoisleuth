import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadLookupEvidenceV27Fixture } from './lookup-evidence-v27-fixture.mts';
import { runInvestigationPackageOperation } from '../frontend/src/lib/investigation-package-worker-model.ts';
import { readPackagedLookupReview } from '../frontend/src/lib/packaged-lookup-review.ts';

async function packaged(documents: readonly string[]) {
  const built = await runInvestigationPackageOperation({ kind: 'build', input: {
    files: documents.map(document => ({ file: new Blob([document]), mediaType: 'application/json', source: { identity: null, observedAt: null } })),
    workflow: 'Offline review', generatedAt: '2026-09-01T00:00:00.000Z', applicationVersion: '2.5.0',
  } });
  if (built.kind !== 'build') throw new Error('Fixture package failed.');
  const inspected = await runInvestigationPackageOperation({ kind: 'inspect', input: { file: built.result.file } });
  if (inspected.kind !== 'inspect') throw new Error('Fixture inspection failed.');
  return inspected.result;
}

test('packaged Lookup review selects an exact entry and reuses historical schema validation', async () => {
  const raw = await loadLookupEvidenceV27Fixture();
  const review = await packaged([raw, raw]);
  const result = await readPackagedLookupReview(review, 'artifact-2');
  assert.equal(result.schemaVersion, 27);
  assert.equal(result.digestVerified, true);
  assert.equal(`sha256:${result.digestSha256}`, review.entries[1]!.entry.contentDigestSha256);
  assert.ok(result.facts.length > 0);
  await assert.rejects(readPackagedLookupReview(review, 'missing'), /Select one/u);
  await assert.rejects(readPackagedLookupReview({ ...review, identityVerified: false }, 'artifact-1'), /Select one/u);
  await assert.rejects(readPackagedLookupReview({ ...review, entries: [...review.entries, review.entries[0]!] }, 'artifact-1'), /Select one/u);
});

test('replay refuses replaced bytes, absent files and future formats without preventing byte downloads', async () => {
  const raw = await loadLookupEvidenceV27Fixture();
  const review = await packaged([raw]);
  await assert.rejects(readPackagedLookupReview({ ...review, contents: new Map() }, 'artifact-1'), /absent/u);
  await assert.rejects(readPackagedLookupReview({ ...review, contents: new Map([['artifact-1', new Blob([raw.replace('2026', '2025')])]]) }, 'artifact-1'), /checksum/u);
  const future = JSON.parse(raw); future.schemaVersion = 999;
  const unsupported = await packaged([JSON.stringify(future)]);
  await assert.rejects(readPackagedLookupReview(unsupported, 'artifact-1'), /Only Lookup evidence schemas/u);
  assert.equal(await unsupported.contents.get('artifact-1')!.text(), JSON.stringify(future));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { buildCaseExport } from '../packages/cases/case-storage-model.mts';
import { caseReviewDocument, caseReviewFileSelection, readCaseReviewDocument, matchCaseReviewFiles } from '../packages/cases/case-review-package.mts';
import { addCaseAttachments, readCaseAttachment } from '../packages/cases/case-attachment-model.mts';
import { canonicalArtifactJsonV2, sha256ArtifactBytes } from '../packages/evidence/artifact-integrity.mts';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../packages/contracts/selected-file-limits.mts';
import { MAX_INVESTIGATION_MANIFEST_ARTIFACTS, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES } from '../packages/contracts/investigation-package-limits.mts';
import { MAX_EDITABLE_CASE_OUTPUT_BYTES } from '../packages/contracts/case-portability.mts';
import { prepareCaseReviewHandoff, assertCaseReviewHandoffCurrent, readPackagedCaseReview } from '../frontend/src/lib/case-review-package.ts';
import { runInvestigationPackageOperation } from '../frontend/src/lib/investigation-package-worker-model.ts';
import { verifyOfflineArtifact, formatOfflineArtifactVerification } from '../cli/artifact-verify.mts';
import { verifyOfflineInvestigationPackage } from '../cli/investigation-package-review.mts';
import { readFile } from 'node:fs/promises';

const NOW = '2026-09-13T00:00:00.000Z';
const fresh = () => createCase({ domain: 'review.example', title: 'One reviewed incident', note: 'A retained private note.' }, NOW);
async function fixture(count = 2) {
  const originals = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const bytes = new Uint8Array([index + 1]);
    const attachment = readCaseAttachment({ id: `file-${index}`, fileName: `capture-${index}.bin`, mediaType: 'application/octet-stream', source: `Declared source ${index}`, observedAt: null, retainedAt: NOW,
      byteLength: bytes.length, digestSha256: await sha256ArtifactBytes(bytes) });
    return { attachment, file: new Blob([bytes]) };
  }));
  const record = addCaseAttachments(fresh(), originals.map(item => item.attachment), NOW);
  const read = async () => originals;
  return { record, originals, read };
}
async function build(files: Awaited<ReturnType<typeof prepareCaseReviewHandoff>>['files'], passphrase?: string) {
  const result = await runInvestigationPackageOperation({ kind: 'build', input: { files, workflow: 'Case review', generatedAt: NOW, applicationVersion: '2.4.0', ...(passphrase ? { passphrase } : {}) } });
  assert.equal(result.kind, 'build'); if (result.kind !== 'build') throw new Error('Package failed.'); return result.result;
}
async function inspect(file: Blob, passphrase?: string) {
  const result = await runInvestigationPackageOperation({ kind: 'inspect', input: { file, ...(passphrase ? { passphrase } : {}) } });
  assert.equal(result.kind, 'inspect'); if (result.kind !== 'inspect') throw new Error('Inspection failed.'); return result.result;
}

test('handoff uses one exact ordinary Case export and refuses added fields or historical shapes', () => {
  const record = fresh();
  assert.deepEqual(readCaseReviewDocument(caseReviewDocument(record, NOW)), record);
  const source = buildCaseExport([record], NOW);
  assert.throws(() => readCaseReviewDocument(JSON.stringify({ ...source, unfinishedForms: ['private draft'] })), /additional fields/u);
  const missingClosure = buildCaseExport([record], NOW); missingClosure.cases[0]!.status = 'resolved';
  assert.throws(() => readCaseReviewDocument(JSON.stringify(missingClosure)), /repair|truncate/u);
  source.cases[0]!.notes[0]!.body += 'x'.repeat(2_001);
  assert.throws(() => readCaseReviewDocument(JSON.stringify(source)), /repair|truncate/u);
  assert.throws(() => readCaseReviewDocument(JSON.stringify(buildCaseExport([record, { ...record, id: 'another-case' }], NOW))), /exactly one/u);
});

test('selection reports missing bodies, deduplicates bytes and never chooses one source as authoritative', async () => {
  const { record, originals } = await fixture();
  const first = originals[0]!.attachment;
  const duplicated = addCaseAttachments(record, [{ ...first, id: 'another-observation', source: 'Different declared source' }], NOW);
  const chosen = caseReviewFileSelection(duplicated, [first.id]);
  assert.equal(chosen.files.length, 1); assert.equal(chosen.omitted.length, 1);
  const ready = await prepareCaseReviewHandoff(duplicated, [first.id], new AbortController().signal, async () => originals);
  assert.equal(ready.files.length, 2);
  assert.equal(ready.files[1]!.source.observedAt, null);
  assert.doesNotMatch(ready.files[1]!.source.identity!, /Declared source|Different declared source/u);
  assert.deepEqual(readCaseReviewDocument(await ready.files[0]!.file.text()), duplicated);
  const matches = matchCaseReviewFiles(duplicated, [{ id: 'body', digestSha256: first.digestSha256, byteLength: first.byteLength }]);
  assert.deepEqual(matches.map(item => item.entries), [['body'], [], ['body']]);
  assert.throws(() => caseReviewFileSelection(record, ['unknown']), /no longer/u);
  assert.throws(() => caseReviewFileSelection(record, [first.id, first.id]), /invalid/u);
});

test('missing files, cancellation and changed Cases stop preparation or publication', async () => {
  const { record, originals, read } = await fixture();
  await assert.rejects(prepareCaseReviewHandoff(record, [originals[0]!.attachment.id], new AbortController().signal, async () => []), /missing/u);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareCaseReviewHandoff(record, [], controller.signal, read), /abort/iu);
  const expected = canonicalArtifactJsonV2(record);
  await assertCaseReviewHandoffCurrent(expected, record.id, async () => [record]);
  await assert.rejects(assertCaseReviewHandoffCurrent(expected, record.id, async () => [{ ...record, title: 'Changed after review' }]), /changed/u);
  await assert.rejects(assertCaseReviewHandoffCurrent(expected, record.id, async () => []), /changed/u);
});

test('encrypted handoff round trip preserves exact Case and original bytes and identifies partial returns', async () => {
  const { record, originals, read } = await fixture();
  const ready = await prepareCaseReviewHandoff(record, originals.map(item => item.attachment.id), new AbortController().signal, read);
  const passphrase = 'Fixture-only review envelope';
  const built = await build(ready.files, passphrase);
  const locked = await runInvestigationPackageOperation({ kind: 'inspect', input: { file: built.file, passphrase: 'A different fixture phrase' } });
  assert.equal(locked.kind, 'error');
  const checked = await readPackagedCaseReview(await inspect(built.file, passphrase));
  assert.equal(checked.encryption, 'verified'); assert.deepEqual(checked.record, record); assert.equal(checked.missing.length, 0);
  for (const item of checked.attachments) assert.deepEqual(new Uint8Array(await checked.files.get(item.entries[0]!)!.arrayBuffer()),
    new Uint8Array(await originals.find(original => original.attachment.id === item.attachment.id)!.file.arrayBuffer()));
  const partial = await prepareCaseReviewHandoff(record, [originals[0]!.attachment.id], new AbortController().signal, read);
  const reviewed = await readPackagedCaseReview(await inspect((await build(partial.files)).file));
  assert.equal(reviewed.missing.length, 1); assert.equal(reviewed.missing[0]!.attachment.id, originals[1]!.attachment.id);
});

test('review never selects an arbitrary Case or accepts an unverified package', async () => {
  const { record } = await fixture();
  const one = await prepareCaseReviewHandoff(record, [], new AbortController().signal);
  const two = [...one.files, { ...one.files[0]!, file: new Blob([caseReviewDocument(fresh(), NOW)]) }];
  const ambiguous = await inspect((await build(two)).file);
  await assert.rejects(readPackagedCaseReview(ambiguous), /exactly one/u);
  await assert.rejects(readPackagedCaseReview({ ...ambiguous, identityVerified: false }), /Every package file/u);
  const future = JSON.parse(await one.files[0]!.file.text()); future.version += 1;
  await assert.rejects(readPackagedCaseReview(await inspect((await build([{ ...one.files[0]!, file: new Blob([JSON.stringify(future)]) }])).file)), /schema|re-export/iu);
});

test('a complete maximum-reference Case fits one bounded container without changing file-retention limits', async () => {
  assert.equal(MAX_SELECTED_FILES, 128);
  assert.equal(MAX_SELECTED_FILE_TOTAL_BYTES, 64 * 1024 * 1024);
  assert.equal(MAX_INVESTIGATION_MANIFEST_ARTIFACTS, MAX_SELECTED_FILES + 1);
  assert.equal(MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES, MAX_SELECTED_FILE_TOTAL_BYTES + MAX_EDITABLE_CASE_OUTPUT_BYTES);
  const { record, originals, read } = await fixture(MAX_SELECTED_FILES);
  const ready = await prepareCaseReviewHandoff(record, originals.map(item => item.attachment.id), new AbortController().signal, read);
  const built = await build(ready.files);
  assert.equal(built.manifest.artifacts.length, 129);
  const checked = await readPackagedCaseReview(await inspect(built.file));
  assert.equal(checked.attachments.length, 128); assert.equal(checked.missing.length, 0);
});

test('offline CLI verification distinguishes exact Case structure from package identity and original completeness', async () => {
  const { record, originals, read } = await fixture();
  const raw = caseReviewDocument(record, NOW);
  const ordinary = await verifyOfflineArtifact(raw);
  assert.equal(ordinary.artifact.kind, 'case_export'); assert.equal(ordinary.state, 'structure_valid');
  assert.equal(ordinary.artifact.schema, null); // Ordinary Case exports have no wire schema identifier.
  assert.match(formatOfflineArtifactVerification(ordinary), /case_export · no schema identifier v/u);
  assert.equal(ordinary.checks.contentIntegrity, 'not_checked'); assert.equal(ordinary.summary.recordCount, 1);
  const published = await verifyOfflineArtifact(await readFile(new URL('./fixtures/case-lifecycle/case-export-v15.json', import.meta.url), 'utf8'));
  assert.equal(published.artifact.version, 15); assert.equal(published.state, 'structure_valid');
  const ready = await prepareCaseReviewHandoff(record, originals.map(item => item.attachment.id), new AbortController().signal, read);
  const passphrase = 'CLI handoff fixture passphrase';
  const full = await verifyOfflineInvestigationPackage(new Uint8Array(await (await build(ready.files, passphrase)).file.arrayBuffer()), passphrase);
  assert.equal(full.state, 'verified'); assert.equal(full.checks.authenticatedEncryption, 'verified');
  assert.deepEqual(full.package!.caseFiles, [{ entryId: 'artifact-1', caseCount: 1, references: 2, matched: 2, missing: 0 }]);
  assert.ok(!JSON.stringify(full).includes(record.id)); assert.ok(!JSON.stringify(full).includes(record.domain));
  assert.ok(!JSON.stringify(full).includes(originals[0]!.attachment.fileName));
  assert.match(formatOfflineArtifactVerification(full), /2 of 2 references matched; 0 missing/u);
  const partial = await verifyOfflineInvestigationPackage(new Uint8Array(await (await build(ready.files.slice(0, 2))).file.arrayBuffer()));
  assert.equal(partial.state, 'partial'); assert.equal(partial.checks.contentIntegrity, 'verified');
  assert.equal(partial.package!.caseFiles[0]!.missing, 1);
  const invalid = JSON.parse(raw); invalid.cases[0].notes[0].body += 'x'.repeat(2_001);
  await assert.rejects(verifyOfflineArtifact(JSON.stringify(invalid)), /repair|truncate/u);
});

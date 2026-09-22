import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { selectedPdfFixture, selectedDocxFixture, selectedDocxEntries, selectedHarFixture } from '../fixtures/selected-input-examples.mts';
import { reviewSelectedInput } from '../packages/investigation/selected-input-review.mts';
import { reviewSelectedInputInWorker } from '../cli/selected-input-worker.mts';
import { sha256ArtifactBytes } from '../packages/evidence/artifact-integrity.mts';
import { MAX_DOCUMENT_TEXT_BYTES } from '../packages/contracts/document-intake.mts';
import { MAX_MESSAGE_INTAKE_BYTES } from '../packages/contracts/message-intake.mts';
import { runMessageIntakeOperation } from '../frontend/src/lib/message-intake-worker-model.ts';
import { runCli } from '../cli/runner.mts';
const NOW = '2026-09-23T00:00:00Z', text = (value: string) => new TextEncoder().encode(value);

test('PDF extracts real text, annotations and raster QR evidence with page and derived identities', async () => {
  const bytes = selectedPdfFixture(), before = bytes.slice(), originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No PDF resource may be requested'); };
  try {
    const result = await reviewSelectedInput(bytes, 'pdf', NOW);
    assert.deepEqual(bytes, before);
    for (const hostname of ['pdf-text.example', 'pdf-link.example', 'document-qr.example']) assert.ok(result.report.links.some(link => link.hostname === hostname), JSON.stringify(result.report));
    assert.equal(result.report.documentReview?.reviewedPages, 1);
    assert.ok(result.report.links.every(link => link.location?.page === 1));
    assert.ok(result.report.documentReview?.parts.every(part => part.parentDigestSha256 === result.report.source.digestSha256));
    assert.ok(result.report.documentReview?.parts.some(part => part.identity === 'decoded_rgba_pixels'));
    assert.doesNotMatch(JSON.stringify(result.report), /private-value|token=|\/private/u);
    assert.equal(result.report.coverage.state, 'partial');
    assert.match(result.report.documentReview!.notes.join(' '), /vector artwork/u);
  } finally { globalThis.fetch = originalFetch; }
});

test('encrypted and malformed PDFs do not become empty successful reviews', async () => {
  const encrypted = await reviewSelectedInput(selectedPdfFixture(true), 'pdf', NOW);
  assert.equal(encrypted.report.documentReview?.state, 'encrypted');
  assert.equal(encrypted.report.coverage.state, 'partial');
  const malformed = await reviewSelectedInput(text('%PDF-1.7 invalid'), 'pdf', NOW);
  assert.equal(malformed.report.documentReview?.state, 'unsupported');
  assert.deepEqual(malformed.report.links, []);
});

test('DOCX uses checked ZIP parts, inert namespace-aware XML and bounded PNG decoding', async () => {
  const input = selectedDocxFixture(), result = await reviewSelectedInput(input, 'docx', NOW);
  for (const hostname of ['docx-text.example', 'docx-link.example', 'document-qr.example']) assert.ok(result.report.links.some(link => link.hostname === hostname));
  assert.equal(result.report.links.some(link => link.hostname === 'never-fetch.example'), false);
  assert.ok(result.report.links.every(link => link.location?.page === null));
  const originalParts = new Set(await Promise.all(Object.values(selectedDocxEntries()).map(sha256ArtifactBytes)));
  assert.ok(result.report.documentReview!.parts.every(part => originalParts.has(part.digestSha256) && part.identity === 'original_part_bytes'));
  assert.doesNotMatch(JSON.stringify(result.report), /private-value|word\/media|token=/u);
  const evil = selectedDocxEntries(); evil['word/document.xml'] = text('<!DOCTYPE x [<!ENTITY read SYSTEM "https://never-fetch.example/">]><x>&read;</x>');
  const incomplete = await reviewSelectedInput(zipSync(evil), 'docx', NOW);
  assert.equal(incomplete.report.coverage.state, 'partial');
  assert.match(incomplete.report.documentReview!.notes.join(' '), /XML review bounds/u);
  const large = selectedDocxEntries(); large['word/document.xml'] = new Uint8Array(MAX_DOCUMENT_TEXT_BYTES + 1).fill(32);
  await assert.rejects(reviewSelectedInput(zipSync(large), 'docx', NOW), /bound/u);
  await assert.rejects(reviewSelectedInput(zipSync({ ...selectedDocxEntries(), '../outside': text('x') }), 'docx', NOW), /unsafe/u);
  await assert.rejects(reviewSelectedInput(zipSync({ ...selectedDocxEntries(), 'word//nested/': new Uint8Array() }), 'docx', NOW), /unsafe/u);
  const corrupt = input.slice(); corrupt[50]! ^= 1;
  await assert.rejects(reviewSelectedInput(corrupt, 'docx', NOW));
});

test('HAR minimisation preserves sequence and unknown timings without private replay material', async () => {
  const result = await reviewSelectedInput(selectedHarFixture(), 'har', NOW), entries = result.report.harReview!.entries;
  assert.deepEqual(entries.map(entry => entry.sequence), [1, 2]);
  assert.deepEqual(entries.map(entry => entry.durationMs), [0, null]);
  assert.deepEqual(entries.map(entry => entry.status), [302, null]);
  assert.equal(entries[0]!.startedAt, '2026-09-20T00:01:00.000Z');
  assert.equal(entries[0]!.timings.dns, null); assert.equal(entries[0]!.timings.connect, 0);
  assert.equal(entries[1]!.reportedFailure, true);
  assert.doesNotMatch(JSON.stringify(result), /private|Bearer|access_token|Authorization|session/u);
  assert.deepEqual(result.targets.map(target => target.exactUrl), ['https://request.example/', 'https://later.example/']);
  await assert.rejects(reviewSelectedInput(text('{"log":{"version":"2","entries":[]}}'), 'har', NOW), /HAR 1.2/u);
  const invalid = await reviewSelectedInput(text('{"log":{"version":"1.2","entries":[null]}}'), 'har', NOW);
  assert.equal(invalid.report.harReview!.invalidEntries, 1); assert.equal(invalid.report.coverage.state, 'partial');
});

test('selected inputs share worker and CLI results, cancellation and binary input policy', async () => {
  for (const [kind, bytes] of [['docx', selectedDocxFixture()], ['har', selectedHarFixture()], ['pdf', selectedPdfFixture()]] as const) {
    const direct = await reviewSelectedInput(bytes, kind, NOW);
    const worker = await reviewSelectedInputInWorker(Buffer.from(bytes), kind, NOW);
    assert.deepEqual(worker, direct);
    if (kind !== 'pdf') assert.deepEqual(await runMessageIntakeOperation({ kind, file: new Blob([bytes]), reviewedAt: NOW }), { kind: 'review', result: direct });
    let output = '', errors = '';
    assert.equal(await runCli(['intake', kind, 'selected.input', '--json'], { readBinaryArtifactInput: async () => Buffer.from(bytes), now: () => NOW,
      stdout: { write(value) { output += value; } }, stderr: { write(value) { errors += value; } }, runUnifiedLookup: async () => { throw new Error('No collection'); } }), 0);
    assert.equal(errors, ''); assert.deepEqual(JSON.parse(output), direct.report);
  }
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(reviewSelectedInputInWorker(text('x'), 'pdf', NOW, aborted.signal));
  const during = new AbortController(), pending = reviewSelectedInputInWorker(selectedPdfFixture(), 'pdf', NOW, during.signal); during.abort();
  await assert.rejects(pending, /cancelled/u);
  await assert.rejects(reviewSelectedInput(new Uint8Array(MAX_MESSAGE_INTAKE_BYTES + 1), 'pdf', NOW), /16 MiB/u);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildWorkspaceArchive, mergeReadyWorkspaceArchiveData, prepareWorkspaceArchive, readWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { compareRecoveredWorkspace, inspectRecoveryFiles, matchRecoveryFiles, workspaceAttachmentGroups } from '../packages/workspace/workspace-recovery.mts';
import { plaintextLocalBinaryCodec } from '../frontend/src/lib/browser-local-binaries.ts';
import type { CaseAttachment } from '../packages/cases/case-attachment-model.mts';
import { createCase } from '../packages/cases/case-model.mts';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../packages/contracts/selected-file-limits.mts';
import { openWorkspaceRecovery } from '../frontend/src/lib/workspace-recovery.ts';

const NOW = '2026-09-01T00:00:00.000Z';
const BODY = new TextEncoder().encode('An independently matched original.');
const DIGEST = `sha256:${createHash('sha256').update(BODY).digest('hex')}`;
const attachment = (id = 'original-one', digest = DIGEST, bytes = BODY.byteLength) => ({ id, fileName: 'original.txt', mediaType: 'application/octet-stream' as const,
  source: 'Analyst-retained source', observedAt: NOW, retainedAt: NOW, digestSha256: digest, byteLength: bytes });
async function fixture() {
  const first = { ...createCase({ domain: 'first.example' }, NOW), id: 'case-one', attachments: [attachment()] };
  const second = { ...createCase({ domain: 'second.example' }, NOW), id: 'case-two', attachments: [{ ...attachment('other-provenance'), source: 'A separate observation' }] };
  return readWorkspaceArchive(await buildWorkspaceArchive({ cases: [first, second] }, { generatedAt: NOW }));
}

test('recovery checklist counts shared content once while retaining independent source references', async () => {
  const source = await fixture();
  const initial = await inspectRecoveryFiles(source, async () => new Map());
  assert.deepEqual([initial.expected, initial.missing, initial.unverified], [1, 1, 0]);
  assert.equal(initial.checklist[0]!.byteLength, BODY.byteLength);
  assert.equal(initial.checklist[0]!.digestSha256, DIGEST);
  assert.deepEqual(initial.checklist[0]!.references.map(item => [item.caseId, item.attachment.id, item.attachment.source]),
    [['case-one', 'original-one', 'Analyst-retained source'], ['case-two', 'other-provenance', 'A separate observation']]);
  const unreadable = await inspectRecoveryFiles(source, async () => { throw new Error('Private storage detail'); });
  assert.deepEqual([unreadable.missing, unreadable.unverified], [0, 1]);
  assert.equal(unreadable.checklist[0]!.state, 'unverified');
  assert.ok(!JSON.stringify(unreadable).includes('Private storage detail'));
});

test('partial multi-group recovery completes only with exact bytes through the existing binary codec', async () => {
  const source = await fixture();
  const rows = (source.sections.find(item => item.id === 'cases')!.data as { cases: { attachments: ReturnType<typeof attachment>[] }[] }).cases;
  const bodies = Array.from({ length: MAX_SELECTED_FILES + 1 }, (_, index) => new Blob([`Unique original ${index}`]));
  const references = await Promise.all(bodies.map(async (file, index) => attachment(`original-${index}`,
    `sha256:${createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')}`, file.size)));
  rows[0]!.attachments = references.slice(0, MAX_SELECTED_FILES);
  rows[1]!.attachments = references.slice(MAX_SELECTED_FILES);
  const cache = new Map<string, ArrayBuffer>();
  const groups = workspaceAttachmentGroups(source);
  const retain = async (files: readonly Blob[]) => {
    const matched = await matchRecoveryFiles(groups, files); // Reject the whole operation before any cache write.
    for (const item of matched) cache.set(item.reference.digestSha256, await plaintextLocalBinaryCodec.encode({
      collection: 'cases', lookupKey: item.reference.digestSha256, ...item }));
  };
  const read = async (group: readonly CaseAttachment[]) => {
    const files = new Map<string, Blob>();
    for (const reference of group) {
      const payload = cache.get(reference.digestSha256);
      if (payload) files.set(reference.digestSha256, await plaintextLocalBinaryCodec.decode({
        collection: 'cases', lookupKey: reference.digestSha256,
        reference: { digestSha256: reference.digestSha256, byteLength: reference.byteLength }, payload }));
    }
    return files;
  };
  await retain(bodies.slice(0, MAX_SELECTED_FILES));
  const partial = await inspectRecoveryFiles(source, read);
  assert.deepEqual([partial.verified, partial.missing, partial.unverified], [MAX_SELECTED_FILES, 1, 0]);
  assert.equal(partial.checklist[0]!.digestSha256, references.at(-1)!.digestSha256);
  const before = cache.size;
  await assert.rejects(retain([bodies.at(-1)!, new File(['Different bytes'], references.at(-1)!.fileName)]), /does not match/);
  assert.equal(cache.size, before);
  await retain([new File([bodies.at(-1)!], 'renamed-exact-original.bin')]);
  const complete = await inspectRecoveryFiles(source, read);
  assert.deepEqual([complete.verified, complete.missing, complete.unverified, complete.checklist.length], [MAX_SELECTED_FILES + 1, 0, 0, 0]);
  new Uint8Array(cache.get(references[0]!.digestSha256)!).fill(0);
  const corrupt = await inspectRecoveryFiles(source, read);
  assert.equal(corrupt.missing, 0);
  assert.equal(corrupt.unverified, MAX_SELECTED_FILES);
});

test('all supported archive sections use one merge owner and current data round trips independently', async () => {
  const source = await fixture();
  const result = mergeReadyWorkspaceArchiveData({}, source.sections.filter(section => section.id !== 'settings'), NOW);
  assert.equal(result.length, source.sections.length - 1);
  const actual = await readWorkspaceArchive(await buildWorkspaceArchive(Object.fromEntries(result.map(item => [item.id, item.document])), { generatedAt: NOW }));
  const compared = compareRecoveredWorkspace(source, actual);
  assert.equal(compared.metadataMatches, true);
  assert.equal(compared.caseCount, 2);
  assert.deepEqual((actual.sections.find(section => section.id === 'cases')!.data as { cases: { id: string }[] }).cases.map(item => item.id).sort(), ['case-one', 'case-two']);
  assert.equal(result.find(item => item.id === 'cases')!.added, 2);
});

test('independent section checks reject altered metadata, omitted data and preserved-count identity substitution', async () => {
  const source = await fixture();
  for (const mutate of [
    (actual: typeof source) => { actual.sections.find(section => section.id === 'cases')!.checksum = `sha256:${'f'.repeat(64)}`; },
    (actual: typeof source) => { actual.sections = actual.sections.filter(section => section.id !== 'campaigns'); },
    (actual: typeof source) => { (actual.sections.find(section => section.id === 'cases')!.data as { cases: { id: string }[] }).cases[0]!.id = 'substituted'; },
    (actual: typeof source) => { actual.sections.find(section => section.id === 'relationshipObservations')!.recordCount++; },
    (actual: typeof source) => { actual.sections.find(section => section.id === 'cases')!.status = 'unsupported'; },
  ]) {
    const actual = structuredClone(source); mutate(actual);
    assert.equal(compareRecoveredWorkspace(source, actual).metadataMatches, false);
  }
});

test('public archive migration remains readable and cannot claim identical current-format checksums', async () => {
  const raw = JSON.parse(await readFile(new URL('fixtures/workspace-populated-v5-public.json', import.meta.url), 'utf8'));
  const prepared = await prepareWorkspaceArchive(raw), source = prepared.read();
  const preview = prepared.preview({});
  const results = mergeReadyWorkspaceArchiveData({}, preview.sections.filter(section => section.id !== 'settings' && section.status === 'ready'), source.generatedAt);
  const actual = await readWorkspaceArchive(await buildWorkspaceArchive(Object.fromEntries(results.map(item => [item.id, item.document])), { generatedAt: source.generatedAt }));
  const comparison = compareRecoveredWorkspace(source, actual);
  assert.equal(comparison.identitiesMatch, true);
  assert.ok(comparison.caseCount! > 0);
  assert.ok(comparison.sections.some(section => section.state === 'migrated'));
  assert.equal(comparison.metadataMatches, false);
});

test('unready, settings and duplicate sections cannot enter data persistence', async () => {
  const source = await fixture(), section = source.sections.find(item => item.id === 'cases')!;
  assert.doesNotThrow(() => mergeReadyWorkspaceArchiveData({}, [section], NOW));
  for (const [sections, expected] of [
    [[{ ...section, status: 'blocked' as const }], /Only verified, supported workspace data sections can be merged/u],
    [[section, section], /duplicate identities/u],
    [[source.sections.find(item => item.id === 'settings')!], /Only verified, supported workspace data sections can be merged/u],
    [[{ ...section, id: 'unknown' }], /Only verified, supported workspace data sections can be merged/u],
  ] as const) {
    assert.throws(() => mergeReadyWorkspaceArchiveData({}, sections, NOW), expected);
  }
});

test('file groups deduplicate bytes without merging source declarations or limiting the whole workspace to one operation', async () => {
  const source = await fixture();
  const groups = workspaceAttachmentGroups(source);
  assert.equal(groups.length, 1); assert.equal(groups[0]!.length, 1);
  assert.equal((source.sections.find(section => section.id === 'cases')!.data as { cases: unknown[] }).cases.length, 2);
  const rows = (source.sections.find(section => section.id === 'cases')!.data as { cases: { attachments: ReturnType<typeof attachment>[] }[] }).cases;
  rows[0]!.attachments = Array.from({ length: MAX_SELECTED_FILES }, (_, i) => attachment(`file-${i}`, `sha256:${i.toString(16).padStart(64, '0')}`, 1));
  rows[1]!.attachments = [attachment('last', `sha256:${'e'.repeat(64)}`, MAX_SELECTED_FILE_TOTAL_BYTES)];
  const partitions = workspaceAttachmentGroups(source);
  assert.deepEqual(partitions.map(group => group.length), [MAX_SELECTED_FILES, 1]);
  assert.equal(partitions.flat().reduce((sum, item) => sum + item.byteLength, 0), MAX_SELECTED_FILE_TOTAL_BYTES + MAX_SELECTED_FILES);
});

test('conflicting content lengths and malformed file provenance fail before recovery writes', async () => {
  const source = await fixture();
  const rows = (source.sections.find(section => section.id === 'cases')!.data as { cases: { attachments: ReturnType<typeof attachment>[] }[] }).cases;
  rows[1]!.attachments[0]!.byteLength++;
  assert.throws(() => workspaceAttachmentGroups(source), /conflicting byte lengths/);
  rows[1]!.attachments[0]!.byteLength--;
  rows[1]!.attachments[0]!.fileName = '../unsafe';
  assert.throws(() => workspaceAttachmentGroups(source), /path/);
});

test('complete original bytes match the downloaded backup regardless of filename; unknown files reject the entire selection', async () => {
  const groups = workspaceAttachmentGroups(await fixture());
  const matched = await matchRecoveryFiles(groups, [new File([BODY], 'renamed.bin'), new Blob([BODY])]);
  assert.equal(matched.length, 1); assert.deepEqual(matched[0]!.reference, { digestSha256: DIGEST, byteLength: BODY.byteLength });
  assert.deepEqual(new Uint8Array(await matched[0]!.file.arrayBuffer()), BODY);
  for (const [files, expected] of [
    [[], /Select 1–\d+ files per operation/u],
    [[new Blob()], /Selected recovery files are empty/u],
    [[new Blob([BODY]), new Blob(['different'])], /does not match any file reference/u],
    [Array.from({ length: MAX_SELECTED_FILES + 1 }, () => new Blob(['x'])), /Select 1–\d+ files per operation/u],
  ] as const) {
    await assert.rejects(matchRecoveryFiles(groups, files), expected);
  }
});

test('selected immutable bodies and declarations cannot be replaced across asynchronous hashing', async () => {
  const groups = workspaceAttachmentGroups(await fixture());
  const files = [new Blob([BODY])];
  const pending = matchRecoveryFiles(groups, files);
  files[0] = new Blob(['replacement']); files.push(new Blob(['injected']));
  const matched = await pending;
  assert.equal(matched.length, 1); assert.equal(matched[0]!.reference.digestSha256, DIGEST);
});

test('unsupported backup data and an encryption downgrade are rejected before touching browser storage', async () => {
  const source = await fixture();
  await assert.rejects(openWorkspaceRecovery(source, { name: 'Protected fixture', requireEncryption: true }), /requires an encrypted/);
  source.sections.find(section => section.id === 'cases')!.status = 'unsupported';
  assert.throws(() => workspaceAttachmentGroups(source), /cannot be determined/);
  await assert.rejects(openWorkspaceRecovery(source, { name: 'Unsupported fixture', requireEncryption: false }), /unsupported section/);
});

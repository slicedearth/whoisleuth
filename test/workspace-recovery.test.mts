import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildWorkspaceArchive, mergeReadyWorkspaceArchiveData, prepareWorkspaceArchive, readWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { compareRecoveredWorkspace, matchRecoveryFiles, workspaceAttachmentGroups } from '../packages/workspace/workspace-recovery.mts';
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
  for (const sections of [[{ ...section, status: 'blocked' as const }], [section, section], [source.sections.find(item => item.id === 'settings')!], [{ ...section, id: 'unknown' }]]) {
    assert.throws(() => mergeReadyWorkspaceArchiveData({}, sections, NOW));
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
  rows[1]!.attachments[0]!.fileName = '../unsafe';
  assert.throws(() => workspaceAttachmentGroups(source), /path/);
});

test('complete original bytes match the downloaded backup regardless of filename; unknown files reject the entire selection', async () => {
  const groups = workspaceAttachmentGroups(await fixture());
  const matched = await matchRecoveryFiles(groups, [new File([BODY], 'renamed.bin'), new Blob([BODY])]);
  assert.equal(matched.length, 1); assert.deepEqual(matched[0]!.reference, { digestSha256: DIGEST, byteLength: BODY.byteLength });
  assert.deepEqual(new Uint8Array(await matched[0]!.file.arrayBuffer()), BODY);
  for (const files of [[], [new Blob()], [new Blob([BODY]), new Blob(['different'])], Array.from({ length: MAX_SELECTED_FILES + 1 }, () => new Blob(['x']))]) {
    await assert.rejects(matchRecoveryFiles(groups, files));
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

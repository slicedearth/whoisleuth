import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { BrowserLocalDataProvider, type BrowserLocalDataUpdater, type BrowserLocalDataUpdateOptions, type LocalDataCollectionDefinition } from '../frontend/src/lib/browser-local-data.ts';
import { prepareCaseAttachmentFiles, readRetainedCaseFile, readRetainedCaseFiles, removeRetainedCaseAttachment, retainCaseAttachments } from '../frontend/src/lib/case-attachments.ts';
import { deleteCaseView, loadCaseViews, saveCaseView } from '../frontend/src/lib/case-views.ts';
import { createCase, type CaseRecord } from '../packages/cases/case-model.mts';
import { emptyCaseViewsStore } from '../packages/workspace/case-views.mts';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../packages/contracts/selected-file-limits.mts';
import type { CaseViewFilters } from '../packages/contracts/case-views-contract.mts';

const NOW = '2026-09-01T00:00:00.000Z';
const FILTERS: CaseViewFilters = { status: '', disposition: '', search: '', sort: 'updated' };

// Only the persistence boundary is substituted; forms, validation, conflict
// checks and collection selection use their production owners.
function localStore(t: TestContext, initial: readonly [string, unknown][]) {
  for (const [name, value] of Object.entries({
    indexedDB: { open: () => assert.fail('The unit boundary must not open a real database.') },
    localStorage: { getItem: () => null, setItem: () => assert.fail('No legacy write is expected.') },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  const state = { documents: new Map(initial), files: new Map<string, Blob | null>(), writes: 0, failure: null as Error | null, options: {} as BrowserLocalDataUpdateOptions };
  t.mock.method(BrowserLocalDataProvider.prototype, 'initialize', async () => ({ state: 'ready', migratedCollections: [] }));
  t.mock.method(BrowserLocalDataProvider.prototype, 'read', async <T,>(definition: LocalDataCollectionDefinition<T>) => state.documents.get(definition.id) as T);
  t.mock.method(BrowserLocalDataProvider.prototype, 'update', async <T, R>(definition: LocalDataCollectionDefinition<T>, updater: BrowserLocalDataUpdater<T, R>, options: BrowserLocalDataUpdateOptions = {}) => {
    if (state.failure) throw state.failure;
    const updated = await updater(state.documents.get(definition.id) as T);
    state.documents.set(definition.id, updated.document); state.options = options; state.writes++;
    return updated.result;
  });
  t.mock.method(BrowserLocalDataProvider.prototype, 'readFiles', async (definition: LocalDataCollectionDefinition<unknown>, references: readonly { digestSha256: string; byteLength: number }[]) => {
    assert.equal(definition.id, 'cases');
    return new Map(references.map(reference => [reference.digestSha256, state.files.get(reference.digestSha256) ?? null]));
  });
  return state;
}

test('selected files preserve exact bytes and independent provenance before one Case mutation', async t => {
  const record = createCase({ domain: 'files.example' }, NOW);
  const state = localStore(t, [['cases', [record]]]);
  const input = new File(['original bytes'], 'original.txt');
  const selected = await prepareCaseAttachmentFiles([input], 'Selected observation', NOW);
  assert.equal(selected.length, 1);
  const first = selected[0]!;
  assert.equal(await first.file.text(), 'original bytes');
  assert.equal(first.attachment.digestSha256, `sha256:${createHash('sha256').update('original bytes').digest('hex')}`);
  assert.equal(first.attachment.source, 'Selected observation');
  assert.equal(first.attachment.observedAt, NOW);
  const second = { ...first, attachment: { ...first.attachment, id: 'independent-reference', source: 'Another observation' } };
  const result = await retainCaseAttachments(record.id, [first, second]);
  assert.equal(state.writes, 1); assert.equal(result.pruned, 0);
  assert.deepEqual(result.record.attachments?.map(item => item.source), ['Selected observation', 'Another observation']);
  assert.equal(state.options.files?.length, 1);
  assert.equal(await state.options.files![0]!.file.text(), 'original bytes');
  state.files.set(first.attachment.digestSha256, first.file);
  assert.equal(await (await readRetainedCaseFile(first.attachment)).text(), 'original bytes');
  assert.equal((await readRetainedCaseFiles(result.record.attachments!)).length, 2);
  await removeRetainedCaseAttachment(record.id, result.record.attachments![0]!);
  assert.deepEqual((state.documents.get('cases') as CaseRecord[])[0]!.attachments?.map(item => item.id), ['independent-reference']);
});

test('attachment validation rejects invalid selections before reading or writing', async t => {
  const state = localStore(t, [['cases', []]]);
  const file = new File(['x'], 'original.txt');
  const slice = t.mock.method(file, 'slice', () => assert.fail('Invalid provenance must fail before body selection.'));
  await assert.rejects(prepareCaseAttachmentFiles([file], null, 'not-a-date'));
  assert.equal(slice.mock.callCount(), 0);
  for (const files of [[], Array.from({ length: MAX_SELECTED_FILES + 1 }, () => file), [new File([], 'empty.txt')]]) {
    await assert.rejects(prepareCaseAttachmentFiles(files, null, null));
  }
  const oversized = new File(['x'], 'large.txt');
  Object.defineProperty(oversized, 'size', { value: MAX_SELECTED_FILE_TOTAL_BYTES + 1 });
  t.mock.method(oversized, 'slice', () => assert.fail('Oversized files must not be read.'));
  await assert.rejects(prepareCaseAttachmentFiles([oversized], null, null), /64-MiB/u);
  await assert.rejects(retainCaseAttachments('missing', []));
  await assert.rejects(readRetainedCaseFiles([]));
  assert.equal(state.writes, 0);
});

test('missing originals, changed references and failed persistence stay explicit', async t => {
  const record = createCase({ domain: 'files.example' }, NOW);
  const state = localStore(t, [['cases', [record]]]);
  const [selected] = await prepareCaseAttachmentFiles([new File(['x'], 'original.txt')], null, null);
  assert.ok(selected);
  await assert.rejects(retainCaseAttachments('missing', [selected]), /no longer available/u);
  await assert.rejects(retainCaseAttachments(record.id, [selected, { ...selected, attachment: { ...selected.attachment, id: 'conflict', digestSha256: `sha256:${'a'.repeat(64)}` } }]), /conflicting content/u);
  assert.equal(state.writes, 0);
  const saved = await retainCaseAttachments(record.id, [selected]);
  await assert.rejects(readRetainedCaseFile(selected.attachment), /original bytes are missing/u);
  await assert.rejects(removeRetainedCaseAttachment(record.id, { ...saved.record.attachments![0]!, source: 'Changed elsewhere' }), /another tab/u);
  await assert.rejects(removeRetainedCaseAttachment('missing', selected.attachment), /no longer available/u);
  const before = structuredClone(state.documents.get('cases'));
  state.failure = new Error('Fixture write failure');
  await assert.rejects(removeRetainedCaseAttachment(record.id, saved.record.attachments![0]!), /Fixture write failure/u);
  assert.deepEqual(state.documents.get('cases'), before); assert.equal(state.writes, 1);
  const large = { ...selected.attachment, byteLength: MAX_SELECTED_FILE_TOTAL_BYTES };
  await assert.rejects(readRetainedCaseFiles([large, { ...large, id: 'second-large' }]), /combined 64-MiB/u);
});

test('saved Case views detach submitted filters and retain identity through deliberate edits', async t => {
  const state = localStore(t, [['case_views', emptyCaseViewsStore()]]);
  const input = { name: 'Review next', filters: { ...FILTERS, search: 'selected evidence' } };
  const pending = saveCaseView(input);
  input.name = 'Mutated caller'; input.filters.search = 'changed';
  const first = await pending;
  assert.equal(first.view.name, 'Review next'); assert.equal(first.view.filters.search, 'selected evidence');
  assert.deepEqual(await loadCaseViews(), first.store);
  const edited = await saveCaseView({ name: 'Follow up', filters: FILTERS }, first.view);
  assert.equal(edited.view.id, first.view.id); assert.equal(edited.view.createdAt, first.view.createdAt);
  assert.equal(edited.store.views.length, 1);
  assert.deepEqual((await deleteCaseView(edited.view)).views, []);
  assert.equal(state.writes, 3);
});

test('stale and failed saved-view writes cannot silently overwrite another tab', async t => {
  const state = localStore(t, [['case_views', emptyCaseViewsStore()]]);
  const first = await saveCaseView({ name: 'First', filters: FILTERS });
  const changed = await saveCaseView({ name: 'Other tab', filters: FILTERS }, first.view);
  await assert.rejects(saveCaseView({ name: 'Stale edit', filters: FILTERS }, first.view), { name: 'LocalRecordConflictError' });
  await assert.rejects(deleteCaseView(first.view), { name: 'LocalRecordConflictError' });
  const writes = state.writes;
  await assert.rejects(saveCaseView({ name: '', filters: FILTERS }));
  state.failure = new Error('Fixture write failure');
  await assert.rejects(deleteCaseView(changed.view), /Fixture write failure/u);
  assert.deepEqual(state.documents.get('case_views'), changed.store); assert.equal(state.writes, writes);
});

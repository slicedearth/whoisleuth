import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectedInvestigationFolderFiles, selectedBagItFolderFiles, readBrowserInvestigationFolder, writeBrowserInvestigationFolder, supportsEvidenceFolderWrite } from '../frontend/src/lib/investigation-folder.ts';
import { runInvestigationPackageOperation, type BrowserInvestigationFolder } from '../frontend/src/lib/investigation-package-worker-model.ts';
import { MAX_INVESTIGATION_PACKAGE_ENTRIES } from '../packages/investigation/investigation-package.mts';

const source = new Blob([new Uint8Array([0, 255, 128, 1])]);
const NOW = '2026-09-12T00:00:00.000Z';
async function prepared(): Promise<BrowserInvestigationFolder> {
  const result = await runInvestigationPackageOperation({ kind: 'folder', input: { workflow: 'Selected files', generatedAt: NOW, applicationVersion: '2.4.0', files: [
    { file: source, mediaType: 'image/png', source: { identity: 'Independent observation', observedAt: null } },
  ] } });
  assert.equal(result.kind, 'folder'); if (result.kind !== 'folder') throw new Error('Expected folder');
  return result.result;
}

type Entry = MemoryDirectory | MemoryFile;
class MemoryFile {
  kind = 'file' as const;
  bytes = new Uint8Array();
  readonly name: string;
  readonly writes: string[];
  readonly beforeClose: (name: string) => void;
  constructor(name: string, writes: string[], beforeClose: (name: string) => void) { this.name = name; this.writes = writes; this.beforeClose = beforeClose; }
  async getFile() { return new File([this.bytes], this.name); }
  async createWritable() {
    let pending = new Uint8Array();
    return {
      write: async (file: Blob) => { pending = new Uint8Array(await file.arrayBuffer()); },
      close: async () => { this.beforeClose(this.name); this.bytes = pending; this.writes.push(this.name); },
      abort: async () => { pending = new Uint8Array(); },
    };
  }
}
class MemoryDirectory {
  kind = 'directory' as const;
  children = new Map<string, Entry>();
  readonly name: string;
  readonly writes: string[];
  readonly beforeClose: (name: string) => void;
  constructor(name: string, writes: string[] = [], beforeClose: (name: string) => void = () => {}) { this.name = name; this.writes = writes; this.beforeClose = beforeClose; }
  async *entries() { yield* this.children; }
  private select(name: string, kind: 'directory' | 'file', create?: boolean): Entry {
    let item = this.children.get(name);
    if (!item && create) {
      item = kind === 'directory' ? new MemoryDirectory(name, this.writes, this.beforeClose) : new MemoryFile(name, this.writes, this.beforeClose);
      this.children.set(name, item);
    }
    if (!item) throw new DOMException('No entry', 'NotFoundError');
    if (item.kind !== kind) throw new DOMException('Wrong kind', 'TypeMismatchError');
    return item;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) { return this.select(name, 'directory', options?.create) as MemoryDirectory; }
  async getFileHandle(name: string, options?: { create?: boolean }) { return this.select(name, 'file', options?.create) as MemoryFile; }
  get handle() { return this as unknown as FileSystemDirectoryHandle; }
}

test('BagIt browser folder output shares the fresh-folder coordinator and independent read-back verifier', async () => {
  const result = await runInvestigationPackageOperation({ kind: 'bagitFolder', input: { workflow: 'Selected files', generatedAt: NOW, applicationVersion: '2.4.0', files: [
    { file: source, mediaType: 'image/png', source: { identity: null, observedAt: null } },
  ] } });
  if (result.kind !== 'bagitFolder') assert.fail('Expected BagIt folder');
  const parent = new MemoryDirectory('selected-parent');
  const written = await writeBrowserInvestigationFolder(parent.handle, result.result, undefined, 'bagit');
  assert.equal(parent.children.size, 1); assert.equal(parent.writes.at(-1), 'tagmanifest-sha512.txt');
  const checked = await runInvestigationPackageOperation({ kind: 'bagitInspectFolder', input: { files: written.files } });
  if (checked.kind !== 'bagitInspectFolder') assert.fail('Expected BagIt review');
  assert.equal(checked.result.review.state, 'valid');
  assert.deepEqual(new Uint8Array(await checked.result.contents.get('artifact-1')!.arrayBuffer()), new Uint8Array(await source.arrayBuffer()));
  const selected = written.files.filter(item => !item.path.endsWith('/')).map(item => {
    const file = new File([item.file], item.path.split('/').at(-1)!);
    Object.defineProperty(file, 'webkitRelativePath', { value: `selected-parent/${item.path}` }); return file;
  });
  assert.equal(selectedBagItFolderFiles(selected).length, selected.length);
  assert.throws(() => selectedBagItFolderFiles([...selected, selected[0]!]), /collid/u);
  const wrong = new File(['x'], 'extra'); Object.defineProperty(wrong, 'webkitRelativePath', { value: 'another-parent/data/extra' });
  assert.throws(() => selectedBagItFolderFiles([...selected, wrong]), /one BagIt folder/u);
});

test('browser folder preparation and inspection use the same manifest and admit only verified opaque bytes', async () => {
  const folder = await prepared();
  const result = await runInvestigationPackageOperation({ kind: 'inspectFolder', input: { files: folder.files } });
  assert.equal(result.kind, 'inspectFolder'); if (result.kind !== 'inspectFolder') assert.fail();
  assert.equal(result.result.identityVerified, true);
  assert.equal(result.result.entries[0]!.interpretation, 'opaque');
  assert.deepEqual(new Uint8Array(await result.result.contents.get('artifact-1')!.arrayBuffer()), new Uint8Array(await source.arrayBuffer()));
  assert.equal(result.result.entries[0]!.entry.version, null);
  const altered = folder.files.map(item => item.path === 'manifest.json' ? item : { ...item, file: new Blob(['x']) });
  const rejected = await runInvestigationPackageOperation({ kind: 'inspectFolder', input: { files: altered } });
  assert.equal(rejected.kind, 'inspectFolder'); if (rejected.kind !== 'inspectFolder') assert.fail();
  assert.equal(rejected.result.identityVerified, false); assert.equal(rejected.result.contents.size, 0);
});

test('directory file input drops its parent name and rejects mixed roots, duplicate paths and excess before body reads', async () => {
  const folder = await prepared();
  const selection = folder.files.map(item => {
    const file = new File([item.file], item.path.split('/').at(-1)!);
    Object.defineProperty(file, 'webkitRelativePath', { value: `private-directory/${item.path}` });
    return file;
  });
  const files = selectedInvestigationFolderFiles(selection);
  assert.deepEqual(files.map(item => item.path), folder.files.map(item => item.path));
  assert.ok(files.every(item => !(item.file instanceof File)));
  assert.throws(() => selectedInvestigationFolderFiles([...selection, selection[0]!]), /duplicate/);
  assert.throws(() => selectedInvestigationFolderFiles({ length: MAX_INVESTIGATION_PACKAGE_ENTRIES + 1 }), /entry limit/);
  const wrongRoot = new File(['x'], 'artifact-2'); Object.defineProperty(wrongRoot, 'webkitRelativePath', { value: 'different-root/artifacts/artifact-2' });
  assert.throws(() => selectedInvestigationFolderFiles([...selection, wrongRoot]), /one evidence folder/);
  const traversal = new File(['x'], 'artifact-2'); Object.defineProperty(traversal, 'webkitRelativePath', { value: 'private-directory/../artifact-2' });
  assert.throws(() => selectedInvestigationFolderFiles([...selection, traversal]), /path/);
});

test('native folder operations create one new child, write the manifest last and read bytes back', async () => {
  const parent = new MemoryDirectory('selected-parent'), folder = await prepared();
  const result = await writeBrowserInvestigationFolder(parent.handle, folder);
  assert.equal(parent.children.size, 1); assert.match(result.name, /^whoisleuth-evidence-[\da-f-]{36}$/);
  assert.deepEqual(parent.writes, ['artifact-1', 'manifest.json']);
  const reviewed = await runInvestigationPackageOperation({ kind: 'inspectFolder', input: { files: result.files } });
  assert.equal(reviewed.kind, 'inspectFolder'); if (reviewed.kind !== 'inspectFolder') assert.fail();
  assert.equal(reviewed.result.identityVerified, true);
  assert.equal(reviewed.result.manifest.integrity.digestSha256, folder.manifest.integrity.digestSha256);
  assert.equal(supportsEvidenceFolderWrite(), false);
});

test('native folder output never replaces a colliding destination', async context => {
  const id = '00000000-0000-4000-8000-000000000001';
  context.mock.method(crypto, 'randomUUID', () => id);
  const parent = new MemoryDirectory('selected-parent');
  const existing = await parent.getDirectoryHandle(`whoisleuth-evidence-${id}`, { create: true });
  const marker = await existing.getFileHandle('preserved', { create: true }); marker.bytes = new Uint8Array([7]);
  await assert.rejects(writeBrowserInvestigationFolder(parent.handle, await prepared()), /already exists/);
  assert.equal(parent.children.size, 1); assert.deepEqual(parent.writes, []); assert.deepEqual(marker.bytes, new Uint8Array([7]));
});

test('failed or cancelled folder writes expose partial output and do not publish the manifest', async () => {
  for (const mode of ['failure', 'cancellation']) {
    const controller = new AbortController();
    const parent = new MemoryDirectory('selected-parent', [], () => {
      if (mode === 'failure') throw new DOMException('Write denied', 'NotAllowedError');
      controller.abort();
    });
    await assert.rejects(writeBrowserInvestigationFolder(parent.handle, await prepared(), controller.signal), /private partial output/);
    assert.equal(parent.children.size, 1);
    const child = [...parent.children.values()][0] as MemoryDirectory;
    assert.equal(child.children.has('manifest.json'), false);
    assert.equal(parent.writes.includes('manifest.json'), false);
  }
});

test('native folder reads reject unrelated trees and worker bounds precede all content reads', async () => {
  const parent = new MemoryDirectory('selected-parent'); await parent.getDirectoryHandle('unrelated', { create: true });
  await assert.rejects(readBrowserInvestigationFolder(parent.handle), /only manifest/);
  const folder = await prepared(); let reads = 0;
  const inaccessible = new Blob(['unread content']); Object.defineProperty(inaccessible, 'arrayBuffer', { value: () => { reads++; throw new Error('must not read'); } });
  const result = await runInvestigationPackageOperation({ kind: 'inspectFolder', input: { files: [...folder.files, { path: 'unrelated/private-file', file: inaccessible }] } });
  assert.equal(result.kind, 'error'); assert.equal(reads, 0); assert.doesNotMatch(JSON.stringify(result), /private-file|unread content/);
});

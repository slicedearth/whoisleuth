import { INVESTIGATION_PACKAGE_MANIFEST_PATH, MAX_INVESTIGATION_PACKAGE_ENTRIES, investigationPackagePath } from '../../../packages/investigation/investigation-package.mts';
import { assertInvestigationFolderSelection, type BrowserInvestigationFolder, type InvestigationFolderFile } from './investigation-package-worker-model.ts';

export function selectedInvestigationFolderFiles(input: ArrayLike<File>): readonly InvestigationFolderFile[] {
  if (input.length < 2 || input.length > MAX_INVESTIGATION_PACKAGE_ENTRIES) throw new TypeError('Select one evidence folder within the supported entry limit.');
  let root = '';
  const files = Array.from(input, file => {
    if (!(file instanceof File) || file.webkitRelativePath.length > 512) throw new TypeError('The selected folder has an invalid file path.');
    const [directory, ...parts] = file.webkitRelativePath.split('/');
    if (!directory || directory === '.' || directory === '..' || directory.includes('\\') || (root && root !== directory)) throw new TypeError('Select one evidence folder, not unrelated files.');
    root = directory;
    return { path: investigationPackagePath(parts.join('/')), file: file.slice() };
  });
  assertInvestigationFolderSelection(files);
  return files;
}

export function supportsEvidenceFolderWrite(): boolean {
  return typeof window !== 'undefined' && typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** Must be called directly from the analyst's button activation. */
export function chooseEvidenceFolderParent(): Promise<FileSystemDirectoryHandle> {
  const host = window as Window & { showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle> };
  if (!supportsEvidenceFolderWrite() || !host.showDirectoryPicker) throw new Error('This browser cannot write folders directly. Download the ZIP and extract it locally.');
  return host.showDirectoryPicker({ mode: 'readwrite' });
}

export async function readBrowserInvestigationFolder(root: FileSystemDirectoryHandle, signal?: AbortSignal): Promise<readonly InvestigationFolderFile[]> {
  const files: InvestigationFolderFile[] = [];
  const append = async (path: string, handle: FileSystemHandle) => {
    signal?.throwIfAborted();
    if (files.length >= MAX_INVESTIGATION_PACKAGE_ENTRIES || handle.kind !== 'file') throw new Error('Evidence folder contains too many files or an unexpected directory.');
    files.push({ path: investigationPackagePath(path), file: await (handle as FileSystemFileHandle).getFile() });
  };
  for await (const [name, entry] of root.entries()) {
    signal?.throwIfAborted();
    if (name === 'artifacts' && entry.kind === 'directory') {
      for await (const [fileName, file] of (entry as FileSystemDirectoryHandle).entries()) await append(`artifacts/${fileName}`, file);
    } else if (name === INVESTIGATION_PACKAGE_MANIFEST_PATH) await append(name, entry);
    else throw new Error('Evidence folders contain only manifest.json and the declared artifacts directory.');
  }
  signal?.throwIfAborted();
  assertInvestigationFolderSelection(files);
  return files;
}

async function requireMissing(read: () => Promise<FileSystemHandle>): Promise<void> {
  try { await read(); }
  catch (cause) { if (cause instanceof DOMException && cause.name === 'NotFoundError') return; throw cause; }
  throw new Error('An entry already exists at the generated destination. It was not replaced.');
}

/** Creates one fresh child; no handle or ongoing permission is retained. */
export async function writeBrowserInvestigationFolder(parent: FileSystemDirectoryHandle, prepared: BrowserInvestigationFolder, signal?: AbortSignal) {
  assertInvestigationFolderSelection(prepared.files);
  const files = prepared.files.map(item => ({ path: item.path, file: item.file }));
  const name = `whoisleuth-evidence-${crypto.randomUUID()}`;
  signal?.throwIfAborted();
  await requireMissing(() => parent.getDirectoryHandle(name));
  signal?.throwIfAborted();
  const root = await parent.getDirectoryHandle(name, { create: true });
  try {
    for await (const _ of root.entries()) throw new Error('The new output folder is not empty.');
    const artifacts = await root.getDirectoryHandle('artifacts', { create: true });
    // Write the completion manifest last. Cancellation may leave an incomplete
    // child folder, never an overwritten source or an implied complete backup.
    const ordered = [...files].sort((left, right) => Number(left.path === INVESTIGATION_PACKAGE_MANIFEST_PATH) - Number(right.path === INVESTIGATION_PACKAGE_MANIFEST_PATH));
    for (const item of ordered) {
      signal?.throwIfAborted();
      const directory = item.path === INVESTIGATION_PACKAGE_MANIFEST_PATH ? root : artifacts;
      const fileName = item.path.split('/').at(-1)!;
      await requireMissing(() => directory.getFileHandle(fileName));
      const handle = await directory.getFileHandle(fileName, { create: true });
      const stream = await handle.createWritable();
      try { signal?.throwIfAborted(); await stream.write(item.file); signal?.throwIfAborted(); await stream.close(); }
      catch (cause) { await stream.abort().catch(() => {}); throw cause; }
    }
    return { name, files: await readBrowserInvestigationFolder(root, signal) };
  } catch {
    throw new Error(`The new folder ${name} could not be completed or confirmed. It may contain private partial output; inspect or remove it before another export. No existing folder was selected for replacement.`);
  }
}

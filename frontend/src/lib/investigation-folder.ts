import { INVESTIGATION_PACKAGE_MANIFEST_PATH, MAX_INVESTIGATION_PACKAGE_ENTRIES, investigationPackagePath } from '../../../packages/investigation/investigation-package.mts';
import { assertInvestigationFolderSelection, type BrowserInvestigationFolder, type InvestigationFolderFile } from './investigation-package-worker-model.ts';
import { assertBagItSelection, bagItPath, MAX_BAGIT_ENTRIES, MAX_BAGIT_PATH_BYTES } from '../../../packages/interchange/bagit.mts';

export function selectedBagItFolderFiles(input: ArrayLike<File>): readonly InvestigationFolderFile[] {
  if (!input.length || input.length > MAX_BAGIT_ENTRIES) throw new TypeError('Select one BagIt folder within the supported entry limit.');
  let root = '';
  const files = Array.from(input, file => {
    if (!(file instanceof File) || file.webkitRelativePath.length > MAX_BAGIT_PATH_BYTES + 256) throw new TypeError('BagIt folder has an invalid selected path.');
    const [directory, ...parts] = file.webkitRelativePath.split('/');
    if (!directory || directory === '.' || directory === '..' || directory.includes('\\') || (root && root !== directory)) throw new TypeError('Select one BagIt folder, not unrelated files.');
    root = directory;
    return { path: bagItPath(parts.join('/')), file: file.slice() };
  });
  assertBagItSelection(files.map(item => ({ path: item.path, byteLength: item.file.size })));
  return files;
}

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

export async function readBrowserInvestigationFolder(root: FileSystemDirectoryHandle, signal?: AbortSignal, format: 'evidence' | 'bagit' = 'evidence'): Promise<readonly InvestigationFolderFile[]> {
  if (format === 'bagit') {
    const files: InvestigationFolderFile[] = [];
    const visit = async (directory: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of directory.entries()) {
        signal?.throwIfAborted();
        if (files.length >= MAX_BAGIT_ENTRIES) throw new TypeError('BagIt exceeds its entry limit.');
        const path = bagItPath(`${prefix}${name}${handle.kind === 'directory' ? '/' : ''}`);
        files.push({ path, file: handle.kind === 'directory' ? new Blob() : await (handle as FileSystemFileHandle).getFile() });
        if (handle.kind === 'directory') await visit(handle as FileSystemDirectoryHandle, path);
      }
    };
    await visit(root, '');
    assertBagItSelection(files.map(item => ({ path: item.path, byteLength: item.file.size })));
    return files;
  }
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
export async function writeBrowserInvestigationFolder(parent: FileSystemDirectoryHandle, prepared: BrowserInvestigationFolder, signal?: AbortSignal, format: 'evidence' | 'bagit' = 'evidence') {
  if (format === 'bagit') assertBagItSelection(prepared.files.map(item => ({ path: item.path, byteLength: item.file.size })));
  else assertInvestigationFolderSelection(prepared.files);
  const files = prepared.files.map(item => ({ path: item.path, file: item.file }));
  const payloadDirectory = format === 'bagit' ? 'data' : 'artifacts';
  const completionFile = format === 'bagit' ? 'tagmanifest-sha512.txt' : INVESTIGATION_PACKAGE_MANIFEST_PATH;
  if (!files.some(item => item.path === completionFile) || files.some(item => item.path !== `${payloadDirectory}/` && !/^[a-z0-9.-]+$/u.test(item.path) && !new RegExp(`^${payloadDirectory}/artifact-[1-9][0-9]{0,2}$`, 'u').test(item.path))) throw new TypeError('The generated evidence folder layout is invalid.');
  const name = `whoisleuth-evidence-${crypto.randomUUID()}`;
  signal?.throwIfAborted();
  await requireMissing(() => parent.getDirectoryHandle(name));
  signal?.throwIfAborted();
  const root = await parent.getDirectoryHandle(name, { create: true });
  try {
    for await (const _ of root.entries()) throw new Error('The new output folder is not empty.');
    const artifacts = await root.getDirectoryHandle(payloadDirectory, { create: true });
    // Write the completion manifest last. Cancellation may leave an incomplete
    // child folder, never an overwritten source or an implied complete backup.
    const ordered = files.filter(item => !item.path.endsWith('/')).sort((left, right) => Number(left.path === completionFile) - Number(right.path === completionFile));
    for (const item of ordered) {
      signal?.throwIfAborted();
      const directory = item.path.startsWith(`${payloadDirectory}/`) ? artifacts : root;
      const fileName = item.path.split('/').at(-1)!;
      await requireMissing(() => directory.getFileHandle(fileName));
      const handle = await directory.getFileHandle(fileName, { create: true });
      const stream = await handle.createWritable();
      try { signal?.throwIfAborted(); await stream.write(item.file); signal?.throwIfAborted(); await stream.close(); }
      catch (cause) { await stream.abort().catch(() => {}); throw cause; }
    }
    return { name, files: await readBrowserInvestigationFolder(root, signal, format) };
  } catch {
    throw new Error(`The new folder ${name} could not be completed or confirmed. It may contain private partial output; inspect or remove it before another export. No existing folder was selected for replacement.`);
  }
}

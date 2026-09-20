import { lstat, opendir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { assertBagItSelection, bagItPath, bagItEntryMaximum, MAX_BAGIT_ENTRIES } from '../packages/interchange/bagit.mts';
import { selectedEvidenceDirectory, evidenceDirectoryIdentity } from './investigation-folder.mts';

/** Bounded recursive enumeration; no symbolic links, special files or writes. */
export async function readBagItFolder(value: string, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
  const selected = selectedEvidenceDirectory(value);
  const identity = await evidenceDirectoryIdentity(selected), root = await realpath(selected);
  const directories = new Map([['', identity]]);
  const entries: Array<{ path: string; byteLength: number }> = [];
  const visit = async (relative: string): Promise<void> => {
    signal?.throwIfAborted();
    const path = join(root, relative);
    if (await realpath(path) !== path) throw new TypeError('BagIt directories must not contain symbolic links.');
    for await (const item of await opendir(path)) {
      signal?.throwIfAborted();
      if (entries.length >= MAX_BAGIT_ENTRIES) throw new TypeError('BagIt exceeds its entry limit.');
      const name = `${relative ? `${relative}/` : ''}${item.name}`;
      bagItPath(item.isDirectory() ? `${name}/` : name);
      const stat = await lstat(join(root, name));
      if (item.isDirectory() && stat.isDirectory() && !stat.isSymbolicLink()) {
        directories.set(name, await evidenceDirectoryIdentity(join(root, name)));
        entries.push({ path: `${name}/`, byteLength: 0 });
        await visit(name);
      } else if (item.isFile() && stat.isFile() && !stat.isSymbolicLink()) {
        if (stat.size > bagItEntryMaximum(name)) throw new TypeError('BagIt entry exceeds its byte limit.');
        entries.push({ path: name, byteLength: stat.size });
      } else throw new TypeError('BagIt entries must be ordinary files and directories, not symbolic links or special files.');
    }
  };
  await visit('');
  assertBagItSelection(entries);
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    signal?.throwIfAborted();
    files.set(entry.path, entry.path.endsWith('/') ? new Uint8Array() : await readBoundedRegularFileWithin(root, entry.path, {
      maximumBytes: bagItEntryMaximum(entry.path), minimumBytes: 0, expectedBytes: entry.byteLength,
      label: 'BagIt file', ...(signal ? { signal } : {}),
    }));
  }
  for (const [path, before] of directories) {
    signal?.throwIfAborted();
    const currentPath = path ? join(root, path) : selected;
    const after = await evidenceDirectoryIdentity(currentPath);
    if (await realpath(currentPath) !== join(root, path) || before.device !== after.device || before.inode !== after.inode
      || before.modified !== after.modified || before.changed !== after.changed) throw new TypeError('BagIt folder changed while it was read.');
  }
  return files;
}

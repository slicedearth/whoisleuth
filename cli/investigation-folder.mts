import { lstat, mkdir, opendir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { writePrivateFile } from './output-file.mts';
import {
  INVESTIGATION_PACKAGE_MANIFEST_PATH, MAX_INVESTIGATION_PACKAGE_ENTRIES,
  investigationPackagePath, prepareInvestigationPackageEntries,
} from '../packages/investigation/investigation-package.mts';
import {
  MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES, MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES,
  MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES, type InvestigationManifestInput,
} from '../packages/investigation/investigation-manifest.mts';

export function selectedEvidenceDirectory(value: string): string {
  if (typeof value !== 'string' || !value || value === '-' || value.length > 4096 || /[\x00-\x1f\x7f]/u.test(value)) throw new TypeError('Select one bounded local folder path.');
  return resolve(value);
}

export async function evidenceDirectoryIdentity(path: string) {
  const value = await lstat(path);
  if (!value.isDirectory() || value.isSymbolicLink()) throw new TypeError('Evidence folders must be ordinary directories, not symbolic links.');
  return { device: value.dev, inode: value.ino, modified: value.mtimeMs, changed: value.ctimeMs };
}

/** Enumerate only the two declared levels; never walk an arbitrary source tree. */
export async function readInvestigationFolder(value: string, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
  signal?.throwIfAborted();
  const selected = selectedEvidenceDirectory(value);
  const before = await evidenceDirectoryIdentity(selected), root = await realpath(selected);
  const paths: string[] = [];
  let nestedIdentity: Awaited<ReturnType<typeof evidenceDirectoryIdentity>> | null = null;
  const directory = await opendir(root);
  for await (const entry of directory) {
    signal?.throwIfAborted();
    if (entry.name === 'artifacts' && entry.isDirectory()) {
      const nested = join(root, 'artifacts');
      nestedIdentity = await evidenceDirectoryIdentity(nested);
      for await (const file of await opendir(nested)) {
        signal?.throwIfAborted();
        if (!file.isFile()) throw new TypeError('Evidence folder entries must be regular files.');
        if (paths.length >= MAX_INVESTIGATION_PACKAGE_ENTRIES) throw new TypeError('Evidence folder has too many entries.');
        paths.push(investigationPackagePath(`artifacts/${file.name}`));
      }
    } else if (entry.name === INVESTIGATION_PACKAGE_MANIFEST_PATH && entry.isFile()) {
      if (paths.length >= MAX_INVESTIGATION_PACKAGE_ENTRIES) throw new TypeError('Evidence folder has too many entries.');
      paths.push(entry.name);
    } else throw new TypeError('Evidence folders contain only manifest.json and the declared artifacts directory.');
  }
  if (!nestedIdentity || !paths.includes(INVESTIGATION_PACKAGE_MANIFEST_PATH) || paths.length < 2) throw new TypeError('Evidence folder is incomplete.');
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const name of paths.sort()) {
    signal?.throwIfAborted();
    const manifest = name === INVESTIGATION_PACKAGE_MANIFEST_PATH;
    const maximumBytes = manifest ? MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES : Math.min(MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES - total);
    const bytes = await readBoundedRegularFileWithin(root, name, { maximumBytes, minimumBytes: 1, label: 'Evidence folder entry', ...(signal ? { signal } : {}) });
    if (!manifest) total += bytes.byteLength;
    files.set(name, bytes);
  }
  const unchanged = (left: typeof before, right: typeof before) => left.device === right.device && left.inode === right.inode && left.modified === right.modified && left.changed === right.changed;
  if (await realpath(selected) !== root || !unchanged(before, await evidenceDirectoryIdentity(selected))
    || !unchanged(nestedIdentity, await evidenceDirectoryIdentity(join(root, 'artifacts')))) throw new TypeError('Evidence folder changed while it was read.');
  signal?.throwIfAborted();
  return files;
}

/** Never replace an existing folder. The manifest is published only after files. */
export async function writeInvestigationFolder(value: string, input: InvestigationManifestInput, generatedAt: string, version: string, signal?: AbortSignal) {
  const prepared = await prepareInvestigationPackageEntries(input, generatedAt, version);
  await writePreparedEvidenceFolder(value, prepared.files, 'artifacts', INVESTIGATION_PACKAGE_MANIFEST_PATH, signal);
  return prepared.manifest;
}

/** Only first-party, generated layouts may use this fresh-directory writer. */
export async function writePreparedEvidenceFolder(value: string, files: ReadonlyMap<string, Uint8Array>, payloadDirectory: 'artifacts' | 'data', completionFile: string, signal?: AbortSignal): Promise<void> {
  const target = selectedEvidenceDirectory(value);
  if (!files.has(completionFile) || !/^[a-z0-9.-]+$/u.test(completionFile)
    || [...files.keys()].some(path => path !== `${payloadDirectory}/` && !/^[a-z0-9.-]+$/u.test(path) && !new RegExp(`^${payloadDirectory}/artifact-[1-9][0-9]{0,2}$`, 'u').test(path))) throw new TypeError('The generated evidence folder layout is invalid.');
  signal?.throwIfAborted();
  try { await mkdir(target, { mode: 0o700 }); }
  catch { throw new TypeError('The output folder must not already exist, and its parent must be writable. Existing files were not replaced.'); }
  try {
    const root = await realpath(target), identity = await evidenceDirectoryIdentity(target);
    await mkdir(join(root, payloadDirectory), { mode: 0o700 });
    const artifactsIdentity = await evidenceDirectoryIdentity(join(root, payloadDirectory));
    const checkLocation = async () => {
      signal?.throwIfAborted();
      const current = await evidenceDirectoryIdentity(target), nested = await evidenceDirectoryIdentity(join(root, payloadDirectory));
      if (await realpath(target) !== root || current.device !== identity.device || current.inode !== identity.inode
        || nested.device !== artifactsIdentity.device || nested.inode !== artifactsIdentity.inode
        || await realpath(join(root, payloadDirectory)) !== join(root, payloadDirectory)) throw new TypeError('Evidence output folder changed.');
    };
    for (const [name, content] of files) {
      if (name === completionFile || name.endsWith('/')) continue;
      await checkLocation();
      await writePrivateFile(join(root, name), content, { beforePublish: checkLocation });
    }
    await checkLocation();
    await writePrivateFile(join(root, completionFile), files.get(completionFile)!, { beforePublish: checkLocation });
    await checkLocation();
  } catch {
    // Retain only this newly created partial output for deliberate inspection;
    // recursive cleanup could remove unrelated files added by another process.
    throw new TypeError('The new evidence folder could not be completed or confirmed. It may contain private partial output; inspect or remove it before choosing a new destination. Existing folders were not replaced.');
  }
}

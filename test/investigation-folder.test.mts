import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readInvestigationFolder, writeInvestigationFolder } from '../cli/investigation-folder.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { runCli } from '../cli/runner.mts';
import { verifyOfflineInvestigationFolder, verifyOfflineInvestigationPackage } from '../cli/investigation-package-review.mts';
import {
  buildInvestigationPackage, encodeInvestigationPackageEntries, inspectInvestigationPackageEntries,
  prepareInvestigationPackageEntries, MAX_INVESTIGATION_PACKAGE_ENTRIES,
} from '../packages/investigation/investigation-package.mts';

const NOW = '2026-09-12T00:00:00.000Z';
const VERSION = '2.4.0';
const input = { workflow: 'Selected evidence', configurationDigestSha256: null, artifacts: [
  { content: new Uint8Array([0, 255, 128, 1]), mediaType: 'image/png' as const, source: { identity: 'Selected source', observedAt: null } },
] };

test('folders and ZIPs share exact byte identity and independent source interpretation', async () => {
  const prepared = await prepareInvestigationPackageEntries(input, NOW, VERSION);
  const bytes = (await buildInvestigationPackage(input, NOW, VERSION)).bytes;
  assert.deepEqual(encodeInvestigationPackageEntries(new Map([...prepared.files].reverse())), bytes);
  const folder = await verifyOfflineInvestigationFolder(prepared.files), zip = await verifyOfflineInvestigationPackage(bytes);
  assert.deepEqual(folder.package, zip.package);
  assert.deepEqual(folder.summary, zip.summary);
  assert.equal(folder.package!.entries[0]!.state, 'opaque');
  assert.equal(folder.package!.timestampAssurance, 'not_checked');
  assert.match(folder.limitations[0]!, /canonical stored-ZIP/);
  assert.match(folder.limitations[0]!, /not filesystem metadata/);
});

test('entry inspection captures bytes and listing before its first asynchronous operation', async () => {
  const selected = (await prepareInvestigationPackageEntries(input, NOW, VERSION)).files;
  const pending = inspectInvestigationPackageEntries(selected);
  selected.get('artifacts/artifact-1')!.fill(9); selected.clear();
  const result = await pending;
  assert.equal(result.identityVerified, true);
  assert.deepEqual(result.contents.get('artifact-1'), input.artifacts[0]!.content);
});

test('folder entry admission rejects unexpected paths, types, counts and missing files', async () => {
  const prepared = await prepareInvestigationPackageEntries(input, NOW, VERSION);
  for (const name of ['../artifact-1', '/manifest.json', 'artifacts/../manifest.json', 'artifacts/artifact-129', 'artifacts/artifact-01', 'extra']) {
    await assert.rejects(inspectInvestigationPackageEntries(new Map([...prepared.files, [name, new Uint8Array([1])]])), /path|identity/);
  }
  await assert.rejects(inspectInvestigationPackageEntries(new Map()), /count/);
  await assert.rejects(inspectInvestigationPackageEntries(new Map(Array.from({ length: MAX_INVESTIGATION_PACKAGE_ENTRIES + 1 }, (_, i) => [`file-${i}`, new Uint8Array([1])]))), /count/);
  const missing = new Map(prepared.files); missing.delete('manifest.json'); missing.set('artifacts/artifact-2', new Uint8Array([1]));
  await assert.rejects(inspectInvestigationPackageEntries(missing), /missing its manifest/);
  const extra = new Map(prepared.files); extra.set('artifacts/artifact-2', new Uint8Array([1]));
  await assert.rejects(inspectInvestigationPackageEntries(extra), /unlisted/);
  const empty = new Map(prepared.files); empty.set('artifacts/artifact-1', new Uint8Array());
  await assert.rejects(inspectInvestigationPackageEntries(empty), /byte limit/);
});

test('mismatched folder bytes remain rejected and are never returned as admitted content', async () => {
  const prepared = await prepareInvestigationPackageEntries(input, NOW, VERSION);
  prepared.files.get('artifacts/artifact-1')![0] = 7;
  const result = await inspectInvestigationPackageEntries(prepared.files);
  assert.equal(result.identityVerified, false); assert.equal(result.entries[0]!.state, 'rejected');
  assert.equal(result.contents.size, 0);
  const report = await verifyOfflineInvestigationFolder(prepared.files);
  assert.equal(report.state, 'partial'); assert.equal(report.package!.entries[0]!.identity, 'failed');
});

test('new folder output uses private files and preserves existing destinations unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-evidence-folder-'));
  try {
    const target = join(root, 'selected');
    const manifest = await writeInvestigationFolder(target, input, NOW, VERSION);
    assert.equal((await stat(target)).mode & 0o777, 0o700);
    assert.equal((await stat(join(target, 'artifacts'))).mode & 0o777, 0o700);
    assert.equal((await stat(join(target, 'artifacts/artifact-1'))).mode & 0o777, 0o600);
    assert.equal((await stat(join(target, 'manifest.json'))).mode & 0o777, 0o600);
    const files = await readInvestigationFolder(target);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))), manifest);
    assert.deepEqual([...files.get('artifacts/artifact-1')!], [...input.artifacts[0]!.content]);
    await assert.rejects(writeInvestigationFolder(target, input, NOW, VERSION), /must not already exist/);
    assert.deepEqual(await readInvestigationFolder(target), files);
    assert.deepEqual((await readdir(target)).sort(), ['artifacts', 'manifest.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('folder reading refuses links, unexpected directory trees and unrelated files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-evidence-folder-'));
  try {
    const target = join(root, 'selected'); await writeInvestigationFolder(target, input, NOW, VERSION);
    const linked = join(root, 'linked'); await symlink(target, linked);
    await assert.rejects(readInvestigationFolder(linked), /symbolic links/);
    await writeFile(join(target, 'unlisted.txt'), 'not evidence');
    await assert.rejects(readInvestigationFolder(target), /only manifest/); await rm(join(target, 'unlisted.txt'));
    await mkdir(join(target, 'artifacts/nested'));
    await assert.rejects(readInvestigationFolder(target), /regular files/); await rm(join(target, 'artifacts/nested'), { recursive: true });
    const saved = await readFile(join(target, 'artifacts/artifact-1'));
    await writeFile(join(root, 'outside'), saved); await rm(join(target, 'artifacts/artifact-1'));
    await symlink(join(root, 'outside'), join(target, 'artifacts/artifact-1'));
    await assert.rejects(readInvestigationFolder(target), /regular files/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancelled or invalid folder preparation cannot create an output directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-evidence-folder-'));
  try {
    const signal = AbortSignal.abort();
    await assert.rejects(writeInvestigationFolder(join(root, 'cancelled'), input, NOW, VERSION, signal), { name: 'AbortError' });
    await assert.rejects(writeInvestigationFolder(join(root, 'invalid'), { ...input, artifacts: [] }, NOW, VERSION), /requires between/);
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(readInvestigationFolder(root, signal), { name: 'AbortError' });
    await assert.rejects(writeInvestigationFolder('-', input, NOW, VERSION), /folder path/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('folder options cannot silently ignore a positional input or combine conflicting output modes', () => {
  assert.throws(() => parseCliArguments(['verify-artifact', 'ignored.json', '--folder', 'selected']), /own input/);
  for (const options of [['--package'], ['--passphrase-file', 'passphrase.txt'], ['--manifest', 'm.json', '--manifest-entry', 'artifact-1']]) {
    assert.throws(() => parseCliArguments(['verify-artifact', '--folder', 'selected', ...options]), /cannot|combined|requires a positional source/);
  }
  for (const options of [['--package', '--output', 'p.zip'], ['--output', 'p.json'], ['--force']]) {
    assert.throws(() => parseCliArguments(['manifest', 'input.json', '--workflow', 'selected', '--folder', 'selected', ...options]), /cannot|combined|requires/);
  }
  const selected = parseCliArguments(['verify-artifact', '--folder', 'selected', '--json']);
  assert.equal(selected.action, 'verify-artifact');
  if (selected.action === 'verify-artifact') { assert.equal(selected.folder, 'selected'); assert.equal(selected.source, null); }
});

test('CLI folder creation and verification stay offline and redact paths and selected values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-evidence-folder-'));
  let stdout = '', stderr = '', requests = 0, stdin = 0;
  const dependencies = { now: () => NOW, stdout: { write(value: string | Uint8Array) { stdout += String(value); } },
    stderr: { write(value: string | Uint8Array) { stderr += String(value); } },
    readStdin: () => { stdin++; throw new Error('Unexpected stdin'); },
    runUnifiedLookup: async () => { requests++; throw new Error('Unexpected collection'); } };
  try {
    const source = join(root, 'sensitive-name.png'), target = join(root, 'private-project');
    await writeFile(source, input.artifacts[0]!.content);
    assert.equal(await runCli(['manifest', source, '--workflow', 'Selected evidence', '--folder', target, '--json'], dependencies), 0);
    assert.equal(JSON.parse(stdout).schema, 'whoisleuth.investigation-manifest');
    assert.doesNotMatch(stdout, /sensitive-name|private-project/);
    stdout = '';
    assert.equal(await runCli(['verify-artifact', '--folder', target, '--strict-exit', '--json'], dependencies), 0);
    assert.equal(JSON.parse(stdout).state, 'verified'); assert.equal(JSON.parse(stdout).package.entries[0].state, 'opaque');
    assert.doesNotMatch(stdout, /sensitive-name|private-project/); assert.equal(stderr, '');
    await writeFile(join(target, 'artifacts/artifact-1'), new Uint8Array([0, 255, 128, 2]));
    stdout = '';
    assert.equal(await runCli(['verify-artifact', '--folder', target, '--strict-exit', '--json'], dependencies), 4);
    assert.equal(JSON.parse(stdout).checks.contentIntegrity, 'failed');
    stdout = ''; stderr = '';
    assert.equal(await runCli(['verify-artifact', '--folder', join(root, 'missing-private-project'), '--json'], dependencies), 2);
    assert.equal(stdout, ''); assert.match(stderr, /selected folder is unavailable/);
    assert.doesNotMatch(stderr, /missing-private-project|whoisleuth-evidence-folder|\/private\/|\/Users\//);
    assert.equal(requests, 0); assert.equal(stdin, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

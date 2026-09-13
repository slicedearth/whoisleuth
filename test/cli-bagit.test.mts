import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli } from '../cli/runner.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { readBagItFolder } from '../cli/bagit-folder.mts';
import { verifyOfflineBagIt } from '../cli/bagit-review.mts';
import { isCompleteOfflineArtifactVerification, hasVerifiedWholeArtifactIntegrity, hasVerifiedApplicableIntegrity } from '../cli/artifact-verify.mts';
import { encodeBagItEntries, inspectBagItEntries, prepareBagItEntries, readBagItZip, MAX_BAGIT_FILE_BYTES } from '../packages/interchange/bagit.mts';

const NOW = '2026-09-13T00:00:00.000Z';
const content = new TextEncoder().encode('private original bytes\n');
const text = (value: string) => new TextEncoder().encode(value);

test('CLI BagIt ZIP and folder output share payloads, private atomic writes and offline redacted verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-bagit-'));
  let stdout = '', stderr = '', requests = 0;
  const dependencies = { now: () => NOW, stdout: { write(value: string | Uint8Array) { stdout += String(value); } },
    stderr: { write(value: string | Uint8Array) { stderr += String(value); } }, runUnifiedLookup: async () => { requests++; throw new Error('No requests allowed'); } };
  try {
    const source = join(root, 'private-selected.bin'), zip = join(root, 'bag.zip'), folder = join(root, 'bag');
    await writeFile(source, content);
    const create = ['manifest', source, '--workflow', 'review', '--bagit', '--package', '--output', zip];
    assert.equal(await runCli(create, dependencies), 0); assert.equal(stdout, ''); assert.equal(stderr, '');
    const archive = await readFile(zip);
    assert.equal((await stat(zip)).mode & 0o777, 0o600);
    assert.deepEqual(readBagItZip(archive).get('data/artifact-1'), content);
    assert.equal(await runCli(create, dependencies), 2); assert.deepEqual(await readFile(zip), archive);
    stdout = ''; stderr = '';
    assert.equal(await runCli(['verify-artifact', zip, '--bagit', '--package', '--json', '--strict-exit'], dependencies), 0);
    const report = JSON.parse(stdout);
    assert.equal(report.artifact.kind, 'bagit'); assert.equal(report.artifact.schema, null); assert.equal(report.artifact.version, '1.0');
    assert.equal(report.state, 'integrity_valid'); assert.equal(report.bagit.state, 'valid');
    assert.equal(isCompleteOfflineArtifactVerification(report), true);
    assert.equal(hasVerifiedApplicableIntegrity(report), true); assert.equal(hasVerifiedWholeArtifactIntegrity(report), false);
    assert.doesNotMatch(stdout, /private-selected|private original|bag\.zip/u); assert.equal(stderr, '');
    stdout = ''; stderr = '';
    assert.equal(await runCli(['manifest', source, '--workflow', 'review', '--bagit', '--folder', folder, '--quiet'], dependencies), 0);
    assert.equal((await stat(folder)).mode & 0o777, 0o700);
    assert.equal((await stat(join(folder, 'data/artifact-1'))).mode & 0o777, 0o600);
    const saved = await readBagItFolder(folder);
    assert.deepEqual(new Uint8Array(saved.get('data/artifact-1')!), content);
    assert.equal((await inspectBagItEntries(saved)).review.state, 'valid');
    assert.equal(await runCli(['verify-artifact', '--folder', folder, '--bagit', '--strict-exit'], dependencies), 0);
    assert.match(stdout, /BagIt: valid/u); assert.doesNotMatch(stdout, /private-selected|private original/u);
    assert.equal(await runCli(['manifest', source, '--workflow', 'review', '--bagit', '--folder', folder], dependencies), 2);
    assert.deepEqual(await readFile(join(folder, 'data/artifact-1')), Buffer.from(content));
    assert.equal(requests, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('strict BagIt verification returns 4 for missing, mismatched and unsupported checks, without printing names or fetch locations', async () => {
  const original = await prepareBagItEntries(new Map([['data/private-name.bin', content]]));
  for (const mode of ['missing', 'mismatch', 'unsupported'] as const) {
    const files = new Map(original);
    if (mode === 'missing') { files.delete('data/private-name.bin'); files.set('fetch.txt', text('https://files.example.test/private?key=value - data/private-name.bin\n')); }
    if (mode === 'mismatch') { const altered = content.slice(); altered[0] = 0; files.set('data/private-name.bin', altered); }
    if (mode === 'unsupported') { files.set('manifest-md5.txt', text(`${'0'.repeat(32)} data/private-name.bin\n`)); files.delete('tagmanifest-sha512.txt'); }
    let output = '', error = '';
    const code = await runCli(['verify-artifact', 'selected.zip', '--bagit', '--package', '--json', '--strict-exit'], {
      readBinaryArtifactInput: () => encodeBagItEntries(files), stdout: { write(value) { output += value; } }, stderr: { write(value) { error += value; } },
    });
    assert.equal(code, 4); assert.equal(error, '');
    const report = JSON.parse(output);
    assert.equal(report.bagit.state, mode === 'missing' ? 'incomplete' : mode === 'mismatch' ? 'invalid' : 'unsupported');
    if (mode === 'mismatch') { assert.equal(report.checks.structure, 'verified'); assert.equal(report.checks.contentIntegrity, 'failed'); }
    assert.equal(isCompleteOfflineArtifactVerification(report), false);
    assert.doesNotMatch(output, /private-name|files\.example|key=value|private original/u);
  }
});

test('BagIt grammar refuses implicit output, encryption and competing manifest policies', () => {
  for (const args of [
    ['manifest', 'file.bin', '--workflow', 'review', '--bagit'],
    ['manifest', 'file.bin', '--workflow', 'review', '--bagit', '--package', '--output', 'bag.zip', '--passphrase-file', 'passphrase.txt'],
    ['verify-artifact', 'bag.zip', '--bagit'],
    ['verify-artifact', 'bag.zip', '--bagit', '--package', '--passphrase-file', 'passphrase.txt'],
    ['verify-artifact', 'bag.zip', '--bagit', '--package', '--manifest', 'manifest.json', '--manifest-entry', 'artifact-1'],
    ['verify-artifact', 'bag.zip', '--bagit', '--folder', 'bag'],
  ]) assert.throws(() => parseCliArguments(args));
  const parsed = parseCliArguments(['verify-artifact', '--bagit', '--folder', 'bag']);
  assert.equal(parsed.action, 'verify-artifact');
  if (parsed.action === 'verify-artifact') assert.equal(parsed.bagit, true);
});

test('the redacted byte inventory belongs to the captured input, not a later caller mutation', async () => {
  const files = new Map(await prepareBagItEntries(new Map([['data/file', content]])));
  const expected = [...files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
  const pending = verifyOfflineBagIt(files); files.clear();
  const report = await pending;
  assert.equal(report.summary.inputBytes, expected); assert.equal(report.bagit?.state, 'valid');
});

test('BagIt folder review admits nested and empty payloads and refuses links, changed sizes and cancelled reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-bagit-input-'));
  try {
    const folder = join(root, 'selected'); await mkdir(join(folder, 'data/nested'), { recursive: true });
    const prepared = await prepareBagItEntries(new Map([['data/nested/empty', new Uint8Array()], ['data/nested/source.bin', content]]));
    for (const [path, bytes] of prepared) if (!path.endsWith('/')) await writeFile(join(folder, path), bytes);
    assert.equal((await verifyOfflineBagIt(await readBagItFolder(folder))).bagit?.state, 'valid');
    const abort = new AbortController(); abort.abort(); await assert.rejects(readBagItFolder(folder, abort.signal), { name: 'AbortError' });
    await symlink(folder, join(root, 'linked')); await assert.rejects(readBagItFolder(join(root, 'linked')), /symbolic/u);
    await symlink(join(folder, 'data/nested/source.bin'), join(folder, 'data/link')); await assert.rejects(readBagItFolder(folder), /symbolic/u);
    await rm(join(folder, 'data/link'));
    await symlink(join(folder, 'data/nested'), join(folder, 'data/directory-link')); await assert.rejects(readBagItFolder(folder), /symbolic/u);
    await rm(join(folder, 'data/directory-link'));
    const oversized = join(folder, 'data/oversized');
    const { open } = await import('node:fs/promises'); const handle = await open(oversized, 'w');
    try { await handle.truncate(MAX_BAGIT_FILE_BYTES + 1); } finally { await handle.close(); }
    await assert.rejects(readBagItFolder(folder), /byte limit/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { runCli } from '../cli/runner.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { verifyOfflineInvestigationPackage } from '../cli/investigation-package-review.mts';
import { hasVerifiedApplicableIntegrity, hasVerifiedWholeArtifactIntegrity, isCompleteOfflineArtifactVerification } from '../cli/artifact-verify.mts';
import { buildInvestigationPackage, inspectInvestigationPackage } from '../packages/investigation/investigation-package.mts';
import { MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES } from '../packages/investigation/investigation-manifest.mts';
import { decryptInvestigationPackage } from '../packages/investigation/investigation-package-crypto.mts';

const NOW = '2026-09-11T00:00:00.000Z';
const source = JSON.stringify({ schema: 'whoisleuth.cli.lookup', version: 1, generatedAt: NOW,
  mode: 'fast', query: 'retained.example', type: 'domain', registrableDomain: 'retained.example',
  diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } }, rdap: { parsed: { domain: 'RETAINED.EXAMPLE' } } });
const makePackage = (artifacts: Parameters<typeof buildInvestigationPackage>[0]['artifacts']) => buildInvestigationPackage({
  workflow: 'evidence review', configurationDigestSha256: null, artifacts,
}, NOW, '2.3.1');

test('CLI package creation uses atomic private binary output and verification reveals no evidence values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-package-command-'));
  const input = join(directory, 'selected.json');
  const attachment = join(directory, 'selected.png');
  const destination = join(directory, 'review.zip');
  let stdout = '';
  let stderr = '';
  let requests = 0;
  const dependencies = { stdout: { write(value: string | Uint8Array) { stdout += String(value); } },
    stderr: { write(value: string | Uint8Array) { stderr += String(value); } }, now: () => NOW,
    runUnifiedLookup: async () => { requests += 1; throw new Error('Unexpected collection'); } };
  try {
    const opaque = new Uint8Array([0, 128, 255, 13, 10, 1]);
    await writeFile(input, source);
    await writeFile(attachment, opaque);
    const args = ['manifest', input, attachment, '--workflow', 'review', '--package', '--output', destination];
    assert.equal(await runCli(args, dependencies), 0);
    assert.equal(stdout, '');
    assert.equal(stderr, '');
    const bytes = await readFile(destination);
    assert.equal((await stat(destination)).mode & 0o777, 0o600);
    const contents = unzipSync(bytes);
    assert.equal(new TextDecoder().decode(contents['artifacts/artifact-1']), source);
    assert.deepEqual(contents['artifacts/artifact-2'], opaque);
    assert.equal(await runCli(args, dependencies), 2);
    assert.deepEqual(await readFile(destination), bytes);
    stderr = '';
    assert.equal(await runCli(['verify-artifact', destination, '--package', '--json', '--strict-exit'], dependencies), 0);
    const report = JSON.parse(stdout);
    assert.equal(report.version, 4);
    assert.equal(report.artifact.kind, 'investigation_package');
    assert.deepEqual(report.package.entries.map((entry: { state: string }) => entry.state), ['admitted', 'opaque']);
    assert.equal(report.checks.contentIntegrityScope, 'manifest_and_files');
    assert.equal(report.package.storageEffect, 'none');
    assert.doesNotMatch(stdout, /retained\.example|RETAINED\.EXAMPLE|selected\.(?:json|png)|review\.zip/u);
    assert.equal(stderr, '');
    assert.equal(requests, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('package verification separates checksum failure, unsupported JSON, opaque content and complete-source assurance', async () => {
  const built = await makePackage([{ content: source }, { content: new Uint8Array([1, 2, 3]) }]);
  const good = await verifyOfflineInvestigationPackage(built.bytes);
  assert.equal(isCompleteOfflineArtifactVerification(good), true);
  assert.equal(hasVerifiedApplicableIntegrity(good), true);
  assert.equal(hasVerifiedWholeArtifactIntegrity(good), false);
  assert.equal(good.package!.signatureTrust, 'not_checked');
  assert.equal(good.package!.timestampAssurance, 'not_checked');
  assert.equal(good.package!.factualAccuracy, 'not_established');
  const files = unzipSync(built.bytes);
  files['artifacts/artifact-2'] = new Uint8Array([1, 2, 4]);
  const bad = zipSync(files);
  const mismatch = await verifyOfflineInvestigationPackage(bad);
  assert.equal(mismatch.state, 'partial');
  assert.equal(mismatch.checks.contentIntegrity, 'failed');
  assert.equal(mismatch.package!.entries[1]!.state, 'rejected');
  let output = '';
  const code = await runCli(['verify-artifact', 'review.zip', '--package', '--json', '--strict-exit'], {
    readBinaryArtifactInput: () => bad, stdout: { write(value) { output += value; } }, stderr: { write() {} },
  });
  assert.equal(code, 4);
  assert.equal(JSON.parse(output).package.entries[1].identity, 'failed');
  const unsupported = await verifyOfflineInvestigationPackage((await makePackage([{ content: '{"schema":"whoisleuth.unsupported-fixture","version":999}' }])).bytes);
  assert.equal(unsupported.package!.entries[0]!.state, 'unsupported');
  assert.equal(unsupported.checks.contentIntegrity, 'verified');
  assert.equal(isCompleteOfflineArtifactVerification(unsupported), false);
});

test('package argument rules prevent terminal binary output, conflicting trust inputs and incomplete file lists', () => {
  assert.throws(() => parseCliArguments(['manifest', 'file.json', '--workflow', 'review', '--package']), /--output/u);
  assert.throws(() => parseCliArguments(['manifest', 'file.json', '--workflow', 'review', '--package', '--output', 'out.zip', '--json']), /exclusive|combined/u);
  assert.equal(parseCliArguments(['verify-artifact', 'pack.wlep', '--package', '--passphrase-file', 'passphrase.txt']).action, 'verify-artifact');
  assert.throws(() => parseCliArguments(['manifest', 'file.json', '--workflow', 'review', '--passphrase-file', 'passphrase.txt']), /--package/u);
  assert.throws(() => parseCliArguments(['verify-artifact', '--folder', 'files', '--passphrase-file', 'passphrase.txt']), /combined|--passphrase-file/u);
  assert.throws(() => parseCliArguments(['verify-artifact', '--package']), /source|file/u);
  const lastEntry = parseCliArguments(['verify-artifact', 'source.json', '--manifest', 'manifest.json', '--manifest-entry', 'artifact-128']);
  assert.equal(lastEntry.action, 'verify-artifact');
  const many = parseCliArguments(['manifest', ...Array.from({ length: 128 }, (_, index) => `file-${index}.bin`), '--workflow', 'review', '--package', '--output', 'out.zip']);
  assert.equal(many.action, 'manifest');
  if (many.action === 'manifest') assert.equal(many.sources.length, 128);
  assert.throws(() => parseCliArguments(['manifest', ...Array.from({ length: 129 }, (_, index) => `file-${index}.bin`), '--workflow', 'review', '--package', '--output', 'out.zip']), /128/u);
});

test('invalid or cancelled package preparation leaves the destination absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-package-cancel-'));
  const destination = join(directory, 'review.zip');
  try {
    const controller = new AbortController();
    const code = await runCli(['manifest', 'input.json', '--workflow', 'review', '--package', '--output', destination], {
      readBinaryArtifactInput: () => { controller.abort(); return new TextEncoder().encode(source); },
      signal: controller.signal, stdout: { write() {} }, stderr: { write() {} },
    });
    assert.equal(code, 130);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
    const invalid = await runCli(['manifest', 'input.json', '--workflow', 'review', '--package', '--output', destination], {
      readBinaryArtifactInput: () => new Uint8Array([255]), stdout: { write() {} }, stderr: { write() {} },
    });
    assert.equal(invalid, 2);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
    assert.equal((await inspectInvestigationPackage((await makePackage([{ content: source }])).bytes)).identityVerified, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('binary input failures remain usage errors and never fall back to stdin or collection', async () => {
  let stdout = '';
  let stderr = '';
  let reads = 0;
  const dependencies = {
    readBinaryArtifactInput() { reads++; throw new Error('Selected file cannot be read'); },
    stdout: { write(value: string) { stdout += value; } }, stderr: { write(value: string) { stderr += value; } },
  };
  assert.equal(await runCli(['verify-artifact', 'missing.zip', '--package'], dependencies), 2);
  assert.match(stderr, /Could not read package input/u);
  assert.equal(stdout, '');
  assert.equal(reads, 1);
  stderr = '';
  assert.equal(await runCli(['verify-artifact', '--package', '--', '-'], dependencies), 2);
  assert.match(stderr, /stdin|selected ZIP/u);
  assert.equal(reads, 1);
});

test('the installed-style encrypted file path admits one full payload plus wrapper overhead without clipping bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-package-capacity-'));
  const input = join(directory, 'source.bin');
  const destination = join(directory, 'package.zip');
  const passphraseFile = join(directory, 'passphrase.txt');
  const passphrase = 'capacity fixture passphrase';
  let output = '';
  const errors: string[] = [];
  const dependencies = { stdout: { write(value: string) { output += value; } }, stderr: { write(value: string) { errors.push(value); } }, now: () => NOW };
  try {
    const bytes = new Uint8Array(MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES);
    bytes[0] = 255; bytes[bytes.length - 1] = 127;
    await writeFile(input, bytes);
    await writeFile(passphraseFile, passphrase, { mode: 0o600 });
    assert.equal(await runCli(['manifest', input, '--workflow', 'capacity', '--package', '--output', destination, '--passphrase-file', passphraseFile], dependencies), 0, errors.join(''));
    assert.ok((await stat(destination)).size > MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES);
    assert.equal(await runCli(['verify-artifact', destination, '--package', '--passphrase-file', passphraseFile, '--json', '--strict-exit'], dependencies), 0, errors.join(''));
    const report = JSON.parse(output);
    assert.equal(report.package.entries[0].byteLength, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES);
    assert.equal(report.package.entries[0].state, 'opaque');
    assert.equal(report.checks.contentIntegrity, 'verified');
    assert.equal(report.checks.authenticatedEncryption, 'verified');
    const unlocked = await decryptInvestigationPackage(await readFile(destination), passphrase);
    assert.deepEqual(unlocked.review.contents.get('artifact-1'), bytes);
    assert.deepEqual(errors, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('encrypted CLI packages keep passphrases out of arguments and reports and refuse downgrade or replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-encrypted-package-'));
  let output = '', error = '', requests = 0;
  const deps = { stdout: { write(value: string) { output += value; } }, stderr: { write(value: string) { error += value; } },
    now: () => NOW, runUnifiedLookup: async () => { requests++; throw new Error('Unexpected network'); } };
  const input = join(directory, 'source.json'), destination = join(directory, 'evidence.wlep'), secret = join(directory, 'passphrase.txt');
  try {
    await writeFile(input, source); await writeFile(secret, 'only a local fixture passphrase\n', { mode: 0o600 });
    const build = ['manifest', input, '--workflow', 'review', '--package', '--output', destination, '--passphrase-file', secret];
    assert.equal(await runCli(build, deps), 0, error); assert.equal(output, ''); assert.equal(error, '');
    const bytes = await readFile(destination); assert.equal((await stat(destination)).mode & 0o777, 0o600);
    assert.equal(await runCli(build, deps), 2); assert.deepEqual(await readFile(destination), bytes);
    for (const mode of ['missing', 'wrong', 'damaged'] as const) {
      output = ''; error = '';
      if (mode === 'wrong') await writeFile(secret, 'a different fixture passphrase');
      if (mode === 'damaged') { await writeFile(secret, 'only a local fixture passphrase'); const damaged = Buffer.from(bytes); damaged[damaged.length - 1]! ^= 1; await writeFile(destination, damaged); }
      assert.equal(await runCli(['verify-artifact', destination, '--package', '--json', ...(mode === 'missing' ? [] : ['--passphrase-file', secret])], deps), 3);
      assert.equal(output, ''); assert.doesNotMatch(error, /retained\.example|fixture passphrase/u);
    }
    await writeFile(destination, bytes); output = ''; error = '';
    assert.equal(await runCli(['verify-artifact', destination, '--package', '--passphrase-file', secret, '--json', '--strict-exit'], deps), 0, error);
    const report = JSON.parse(output); assert.equal(report.checks.authenticatedEncryption, 'verified');
    assert.equal(report.summary.inputBytes, bytes.length); assert.equal(report.summary.ciphertextBytes, bytes.length - 58);
    assert.equal(report.package.factualAccuracy, 'not_established'); assert.equal(report.package.signatureTrust, 'not_checked');
    assert.doesNotMatch(output, /retained\.example|fixture passphrase|source\.json/u);
    await assert.rejects(verifyOfflineInvestigationPackage((await makePackage([{ content: source }])).bytes, 'only a local fixture passphrase'), /unencrypted/u);
    assert.equal(requests, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

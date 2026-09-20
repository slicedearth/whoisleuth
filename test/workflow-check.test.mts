import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import {
  ACTIONLINT_VERSION,
  MAX_ACTIONLINT_ARCHIVE_BYTES,
  actionlintRelease,
  installActionlintArchive,
  readActionlintDownload,
  runActionlint,
  verifyActionlintArchive,
  type ActionlintRelease,
} from '../tools/workflow-check.mts';

function fixtureRelease(bytes: Buffer, zip = false): ActionlintRelease {
  return { url: 'https://example.test/release', sha256: createHash('sha256').update(bytes).digest('hex'), executable: zip ? 'actionlint.exe' : 'actionlint', zip };
}

test('selects pinned native releases without a host toolchain or floating version', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const architecture of ['x64', 'arm64']) {
      const release = actionlintRelease(platform, architecture);
      assert.match(release.sha256, /^[a-f0-9]{64}$/u);
      assert.ok(release.url.startsWith(`https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/`));
      assert.equal(release.zip, platform === 'win32');
    }
  }
  assert.deepEqual(actionlintRelease(), actionlintRelease(process.platform, process.arch));
  assert.throws(() => actionlintRelease('other', 'other'), /No pinned/u);
  assert.throws(() => actionlintRelease('__proto__', ''), /No pinned/u);
});

test('rejects empty, altered, oversized and wrong-platform archives before extraction', () => {
  const bytes = Buffer.from('fixture archive');
  const release = fixtureRelease(bytes);
  assert.doesNotThrow(() => verifyActionlintArchive(bytes, release));
  for (const invalid of [Buffer.alloc(0), Buffer.from('altered archive'), Buffer.alloc(MAX_ACTIONLINT_ARCHIVE_BYTES + 1)]) {
    assert.throws(() => verifyActionlintArchive(invalid, release), /pinned digest/u);
  }
  assert.throws(() => verifyActionlintArchive(bytes, actionlintRelease('linux', 'x64')), /pinned digest/u);
});

test('bounds streamed downloads before concatenation and cancels failed reads', async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from('one')); controller.enqueue(Buffer.from('two')); controller.close(); } });
  assert.equal((await readActionlintDownload(new Response(body))).toString(), 'onetwo');
  await assert.rejects(readActionlintDownload(new Response(null, { status: 204 })), /failed/u);
  await assert.rejects(readActionlintDownload(new Response('failure', { status: 503 })), /503/u);
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_ACTIONLINT_ARCHIVE_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readActionlintDownload(new Response(oversized)), /byte bound/u);
  assert.equal(cancelled, true);
  const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('fixture transport failure')); } });
  await assert.rejects(readActionlintDownload(new Response(broken)), /fixture transport failure/u);
});

test('extracts only the verified executable and refuses replacement or corrupt input', (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workflow-check-test-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('fixture archive');
  const binary = Buffer.from([0, 255, 128, 1]);
  let calls = 0;
  const run = (file: string, args: readonly string[]) => {
    calls++;
    assert.equal(file, 'tar');
    assert.deepEqual(args, ['-xOf', path.join(directory, 'release.tar.gz'), 'actionlint']);
    return { status: 0, stdout: binary, stderr: Buffer.alloc(0) };
  };
  assert.throws(() => installActionlintArchive(Buffer.from('invalid'), fixtureRelease(bytes), directory, run), /pinned digest/u);
  assert.equal(calls, 0);
  assert.deepEqual(readdirSync(directory), []);
  const filename = installActionlintArchive(bytes, fixtureRelease(bytes), directory, run);
  assert.deepEqual(readFileSync(filename), binary);
  assert.equal(calls, 1);
  assert.throws(() => installActionlintArchive(bytes, fixtureRelease(bytes), directory, run), /EEXIST/u);
});

test('rejects failed, empty and oversized executable extraction', (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'workflow-check-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from('fixture archive');
  for (const result of [
    { status: 1, stdout: Buffer.from('failed'), stderr: '' },
    { status: null, stdout: Buffer.from('failed'), stderr: '', error: new Error('fixture spawn failure') },
    { status: 0, stdout: 'not binary', stderr: '' },
    { status: 0, stdout: Buffer.alloc(0), stderr: '' },
    { status: 0, stdout: Buffer.alloc(32 * 1024 * 1024 + 1), stderr: '' },
  ]) {
    const directory = mkdtempSync(path.join(root, 'case-'));
    assert.throws(() => installActionlintArchive(bytes, fixtureRelease(bytes), directory, () => result), /extract|missing|bound/u);
    assert.deepEqual(readdirSync(directory), ['release.tar.gz']);
  }
});

test('Windows extraction ignores other paths and requires the expected executable', (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'workflow-check-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from(zipSync({ 'actionlint.exe': Buffer.from('fixture executable'), '../ignored.txt': Buffer.from('ignored') }));
  const output = installActionlintArchive(bytes, fixtureRelease(bytes, true), root);
  assert.equal(readFileSync(output, 'utf8'), 'fixture executable');
  assert.deepEqual(readdirSync(root).sort(), ['actionlint.exe', 'release.zip']);
  const absent = Buffer.from(zipSync({ 'other.exe': Buffer.from('fixture executable') }));
  assert.throws(() => installActionlintArchive(absent, fixtureRelease(absent, true), mkdtempSync(path.join(root, 'missing-'))), /missing/u);
});

test('validates every workflow with fixed optional-tool scope and propagates diagnostics', () => {
  let calls = 0;
  runActionlint('/fixture/actionlint', '/fixture/repository', (file, args, options) => {
    calls++;
    assert.equal(file, '/fixture/actionlint');
    assert.deepEqual(args, ['-color', '-shellcheck=', '-pyflakes=']);
    assert.equal(options.cwd, '/fixture/repository');
    assert.equal(options.timeout, 60_000);
    return { status: 0, stdout: '', stderr: '' };
  });
  assert.equal(calls, 1);
  assert.throws(() => runActionlint('/fixture/actionlint', undefined, () => ({ status: 1, stdout: 'unknown context', stderr: 'fixture.yml:3' })), /unknown contextfixture.yml:3/u);
  assert.throws(() => runActionlint('/fixture/actionlint', undefined, () => ({ status: null, stdout: '', stderr: '', error: new Error('fixture spawn failure') })), /Could not run/u);
});

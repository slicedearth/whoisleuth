import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { readCliHeaderInput, readCliTextInput } from '../cli/input.mts';
import { environmentWithoutV8Coverage } from './helpers/subprocess-environment.mts';

const execFileAsync = promisify(execFile);

test('reads bounded regular files and explicit symbolic-link targets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-input-'));
  try {
    const file = path.join(directory, 'input.json');
    const link = path.join(directory, 'input-link.json');
    await writeFile(file, '{"ok":true}', 'utf8');
    await symlink(file, link);
    assert.equal(await readCliTextInput(file, null, { maximumBytes: 11, label: 'Fixture' }), '{"ok":true}');
    assert.equal(await readCliTextInput(link, null, { maximumBytes: 11, label: 'Fixture' }), '{"ok":true}');
    await assert.rejects(readCliTextInput(file, null, { maximumBytes: 10, label: 'Fixture' }), /10-byte maximum/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a named pipe promptly at the shared CLI path boundary', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-input-'));
  try {
    const fifo = path.join(directory, 'input.pipe');
    await execFileAsync('mkfifo', [fifo]);
    await assert.rejects(readCliTextInput(fifo, null, { maximumBytes: 64, label: 'Fixture' }), /regular file/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps stdin bounded and responds to cancellation while the stream remains open', async () => {
  assert.equal(await readCliTextInput(null, Readable.from(['one', 'two']), { maximumBytes: 6, label: 'Fixture' }), 'onetwo');
  await assert.rejects(
    readCliTextInput(null, Readable.from(['one', 'two']), { maximumBytes: 5, label: 'Fixture' }),
    /limited to 5 bytes/iu,
  );
  const controller = new AbortController();
  const input = new PassThrough();
  const pending = readCliTextInput(null, input, { maximumBytes: 64, label: 'Fixture', signal: controller.signal });
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(pending, /Cancelled|aborted/iu);
});

test('rejects a pre-aborted input without opening a path', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(
    readCliTextInput('/path/that/must/not/open', null, { maximumBytes: 64, label: 'Fixture', signal: controller.signal }),
    /Cancelled|aborted/iu,
  );
});

test('reads only a bounded message-header prefix from files and stdin', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-header-input-'));
  try {
    const file = path.join(directory, 'message.eml');
    const header = 'From: analyst@example.test\r\nSubject: private';
    const body = `\r\n\r\n${'body-data'.repeat(32_768)}`;
    await writeFile(file, Buffer.concat([Buffer.from(header + body, 'utf8'), Buffer.from([0xff])]));
    assert.equal(await readCliHeaderInput(file, null, { maximumBytes: 128, label: 'Header fixture' }), header);
    assert.equal(await readCliHeaderInput(null, Readable.from([
      'From: analyst@example.test\r\nSubject: private\r\n',
      `\r\n${'unretained-body'.repeat(1_000)}`,
    ]), { maximumBytes: 128, label: 'Header fixture' }), header);
    await assert.rejects(
      readCliHeaderInput(null, Readable.from(['X-Test: ', 'a'.repeat(129)]), { maximumBytes: 128, label: 'Header fixture' }),
      /limited to 128 bytes before the message body/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cancels header input while standard input remains open', async () => {
  const controller = new AbortController();
  const input = new PassThrough();
  const pending = readCliHeaderInput(null, input, {
    maximumBytes: 128,
    label: 'Header fixture',
    signal: controller.signal,
  });
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(pending, /Cancelled|aborted/iu);
});

test('the repository CLI rejects a named-pipe operand without blocking', {
  skip: process.platform === 'win32',
  timeout: 30_000,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-process-input-'));
  try {
    const fifo = path.join(directory, 'input.pipe');
    await execFileAsync('mkfifo', [fifo]);
    const entryPoint = path.join(import.meta.dirname, '..', 'bin/whoisleuth.mts');
    await assert.rejects(
      execFileAsync(process.execPath, [entryPoint, 'export', fifo], { timeout: 10_000 }),
      (cause: unknown) => {
        const error = cause as { code?: unknown; stderr?: unknown };
        return error.code === 2 && /regular file/iu.test(String(error.stderr));
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the repository CLI honours one interrupt while standard input remains open', async () => {
  const entryPoint = path.join(import.meta.dirname, '..', 'bin/whoisleuth.mts');
  const readinessModule = `data:text/javascript,${encodeURIComponent(`
    process.on('newListener', (event) => {
      if (event === 'SIGINT') queueMicrotask(() => process.send?.({ type: 'ready' }));
    });
  `)}`;
  const child = spawn(process.execPath, ['--import', readinessModule, entryPoint, 'lookup'], {
    env: environmentWithoutV8Coverage(),
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  assert.ok(child.stdout);
  assert.ok(child.stderr);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CLI did not become ready for SIGINT.')), 15_000);
      child.once('message', (message) => {
        if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'ready') return;
        clearTimeout(timeout);
        resolve();
      });
    });
    const settled = new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CLI did not settle after SIGINT.')), 3_000);
      child.once('exit', (code) => { clearTimeout(timeout); resolve(code); });
    });
    child.kill('SIGINT');
    assert.equal(await settled, 130);
    assert.equal(stdout, '');
    assert.equal(stderr, 'Cancelled by analyst.\n');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { readCliTextInput } from '../cli/input.mts';

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

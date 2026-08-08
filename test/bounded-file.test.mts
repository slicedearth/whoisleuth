import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { open, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import {
  readBoundedRegularFile,
  readBoundedRegularTextFile,
} from '../lib/bounded-file.mts';

const execFileAsync = promisify(execFile);

test('reads a regular file through one bounded descriptor', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-bounded-file-'));
  try {
    const filename = path.join(directory, 'input.json');
    await writeFile(filename, '{"ok":true}', 'utf8');
    assert.equal(await readBoundedRegularTextFile(filename, {
      maximumBytes: 64,
      minimumBytes: 1,
      expectedBytes: 11,
      label: 'Fixture',
    }), '{"ok":true}');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects oversized, empty, mismatched, and non-regular inputs with explicit symlink opt-in', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-bounded-file-'));
  try {
    const empty = path.join(directory, 'empty');
    const oversized = path.join(directory, 'oversized');
    const link = path.join(directory, 'link');
    const childDirectory = path.join(directory, 'directory');
    await writeFile(empty, '');
    await writeFile(oversized, '12345');
    await symlink(oversized, link);
    await mkdir(childDirectory);
    await assert.rejects(readBoundedRegularFile(empty, { maximumBytes: 8, minimumBytes: 1 }), /smaller than its 1-byte minimum/iu);
    await assert.rejects(readBoundedRegularFile(oversized, { maximumBytes: 4 }), /exceeds its 4-byte maximum/iu);
    await assert.rejects(readBoundedRegularFile(oversized, { maximumBytes: 8, expectedBytes: 4 }), /declared size/iu);
    await assert.rejects(readBoundedRegularFile(link, { maximumBytes: 8 }), /ELOOP|symbolic link/iu);
    assert.equal((await readBoundedRegularFile(link, {
      maximumBytes: 8,
      allowSymbolicLink: true,
    })).toString('utf8'), '12345');
    await assert.rejects(readBoundedRegularFile(childDirectory, { maximumBytes: 8 }), /regular file/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects deterministic descriptor changes between the two metadata checks', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-bounded-file-'));
  try {
    const filename = path.join(directory, 'input.json');
    await writeFile(filename, 'stable', 'utf8');
    const realHandle = await open(filename, 'r');
    const initial = await realHandle.stat();
    let statCalls = 0;
    const handle = {
      stat: async () => {
        statCalls += 1;
        return statCalls === 1 ? initial : { ...initial, size: initial.size + 1 };
      },
      read: realHandle.read.bind(realHandle),
      close: realHandle.close.bind(realHandle),
    } as unknown as Awaited<ReturnType<typeof open>>;
    await assert.rejects(readBoundedRegularFile(filename, { maximumBytes: 64 }, {
      openFile: async () => handle,
    }), /changed while it was being read/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a named pipe promptly instead of waiting for a writer', {
  skip: process.platform === 'win32',
  timeout: 30_000,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-bounded-file-'));
  try {
    const fifo = path.join(directory, 'input.pipe');
    await execFileAsync('mkfifo', [fifo]);
    const moduleUrl = new URL('../lib/bounded-file.mts', import.meta.url).href;
    const { stdout } = await execFileAsync(process.execPath, [
      '-e',
      `import(${JSON.stringify(moduleUrl)}).then(async ({readBoundedRegularFile}) => { try { await readBoundedRegularFile(process.argv[1], {maximumBytes:8}); process.exitCode=2; } catch { process.stdout.write('rejected'); } });`,
      fifo,
    ], { timeout: 10_000 });
    assert.equal(stdout, 'rejected');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

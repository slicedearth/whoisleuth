import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { open, mkdtemp, mkdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import {
  decodeBoundedUtf8,
  readBoundedRegularFile,
  readBoundedRegularFileWithin,
  readBoundedRegularTextFile,
} from '../lib/bounded-file.mts';

const execFileAsync = promisify(execFile);

test('rejects malformed UTF-8 without rejecting valid replacement characters or stripping a BOM', () => {
  for (const bytes of [
    Buffer.from([0x80]),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0xe2, 0x82]),
    Buffer.from([0xed, 0xa0, 0x80]),
  ]) {
    assert.throws(() => decodeBoundedUtf8(bytes, 'Fixture'), /valid UTF-8/iu);
  }

  const replacement = Buffer.from('\ufffd', 'utf8');
  assert.equal(decodeBoundedUtf8(replacement), '\ufffd');
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"ok":true}')]);
  const decoded = decodeBoundedUtf8(withBom);
  assert.deepEqual(Buffer.from(decoded, 'utf8'), withBom);
});

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

test('confines reads to a canonical root and rejects final or intermediate symbolic links', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-bounded-root-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'whoisleuth-bounded-outside-'));
  try {
    await mkdir(path.join(directory, 'nested'));
    await writeFile(path.join(directory, 'nested', 'input.txt'), 'inside', 'utf8');
    await writeFile(path.join(outside, 'outside.txt'), 'outside', 'utf8');
    assert.equal((await readBoundedRegularFileWithin(directory, 'nested/input.txt', {
      maximumBytes: 64,
      label: 'Confined fixture',
    })).toString('utf8'), 'inside');

    await symlink(path.join(outside, 'outside.txt'), path.join(directory, 'final-link'));
    await assert.rejects(
      readBoundedRegularFileWithin(directory, 'final-link', { maximumBytes: 64, label: 'Final link' }),
      /symbolic link/iu,
    );
    await symlink(outside, path.join(directory, 'directory-link'));
    await assert.rejects(
      readBoundedRegularFileWithin(directory, 'directory-link/outside.txt', { maximumBytes: 64, label: 'Directory link' }),
      /symbolic link/iu,
    );
    await assert.rejects(
      readBoundedRegularFileWithin(directory, '../outside.txt', { maximumBytes: 64, label: 'Traversal' }),
      /safe relative file path|escapes/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('binds the opened descriptor to the admitted target across an intermediate swap and restore', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-bounded-swap-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'whoisleuth-bounded-swap-outside-'));
  try {
    const nested = path.join(directory, 'nested');
    const parked = path.join(directory, 'nested-admitted');
    await mkdir(nested);
    await writeFile(path.join(nested, 'input.txt'), 'inside', 'utf8');
    await writeFile(path.join(outside, 'input.txt'), 'outside', 'utf8');
    await assert.rejects(
      readBoundedRegularFileWithin(directory, 'nested/input.txt', {
        maximumBytes: 64,
        label: 'Swap fixture',
      }, {
        openFile: async (filename, flags, mode) => {
          await rename(nested, parked);
          await symlink(outside, nested);
          try {
            return await open(filename, flags, mode);
          } finally {
            await unlink(nested);
            await rename(parked, nested);
          }
        },
      }),
      /changed while it was being read/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
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

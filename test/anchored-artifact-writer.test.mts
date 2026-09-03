import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  startAnchoredArtifactWriter,
  type AnchoredArtifactIdentity,
  type AnchoredArtifactWriter,
} from '../packages/web-capture/anchored-artifact-writer.mts';
import {
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
} from '../packages/contracts/web-capture.mts';

type WriterFixture = {
  parent: string;
  directory: string;
  identity: AnchoredArtifactIdentity;
  uid: number | null;
};

async function fixture(mode = 0o755): Promise<WriterFixture> {
  const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-anchored-writer-'));
  const directory = path.join(parent, 'capture');
  await mkdir(directory, { mode });
  await chmod(directory, mode);
  const current = await lstat(directory);
  return {
    parent,
    directory,
    identity: { dev: current.dev, ino: current.ino },
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
  };
}

async function removeFixture(value: WriterFixture): Promise<void> {
  await rm(value.parent, { recursive: true, force: true });
}

function childProcesses(): ChildProcess[] {
  const runtime = process as NodeJS.Process & { _getActiveHandles?: () => unknown[] };
  return (runtime._getActiveHandles?.() ?? []).filter((handle): handle is ChildProcess => {
    const candidate = handle as Partial<ChildProcess>;
    return typeof candidate.pid === 'number'
      && typeof candidate.kill === 'function'
      && typeof candidate.send === 'function';
  });
}

async function startWithChild(value: WriterFixture): Promise<{
  writer: AnchoredArtifactWriter;
  child: ChildProcess;
}> {
  const before = new Set(childProcesses().map((child) => child.pid));
  const writer = await startAnchoredArtifactWriter(value.directory, value.identity, value.uid);
  const child = childProcesses().find((candidate) => (
    candidate.pid !== undefined && !before.has(candidate.pid)
  ));
  assert.ok(child?.pid, 'The anchored writer child process was not discoverable.');
  return { writer, child };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

test('secures the anchored directory and exclusively writes each bounded public artefact', async () => {
  const value = await fixture(0o777);
  let writer: AnchoredArtifactWriter | null = null;
  try {
    writer = await startAnchoredArtifactWriter(value.directory, value.identity, value.uid);
    assert.equal((await stat(value.directory)).mode & 0o077, 0);

    const created = new Map<string, AnchoredArtifactIdentity>();
    for (const [fileName, content] of [
      ['screenshot.png', Buffer.from('fixture-png')],
      ['dom-digest.json', '{"schema":"fixture"}'],
      ['manifest.json', '{"manifest":"fixture"}'],
    ] as const) {
      await writer.write(fileName, content, signal(), (identity) => created.set(fileName, identity));
      const status = await lstat(path.join(value.directory, fileName));
      assert.deepEqual(created.get(fileName), { dev: status.dev, ino: status.ino });
      if (process.platform !== 'win32') assert.equal(status.mode & 0o077, 0);
    }
    await writer.finish(false);
    writer = null;
    assert.equal(await readFile(path.join(value.directory, 'manifest.json'), 'utf8'), '{"manifest":"fixture"}');
  } finally {
    writer?.terminate();
    await removeFixture(value);
  }
});

test('rejects malformed, oversized, pre-existing, and duplicate writes without weakening bounds', async () => {
  const value = await fixture();
  let writer: AnchoredArtifactWriter | null = null;
  try {
    await writeFile(path.join(value.directory, 'manifest.json'), 'pre-existing', { mode: 0o600 });
    writer = await startAnchoredArtifactWriter(value.directory, value.identity, value.uid);
    for (const [fileName, content] of [
      ['other.json', '{}'],
      ['../manifest.json', '{}'],
      ['dom-digest.json', Buffer.alloc(0)],
      ['dom-digest.json', Buffer.alloc(MAX_WEB_CAPTURE_DOM_DIGEST_BYTES + 1)],
    ] as const) {
      await assert.rejects(
        writer.write(fileName, content, signal(), () => {}),
        /malformed|byte bound/u,
      );
    }
    await assert.rejects(
      writer.write('manifest.json', '{}', signal(), () => {}),
      /EEXIST|exist/u,
    );
    await writer.write('dom-digest.json', '{}', signal(), () => {});
    await assert.rejects(
      writer.write('dom-digest.json', '{"duplicate":true}', signal(), () => {}),
      /already written/u,
    );
    await writer.finish(true);
    writer = null;
    assert.equal(await readFile(path.join(value.directory, 'manifest.json'), 'utf8'), 'pre-existing');
    await assert.rejects(stat(path.join(value.directory, 'dom-digest.json')), /ENOENT/u);
  } finally {
    writer?.terminate();
    await removeFixture(value);
  }
});

test('cleans only owned identities and preserves replaced or already absent paths', async () => {
  const value = await fixture();
  let writer: AnchoredArtifactWriter | null = null;
  try {
    writer = await startAnchoredArtifactWriter(value.directory, value.identity, value.uid);
    await writer.write('manifest.json', '{"owned":true}', signal(), () => {});
    await writer.write('dom-digest.json', '{"owned":true}', signal(), () => {});
    await writer.write('screenshot.png', Buffer.from('owned'), signal(), () => {});
    await rename(
      path.join(value.directory, 'manifest.json'),
      path.join(value.directory, 'original-manifest.json'),
    );
    await writeFile(path.join(value.directory, 'manifest.json'), '{"replacement":true}', { mode: 0o600 });
    await unlink(path.join(value.directory, 'screenshot.png'));

    await writer.finish(true);
    writer = null;
    assert.equal(await readFile(path.join(value.directory, 'manifest.json'), 'utf8'), '{"replacement":true}');
    assert.equal(await readFile(path.join(value.directory, 'original-manifest.json'), 'utf8'), '{"owned":true}');
    await assert.rejects(stat(path.join(value.directory, 'dom-digest.json')), /ENOENT/u);
  } finally {
    writer?.terminate();
    await removeFixture(value);
  }
});

test('rejects pre-cancelled and in-flight writes and cleans any owned partial file', async () => {
  const value = await fixture();
  let writer: AnchoredArtifactWriter | null = null;
  try {
    writer = await startAnchoredArtifactWriter(value.directory, value.identity, value.uid);
    const preCancelled = new AbortController();
    preCancelled.abort(new Error('fixture cancelled before write'));
    await assert.rejects(
      writer.write('manifest.json', '{}', preCancelled.signal, () => {}),
      /fixture cancelled before write/u,
    );

    const controller = new AbortController();
    const pending = writer.write(
      'screenshot.png',
      Buffer.alloc(MAX_WEB_CAPTURE_SCREENSHOT_BYTES, 1),
      controller.signal,
      () => {},
    );
    controller.abort(new Error('fixture cancelled during write'));
    await assert.rejects(pending, /cancel|abort/u);
    await writer.finish(true);
    writer = null;
    await assert.rejects(stat(path.join(value.directory, 'screenshot.png')), /ENOENT/u);
  } finally {
    writer?.terminate();
    await removeFixture(value);
  }
});

test('rejects changed directory identity, ownership, malformed identity, and child startup failure', async () => {
  const value = await fixture();
  try {
    await assert.rejects(
      startAnchoredArtifactWriter(
        value.directory,
        { dev: value.identity.dev, ino: value.identity.ino + 1 },
        value.uid,
      ),
      /identity changed/u,
    );
    if (value.uid !== null) {
      await assert.rejects(
        startAnchoredArtifactWriter(value.directory, value.identity, value.uid + 1),
        /not owned by the current user/u,
      );
    }
    await assert.rejects(
      startAnchoredArtifactWriter(
        value.directory,
        { dev: Number.NaN, ino: value.identity.ino },
        value.uid,
      ),
      /identity arguments are malformed/u,
    );
    await assert.rejects(
      startAnchoredArtifactWriter(
        path.join(value.parent, 'missing-directory'),
        value.identity,
        value.uid,
      ),
      /ENOENT|exited before completion/u,
    );
  } finally {
    await removeFixture(value);
  }
});

test('rejects IPC send failures, cancellation-send failures, and subsequent operations after child exit', async () => {
  const value = await fixture();
  try {
    const { writer, child } = await startWithChild(value);
    const mutableChild = child as ChildProcess & { send: ChildProcess['send'] };
    const originalSend = mutableChild.send;
    mutableChild.send = (() => { throw new Error('fixture IPC send failure'); }) as ChildProcess['send'];
    try {
      await assert.rejects(
        writer.write('manifest.json', '{}', signal(), () => {}),
        /fixture IPC send failure/u,
      );
    } finally {
      mutableChild.send = originalSend;
    }

    const cancellation = new AbortController();
    const pending = writer.write(
      'screenshot.png',
      Buffer.alloc(MAX_WEB_CAPTURE_SCREENSHOT_BYTES, 2),
      cancellation.signal,
      () => {},
    );
    mutableChild.send = (() => { throw new Error('fixture cancellation send failure'); }) as ChildProcess['send'];
    cancellation.abort(new Error('fixture cancellation requested'));
    await assert.rejects(pending, /exited before completion|channel closed|EPIPE/u);
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    mutableChild.send = originalSend;
    await assert.rejects(
      writer.write('manifest.json', '{}', signal(), () => {}),
      /channel closed|exited before completion|EPIPE/iu,
    );
  } finally {
    await removeFixture(value);
  }
});

test('enforces the unchanged operation deadline against an unresponsive writer child', {
  skip: process.platform === 'win32',
}, async () => {
  const value = await fixture();
  try {
    const { writer, child } = await startWithChild(value);
    const pid = child.pid;
    assert.ok(pid);
    process.kill(pid, 'SIGSTOP');
    try {
      await assert.rejects(
        writer.write('manifest.json', '{}', signal(), () => {}),
        /timed out/u,
      );
    } finally {
      try { process.kill(pid, 'SIGCONT'); } catch {}
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  } finally {
    await removeFixture(value);
  }
});

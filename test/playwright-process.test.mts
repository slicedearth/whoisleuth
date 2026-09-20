import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { runPlaywrightProcess } from '../tools/playwright-process.mts';
import { localPortIsFree } from '../tools/maintainer-tool-helpers.mts';
import { environmentWithoutV8Coverage } from './helpers/subprocess-environment.mts';

async function waitFor<T>(read: () => Promise<T | null>, label: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== null) return result;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

test('browser process preserves exit codes, spawn errors and pre-launch cancellation', async () => {
  for (const code of [0, 9]) {
    assert.equal(await runPlaywrightProcess(['-e', `process.exitCode = ${code}`], {
      cwd: process.cwd(), env: environmentWithoutV8Coverage(), signal: new AbortController().signal,
    }), code);
  }
  const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-browser-spawn-'));
  try {
    await assert.rejects(runPlaywrightProcess([], {
      cwd: path.join(root, 'absent'), env: environmentWithoutV8Coverage(), signal: new AbortController().signal,
    }), /ENOENT/u);
    const interruption = new AbortController();
    interruption.abort();
    assert.equal(await runPlaywrightProcess(['-e', 'process.exitCode = 99'], {
      cwd: root, env: environmentWithoutV8Coverage(), signal: interruption.signal,
    }), 130);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const mode of ['graceful', 'unresponsive'] as const) {
  test(`browser cancellation closes ${mode} descendants without touching another listener`, { timeout: 25_000 }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-browser-cancellation-'));
    const ready = path.join(root, 'ready.json');
    const preview = path.join(root, 'preview.mjs');
    const runner = path.join(root, 'runner.mjs');
    await writeFile(preview, `
      import { createServer } from 'node:net';
      const server = createServer();
      server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `);
    await writeFile(runner, `
      import { fork } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      const preview = fork(process.argv[2], [], {
        detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      process.on('SIGINT', () => {
        if (process.argv[4] === 'graceful') preview.kill('SIGTERM');
      });
      preview.once('exit', () => process.exit(0));
      preview.once('message', ({ port }) => writeFileSync(process.argv[3], JSON.stringify({
        runner: process.pid, preview: preview.pid, port,
      })));
    `);
    const unrelated = createServer();
    await new Promise<void>((resolve) => unrelated.listen(0, '127.0.0.1', resolve));
    const address = unrelated.address();
    assert.ok(address && typeof address !== 'string');
    const interruption = new AbortController();
    const completion = runPlaywrightProcess([runner, preview, ready, mode], {
      cwd: root, env: environmentWithoutV8Coverage(), signal: interruption.signal,
      shutdownTimeoutMs: 250,
    });
    try {
      const identities = await waitFor(async () => {
        try {
          return JSON.parse(await readFile(ready, 'utf8')) as { runner: number; preview: number; port: number };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      }, 'the owned preview listener');
      assert.equal(await localPortIsFree(identities.port), false);
      interruption.abort();
      interruption.abort(); // Repeated requests must not bypass orderly teardown.
      assert.equal(await completion, 130);
      assert.equal(await localPortIsFree(identities.port), true);
      await waitFor(async () => {
        const survivors = [identities.runner, identities.preview].filter((pid) => {
          try { process.kill(pid, 0); return true; }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
            throw error;
          }
        });
        return survivors.length ? null : true;
      }, 'all owned descendants to exit');
      assert.equal(await localPortIsFree(address.port), false);
    } finally {
      interruption.abort();
      await completion.catch(() => {});
      await new Promise<void>((resolve, reject) => unrelated.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
}

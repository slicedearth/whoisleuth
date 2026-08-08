import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, test } from 'node:test';

import { reviewLocalMmdb } from '../cli/local-mmdb-review.mts';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function namedPipe(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-file-boundary-'));
  directories.push(directory);
  const filename = path.join(directory, 'input.pipe');
  await execFileAsync('mkfifo', [filename]);
  return filename;
}

async function runTool(script: string, args: readonly string[]): Promise<{
  code: number | null;
  stderr: string;
  timedOut: boolean;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let timedOut = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 10_000);
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr, timedOut });
    });
  });
}

describe('maintainer tool file boundaries', () => {
  test('rejects non-regular technology inputs without blocking', { timeout: 30_000 }, async () => {
    const pipe = await namedPipe();
    const review = await runTool('tools/technology-example-review.mts', [
      pipe,
      '--id=official-example-20260808',
      '--expected=apache-http-server',
      '--licence-basis=official-demonstration-terms',
      '--source-reference=official:example/demonstration',
      '--source-revision=2026-08-08T00:00:00.000Z',
      '--source-licence=official-demonstration-terms',
      '--build-recipe=official-public-demonstration',
      '--observed-at=2026-08-08T00:00:00.000Z',
      '--reviewed-at=2026-08-08T00:00:00.000Z',
    ]);
    assert.equal(review.timedOut, false);
    assert.equal(review.code, 2);
    assert.match(review.stderr, /regular file/iu);

    const verify = await runTool('tools/technology-source-verify.mts', [pipe, '--json']);
    assert.equal(verify.timedOut, false);
    assert.equal(verify.code, 2);
    assert.match(verify.stderr, /regular file/iu);
  });

  test('rejects non-regular catalogue sources without blocking', { timeout: 30_000 }, async () => {
    const pipe = await namedPipe();
    const commands = [
      ['tools/cisa-kev-catalog.mts', ['--source', pipe, '--check']],
      ['tools/retire-browser-catalog.mts', ['--source', pipe, '--check']],
      ['tools/unicode-confusable-audit.mts', ['--source', pipe, '--json']],
    ] as const;
    for (const [script, args] of commands) {
      const result = await runTool(script, args);
      assert.equal(result.timedOut, false, `${script} blocked on a named pipe`);
      assert.equal(result.code, 2);
      assert.match(result.stderr, /missing|byte limit/iu);
    }
  });

  test('rejects a non-regular local MMDB without blocking', { timeout: 30_000 }, async () => {
    const pipe = await namedPipe();
    await assert.rejects(reviewLocalMmdb({
      address: '192.0.2.1',
      sourceLabel: 'Local fixture',
      databaseVersion: '1',
      license: 'Test fixture',
    }, pipe), /must be a file/iu);
  });
});

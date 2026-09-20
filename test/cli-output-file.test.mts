import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  cleanupPendingOutputFiles,
  createBufferedOutput,
  writePrivateFile,
  type OutputFileOperations,
} from '../cli/output-file.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

test('binary output retains owned bytes and rejects text without altering the text-output contract', async () => {
  const source = new Uint8Array([0, 255, 128, 1]);
  const buffer = createBufferedOutput({ binary: true });
  buffer.writeBinary(source);
  source.fill(4);
  assert.deepEqual(buffer.value(), new Uint8Array([0, 255, 128, 1]));
  assert.throws(() => buffer.stream.write('text'), /terminal text/u);
  const textBuffer = createBufferedOutput();
  assert.throws(() => textBuffer.writeBinary(source), /explicit package/u);
  textBuffer.stream.write('text');
  assert.equal(textBuffer.value(), 'text');
  let opened!: () => void;
  const pendingOpen = new Promise<void>(resolve => { opened = resolve; });
  let captured: string | Uint8Array | null = null;
  const original = new Uint8Array([1, 255]);
  const writing = writePrivateFile(join(process.cwd(), 'owned-fixture.bin'), original, {}, {
    randomUUID: () => '00000000-0000-4000-8000-000000000004',
    async open() { await pendingOpen; return { async writeFile(value) { captured = value; }, async sync() {}, async close() {} }; },
    async link() {}, async rename() {}, async unlink() {},
  });
  original.fill(9); opened(); await writing;
  assert.deepEqual(captured, new Uint8Array([1, 255]));
});

test('a published output remains successful when the first temporary-file cleanup fails', async () => {
  let linked = false;
  let unlinkCalls = 0;
  const operations: OutputFileOperations = {
    randomUUID: () => '00000000-0000-4000-8000-000000000000',
    async open() {
      return {
        async writeFile() {},
        async sync() {},
        async close() {},
      };
    },
    async link() { linked = true; },
    async rename() { throw new Error('rename is not used by this fixture'); },
    async unlink() {
      unlinkCalls += 1;
      if (unlinkCalls === 1) throw new Error('temporary cleanup unavailable');
    },
  };
  const target = join(process.cwd(), 'fixture-output.json');

  await assert.doesNotReject(async () => {
    assert.equal(await writePrivateFile(target, '{}\n', {}, operations), target);
  });
  assert.equal(linked, true);
  assert.equal(unlinkCalls, 2);
});

test('normal cleanup does not race an in-progress output write', async () => {
  let releaseWrite!: () => void;
  let announceWrite!: () => void;
  const writeStarted = new Promise<void>((resolve) => { announceWrite = resolve; });
  const writeReleased = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const operations: OutputFileOperations = {
    randomUUID: () => '00000000-0000-4000-8000-000000000002',
    async open() {
      return {
        async writeFile() {
          announceWrite();
          await writeReleased;
        },
        async sync() {},
        async close() {},
      };
    },
    async link() {},
    async rename() { throw new Error('rename is not used by this fixture'); },
    async unlink() {},
  };
  const target = join(process.cwd(), 'concurrent-fixture-output.json');
  const writing = writePrivateFile(target, '{}\n', {}, operations);
  await writeStarted;

  assert.deepEqual(await cleanupPendingOutputFiles(), {
    attempted: 0, removed: 0, retained: 0, retainedPublished: 0, retainedUnpublished: 0,
  });

  releaseWrite();
  assert.equal(await writing, target);
});

test('publication preconditions run after the temporary file is closed and failure removes only that temporary file', async () => {
  const calls: string[] = [];
  const operations: OutputFileOperations = {
    randomUUID: () => '00000000-0000-4000-8000-000000000003',
    async open() {
      calls.push('open');
      return {
        async writeFile() { calls.push('write'); },
        async sync() { calls.push('sync'); },
        async close() { calls.push('close'); },
      };
    },
    async link() { calls.push('link'); },
    async rename() { calls.push('rename'); },
    async unlink() { calls.push('unlink'); },
  };
  await assert.rejects(writePrivateFile(join(process.cwd(), 'fixture-state.json'), '{}', {
    force: true,
    async beforePublish() { calls.push('validate'); throw new Error('fixture state changed'); },
  }, operations), /fixture state changed/u);
  assert.deepEqual(calls, ['open', 'write', 'sync', 'close', 'validate', 'unlink']);
});

test('persistent temporary-file cleanup failure is reported and remains retryable', async () => {
  let cleanupAllowed = false;
  let unlinkCalls = 0;
  const operations: OutputFileOperations = {
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    async open() {
      return {
        async writeFile() {},
        async sync() {},
        async close() {},
      };
    },
    async link() {},
    async rename() { throw new Error('rename is not used by this fixture'); },
    async unlink() {
      unlinkCalls += 1;
      if (!cleanupAllowed) throw new Error('temporary cleanup unavailable');
    },
  };
  const target = join(process.cwd(), 'persistent-fixture-output.json');

  assert.equal(await writePrivateFile(target, '{}\n', {}, operations), target);
  assert.equal(unlinkCalls, 2);
  assert.deepEqual(await cleanupPendingOutputFiles(), {
    attempted: 1, removed: 0, retained: 1, retainedPublished: 1, retainedUnpublished: 0,
  });

  cleanupAllowed = true;
  assert.deepEqual(await cleanupPendingOutputFiles(), {
    attempted: 1, removed: 1, retained: 0, retainedPublished: 0, retainedUnpublished: 0,
  });
});

test('the CLI preserves success while disclosing retained temporary output', async () => {
  let stdout = '';
  let stderr = '';
  const code = await runCli(['commands', '--json'], {
    stdout: { write(chunk) { stdout += String(chunk); } },
    stderr: { write(chunk) { stderr += String(chunk); } },
    cleanupPendingOutputFiles: async () => ({
      attempted: 1, removed: 0, retained: 1, retainedPublished: 1, retainedUnpublished: 0,
    }),
  });

  assert.equal(code, EXIT_CODES.SUCCESS);
  assert.match(stdout, /whoisleuth\.cli\.command-catalogue/u);
  assert.match(stderr, /Published output is intact.*1 linked temporary output file remains/u);
});

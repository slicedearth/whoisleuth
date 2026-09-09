import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { link, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { prepareInvestigationCheckpoint } from '../cli/investigation-checkpoint.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { MAX_INVESTIGATION_RUN_BYTES } from '../packages/contracts/investigation-run.mts';

async function directory(context: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'whoisleuth-workflow-files-'));
  context.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('checkpoint ownership spans private atomic publication and cannot be reused after settlement', async (context) => {
  const root = await directory(context);
  const destination = join(root, 'state.json');
  const checkpoint = await prepareInvestigationCheckpoint({ destination, resumeSource: null, force: false });
  assert.deepEqual(JSON.parse(await readFile(join(root, '.state.json.workflow.lock'), 'utf8')), { pid: process.pid });
  assert.equal((await stat(join(root, '.state.json.workflow.lock'))).mode & 0o777, 0o600);
  await checkpoint.publish('{"fixture":true}\n');
  assert.equal(await readFile(destination, 'utf8'), '{"fixture":true}\n');
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
  assert.ok((await readdir(root)).includes('.state.json.workflow.lock'));
  await assert.rejects(checkpoint.publish('{}'), /settled/u);
  assert.equal(await checkpoint.release(), 0);
  assert.deepEqual(await readdir(root), ['state.json']);
  assert.equal(await checkpoint.release(), 0);
  await assert.rejects(checkpoint.publish('{}'), /settled/u);
});

test('a distinct CLI process cannot acquire an active workflow output, including canonical parent aliases', async (context) => {
  const root = await directory(context);
  const destination = join(root, 'state.json');
  const alias = join(root, 'alias');
  await symlink(root, alias, 'dir');
  const checkpoint = await prepareInvestigationCheckpoint({ destination, resumeSource: null, force: false });
  try {
    for (const target of [destination, join(alias, 'state.json')]) {
      const child = spawnSync(process.execPath, [
        fileURLToPath(new URL('../bin/whoisleuth.mts', import.meta.url)),
        'workflow-run', 'domain-triage', 'example.test', '--json', '--output', target,
      ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024 });
      assert.equal(child.error, undefined);
      assert.equal(child.signal, null);
      assert.equal(child.status, EXIT_CODES.USAGE, child.stderr);
      assert.equal(child.stdout, '');
      assert.match(child.stderr, /already locked/u);
    }
  } finally { assert.equal(await checkpoint.release(), 0); }
});

test('resume and output share one lease and publication retains the captured input', async (context) => {
  const root = await directory(context);
  const destination = join(root, 'state.json');
  await writeFile(destination, '{"fixture":"prior"}\n');
  const checkpoint = await prepareInvestigationCheckpoint({ destination, resumeSource: destination, force: true });
  assert.equal(checkpoint.resumeInput, '{"fixture":"prior"}\n');
  assert.deepEqual((await readdir(root)).sort(), ['.state.json.workflow.lock', 'state.json']);
  await checkpoint.publish('{"fixture":"next"}\n');
  assert.equal(await checkpoint.release(), 0);
  assert.equal(await readFile(destination, 'utf8'), '{"fixture":"next"}\n');
});

test('external replacement, edits, creation or deletion invalidate a captured state without overwriting it', async (context) => {
  const root = await directory(context);
  for (const kind of ['edit', 'replace', 'delete', 'create', 'source'] as const) {
    const targetRoot = join(root, kind);
    await mkdir(targetRoot);
    const destination = join(targetRoot, 'state.json');
    const source = join(targetRoot, 'resume.json');
    if (kind !== 'create') await writeFile(destination, '{}\n');
    if (kind === 'source') await writeFile(source, '{}\n');
    const checkpoint = await prepareInvestigationCheckpoint({
      destination, resumeSource: kind === 'source' ? source : null, force: true,
    });
    if (kind === 'replace') {
      await writeFile(join(targetRoot, 'replacement'), '{}\n');
      await rename(join(targetRoot, 'replacement'), destination);
    } else if (kind === 'delete') await unlink(destination);
    else await writeFile(kind === 'source' ? source : destination, '{"fixture":"external"}\n');
    await assert.rejects(checkpoint.publish('{"fixture":"must not replace"}'), /state changed/u, kind);
    assert.equal(await checkpoint.release(), 0);
    if (kind === 'delete') await assert.rejects(readFile(destination), { code: 'ENOENT' });
    else assert.equal(await readFile(destination, 'utf8'), kind === 'source' || kind === 'replace' ? '{}\n' : '{"fixture":"external"}\n');
    assert.ok((await readdir(targetRoot)).every((name) => !name.endsWith('.tmp') && !name.endsWith('.workflow.lock')));
  }
});

test('another owner’s replacement lease is neither trusted nor removed', async (context) => {
  const root = await directory(context);
  const checkpoint = await prepareInvestigationCheckpoint({ destination: join(root, 'state.json'), resumeSource: null, force: false });
  const lease = join(root, '.state.json.workflow.lock');
  await rename(lease, join(root, 'original-lock'));
  await writeFile(lease, '{"pid":1}\n');
  await assert.rejects(checkpoint.publish('{}'), /ownership changed/u);
  assert.equal(await checkpoint.release(), 1);
  assert.equal(await readFile(lease, 'utf8'), '{"pid":1}\n');
});

test('linked, nonregular, oversized and occupied state paths fail before retaining a lease', async (context) => {
  const root = await directory(context);
  const original = join(root, 'original.json');
  await writeFile(original, '{}');
  const symbolic = join(root, 'symbolic.json');
  await symlink(original, symbolic);
  await assert.rejects(prepareInvestigationCheckpoint({ destination: symbolic, resumeSource: null, force: true }), /regular files/u);
  const hard = join(root, 'hard.json');
  await link(original, hard);
  await assert.rejects(prepareInvestigationCheckpoint({ destination: hard, resumeSource: null, force: true }), /regular files/u);
  await unlink(hard);
  await assert.rejects(prepareInvestigationCheckpoint({ destination: root, resumeSource: null, force: true }), /regular files/u);
  await assert.rejects(prepareInvestigationCheckpoint({ destination: original, resumeSource: null, force: false }), /already exists/u);
  await assert.rejects(prepareInvestigationCheckpoint({ destination: join(root, '.reserved.workflow.lock'), resumeSource: null, force: true }), /reserved/u);
  const oversized = join(root, 'oversized.json');
  const handle = await open(oversized, 'w');
  try { await handle.truncate(MAX_INVESTIGATION_RUN_BYTES + 1); } finally { await handle.close(); }
  await assert.rejects(prepareInvestigationCheckpoint({ destination: oversized, resumeSource: null, force: true }), /maximum/u);
  assert.ok((await readdir(root)).every((name) => !name.endsWith('.workflow.lock')));
});

test('cancellation and excessive output leave the original state and release the lease deliberately', async (context) => {
  const root = await directory(context);
  const destination = join(root, 'state.json');
  await writeFile(destination, '{}\n');
  const controller = new AbortController();
  const checkpoint = await prepareInvestigationCheckpoint({ destination, resumeSource: null, force: true, signal: controller.signal });
  await assert.rejects(checkpoint.publish(' '.repeat(MAX_INVESTIGATION_RUN_BYTES + 1)), /limited/u);
  controller.abort();
  await assert.rejects(checkpoint.publish('{}'), { name: 'AbortError' });
  assert.equal(await checkpoint.release(), 0);
  assert.equal(await readFile(destination, 'utf8'), '{}\n');
  assert.deepEqual(await readdir(root), ['state.json']);
});

test('workflow execution refuses occupied output before collection and preserves externally changed output', async (context) => {
  const root = await directory(context);
  const destination = join(root, 'state.json');
  await writeFile(destination, '{}\n');
  let requests = 0;
  let stderr = '';
  const args = ['workflow-run', 'domain-triage', 'example.test', '--approve-network', '--json', '--output', destination];
  const dependencies = {
    stdout: { write() { throw new Error('File output must not reach stdout'); } },
    stderr: { write(value: string) { stderr += value; } },
    now: () => '2026-08-05T05:00:00.000Z',
    runUnifiedLookup: async () => {
      requests += 1;
      await writeFile(destination, '{"fixture":"external"}\n');
      return { diagnostics: { rdap: { status: 'unsupported' }, whois: { status: 'skipped' } }, availability: {} };
    },
  };
  assert.equal(await runCli(args, dependencies), EXIT_CODES.USAGE);
  assert.equal(requests, 0);
  assert.match(stderr, /already exists/u);
  stderr = '';
  assert.equal(await runCli([...args, '--force'], dependencies), EXIT_CODES.USAGE);
  assert.equal(requests, 1);
  assert.match(stderr, /state changed/u);
  assert.equal(await readFile(destination, 'utf8'), '{"fixture":"external"}\n');
  assert.deepEqual(await readdir(root), ['state.json']);
});

test('the runner resumes the locked snapshot and publishes one current checkpoint', async (context) => {
  const root = await directory(context);
  const destination = join(root, 'state.json');
  const args = ['workflow-run', 'domain-triage', 'example.test', '--json', '--output', destination];
  const errors: string[] = [];
  const dependencies = { stdout: { write() {} }, stderr: { write(value: string) { errors.push(value); } } };
  assert.equal(await runCli(args, dependencies), EXIT_CODES.SUCCESS);
  const before = JSON.parse(await readFile(destination, 'utf8'));
  assert.equal(before.state, 'awaiting_network_approval');
  assert.equal(await runCli([...args, '--resume', destination, '--force'], {
    ...dependencies,
    readDiffInput: async () => { throw new Error('The locked snapshot must not be reread through another owner'); },
  }), EXIT_CODES.SUCCESS);
  const after = JSON.parse(await readFile(destination, 'utf8'));
  assert.equal(after.state, before.state);
  assert.deepEqual(after.completedSteps, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(await readdir(root), ['state.json']);
});

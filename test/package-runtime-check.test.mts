import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { packageRuntimeDeadline, readPackageRuntimeRequest, verifyPackageRuntimes, withPackageInstallation } from '../tools/package-runtime-check.mts';
import { PACKAGE_PROCESS_TIMEOUT_MS, MAX_PACKAGE_PROCESSING_ITEMS } from '../tools/package-resource-bounds.mts';

test('runtime orchestration preserves operation deadlines as installed checks grow', () => {
  assert.equal(packageRuntimeDeadline(2), PACKAGE_PROCESS_TIMEOUT_MS * 3);
  assert.equal(packageRuntimeDeadline(147), PACKAGE_PROCESS_TIMEOUT_MS * 148);
  for (const value of [0, -1, 1.5, Infinity, MAX_PACKAGE_PROCESSING_ITEMS + 1]) assert.throws(() => packageRuntimeDeadline(value), /bound/u);
});

test('independent package installations use private homes, fresh caches and deterministic cleanup', async () => {
  const roots: string[] = [];
  const names = ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'NODE_OPTIONS', 'NODE_PATH', 'SITE_PASSWORD', 'SESSION_SECRET'] as const;
  const before = names.map(name => [name, process.env[name]] as const);
  try {
    for (const name of names) process.env[name] = 'synthetic-private-sentinel';
    const check = async (context: Parameters<Parameters<typeof withPackageInstallation>[0]>[0]) => {
      roots.push(context.temporary);
      for (const name of names) assert.equal(context.environment[name], undefined);
      assert.equal(context.environment.HOME, context.home);
      assert.equal(context.environment.npm_config_cache, path.join(context.temporary, 'cache'));
      assert.equal(context.environment.npm_config_ignore_scripts, 'true');
      assert.equal(await readFile(path.join(context.home, 'npmrc'), 'utf8'), '');
      await assert.rejects(access(path.join(context.temporary, 'cache')));
      await writeFile(path.join(context.home, 'private-fixture'), 'fixture');
    };
    await withPackageInstallation(check);
    await assert.rejects(withPackageInstallation(async context => { await check(context); throw new Error('deliberate failure'); }), /deliberate failure/u);
    assert.notEqual(roots[0], roots[1]);
    for (const root of roots) await assert.rejects(access(root));
  } finally {
    for (const [name, value] of before) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test('runtime handoff binds the exact archive and rejects corruption, paths, links and oversized inputs', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-runtime-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'candidate.tgz'), request = path.join(root, 'runtime-check.json');
  const bytes = Buffer.from('synthetic archive identity');
  const descriptor = { version: 1, archive: 'candidate.tgz', sha256: createHash('sha256').update(bytes).digest('hex'), input: { checks: ['help', 'offline'] } };
  const set = (value: unknown) => writeFile(request, JSON.stringify(value));
  await writeFile(archive, bytes); await set(descriptor);
  assert.deepEqual(await readPackageRuntimeRequest(request, 1024), { archive, input: descriptor.input });
  for (const archive of ['../candidate.tgz', '/candidate.tgz', 'candidate.zip']) {
    await set({ ...descriptor, archive });
    await assert.rejects(readPackageRuntimeRequest(request, 1024), /Invalid package runtime request/u);
  }
  await set({ ...descriptor, version: 2 });
  await assert.rejects(readPackageRuntimeRequest(request, 1024), /Invalid/u);
  await set(descriptor);
  await assert.rejects(readPackageRuntimeRequest(request, 1), /bound|limit|exceed/iu);
  await writeFile(archive, 'changed');
  await assert.rejects(readPackageRuntimeRequest(request, 1024), /archive changed/u);
  await rm(archive); await symlink(request, archive);
  await assert.rejects(readPackageRuntimeRequest(request, 1024), /symbolic|symlink|regular/iu);
});

test('primary package verification cannot certify an archive changed by the check', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-runtime-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'candidate.tgz');
  await writeFile(archive, 'before');
  await assert.rejects(verifyPackageRuntimes('/unused.mts', archive, 1024, {}, async () => {
    await writeFile(archive, 'after');
    return { installedChecks: ['fixture'] };
  }), /changed during primary/u);
});

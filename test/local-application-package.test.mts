import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parseLocalApplicationArguments } from '../packages/local-application/arguments.mts';
import { localApplicationPackageInputs, localApplicationPackageManifest } from '../tools/local-application-package.mts';
import { optionalPackageLock, assertInstalledPackageDependencies, captureOptionalPackageFiles, assertInstalledOptionalPackage, validateOptionalPackageFiles } from '../tools/optional-package.mts';
import { CI_BROWSER_BUILD_SCRIPTS, CI_CLI_RUNTIME_SCRIPTS } from '../tools/ci-verification.mts';
import { createVerificationOwnershipPlan } from '../tools/verification-ownership.mts';
import { buildFocusedVerificationExecution } from '../tools/focused-verification.mts';

const entry = 'packages/local-application/bin/whoisleuth-local.mts';
const worker = 'lib/local-application-worker.mts';
const manifest = { name: '@slicedearth/whoisleuth-local', private: true, version: '1.0.0', license: 'AGPL-3.0-only', description: 'Local application.' };
const graph = (sources: string[]) => ({ modules: sources.map(source => ({ source, dependencies: [] })) });
const dependency = (version: string, dependencies = {}) => ({ version, dependencies, resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz', integrity: 'sha512-Zml4dHVyZQ==' });

describe('local application package', () => {
  test('native help and argument failures need neither a workspace nor a server', () => {
    for (const args of [[], ['--help'], ['-h'], ['--version'], ['--offline'], ['--host', '0.0.0.0']]) {
      const result = spawnSync(process.execPath, ['--import', path.resolve('tools/browser-server-egress-guard.mts'), path.resolve(entry), ...args], {
        encoding: 'utf8', timeout: 10_000, maxBuffer: 16_384,
      });
      assert.equal(result.error, undefined); assert.equal(result.signal, null);
      const invalid = args[0] === '--offline' || args[0] === '--host';
      assert.equal(result.status, invalid ? 2 : 0);
      if (invalid) {
        assert.equal(result.stdout, ''); assert.match(result.stderr, /^Local application error: /u);
        assert.ok(result.stderr.length < 1_024);
      } else {
        assert.equal(result.stderr, '');
        if (args[0] === '--version') assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/u);
        else assert.match(result.stdout, /The application listens only on 127\.0\.0\.1/u);
      }
    }
  });

  test('requires an explicit workspace and rejects ambiguous or oversized arguments', () => {
    assert.deepEqual(parseLocalApplicationArguments([]), { operation: 'help' });
    assert.deepEqual(parseLocalApplicationArguments(['-h']), { operation: 'help' });
    assert.deepEqual(parseLocalApplicationArguments(['--version']), { operation: 'version' });
    assert.deepEqual(parseLocalApplicationArguments(['--workspace', './review folder', '--init', '--offline', '--port', '65535']),
      { operation: 'start', workspace: './review folder', create: true, offline: true, port: 65535 });
    assert.equal(parseLocalApplicationArguments(['--workspace', './existing']).port, 0);
    for (const args of [['--offline'], ['--workspace', ''], ['--workspace', './one', '--workspace', './two'], ['--workspace', './one', '--port', '065'],
      ['--workspace', './one', '--port', '65536'], ['--host', '0.0.0.0'], ['--workspace', 'a\nb'], ['--workspace', 'a'.repeat(4097)], ['--help', '--init']]) {
      assert.throws(() => parseLocalApplicationArguments(args));
    }
  });

  test('discovers source helpers but requires the runtime worker and reviewed dependencies', () => {
    const sources = [entry, worker, 'server.mts', ...Array.from({ length: 300 }, (_, i) => `lib/helper-${i}.mts`)];
    assert.deepEqual(localApplicationPackageInputs(graph([...sources, 'node_modules/express/index.js']), { dependencies: { express: '^5.0.0' } }),
      { sources: sources.sort(), dependencies: ['express'] });
    for (const sources of [[entry], [worker], [entry, worker, 'frontend/private.ts'], [entry, worker, 'lib/../outside.mts'], [entry, worker, 'node_modules/unreviewed/index.js']]) {
      assert.throws(() => localApplicationPackageInputs(graph(sources), { dependencies: {} }));
    }
  });

  test('pins package dependencies without enabling publication', () => {
    const result = localApplicationPackageManifest(manifest, { packages: { 'node_modules/express': { version: '5.1.0' } } }, ['express']);
    assert.deepEqual(result.dependencies, { express: '5.1.0' });
    assert.equal(result.private, true);
    assert.deepEqual(result.engines, { node: '>=24.19.0' });
    assert.throws(() => localApplicationPackageManifest({ ...manifest, private: false }, {}, []));
  });

  test('locks only the reviewed transitive closure and rejects missing registry integrity', () => {
    const root = { ...manifest, dependencies: { parent: '1.0.0' }, engines: { node: '>=24.19.0' } };
    const lock = { packages: { 'node_modules/parent': { ...dependency('1.0.0', { child: '^1.0.0' }), dev: true },
      'node_modules/child': dependency('1.1.0'), 'node_modules/unrelated': dependency('2.0.0') } };
    const result = optionalPackageLock(root, lock);
    assert.deepEqual(Object.keys(result.packages), ['', 'node_modules/child', 'node_modules/parent']);
    assert.equal((result.packages['node_modules/parent'] as Record<string, unknown>).dev, undefined);
    assert.equal(lock.packages['node_modules/parent'].dev, true);
    assert.equal(assertInstalledPackageDependencies(result, lock, ['parent'], String(root.name)), 2);
    for (const invalid of [{ ...dependency('1.1.0'), integrity: '' }, { ...dependency('1.1.0'), resolved: 'file:../other' }, { ...dependency('1.1.0'), link: true }]) {
      assert.throws(() => optionalPackageLock(root, { packages: { ...lock.packages, 'node_modules/child': invalid } }));
    }
  });

  test('selects a verified build before local packaging in both runtime lanes and focused checks', async () => {
    assert.ok(CI_BROWSER_BUILD_SCRIPTS.indexOf('frontend:build:integrity') < CI_BROWSER_BUILD_SCRIPTS.indexOf('local:package:check'));
    assert.ok(CI_CLI_RUNTIME_SCRIPTS.indexOf('frontend:build:integrity') < CI_CLI_RUNTIME_SCRIPTS.indexOf('local:package:check'));
    const plan = await createVerificationOwnershipPlan([entry]);
    assert.ok(plan.mandatorySpecialisedChecks.includes('local-package'));
    const execution = buildFocusedVerificationExecution(plan);
    const commands = execution.commands.map(command => command.id);
    assert.ok(commands.indexOf('build') >= 0 && commands.indexOf('build') < commands.indexOf('local:package:check'));
  });

  test('bundled vendor files are retained but application sources and altered installed bytes are rejected', async () => {
    const files = ['package.json', 'runtime/main.mjs', 'node_modules/parent/package.json', 'node_modules/parent/index.d.ts'];
    assert.deepEqual(validateOptionalPackageFiles({ files: files.map(path => ({ path })) }, files), files);
    for (const bad of ['runtime/main.mts', '../outside.js']) {
      const candidate = [...files, bad];
      assert.throws(() => validateOptionalPackageFiles({ files: candidate.map(path => ({ path })) }, candidate));
    }
    assert.throws(() => validateOptionalPackageFiles({ files: [...files, files[0]].map(path => ({ path })) }, files));
    const directory = await mkdtemp(path.join(tmpdir(), 'optional-package-files-'));
    try {
      for (const file of files) { await mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await writeFile(path.join(directory, file), file); }
      const expected = await captureOptionalPackageFiles(directory);
      const reviewed = { packages: { 'node_modules/parent': dependency('1.0.0') } };
      const bundled = { version: '1.0.0', inBundle: true };
      const installed = { packages: { '': {}, 'node_modules/example-local': { version: '1.0.0' }, 'node_modules/example-local/node_modules/parent': bundled } };
      assert.equal(await assertInstalledOptionalPackage(directory, expected, installed, reviewed, ['parent'], 'example-local'), 1);
      for (const entries of [{ ...installed.packages, 'node_modules/outside': bundled }, { ...installed.packages, 'node_modules/example-local/node_modules/parent': { ...bundled, version: '2.0.0' } }]) {
        await assert.rejects(assertInstalledOptionalPackage(directory, expected, { packages: entries }, reviewed, ['parent'], 'example-local'));
      }
      await writeFile(path.join(directory, 'runtime/main.mjs'), 'altered');
      await assert.rejects(assertInstalledOptionalPackage(directory, expected, installed, reviewed, ['parent'], 'example-local'), /bytes differ/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

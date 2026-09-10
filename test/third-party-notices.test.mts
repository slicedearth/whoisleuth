import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { build } from 'vite';
import { frontendWorkerBuild } from '../tools/frontend-worker-build.mts';

import {
  buildThirdPartyNotices,
  browserThirdPartyNoticesPlugin,
  MAX_NOTICE_DOCUMENT_BYTES,
  THIRD_PARTY_NOTICE_PATH,
  collectProductionPackages,
  main,
  parseArguments,
} from '../tools/third-party-notices.mts';

function capture() {
  let value = '';
  return { stream: { write(chunk: unknown) { value += String(chunk); } }, value: () => value };
}

function fixtureLockfile() {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { alpha: '1.0.0' } },
      frontend: { dependencies: { beta: '2.0.0' } },
      'node_modules/alpha': { version: '1.0.0', license: 'MIT', dependencies: { shared: '3.0.0' } },
      'node_modules/beta': { version: '2.0.0', license: 'ISC' },
      'node_modules/shared': { version: '3.0.0', license: 'BSD-3-Clause' },
      'node_modules/dev-only': { version: '4.0.0', license: 'MIT', dev: true },
    },
  };
}

async function writeFixturePackage(root: string, name: string, licenseText = '') {
  const directory = path.join(root, 'node_modules', name);
  await mkdir(directory, { recursive: true });
  if (licenseText) await writeFile(path.join(directory, 'LICENSE'), licenseText, 'utf8');
  else await writeFile(path.join(directory, 'README.md'), '# Package\n\n## License\n\nMIT\n', 'utf8');
}

describe('third-party production dependency notices', () => {
  test('collects exact direct and transitive production packages while excluding development dependencies', () => {
    assert.deepEqual(collectProductionPackages(fixtureLockfile()), [
      { name: 'alpha', version: '1.0.0', license: 'MIT', direct: true, installPath: 'node_modules/alpha' },
      { name: 'beta', version: '2.0.0', license: 'ISC', direct: true, installPath: 'node_modules/beta' },
      { name: 'shared', version: '3.0.0', license: 'BSD-3-Clause', direct: false, installPath: 'node_modules/shared' },
    ]);
  });

  test('scopes a distributable inventory to the exact runtime dependency closure', () => {
    assert.deepEqual(collectProductionPackages(fixtureLockfile(), {
      directDependencyNames: ['alpha'],
    }), [
      { name: 'alpha', version: '1.0.0', license: 'MIT', direct: true, installPath: 'node_modules/alpha' },
      { name: 'shared', version: '3.0.0', license: 'BSD-3-Clause', direct: false, installPath: 'node_modules/shared' },
    ]);
  });

  test('includes only the dev-declared dependencies identified in the delivered bundle', () => {
    const lockfile = fixtureLockfile();
    const bundledDependencies = [{ name: 'dev-only', version: '4.0.0' }];
    assert.deepEqual(collectProductionPackages(lockfile, { bundledDependencies }).map((entry) => entry.name), ['alpha', 'beta', 'dev-only', 'shared']);
    assert.throws(() => collectProductionPackages(lockfile, { bundledDependencies: [{ name: 'dev-only', version: '5.0.0' }] }), /absent from the locked inventory/u);
    assert.throws(() => collectProductionPackages(lockfile, { bundledDependencies, directDependencyNames: ['alpha'] }), /must remain separate/u);
    assert.throws(() => collectProductionPackages(lockfile, { bundledDependencies: [{ name: '../outside', version: '1.0.0' }] }), /safe relative path|invalid package/u);
    assert.throws(() => collectProductionPackages({ ...lockfile, packages: { ...lockfile.packages, 'node_modules/dev-only': { version: '4.0.0', dev: true, license: 'UNLICENSED' } } }, { bundledDependencies }), /unreviewed licence/u);
    assert.equal(collectProductionPackages(lockfile, { directDependencyNames: ['alpha'] }).some((entry) => entry.name === 'dev-only'), false);
  });

  test('derives browser notices from a real build and replaces the copied production base', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-browser-notices-'));
    try {
      await mkdir(path.join(directory, 'public'), { recursive: true });
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'notice-fixture', version: '1.0.0', private: true, type: 'module' }));
      const lockfile = fixtureLockfile();
      await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({ ...lockfile, packages: { ...lockfile.packages,
        'node_modules/unused-dev': { version: '1.0.0', dev: true, license: 'MIT' },
        'node_modules/worker-only': { version: '1.0.0', dev: true, license: 'MIT' },
      } }));
      for (const name of ['alpha', 'beta', 'shared', 'dev-only']) await writeFixturePackage(directory, name, `${name} licence text`);
      await writeFile(path.join(directory, 'node_modules/dev-only/package.json'), JSON.stringify({ name: 'dev-only', version: '4.0.0', license: 'MIT', type: 'module', exports: './index.js' }));
      await writeFile(path.join(directory, 'node_modules/dev-only/index.js'), 'export const visible = "retained-browser-value";');
      await writeFixturePackage(directory, 'worker-only', 'worker-only licence text');
      await writeFile(path.join(directory, 'node_modules/worker-only/package.json'), JSON.stringify({ name: 'worker-only', version: '1.0.0', license: 'MIT', type: 'module', exports: './index.js' }));
      await writeFile(path.join(directory, 'node_modules/worker-only/index.js'), 'export const message = "retained-worker-value";');
      await mkdir(path.join(directory, 'src'));
      await writeFile(path.join(directory, 'src/entry.js'), 'export { visible } from "dev-only"; export function start() { return new Worker(new URL("./index.worker.js", import.meta.url), { type: "module" }); }');
      await writeFile(path.join(directory, 'src/index.worker.js'), 'import { message } from "worker-only"; self.postMessage(message);');
      await writeFile(path.join(directory, 'public/third-party-notices.txt'), 'copied production base');
      const workerBuild = frontendWorkerBuild(directory);
      await build({
        configFile: false, root: directory, logLevel: 'silent', plugins: [workerBuild.client, browserThirdPartyNoticesPlugin(directory, workerBuild.renderedWorkerModules)],
        worker: { plugins: workerBuild.workerPlugins },
        build: { outDir: 'dist', assetsDir: '_app/immutable/workers', manifest: true, minify: false,
          lib: { entry: path.join(directory, 'src/entry.js'), formats: ['es'] } },
      });
      const notice = await readFile(path.join(directory, 'dist/third-party-notices.txt'), 'utf8');
      assert.match(notice, /^dev-only@4\.0\.0\nRelationship: bundled browser dependency/mu);
      assert.match(notice, /dev-only licence text/u);
      assert.match(notice, /^worker-only@1\.0\.0\nRelationship: bundled browser dependency/mu);
      assert.match(notice, /worker-only licence text/u);
      const manifest = JSON.parse(await readFile(path.join(directory, 'dist/.vite/manifest.json'), 'utf8'));
      assert.match(manifest['src/index.worker.js'].file, /^_app\/immutable\/workers\/index\.worker-[^/]+\.js$/u);
      assert.match(await readFile(path.join(directory, 'dist', manifest['src/index.worker.js'].file), 'utf8'), /retained-worker-value/u);
      assert.equal(Object.keys(manifest).filter((source) => source === 'src/index.worker.js').length, 1);
      assert.match(notice, /run npm run build/u);
      assert.doesNotMatch(notice, /run npm run licenses:update/u);
      assert.match(notice, /^alpha@1\.0\.0$/mu);
      assert.doesNotMatch(notice, /unused-dev|copied production base/u);
      await assert.rejects(readFile(path.join(directory, 'dist/.vite/browser-licenses.json')), { code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('derives notice bytes from an admitted lockfile value and exposes later document drift', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-notices-snapshot-'));
    try {
      const admittedLockfile = fixtureLockfile();
      await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({
        lockfileVersion: 3,
        packages: { '': {} },
      }), 'utf8');
      await writeFixturePackage(directory, 'alpha', 'Alpha admitted licence');
      await writeFixturePackage(directory, 'beta', 'Beta admitted licence');
      await writeFixturePackage(directory, 'shared', 'Shared admitted licence');
      const admitted = await buildThirdPartyNotices(directory, { lockfileValue: admittedLockfile });
      assert.match(admitted, /Package count: 3/u);
      assert.match(admitted, /Alpha admitted licence/u);

      await writeFile(path.join(directory, 'node_modules', 'alpha', 'LICENSE'), 'Alpha changed licence', 'utf8');
      const changed = await buildThirdPartyNotices(directory, { lockfileValue: admittedLockfile });
      assert.notEqual(changed, admitted);
      assert.match(changed, /Alpha changed licence/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects malformed inventories and unsupported command arguments', () => {
    assert.throws(() => collectProductionPackages({ lockfileVersion: 3, packages: { '': {}, 'node_modules/unknown': { version: '1.0.0' } } }), /licence/);
    assert.equal(parseArguments(['--check']), 'check');
    assert.equal(parseArguments(['--write']), 'write');
    assert.throws(() => parseArguments([]), /Usage/);
    assert.throws(() => parseArguments(['--delete']), /Usage/);
    assert.throws(() => collectProductionPackages({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { outside: '1.0.0' } },
        'node_modules/../../outside': { version: '1.0.0', license: 'MIT' },
      },
    }), /safe relative path|inside node_modules/iu);
    assert.throws(() => collectProductionPackages({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { proprietary: '1.0.0' } },
        'node_modules/proprietary': { version: '1.0.0', license: 'UNLICENSED' },
      },
    }), /unreviewed licence expression/u);
  });

  test('rejects package documents that resolve through symbolic links', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-notices-link-'));
    try {
      await mkdir(path.join(directory, 'frontend', 'static'), { recursive: true });
      await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(fixtureLockfile()), 'utf8');
      await writeFixturePackage(directory, 'beta', 'Beta licence text');
      await writeFixturePackage(directory, 'shared', 'Shared licence text');
      const alphaDirectory = path.join(directory, 'node_modules', 'alpha');
      await mkdir(alphaDirectory, { recursive: true });
      const outside = path.join(directory, 'outside-license.txt');
      await writeFile(outside, 'Outside licence text', 'utf8');
      await symlink(outside, path.join(alphaDirectory, 'LICENSE'));

      const errors = capture();
      assert.equal(await main(['--write'], { repositoryRoot: directory, stderr: errors.stream }), 2);
      assert.match(errors.value(), /ELOOP|symbolic link/iu);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects node_modules and output-directory roots that resolve outside the repository', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'whoisleuth-notices-roots-'));
    const repository = path.join(parent, 'repository');
    const externalModules = path.join(parent, 'external-modules');
    const externalStatic = path.join(parent, 'external-static');
    try {
      await mkdir(repository, { recursive: true });
      await mkdir(externalModules, { recursive: true });
      await mkdir(externalStatic, { recursive: true });
      await writeFile(path.join(repository, 'package-lock.json'), JSON.stringify(fixtureLockfile()), 'utf8');
      await mkdir(path.join(externalModules, 'alpha'), { recursive: true });
      await writeFile(path.join(externalModules, 'alpha', 'LICENSE'), 'External licence', 'utf8');
      await symlink(externalModules, path.join(repository, 'node_modules'));
      const moduleErrors = capture();
      assert.equal(await main(['--write'], { repositoryRoot: repository, stderr: moduleErrors.stream }), 2);
      assert.match(moduleErrors.value(), /node_modules resolves outside/iu);

      await rm(path.join(repository, 'node_modules'), { force: true });
      await writeFixturePackage(repository, 'alpha', 'Alpha licence');
      await writeFixturePackage(repository, 'beta', 'Beta licence');
      await writeFixturePackage(repository, 'shared', 'Shared licence');
      await mkdir(path.join(repository, 'frontend'), { recursive: true });
      await symlink(externalStatic, path.join(repository, 'frontend', 'static'));
      const outputErrors = capture();
      assert.equal(await main(['--write'], { repositoryRoot: repository, stderr: outputErrors.stream }), 2);
      assert.match(outputErrors.value(), /output directory resolves outside/iu);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('rejects notice output incrementally before reading later package documents', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-notices-output-bound-'));
    const names = ['alpha0', 'alpha1', 'alpha2', 'alpha3', 'alpha4'];
    try {
      const packages = Object.fromEntries(names.map((name) => [
        `node_modules/${name}`,
        { version: '1.0.0', license: 'MIT' },
      ]));
      await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { dependencies: { alpha0: '1.0.0' } }, ...packages },
      }), 'utf8');
      for (const name of names.slice(0, 4)) {
        const packageDirectory = path.join(directory, 'node_modules', name);
        await mkdir(packageDirectory, { recursive: true });
        for (let index = 0; index < 8; index += 1) {
          await writeFile(
            path.join(packageDirectory, `LICENSE-${index}`),
            `${name}-${index}-`.padEnd(MAX_NOTICE_DOCUMENT_BYTES, 'x'),
            'utf8',
          );
        }
      }
      const unreadPackage = path.join(directory, 'node_modules', names[4] as string);
      await mkdir(unreadPackage, { recursive: true });
      await symlink(path.join(directory, 'missing-later-document'), path.join(unreadPackage, 'LICENSE'));

      await assert.rejects(
        buildThirdPartyNotices(directory),
        /output exceeds its byte limit/iu,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('writes and checks a deterministic bounded notice artifact', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-notices-'));
    try {
      await mkdir(path.join(directory, 'frontend', 'static'), { recursive: true });
      await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(fixtureLockfile()), 'utf8');
      await writeFixturePackage(directory, 'alpha', 'Alpha licence text');
      await writeFixturePackage(directory, 'beta', 'Beta licence text');
      await writeFixturePackage(directory, 'shared');
      const outsideNotice = path.join(directory, 'outside-notices.txt');
      await writeFile(outsideNotice, 'outside notice sentinel', 'utf8');
      await symlink(outsideNotice, path.join(directory, THIRD_PARTY_NOTICE_PATH));

      const writeStdout = capture();
      const writeStderr = capture();
      assert.equal(await main(['--write'], { repositoryRoot: directory, stdout: writeStdout.stream, stderr: writeStderr.stream }), 0);
      assert.equal(writeStderr.value(), '');
      const output = await readFile(path.join(directory, THIRD_PARTY_NOTICE_PATH), 'utf8');
      assert.equal(await readFile(outsideNotice, 'utf8'), 'outside notice sentinel');
      assert.match(output, /Package count: 3/u);
      assert.match(output, /Package count: 3\n\n={80}/u);
      assert.match(output, /alpha@1\.0\.0[\s\S]+direct production dependency/u);
      assert.match(output, /shared@3\.0\.0[\s\S]+transitive production dependency/u);
      assert.doesNotMatch(output, /dev-only/u);

      const checkStdout = capture();
      const checkStderr = capture();
      assert.equal(await main(['--check'], { repositoryRoot: directory, stdout: checkStdout.stream, stderr: checkStderr.stream }), 0);
      assert.match(checkStdout.value(), /pass \(3 packages\)/u);
      assert.equal(checkStderr.value(), '');

      await writeFile(path.join(directory, THIRD_PARTY_NOTICE_PATH), 'stale', 'utf8');
      const staleStderr = capture();
      assert.equal(await main(['--check'], { repositoryRoot: directory, stderr: staleStderr.stream }), 2);
      assert.match(staleStderr.value(), /notices are stale/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

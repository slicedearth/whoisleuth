import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLI_PACKAGE_INSTALLED_CHECK_TIMEOUT_MS,
  CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS,
  MAX_CLI_PACKAGE_COMPILER_SOURCES,
  MAX_CLI_PACKAGE_ENTRIES,
  MAX_CLI_PACKAGE_MODULES,
  MAX_CLI_RUNTIME_MODULES,
  assertCliPackageSourceSnapshot,
  buildCliPackageManifest,
  captureCliPackageSourceSnapshot,
  compilePackageSources,
  formatCliPackageReport,
  isCliPackageCompilerInputPath,
  materializeCliPackageSourceSnapshot,
  parseArguments,
  selectCliPackageSources,
  selectMaterializedCliPackageSources,
} from '../tools/cli-package.mts';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

const rootManifest = {
  name: 'whoisleuth',
  version: '1.26.0',
  dependencies: {
    '@peculiar/x509': '^2.0.0',
    express: '^5.2.1',
    maxmind: '^5.0.7',
    parse5: '^8.0.1',
    'reflect-metadata': '0.2.2',
    tldts: '^7.4.9',
    undici: '^8.7.0',
  },
};

const templateManifest = {
  name: '@slicedearth/whoisleuth-cli',
  private: true,
  type: 'module',
  license: 'AGPL-3.0-only',
  author: 'slicedearth',
  contentPolicy: { class: 'dual-use' },
  bin: { whoisleuth: 'bin/whoisleuth.mjs' },
  repository: { type: 'git', url: 'git+https://github.com/slicedearth/whoisleuth.git' },
  homepage: 'https://www.whoisleuth.com/',
  bugs: { url: 'https://github.com/slicedearth/whoisleuth/issues' },
};

const lockfile = {
  name: 'whoisleuth',
  version: '1.26.0',
  lockfileVersion: 3,
  packages: {
    '': {
      name: 'whoisleuth',
      version: '1.26.0',
      dependencies: rootManifest.dependencies,
    },
    'node_modules/@peculiar/x509': { version: '2.0.0' },
    'node_modules/maxmind': { version: '5.0.7' },
    'node_modules/parse5': { version: '8.0.1' },
    'node_modules/reflect-metadata': { version: '0.2.2' },
    'node_modules/tldts': { version: '7.4.10' },
    'node_modules/undici': { version: '8.9.0' },
  },
};

describe('scoped CLI package contract', () => {
  test('bounds both long-running package assembly and installed command processes', () => {
    assert.equal(CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS, 120_000);
    assert.equal(CLI_PACKAGE_INSTALLED_CHECK_TIMEOUT_MS, 15_000);
    assert.ok(MAX_CLI_RUNTIME_MODULES >= 1 && MAX_CLI_RUNTIME_MODULES < MAX_CLI_PACKAGE_MODULES);
    assert.ok(MAX_CLI_PACKAGE_MODULES <= 512);
    assert.ok(MAX_CLI_PACKAGE_COMPILER_SOURCES >= MAX_CLI_RUNTIME_MODULES / 2
      && MAX_CLI_PACKAGE_COMPILER_SOURCES <= 512);
    assert.ok(MAX_CLI_PACKAGE_ENTRIES >= MAX_CLI_RUNTIME_MODULES / 2
      && MAX_CLI_PACKAGE_ENTRIES <= 512);
  });

  test('validates compiler context paths with bounded linear segment checks', () => {
    assert.equal(isCliPackageCompilerInputPath('node_modules/typescript/lib/lib.es2022.d.ts'), true);
    assert.equal(isCliPackageCompilerInputPath('node_modules/@types/node/index.d.ts'), true);
    assert.equal(isCliPackageCompilerInputPath('node_modules/example/package.json'), true);
    assert.equal(isCliPackageCompilerInputPath('node_modules/example/node_modules/@scope/types/index.d.mts'), true);
    assert.equal(isCliPackageCompilerInputPath('node_modules/example/index.js'), false);
    assert.equal(isCliPackageCompilerInputPath('node_modules/example/../outside.d.ts'), false);
    assert.equal(isCliPackageCompilerInputPath(`node_modules/${'-.'.repeat(4_096)}invalid.d.ts`), false);
  });
  test('selects only the bounded executable dependency closure', () => {
    const selected = selectCliPackageSources({
      modules: [
        { source: 'package.json', dependencies: [] },
        { source: 'bin/whoisleuth.mts', dependencies: [{ module: '../cli/runner.mts', couldNotResolve: false }] },
        { source: 'cli/runner.mts', dependencies: [] },
        { source: 'lib/lookup.mts', dependencies: [] },
        { source: 'frontend/src/lib/bounded-json.ts', dependencies: [] },
        { source: 'frontend/src/lib/analysis/workspace-archive.ts', dependencies: [] },
        { source: 'packages/contracts/risk-calibration.mts', dependencies: [] },
        { source: 'packages/comparison/page-similarity.mts', dependencies: [] },
        { source: 'packages/evidence/artifact-integrity.mts', dependencies: [] },
        { source: 'packages/evidence/observation.mts', dependencies: [] },
        { source: 'packages/interchange/external-findings-import.mts', dependencies: [] },
        { source: 'packages/investigation/investigation-capsule.mts', dependencies: [] },
        { source: 'packages/monitoring/analyst-review-state.mts', dependencies: [] },
        { source: 'packages/web-capture/capture.mts', dependencies: [] },
        { source: 'test/cli.test.mts', dependencies: [] },
      ],
    });
    assert.deepEqual(selected, [
      'bin/whoisleuth.mts',
      'cli/runner.mts',
      'frontend/src/lib/analysis/workspace-archive.ts',
      'frontend/src/lib/bounded-json.ts',
      'lib/lookup.mts',
      'packages/comparison/page-similarity.mts',
      'packages/contracts/risk-calibration.mts',
      'packages/evidence/artifact-integrity.mts',
      'packages/evidence/observation.mts',
      'packages/interchange/external-findings-import.mts',
      'packages/investigation/investigation-capsule.mts',
      'packages/monitoring/analyst-review-state.mts',
    ]);
  });

  test('retains released domain-control facade paths as explicit package roots', () => {
    const roots = [
      'bin/whoisleuth.mts',
      'cli/runner.mts',
      'frontend/src/lib/analysis/domain-control-manifest-core.ts',
      'frontend/src/lib/analysis/domain-control-records.ts',
    ];
    const selected = selectCliPackageSources({
      modules: [
        ...roots.map((source) => ({ source, dependencies: [] })),
        { source: 'packages/evidence/domain-control-runtime.mts', dependencies: [] },
        { source: 'packages/evidence/domain-name.mts', dependencies: [] },
      ],
    }, {
      maximumModules: 6,
      requiredSources: roots,
    });
    assert.deepEqual(selected, [
      'bin/whoisleuth.mts',
      'cli/runner.mts',
      'frontend/src/lib/analysis/domain-control-manifest-core.ts',
      'frontend/src/lib/analysis/domain-control-records.ts',
      'packages/evidence/domain-control-runtime.mts',
      'packages/evidence/domain-name.mts',
    ]);
    assert.throws(() => selectCliPackageSources({
      modules: roots.slice(0, -1).map((source) => ({ source, dependencies: [] })),
    }, {
      maximumModules: 4,
      requiredSources: roots,
    }), /missing required CLI source.*domain-control-records/iu);
  });

  test('rejects unresolved, traversing, and incomplete dependency graphs', () => {
    assert.throws(() => selectCliPackageSources({ modules: [{ source: '../bin/whoisleuth.mts' }] }), /safe repository-relative path/u);
    assert.throws(() => selectCliPackageSources({
      modules: [
        { source: 'bin/whoisleuth.mts', dependencies: [{ module: '../cli/missing.mts', couldNotResolve: true }] },
        { source: 'cli/runner.mts' },
      ],
    }), /could not be resolved/u);
    assert.throws(() => selectCliPackageSources({ modules: [{ source: 'bin/whoisleuth.mts' }] }), /cli\/runner\.mts/u);
  });

  test('rejects linked package inputs and source changes after snapshot admission', async () => {
    const repository = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-package-source-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-package-outside-'));
    try {
      await mkdir(path.join(repository, 'lib'));
      await writeFile(path.join(repository, 'lib', 'needed.mts'), 'export const needed = 1;\n', 'utf8');
      await writeFile(path.join(repository, 'lib', 'stable.mts'), "import { needed } from './needed.mts';\nexport const value = needed;\n", 'utf8');
      await writeFile(path.join(repository, 'lib', 'unreferenced.mts'), 'export const unreviewed = 2;\n', 'utf8');
      const snapshot = await captureCliPackageSourceSnapshot(repository, [
        'lib/needed.mts',
        'lib/stable.mts',
        'lib/unreferenced.mts',
      ]);
      await assertCliPackageSourceSnapshot(repository, snapshot);

      const assemblyRoot = path.join(repository, 'assembly');
      const sourceRoot = path.join(assemblyRoot, 'source');
      const stagingRoot = path.join(assemblyRoot, 'staging');
      await mkdir(stagingRoot, { recursive: true });
      await materializeCliPackageSourceSnapshot(sourceRoot, snapshot);
      await writeFile(path.join(repository, 'lib', 'stable.mts'), 'export const value = 2;\n', 'utf8');
      await compilePackageSources(
        REPOSITORY_ROOT,
        assemblyRoot,
        stagingRoot,
        sourceRoot,
        ['lib/stable.mts'],
      );
      const compiled = await readFile(path.join(stagingRoot, 'lib', 'stable.mjs'), 'utf8');
      assert.match(compiled, /\.\/needed\.mjs/u);
      assert.doesNotMatch(compiled, /value = 2/u);
      await assert.rejects(
        readFile(path.join(stagingRoot, 'lib', 'unreferenced.mjs'), 'utf8'),
        /ENOENT/u,
      );
      await assert.rejects(
        assertCliPackageSourceSnapshot(repository, snapshot),
        /changed during CLI package assembly/iu,
      );

      await writeFile(path.join(outside, 'outside.mts'), 'export const outside = true;\n', 'utf8');
      await symlink(path.join(outside, 'outside.mts'), path.join(repository, 'final-link.mts'));
      await assert.rejects(
        captureCliPackageSourceSnapshot(repository, ['final-link.mts']),
        /symbolic link/iu,
      );
      await symlink(outside, path.join(repository, 'linked-directory'));
      await assert.rejects(
        captureCliPackageSourceSnapshot(repository, ['linked-directory/outside.mts']),
        /symbolic link/iu,
      );
    } finally {
      await rm(repository, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test('rejects a dependency-discovery hint that is absent from the materialized entrypoint closure', () => {
    assert.deepEqual(selectMaterializedCliPackageSources(
      ['bin/whoisleuth.mts', 'cli/runner.mts'],
      ['bin/whoisleuth.mts', 'cli/runner.mts', 'lib/needed.mts'],
    ), ['bin/whoisleuth.mts', 'cli/runner.mts', 'lib/needed.mts']);
    assert.throws(() => selectMaterializedCliPackageSources(
      ['bin/whoisleuth.mts', 'cli/runner.mts', 'lib/unreferenced.mts'],
      ['bin/whoisleuth.mts', 'cli/runner.mts', 'lib/needed.mts'],
    ), /not reachable from the materialized entrypoint closure/iu);
  });

  test('generates a private version-aligned manifest with exact locked runtime dependencies', () => {
    const manifest = buildCliPackageManifest(rootManifest, templateManifest, lockfile);
    assert.equal(manifest.name, '@slicedearth/whoisleuth-cli');
    assert.equal(manifest.version, '1.26.0');
    assert.equal(manifest.private, true);
    assert.deepEqual(manifest.contentPolicy, { class: 'dual-use' });
    assert.deepEqual(manifest.dependencies, {
      '@peculiar/x509': '2.0.0',
      maxmind: '5.0.7',
      parse5: '8.0.1',
      'reflect-metadata': '0.2.2',
      tldts: '7.4.10',
      undici: '8.9.0',
    });
    assert.equal(Object.hasOwn(manifest.dependencies as object, 'express'), false);
    assert.equal(Object.hasOwn(manifest, 'publishConfig'), false);
    assert.ok((manifest.files as string[]).includes('frontend/src/lib/**/*.js'));
    assert.ok((manifest.files as string[]).includes('packages/cases/**/*.mjs'));
    assert.ok((manifest.files as string[]).includes('packages/comparison/**/*.mjs'));
    assert.ok((manifest.files as string[]).includes('packages/contracts/**/*.mjs'));
    assert.ok((manifest.files as string[]).includes('packages/evidence/**/*.mjs'));
    assert.ok((manifest.files as string[]).includes('packages/interchange/**/*.mjs'));
    assert.ok((manifest.files as string[]).includes('packages/investigation/**/*.mjs'));
    assert.ok((manifest.files as string[]).includes('packages/monitoring/**/*.mjs'));
    assert.ok((manifest.files as string[]).includes('packages/workspace/**/*.mjs'));
  });

  test('generates public metadata only for an explicit release candidate', () => {
    const manifest = buildCliPackageManifest(rootManifest, templateManifest, lockfile, { publicationEnabled: true });
    assert.equal(Object.hasOwn(manifest, 'private'), false);
    assert.deepEqual(manifest.publishConfig, {
      access: 'public',
      provenance: true,
    });
  });

  test('refuses an unscoped or publication-enabled template', () => {
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, name: 'whoisleuth-cli' }, lockfile), /must remain scoped/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, private: false }, lockfile), /must remain private/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, publishConfig: { access: 'public' } }, lockfile), /must not contain release-only/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, scripts: { postinstall: 'node install.mjs' } }, lockfile), /must not declare scripts/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, contentPolicy: { class: 'ordinary' } }, lockfile), /dual-use class/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, contentPolicy: { class: 'dual-use', extra: true } }, lockfile), /dual-use class/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, homepage: 'https://different.example/' }, lockfile), /shared project metadata/u);
  });

  test('refuses dependency ranges that drift from the reviewed lockfile', () => {
    assert.throws(() => buildCliPackageManifest(
      { ...rootManifest, dependencies: { ...rootManifest.dependencies, undici: '^8.9.0' } },
      templateManifest,
      lockfile,
    ), /must match the lockfile request/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, templateManifest, {
      ...lockfile,
      packages: {
        ...lockfile.packages,
        'node_modules/undici': { version: '^8.9.0' },
      },
    }), /Release version must contain major, minor, and patch/u);
  });

  test('keeps arguments and the human report explicit', () => {
    assert.deepEqual(parseArguments([]), { json: false, publicationEnabled: false });
    assert.deepEqual(parseArguments(['--json']), { json: true, publicationEnabled: false });
    assert.deepEqual(parseArguments(['--release-candidate', '/tmp/release', '--tag', 'v1.26.0', '--json']), {
      json: true,
      publicationEnabled: true,
      artifactDirectory: '/tmp/release',
      expectedTag: 'v1.26.0',
    });
    assert.throws(() => parseArguments(['--publish']), /Usage/u);
    assert.throws(() => parseArguments(['--release-candidate', '/tmp/release']), /Usage/u);
    const output = formatCliPackageReport({
      schema: 'whoisleuth.cli-package-check',
      version: 3,
      packageName: '@slicedearth/whoisleuth-cli',
      packageVersion: '1.26.0',
      sourceModuleCount: 156,
      packedEntryCount: 165,
      packedBytes: 700_000,
      unpackedBytes: 2_800_000,
      runtimeDependencies: {
        '@peculiar/x509': '2.0.0',
        maxmind: '5.0.7',
        parse5: '8.0.1',
        'reflect-metadata': '0.2.2',
        tldts: '7.4.10',
        undici: '8.9.0',
      },
      installedChecks: ['help', 'zero-argument-help', 'version', 'doctor', 'lookup-plan', 'direct-lookup-plan', 'completion', 'manual', 'registry-support', 'discover'],
      publicationEnabled: false,
      archiveFilename: null,
      archiveSha256: null,
    });
    assert.match(output, /Publication: disabled/u);
    assert.match(output, /Runtime dependencies: @peculiar\/x509@2\.0\.0, maxmind@5\.0\.7, parse5@8\.0\.1, reflect-metadata@0\.2\.2, tldts@7\.4\.10, undici@8\.9\.0/u);
    assert.match(output, /Installed checks: help, zero-argument-help, version, doctor, lookup-plan, direct-lookup-plan, completion, manual, registry-support, discover/u);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCliPackageManifest,
  formatCliPackageReport,
  parseArguments,
  selectCliPackageSources,
} from '../tools/cli-package.mts';

const rootManifest = {
  version: '1.26.0',
  dependencies: {
    express: '^5.2.1',
    parse5: '^8.0.1',
    tldts: '^7.4.9',
    undici: '^8.7.0',
  },
};

const templateManifest = {
  name: '@slicedearth/whoisleuth-cli',
  private: true,
  type: 'module',
  license: 'AGPL-3.0-only',
  contentPolicy: { class: 'dual-use' },
  bin: { whoisleuth: 'bin/whoisleuth.mjs' },
};

describe('scoped CLI package contract', () => {
  test('selects only the bounded executable dependency closure', () => {
    const selected = selectCliPackageSources({
      modules: [
        { source: 'package.json', dependencies: [] },
        { source: 'bin/whoisleuth.mts', dependencies: [{ module: '../cli/runner.mts', couldNotResolve: false }] },
        { source: 'cli/runner.mts', dependencies: [] },
        { source: 'lib/lookup.mts', dependencies: [] },
        { source: 'frontend/src/lib/analysis/workspace-archive.ts', dependencies: [] },
        { source: 'test/cli.test.mts', dependencies: [] },
      ],
    });
    assert.deepEqual(selected, [
      'bin/whoisleuth.mts',
      'cli/runner.mts',
      'frontend/src/lib/analysis/workspace-archive.ts',
      'lib/lookup.mts',
    ]);
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

  test('generates a private version-aligned manifest with only runtime dependencies', () => {
    const manifest = buildCliPackageManifest(rootManifest, templateManifest);
    assert.equal(manifest.name, '@slicedearth/whoisleuth-cli');
    assert.equal(manifest.version, '1.26.0');
    assert.equal(manifest.private, true);
    assert.deepEqual(manifest.contentPolicy, { class: 'dual-use' });
    assert.deepEqual(manifest.dependencies, {
      parse5: '^8.0.1',
      tldts: '^7.4.9',
      undici: '^8.7.0',
    });
    assert.equal(Object.hasOwn(manifest.dependencies as object, 'express'), false);
    assert.equal(Object.hasOwn(manifest, 'publishConfig'), false);
  });

  test('generates public metadata only for an explicit release candidate', () => {
    const manifest = buildCliPackageManifest(rootManifest, templateManifest, { publicationEnabled: true });
    assert.equal(Object.hasOwn(manifest, 'private'), false);
    assert.deepEqual(manifest.publishConfig, {
      access: 'public',
      provenance: true,
    });
  });

  test('refuses an unscoped or publication-enabled template', () => {
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, name: 'whoisleuth-cli' }), /must remain scoped/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, private: false }), /must remain private/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, publishConfig: { access: 'public' } }), /must not contain release-only/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, contentPolicy: { class: 'ordinary' } }), /dual-use class/u);
    assert.throws(() => buildCliPackageManifest(rootManifest, { ...templateManifest, contentPolicy: { class: 'dual-use', extra: true } }), /dual-use class/u);
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
      version: 2,
      packageName: '@slicedearth/whoisleuth-cli',
      packageVersion: '1.26.0',
      sourceModuleCount: 156,
      packedEntryCount: 165,
      packedBytes: 700_000,
      unpackedBytes: 2_800_000,
      installedChecks: ['help', 'version', 'doctor', 'completion', 'manual', 'registry-support', 'discover'],
      publicationEnabled: false,
      archiveFilename: null,
      archiveSha256: null,
    });
    assert.match(output, /Publication: disabled/u);
    assert.match(output, /Installed checks: help, version, doctor, completion, manual, registry-support, discover/u);
  });
});

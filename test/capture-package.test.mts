import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { assertCaptureInstalledDependencies, capturePackageInputs, capturePackageManifest } from '../tools/capture-package.mts';
import { CI_QUALITY_SCRIPTS, CI_CLI_RUNTIME_SCRIPTS } from '../tools/ci-verification.mts';
import { createVerificationOwnershipPlan } from '../tools/verification-ownership.mts';

const entry = 'packages/web-capture/bin/whoisleuth-capture.mts';
const source = {
  name: '@slicedearth/whoisleuth-web-capture', private: true, version: '1.1.0', license: 'AGPL-3.0-only',
  description: 'Optional capture companion.', dependencies: { playwright: '1.62.1', undici: '^8.10.1' },
};
const lock = { packages: { 'node_modules/playwright': { version: '1.62.1' }, 'node_modules/undici': { version: '8.10.2' } } };
const graph = (sources: string[]) => ({ modules: sources.map(source => ({ source, dependencies: [] })) });

describe('independent capture package', () => {
  test('discovers helper modules without a maintained source inventory', () => {
    const sources = [entry, ...Array.from({ length: 300 }, (_, index) => `lib/helper-${index}.mts`), ...Array.from({ length: 300 }, (_, index) => `packages/comparison/helper-${index}.mts`)];
    const inputs = capturePackageInputs(graph([...sources, 'node_modules/playwright/index.mjs', 'node_modules/undici/index.js']));
    assert.deepEqual(inputs.sources, sources.sort());
    assert.deepEqual(inputs.dependencies, ['playwright', 'undici']);
  });

  test('rejects unrelated, unresolved, traversing and excessive graph inputs', () => {
    for (const source of ['frontend/src/lib/private.ts', 'cli/private.mts', 'packages/unreviewed-adapter/runtime.mts', 'lib/../outside.mts', 'node_modules/unreviewed/index.js']) {
      assert.throws(() => capturePackageInputs(graph([entry, source])));
    }
    assert.throws(() => capturePackageInputs({ modules: [{ source: entry, dependencies: [{ couldNotResolve: true }] }] }), /could not be resolved/u);
    assert.throws(() => capturePackageInputs(graph(['lib/helper.mts'])), /missing its executable/u);
    assert.throws(() => capturePackageInputs(graph(Array.from({ length: 4097 }, () => entry))), /processing bound/u);
  });

  test('reads external dependencies from resolved edges when the resolver excludes their internals', () => {
    const inputs = capturePackageInputs({ modules: [{ source: entry, dependencies: [
      { module: 'playwright', resolved: 'node_modules/playwright/index.mjs', matchesDoNotFollow: true },
      { module: 'undici', resolved: 'node_modules/undici/index.js', matchesDoNotFollow: true },
    ] }] });
    assert.deepEqual(inputs, { sources: [entry], dependencies: ['playwright', 'undici'] });
    assert.throws(() => capturePackageInputs({ modules: [{ source: entry, dependencies: [{ resolved: 'node_modules/unreviewed/index.js' }] }] }), /Unreviewed/u);
  });

  test('pins the actual runtime closure while preserving the publication guard', () => {
    const manifest = capturePackageManifest(source, lock, ['playwright', 'undici']);
    assert.deepEqual(manifest.dependencies, { playwright: '1.62.1', undici: '8.10.2' });
    assert.equal(manifest.private, true);
    assert.deepEqual(manifest.bin, { 'whoisleuth-capture': 'runtime/packages/web-capture/bin/whoisleuth-capture.mjs' });
    assert.throws(() => capturePackageManifest({ ...source, private: false }, lock, ['playwright', 'undici']), /identity/u);
    assert.throws(() => capturePackageManifest(source, lock, ['playwright']), /actual runtime closure/u);
    assert.throws(() => capturePackageManifest(source, { packages: { ...lock.packages, 'node_modules/playwright': { version: '1.63.0' } } }, ['playwright', 'undici']), /reviewed companion/u);
    assert.throws(() => capturePackageManifest({ ...source, dependencies: { playwright: 'latest', undici: '^8.10.1' } }, lock, ['playwright', 'undici']), /unsupported/u);
  });

  test('requires installed dependency versions and integrity to match the reviewed runtime closure', () => {
    const reviewed = { packages: { 'node_modules/playwright': { version: '1.62.1', integrity: 'sha512-fixture' }, 'node_modules/unrelated': { version: '1.0.0', integrity: 'sha512-other' } } };
    const installed = { packages: { '': {}, 'node_modules/playwright': reviewed.packages['node_modules/playwright'] } };
    assert.equal(assertCaptureInstalledDependencies(installed, reviewed, ['playwright']), 1);
    assert.throws(() => assertCaptureInstalledDependencies({ packages: {} }, reviewed, ['playwright']), /missing/u);
    assert.throws(() => assertCaptureInstalledDependencies({ packages: { 'node_modules/playwright': { version: '1.62.1', integrity: 'sha512-changed' } } }, reviewed, ['playwright']), /reviewed lockfile/u);
    assert.throws(() => assertCaptureInstalledDependencies({ packages: { ...installed.packages, 'node_modules/unrelated': reviewed.packages['node_modules/unrelated'] } }, reviewed, ['playwright']), /reviewed lockfile/u);
  });

  test('checks the companion in both runtime lanes without changing application dependencies', async () => {
    assert.ok(CI_QUALITY_SCRIPTS.includes('capture:package:check'));
    assert.ok(CI_CLI_RUNTIME_SCRIPTS.includes('capture:package:check'));
    const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const frontend = JSON.parse(readFileSync(new URL('../frontend/package.json', import.meta.url), 'utf8'));
    for (const manifest of [root, frontend]) assert.equal(manifest.dependencies?.playwright, undefined);
    const plan = await createVerificationOwnershipPlan(['packages/web-capture/capture.mts']);
    assert.ok(plan.mandatorySpecialisedChecks.includes('capture-package'));
  });
});

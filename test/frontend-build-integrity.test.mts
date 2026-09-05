import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';

import {
  assertFrontendBuildIntegrity,
  cleanFrontendBuildArtifacts,
  FRONTEND_BUILD_INTEGRITY_MARKER,
  frontendProductionChunk,
  parseFrontendBuildIntegritySnapshot,
  recordFrontendBuildIntegrity,
} from '../tools/frontend-build-integrity.mts';
import { createHostedBrowserWorkspace } from '../tools/hosted-browser-workspace.mts';

const REVISION = '0123456789abcdef0123456789abcdef01234567';
const ENVIRONMENT = Object.freeze({ WHOISLEUTH_BUILD_REVISION: REVISION });
const SOURCE_DIRECTORIES = ['cli', 'frontend/src', 'frontend/static', 'lib', 'packages'];
const SOURCE_FILES = [
  '.nvmrc',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'frontend/package.json',
  'frontend/svelte.config.ts',
  'frontend/tsconfig.json',
  'frontend/vite.config.ts',
];

function write(root: string, relative: string, source: string | Buffer): void {
  const filename = path.join(root, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, source);
}

function fixtureRepository(context: { after(callback: () => void): void }): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'whoisleuth-frontend-integrity-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of SOURCE_DIRECTORIES) {
    mkdirSync(path.join(root, directory), { recursive: true });
    write(root, `${directory}/.fixture`, `${directory}\n`);
  }
  for (const relative of SOURCE_FILES) write(root, relative, `${relative}\n`);
  write(root, 'frontend/src/app.ts', 'export const app = true;\n');

  const script = 'console.log("fixture");\n';
  const style = 'body{color:black}\n';
  const html = [
    '<!doctype html>',
    '<link rel="stylesheet" href="./_app/immutable/assets/app.A.css">',
    '<script type="module" src="./_app/immutable/entry/app.A.js"></script>',
    '',
  ].join('\n');
  const redirect = '<script>location.href="/";</script>\n';
  const manifest = {
    'src/app.ts': {
      file: '_app/immutable/entry/app.A.js',
      css: ['_app/immutable/assets/app.A.css'],
    },
  };
  for (const [relative, source] of [
    ['frontend/.svelte-kit/output/client/_app/immutable/entry/app.A.js', script],
    ['frontend/.svelte-kit/output/client/_app/immutable/assets/app.A.css', style],
    ['frontend/.svelte-kit/output/client/.vite/manifest.json', JSON.stringify(manifest)],
    ['frontend/.svelte-kit/output/prerendered/pages/index.html', html],
    ['frontend/.svelte-kit/output/prerendered/pages/redirect.html', redirect],
    ['frontend/build/_app/immutable/entry/app.A.js', script],
    ['frontend/build/_app/immutable/assets/app.A.css', style],
    ['frontend/build/index.html', html],
    ['frontend/build/redirect.html', redirect],
  ] as const) write(root, relative, source);
  return root;
}

function markerObject(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, FRONTEND_BUILD_INTEGRITY_MARKER), 'utf8')) as Record<string, unknown>;
}

function initialiseFixtureCheckout(root: string): void {
  write(root, '.gitignore', [
    'node_modules/',
    'frontend/build/',
    'frontend/build-identity.json',
    'frontend/.svelte-kit/',
    '',
  ].join('\n'));
  mkdirSync(path.join(root, 'node_modules'));
  for (const args of [['init', '--quiet'], ['add', '--all']] as const) {
    const child = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  }
}

describe('frontend build integrity', () => {
  test('records deterministic served bytes and verifies them after an absolute-root move', (context) => {
    const root = fixtureRepository(context);
    const first = recordFrontendBuildIntegrity(root, ENVIRONMENT);
    assert.equal(first.runtime.revision, REVISION);
    assert.equal(first.served.fileCount, 4);
    assert.equal(first.htmlDocuments, 2);
    assert.equal(first.immutableReferences, 2);
    assert.equal(first.browserTestSupport.modules.length, 1);
    assert.equal(frontendProductionChunk(first, 'src/app.ts'), '/_app/immutable/entry/app.A.js');
    assert.deepEqual(assertFrontendBuildIntegrity(root, ENVIRONMENT), first);

    const copied = mkdtempSync(path.join(os.tmpdir(), 'whoisleuth-frontend-integrity-copy-'));
    context.after(() => rmSync(copied, { recursive: true, force: true }));
    cpSync(root, copied, { recursive: true });
    assert.deepEqual(assertFrontendBuildIntegrity(copied, ENVIRONMENT), first);
  });

  test('verifies the exact downloaded artifact without SvelteKit build intermediates', (context) => {
    const root = fixtureRepository(context);
    const retained = recordFrontendBuildIntegrity(root, ENVIRONMENT);
    const artifact = mkdtempSync(path.join(os.tmpdir(), 'whoisleuth-frontend-artifact-only-'));
    context.after(() => rmSync(artifact, { recursive: true, force: true }));

    for (const directory of SOURCE_DIRECTORIES) {
      cpSync(path.join(root, directory), path.join(artifact, directory), { recursive: true });
    }
    for (const relative of SOURCE_FILES) {
      const destination = path.join(artifact, relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(root, relative), destination);
    }
    cpSync(path.join(root, 'frontend/build'), path.join(artifact, 'frontend/build'), { recursive: true });
    cpSync(
      path.join(root, FRONTEND_BUILD_INTEGRITY_MARKER),
      path.join(artifact, FRONTEND_BUILD_INTEGRITY_MARKER),
    );

    assert.equal(existsSync(path.join(artifact, 'frontend/.svelte-kit')), false);
    const verified = assertFrontendBuildIntegrity(artifact, ENVIRONMENT);
    assert.deepEqual(verified, retained);
    assert.equal(frontendProductionChunk(verified, 'src/app.ts'), '/_app/immutable/entry/app.A.js');
  });

  test('materialises local browser verification from only checkout files and declared artefacts', (context) => {
    const root = fixtureRepository(context);
    initialiseFixtureCheckout(root);
    const retained = recordFrontendBuildIntegrity(root, ENVIRONMENT);
    const workspace = createHostedBrowserWorkspace(root, ENVIRONMENT);
    context.after(workspace.dispose);

    assert.equal(workspace.root, realpathSync(workspace.root));
    assert.equal(existsSync(path.join(workspace.root, 'frontend/.svelte-kit')), false);
    assert.equal(existsSync(path.join(workspace.root, 'frontend/build/index.html')), true);
    const verified = assertFrontendBuildIntegrity(workspace.root, {
      WHOISLEUTH_BUILD_REVISION: retained.runtime.revision,
    });
    assert.equal(frontendProductionChunk(verified, 'src/app.ts'), '/_app/immutable/entry/app.A.js');
  });

  test('rejects an aggregate-oversized sparse output before reading file contents', (context) => {
    const root = fixtureRepository(context);
    for (let index = 0; index < 9; index += 1) {
      const relative = `frontend/build/oversized-${index}.bin`;
      const filename = path.join(root, relative);
      write(root, relative, '');
      truncateSync(filename, 32 * 1024 * 1024);
    }
    assert.throws(
      () => recordFrontendBuildIntegrity(root, ENVIRONMENT),
      /aggregate byte limit before content is read/u,
    );
  });

  test('rejects modified, added, and missing served files', (context) => {
    const variants: Array<readonly [string, (root: string) => void]> = [
      ['modified', (root) => write(root, 'frontend/build/index.html', '<p>changed</p>\n')],
      ['added', (root) => write(root, 'frontend/build/unexpected.txt', 'unexpected\n')],
      ['missing', (root) => rmSync(path.join(root, 'frontend/build/index.html'))],
    ];
    for (const [label, mutate] of variants) {
      const root = fixtureRepository(context);
      recordFrontendBuildIntegrity(root, ENVIRONMENT);
      mutate(root);
      assert.throws(
        () => assertFrontendBuildIntegrity(root, ENVIRONMENT),
        /stale or mixed|no prerendered HTML|no immutable asset references/u,
        label,
      );
    }
  });

  test('binds reuse to source bytes, runtime, and source revision', (context) => {
    const root = fixtureRepository(context);
    recordFrontendBuildIntegrity(root, ENVIRONMENT);
    write(root, 'frontend/src/app.ts', 'export const app = false;\n');
    assert.throws(() => assertFrontendBuildIntegrity(root, ENVIRONMENT), /stale or mixed/u);

    write(root, 'frontend/src/app.ts', 'export const app = true;\n');
    assert.throws(
      () => assertFrontendBuildIntegrity(root, { WHOISLEUTH_BUILD_REVISION: 'abcdef0123456789abcdef0123456789abcdef01' }),
      /stale or mixed/u,
    );
  });

  test('rejects malformed, future, oversized, and impossible markers', (context) => {
    const root = fixtureRepository(context);
    recordFrontendBuildIntegrity(root, ENVIRONMENT);
    const retained = markerObject(root);

    assert.throws(() => parseFrontendBuildIntegritySnapshot('{'), /JSON|parse/u);
    assert.throws(
      () => parseFrontendBuildIntegritySnapshot(JSON.stringify({ ...retained, version: 3 })),
      /unsupported format or version/u,
    );
    assert.throws(
      () => parseFrontendBuildIntegritySnapshot(`{"padding":"${'x'.repeat(2 * 1024 * 1024)}"}`),
      /bytes|byte limit/u,
    );

    const invalidBytes = structuredClone(retained) as Record<string, any>;
    invalidBytes.source.files[0].bytes = (32 * 1024 * 1024) + 1;
    assert.throws(() => parseFrontendBuildIntegritySnapshot(JSON.stringify(invalidBytes)), /invalid byte/u);

    const excessiveTotal = structuredClone(retained) as Record<string, any>;
    excessiveTotal.source.files = Array.from({ length: 9 }, (_, index) => ({
      path: `source-${index}.mts`,
      bytes: 32 * 1024 * 1024,
      sha256: '0'.repeat(64),
    }));
    excessiveTotal.source.fileCount = 9;
    excessiveTotal.source.totalBytes = 9 * 32 * 1024 * 1024;
    assert.throws(() => parseFrontendBuildIntegritySnapshot(JSON.stringify(excessiveTotal)), /aggregate byte limit/u);

    const excessiveFiles = structuredClone(retained) as Record<string, any>;
    excessiveFiles.source.files = Array.from({ length: 4_097 }, (_, index) => ({
      path: `f-${String(index).padStart(4, '0')}`,
      bytes: 0,
      sha256: '0'.repeat(64),
    }));
    assert.throws(() => parseFrontendBuildIntegritySnapshot(JSON.stringify(excessiveFiles)), /invalid file inventory/u);

    const missingSupport = structuredClone(retained) as Record<string, any>;
    delete missingSupport.browserTestSupport;
    assert.throws(
      () => parseFrontendBuildIntegritySnapshot(JSON.stringify(missingSupport)),
      /exact fields/u,
    );

    const staleSupport = structuredClone(retained) as Record<string, any>;
    staleSupport.browserTestSupport.modules = [];
    assert.throws(
      () => parseFrontendBuildIntegritySnapshot(JSON.stringify(staleSupport)),
      /browser-test support is malformed/u,
    );

    const mismatchedSupport = structuredClone(retained) as Record<string, any>;
    mismatchedSupport.browserTestSupport.modules[0].output = '_app/immutable/assets/app.A.css';
    assert.throws(
      () => parseFrontendBuildIntegritySnapshot(JSON.stringify(mismatchedSupport)),
      /does not match the declared served build/u,
    );
  });

  test('rejects stale, missing, external, and traversing generated asset references', (context) => {
    const variants: Array<readonly [string, string, RegExp]> = [
      ['stale', '<script src="./_app/immutable/entry/stale.js"></script>\n', /absent from the current Vite manifest/u],
      ['external', '<script src="https://example.invalid/_app/immutable/entry/app.A.js"></script>\n', /non-local immutable asset/u],
      ['traversing', '<script src="../_app/immutable/entry/app.A.js"></script>\n', /safe relative|traverse|outside/u],
      ['missing', '<p>No client entry</p>\n', /contains no immutable asset references/u],
    ];
    for (const [label, html, expected] of variants) {
      const root = fixtureRepository(context);
      write(root, 'frontend/.svelte-kit/output/prerendered/pages/index.html', html);
      write(root, 'frontend/build/index.html', html);
      assert.throws(() => recordFrontendBuildIntegrity(root, ENVIRONMENT), expected, label);
    }
  });

  test('rejects symbolic links in source and generated trees', (context) => {
    for (const relative of ['frontend/src/linked.ts', 'frontend/build/linked.txt']) {
      const root = fixtureRepository(context);
      symlinkSync(path.join(root, 'package.json'), path.join(root, relative));
      assert.throws(() => recordFrontendBuildIntegrity(root, ENVIRONMENT), /rejects symbolic links/u, relative);
    }
  });

  test('removes all reusable build state as one cleanup boundary', (context) => {
    const root = fixtureRepository(context);
    recordFrontendBuildIntegrity(root, ENVIRONMENT);
    cleanFrontendBuildArtifacts(root);
    for (const relative of ['frontend/build', 'frontend/.svelte-kit/output', FRONTEND_BUILD_INTEGRITY_MARKER]) {
      assert.equal(existsSync(path.join(root, relative)), false, relative);
    }
  });
});

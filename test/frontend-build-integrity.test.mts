import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
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
import {
  createHostedBrowserWorkspace,
  HOSTED_BROWSER_DIAGNOSTIC_LIMITS,
  runHostedBrowserWorkspace,
} from '../tools/hosted-browser-workspace.mts';
import { playwrightRunArtifacts } from '../tools/playwright-run-artifacts.mts';

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

function diagnosticWorkspace(context: { after(callback: () => void): void }) {
  const repository = fixtureRepository(context);
  initialiseFixtureCheckout(repository);
  recordFrontendBuildIntegrity(repository, ENVIRONMENT);
  const workspace = createHostedBrowserWorkspace(repository, ENVIRONMENT);
  context.after(workspace.dispose);
  return { repository, workspace };
}

function writeDiagnosticFixture(root: string, environment: NodeJS.ProcessEnv) {
  const artifacts = playwrightRunArtifacts(environment);
  const files = [
    [artifacts.jsonResults, '{"fixture":"result"}\n'],
    [`${artifacts.testResults}/failed-check/trace.zip`, 'fixture trace'],
    [`${artifacts.testResults}/failed-check/test-failed-1.png`, 'fixture screenshot'],
    [`${artifacts.htmlReport}/index.html`, '<p>Fixture report</p>'],
  ] as const;
  for (const [relative, source] of files) write(root, relative, source);
  write(root, artifacts.authFile, '{"fixture":"authentication"}');
  return { artifacts, files };
}

describe('hosted browser workspace diagnostics', () => {
  test('retains available failure and interruption evidence at its original paths after cleanup', async (context) => {
    for (const exit of [2, 130]) {
      const { repository, workspace } = diagnosticWorkspace(context);
      const performance = writeDiagnosticFixture(workspace.root, { WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance' });
      const functional = writeDiagnosticFixture(workspace.root, {
        WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'functional', WHOISLEUTH_PLAYWRIGHT_SHARD: '1/4',
      });
      const messages: string[] = [];
      assert.equal(await runHostedBrowserWorkspace(workspace, async () => exit, () => false, (text) => messages.push(text)), exit);

      for (const [relative, source] of [...performance.files, ...functional.files]) {
        const filename = path.join(workspace.root, relative);
        assert.equal(readFileSync(filename, 'utf8'), source);
        assert.equal(lstatSync(filename).mode & 0o777, 0o600);
      }
      for (const relative of [
        ...SOURCE_DIRECTORIES, 'node_modules', 'package.json', FRONTEND_BUILD_INTEGRITY_MARKER,
        performance.artifacts.authFile, functional.artifacts.authFile,
      ]) assert.equal(existsSync(path.join(workspace.root, relative)), false, relative);
      assert.equal(existsSync(path.join(repository, 'node_modules')), true);
      assert.equal(existsSync(path.join(repository, 'frontend/build/index.html')), true);
      assert.equal(lstatSync(workspace.root).mode & 0o777, 0o700);
      const summary = JSON.parse(readFileSync(path.join(workspace.root, 'diagnostics.json'), 'utf8'));
      assert.equal(summary.revision, REVISION);
      assert.equal(summary.outcome, exit === 130 ? 'interrupted' : 'failed');
      assert.equal(summary.retainedFiles, 8);
      assert.equal(summary.omittedEntries, 0);
      assert.equal(messages.length, 1);
      assert.ok(messages[0]!.includes(workspace.root));
    }
  });

  test('retains diagnostics for thrown validation failures and a signalled interruption', async (context) => {
    const { workspace } = diagnosticWorkspace(context);
    const { files } = writeDiagnosticFixture(workspace.root, { WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance' });
    const failure = new Error('Fixture result validation failed.');
    await assert.rejects(runHostedBrowserWorkspace(workspace, async () => { throw failure; }, () => true, () => {}), (error) => error === failure);
    assert.equal(JSON.parse(readFileSync(path.join(workspace.root, 'diagnostics.json'), 'utf8')).outcome, 'interrupted');
    for (const [relative] of files) assert.equal(existsSync(path.join(workspace.root, relative)), true);
    assert.equal(existsSync(path.join(workspace.root, 'frontend')), false);
  });

  test('removes the complete owned workspace after success and preserves the original checkout', async (context) => {
    const { repository, workspace } = diagnosticWorkspace(context);
    writeDiagnosticFixture(workspace.root, { WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance' });
    assert.equal(await runHostedBrowserWorkspace(workspace, async () => 0, () => false, () => assert.fail('Success must not retain diagnostics.')), 0);
    assert.equal(existsSync(workspace.root), false);
    assert.equal(existsSync(path.join(repository, 'node_modules')), true);
    assert.equal(existsSync(path.join(repository, 'frontend/build/index.html')), true);
  });

  test('does not report success when interruption arrives during final verification', async (context) => {
    const { workspace } = diagnosticWorkspace(context);
    writeDiagnosticFixture(workspace.root, { WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance' });
    const exit = await runHostedBrowserWorkspace(workspace, async () => 0, () => true, () => {});
    assert.equal(exit, 130);
    assert.equal(JSON.parse(readFileSync(path.join(workspace.root, 'diagnostics.json'), 'utf8')).outcome, 'interrupted');
  });

  test('records an early failure honestly when no browser diagnostics were produced', async (context) => {
    const { workspace } = diagnosticWorkspace(context);
    await runHostedBrowserWorkspace(workspace, async () => 2, () => false, () => {});
    const summary = JSON.parse(readFileSync(path.join(workspace.root, 'diagnostics.json'), 'utf8'));
    assert.equal(summary.retainedFiles, 0);
    assert.equal(summary.retainedBytes, 0);
    assert.equal(summary.omittedEntries, 0);
    assert.equal(summary.outcome, 'failed');
  });

  test('bounds retained files and bytes without reading oversized diagnostic contents', (context) => {
    const { workspace } = diagnosticWorkspace(context);
    const artifacts = playwrightRunArtifacts({ WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance' });
    const excessiveFile = path.join(workspace.root, artifacts.testResults, 'oversized.zip');
    write(workspace.root, `${artifacts.testResults}/oversized.zip`, '');
    truncateSync(excessiveFile, HOSTED_BROWSER_DIAGNOSTIC_LIMITS.fileBytes + 1);
    for (let index = 0; index < 3; index += 1) {
      const relative = `${artifacts.testResults}/trace-${index}.zip`;
      write(workspace.root, relative, '');
      truncateSync(path.join(workspace.root, relative), HOSTED_BROWSER_DIAGNOSTIC_LIMITS.fileBytes);
    }
    const retained = workspace.retainDiagnostics('failed');
    assert.equal(existsSync(excessiveFile), false);
    assert.equal(retained.retainedFiles, 2);
    assert.equal(retained.retainedBytes, HOSTED_BROWSER_DIAGNOSTIC_LIMITS.totalBytes);
    assert.equal(retained.omittedEntries, 2);
  });

  test('bounds diagnostic entry counts and depth and removes links without following them', (context) => {
    const { repository, workspace } = diagnosticWorkspace(context);
    const artifacts = playwrightRunArtifacts({ WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance' });
    const external = path.join(repository, 'private-fixture.txt');
    write(repository, 'private-fixture.txt', 'must remain untouched');
    const mode = lstatSync(external).mode;
    mkdirSync(path.join(workspace.root, artifacts.testResults), { recursive: true });
    symlinkSync(repository, path.join(workspace.root, artifacts.testResults, 'external'));
    symlinkSync(path.join(repository, 'missing'), path.join(workspace.root, artifacts.testResults, 'dangling'));
    linkSync(external, path.join(workspace.root, artifacts.testResults, 'hardlink.txt'));
    const deep = `${artifacts.testResults}/${'nested/'.repeat(HOSTED_BROWSER_DIAGNOSTIC_LIMITS.depth)}trace.zip`;
    write(workspace.root, deep, 'too deep');
    for (let index = 0; index < HOSTED_BROWSER_DIAGNOSTIC_LIMITS.entries; index += 1) {
      write(workspace.root, `${artifacts.testResults}/entry-${index}.txt`, '');
    }
    const retained = workspace.retainDiagnostics('interrupted');
    assert.ok(retained.retainedFiles <= HOSTED_BROWSER_DIAGNOSTIC_LIMITS.entries);
    assert.ok(retained.omittedEntries >= 4);
    for (const name of ['external', 'dangling', 'hardlink.txt']) {
      assert.equal(lstatSync(path.join(workspace.root, artifacts.testResults, name), { throwIfNoEntry: false }), undefined);
    }
    assert.equal(existsSync(path.join(workspace.root, deep)), false);
    assert.equal(readFileSync(external, 'utf8'), 'must remain untouched');
    assert.equal(lstatSync(external).mode, mode);
  });

  test('does not erase the workspace if diagnostic retention itself fails', async (context) => {
    const { workspace } = diagnosticWorkspace(context);
    const failure = new Error('Fixture retention failure.');
    await assert.rejects(runHostedBrowserWorkspace({
      ...workspace,
      retainDiagnostics: () => { throw failure; },
      dispose: () => assert.fail('Retention failure must not erase the source evidence.'),
    }, async () => 2, () => false, () => {}), (error) => (
      error instanceof Error && error.cause === failure && error.message.includes(workspace.root)
    ));
    assert.equal(existsSync(workspace.root), true);
  });
});

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

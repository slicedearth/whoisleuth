import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  BROWSER_LOCAL_CHUNK_NAME,
  MAX_FRONTEND_ASSET_BYTES,
  buildFrontendLoadingReport,
  formatFrontendLoadingReport,
  measureFrontendAsset,
  parseGeneratedRouteNodes,
} from '../tools/frontend-loading-report.mts';

const routes = parseGeneratedRouteNodes(`
export const dictionary = {
  "/(public)": [4,[3]],
  "/(console)/dashboard": [5,[2]]
};
`);

function fixtureManifest(publicImports: readonly string[] = ['_shared.js']) {
  return {
    '_start.js': { file: 'start.js', name: 'entry/start', imports: ['_shared.js'] },
    '_app.js': { file: 'app.js', name: 'entry/app', imports: ['_shared.js'] },
    '.svelte-kit/generated/client-optimized/nodes/0.js': {
      file: 'node-0.js',
      imports: ['_shared.js'],
      css: ['root.css'],
    },
    '.svelte-kit/generated/client-optimized/nodes/2.js': {
      file: 'console-layout.js',
      imports: ['_shared.js'],
    },
    '.svelte-kit/generated/client-optimized/nodes/3.js': {
      file: 'public-layout.js',
      imports: publicImports,
    },
    '.svelte-kit/generated/client-optimized/nodes/4.js': {
      file: 'home.js',
      imports: ['_shared.js'],
    },
    '.svelte-kit/generated/client-optimized/nodes/5.js': {
      file: 'dashboard.js',
      imports: ['_shared.js'],
    },
    '_shared.js': { file: 'shared.js', name: 'shared' },
    '_workspace.js': { file: 'workspace.js', name: BROWSER_LOCAL_CHUNK_NAME },
  };
}

function report(publicImports?: readonly string[]) {
  return buildFrontendLoadingReport({
    manifest: fixtureManifest(publicImports),
    routeNodes: routes,
    measureAsset(file) {
      return { file, bytes: file.length * 10, gzipBytes: file.length * 4 };
    },
    routeGzipBudgets: { '/': 1_000, '/dashboard': 1_000 },
  });
}

describe('frontend loading report', () => {
  test('parses route groups and keeps the browser-local workspace outside public routes', () => {
    const result = report();
    assert.equal(result.ready, true);
    assert.equal(result.summary.publicRouteLeak, false);
    assert.equal(result.routes.find((route) => route.path === '/')?.access, 'public');
    assert.equal(result.routes.find((route) => route.path === '/')?.includesBrowserLocalWorkspace, false);
    assert.equal(result.routes.find((route) => route.path === '/dashboard')?.includesBrowserLocalWorkspace, false);
    assert.equal(result.browserLocalWorkspace.file, 'workspace.js');
    assert.equal(result.browserLocalWorkspace.assetCount, 1);
    assert.match(formatFrontendLoadingReport(result), /Public-route exposure: none/);
    assert.match(formatFrontendLoadingReport(result), /Route budgets: within reviewed ceilings/);
  });

  test('fails closed for missing and exceeded route budgets', () => {
    const missing = buildFrontendLoadingReport({
      manifest: fixtureManifest(),
      routeNodes: routes,
      measureAsset(file) {
        return { file, bytes: file.length * 10, gzipBytes: file.length * 4 };
      },
      routeGzipBudgets: { '/': 1_000 },
    });
    assert.equal(missing.ready, false);
    assert.deepEqual(missing.summary.missingBudgetPaths, ['/dashboard']);

    const exceeded = buildFrontendLoadingReport({
      manifest: fixtureManifest(),
      routeNodes: routes,
      measureAsset(file) {
        return { file, bytes: file.length * 10, gzipBytes: file.length * 4 };
      },
      routeGzipBudgets: { '/': 1, '/dashboard': 1_000 },
    });
    assert.equal(exceeded.ready, false);
    assert.deepEqual(exceeded.summary.overBudgetPaths, ['/']);
  });

  test('fails closed when a public layout imports the workspace chunk', () => {
    const result = report(['_workspace.js']);
    assert.equal(result.ready, false);
    assert.equal(result.summary.publicRouteLeak, true);
    assert.equal(result.routes.find((route) => route.path === '/')?.includesBrowserLocalWorkspace, true);
  });

  test('rejects missing and empty generated route dictionaries', () => {
    assert.throws(() => parseGeneratedRouteNodes('export const routes = {};'), /route dictionary/);
    assert.throws(
      () => parseGeneratedRouteNodes(`export const dictionary = {
};`),
      /dictionary is empty/,
    );
  });

  test('rejects unsafe manifest paths and malformed asset measurements', () => {
    const traversal = structuredClone(fixtureManifest());
    traversal['_workspace.js'].file = '../outside.js';
    assert.throws(() => buildFrontendLoadingReport({
      manifest: traversal,
      routeNodes: routes,
      measureAsset: (file) => ({ file, bytes: 1, gzipBytes: 1 }),
      routeGzipBudgets: { '/': 1000, '/dashboard': 1000 },
    }), /safe relative path/iu);

    for (const unsafe of ['\u0085', '\u00ad', '\u034f']) {
      const ambiguous = structuredClone(fixtureManifest());
      ambiguous['_workspace.js'].file = `assets/workspace${unsafe}.js`;
      assert.throws(() => buildFrontendLoadingReport({
        manifest: ambiguous,
        routeNodes: routes,
        measureAsset: (file) => ({ file, bytes: 1, gzipBytes: 1 }),
        routeGzipBudgets: { '/': 1000, '/dashboard': 1000 },
      }), /safe relative path/iu);

      const ambiguousKey: Record<string, { file: string; name?: string; imports?: readonly string[]; css?: readonly string[] }> = structuredClone(fixtureManifest());
      ambiguousKey[`_workspace${unsafe}.js`] = ambiguousKey['_workspace.js']!;
      delete ambiguousKey['_workspace.js'];
      assert.throws(() => buildFrontendLoadingReport({
        manifest: ambiguousKey,
        routeNodes: routes,
        measureAsset: (file) => ({ file, bytes: 1, gzipBytes: 1 }),
        routeGzipBudgets: { '/': 1000, '/dashboard': 1000 },
      }), /control-free text/iu);

      const ambiguousName = structuredClone(fixtureManifest());
      ambiguousName['_workspace.js'].name = `workspace${unsafe}`;
      assert.throws(() => buildFrontendLoadingReport({
        manifest: ambiguousName,
        routeNodes: routes,
        measureAsset: (file) => ({ file, bytes: 1, gzipBytes: 1 }),
        routeGzipBudgets: { '/': 1000, '/dashboard': 1000 },
      }), /control-free text/iu);
    }

    assert.throws(() => buildFrontendLoadingReport({
      manifest: fixtureManifest(),
      routeNodes: routes,
      measureAsset: (file) => ({ file: `${file}.changed`, bytes: 1, gzipBytes: 1 }),
      routeGzipBudgets: { '/': 1000, '/dashboard': 1000 },
    }), /measurement/iu);
  });

  test('bounds cyclic import graphs and measures each repeated asset once', () => {
    const base = fixtureManifest();
    const shared = base['_shared.js'];
    if (!shared) throw new Error('Shared asset fixture is missing.');
    const manifest = {
      ...base,
      '_shared.js': { ...shared, imports: ['_shared.js'] },
    };
    const calls = new Map<string, number>();
    const result = buildFrontendLoadingReport({
      manifest,
      routeNodes: routes,
      measureAsset(file) {
        calls.set(file, (calls.get(file) ?? 0) + 1);
        return { file, bytes: 10, gzipBytes: 5 };
      },
      routeGzipBudgets: { '/': 1000, '/dashboard': 1000 },
    });
    assert.equal(result.ready, true);
    assert.ok([...calls.values()].every((count) => count === 1));
  });

  test('confines bounded asset reads to regular files beneath the client root', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-loading-assets-'));
    const clientRoot = path.join(directory, 'client');
    const outside = path.join(directory, 'outside.js');
    try {
      await mkdir(clientRoot, { recursive: true });
      await writeFile(path.join(clientRoot, 'inside.js'), 'export const value = 1;\n', 'utf8');
      await writeFile(outside, 'private outside fixture\n', 'utf8');
      assert.ok(measureFrontendAsset(clientRoot, 'inside.js').gzipBytes > 0);
      assert.throws(() => measureFrontendAsset(clientRoot, '../outside.js'), /safe relative path/iu);

      await symlink(outside, path.join(clientRoot, 'linked.js'));
      assert.throws(() => measureFrontendAsset(clientRoot, 'linked.js'), /outside the client root|ELOOP/iu);

      const oversized = path.join(clientRoot, 'oversized.js');
      await writeFile(oversized, 'x', 'utf8');
      await truncate(oversized, MAX_FRONTEND_ASSET_BYTES + 1);
      assert.throws(() => measureFrontendAsset(clientRoot, 'oversized.js'), /byte limit/iu);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

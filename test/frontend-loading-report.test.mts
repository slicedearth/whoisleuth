import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { describe, test } from 'node:test';

import {
  BROWSER_LOCAL_CHUNK_NAME,
  buildFrontendLoadingReport,
  formatFrontendLoadingReport,
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
      imports: ['_workspace.js'],
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
      imports: ['_workspace.js'],
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
    assert.equal(
      result.routes.find((route) => route.path === '/dashboard')?.includesBrowserLocalWorkspace,
      true,
    );
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
});

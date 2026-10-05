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
  readFrontendRouteNodes,
  previousFrontendRouteMeasurements,
  main,
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
    assert.match(formatFrontendLoadingReport(result), /current measurements only/);
  });

  test('measures new routes without registration and reports growth without changing correctness', () => {
    const result = buildFrontendLoadingReport({
      manifest: fixtureManifest(),
      routeNodes: [...routes, { routeKey: '/(public)/new-guide', pageNode: 4, layoutNodes: [3] }],
      measureAsset: file => ({ file, bytes: 2_000, gzipBytes: 1_024 }),
      previousRoutes: { '/': 1_024, '/dashboard': 20_480, '/removed': 1_024 },
    });
    assert.equal(result.ready, true);
    assert.equal(result.routes.find(route => route.path === '/new-guide')?.gzipBytes, 7_168);
    assert.equal(result.routes.find(route => route.path === '/new-guide')?.previousGzipBytes, null);
    assert.equal(result.routes.find(route => route.path === '/')?.changeGzipBytes, 6_144);
    assert.equal(result.routes.find(route => route.path === '/dashboard')?.changeGzipBytes, -13_312);
    assert.deepEqual(result.summary.removedRoutes, ['/removed']);
    const text = formatFrontendLoadingReport(result);
    assert.match(text, /all changes shown/);
    assert.match(text, /\+6\.00/);
    assert.match(text, /-13\.00/);
    assert.match(text, /\/new-guide\s+public\s+7\.00\s+new/);
  });

  test('rejects malformed comparison measurements', () => {
    for (const previousRoutes of [{ '/': -1 }, { '/': Infinity }, { '/': 0.5 }, { 'bad': 1 }]) {
      assert.throws(() => buildFrontendLoadingReport({ manifest: fixtureManifest(), routeNodes: routes,
        measureAsset: file => ({ file, bytes: 1, gzipBytes: 1 }), previousRoutes }), /Previous route measurements/);
    }
  });

  test('round-trips measured reports and rejects ambiguous or unsupported comparisons', () => {
    const value = report();
    assert.deepEqual(previousFrontendRouteMeasurements(JSON.parse(JSON.stringify(value))),
      Object.fromEntries(value.routes.map(route => [route.path, route.gzipBytes])));
    for (const invalid of [null, [], {}, { ...value, version: value.version + 1 },
      { ...value, routes: [...value.routes, value.routes[0]] },
      { ...value, routes: [{ path: '/', gzipBytes: -1 }] }]) {
      assert.throws(() => previousFrontendRouteMeasurements(invalid));
    }
  });

  test('rejects invalid arguments before requiring a build', () => {
    for (const args of [['--unknown'], ['--json', '--json'], ['--compare='], ['--compare=a', '--compare=b']]) {
      let error = '';
      assert.equal(main({ write() { assert.fail('No report should be emitted.'); } }, { write(value) { error += value; } }, args), 2);
      assert.match(error, /Usage:/);
    }
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

  test('includes root-only and server-loaded routes without silently omitting unsupported tuples', () => {
    assert.deepEqual(parseGeneratedRouteNodes(`export const dictionary = {
      "/404": [26],
      "/(public)/review": [~27,[,3],[,1]]
    };`), [
      { routeKey: '/404', pageNode: 26, layoutNodes: [] },
      { routeKey: '/(public)/review', pageNode: 27, layoutNodes: [3] },
    ]);
    assert.throws(() => parseGeneratedRouteNodes(`export const dictionary = {
      "/(public)": [4,[3]],
      "/missing": unexpected
    };`), /unsupported route tuple/);
    const manifest = fixtureManifest();
    const result = buildFrontendLoadingReport({
      manifest: { ...manifest, '_app.js': { ...manifest['_app.js'], imports: ['_workspace.js'] } },
      routeNodes: [
        { routeKey: '/404', pageNode: 4, layoutNodes: [] },
        { routeKey: '/(public)/docs(console)', pageNode: 4, layoutNodes: [3] },
      ],
      measureAsset: file => ({ file, bytes: 10, gzipBytes: 5 }),
    });
    assert.equal(result.routes[0]?.access, 'public');
    assert.equal(result.routes.find(route => route.path === '/docs(console)')?.access, 'public');
    assert.equal(result.ready, false);
    assert.equal(result.summary.publicRouteLeak, true);
  });

  test('reads only the current manifest entry after a clean build or beside stale generated output', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-loading-routes-'));
    const current = '.svelte-kit/generated/build/client-optimized/app.js';
    const stale = '.svelte-kit/generated/client/app.js';
    const manifest = { [current]: { file: 'app.js', name: 'entry/app' } };
    try {
      await mkdir(path.dirname(path.join(directory, current)), { recursive: true });
      await writeFile(path.join(directory, current), 'export const dictionary = {"/(public)/current": [4,[3]]};');
      const expected = [{ routeKey: '/(public)/current', pageNode: 4, layoutNodes: [3] }];
      assert.deepEqual(readFrontendRouteNodes(directory, manifest), expected);
      await mkdir(path.dirname(path.join(directory, stale)), { recursive: true });
      await writeFile(path.join(directory, stale), 'export const dictionary = {"/(public)/stale": [8,[3]]};');
      assert.deepEqual(readFrontendRouteNodes(directory, manifest), expected);
      assert.throws(() => readFrontendRouteNodes(directory, {}), /exactly one application entry/);
      assert.throws(() => readFrontendRouteNodes(directory, { ...manifest, [stale]: manifest[current] }), /exactly one application entry/);
      await rm(path.join(directory, current));
      assert.throws(() => readFrontendRouteNodes(directory, manifest), /ENOENT/);
      await writeFile(path.join(directory, 'outside.js'), 'export const dictionary = {"/outside": [4]};');
      assert.throws(() => readFrontendRouteNodes(directory, { 'outside.js': manifest[current] }), /outside the generated root/);
      assert.throws(() => readFrontendRouteNodes(directory, { '../outside.js': manifest[current] }), /safe relative path/);
      await symlink(path.join(directory, 'outside.js'), path.join(directory, current));
      assert.throws(() => readFrontendRouteNodes(directory, manifest), /outside the generated root/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects unsafe manifest paths and malformed asset measurements', () => {
    const traversal = structuredClone(fixtureManifest());
    traversal['_workspace.js'].file = '../outside.js';
    assert.throws(() => buildFrontendLoadingReport({
      manifest: traversal,
      routeNodes: routes,
      measureAsset: (file) => ({ file, bytes: 1, gzipBytes: 1 }),
    }), /safe relative path/iu);

    for (const unsafe of ['\u0085', '\u00ad', '\u034f']) {
      const ambiguous = structuredClone(fixtureManifest());
      ambiguous['_workspace.js'].file = `assets/workspace${unsafe}.js`;
      assert.throws(() => buildFrontendLoadingReport({
        manifest: ambiguous,
        routeNodes: routes,
        measureAsset: (file) => ({ file, bytes: 1, gzipBytes: 1 }),
      }), /safe relative path/iu);

      const ambiguousKey: Record<string, { file: string; name?: string; imports?: readonly string[]; css?: readonly string[] }> = structuredClone(fixtureManifest());
      ambiguousKey[`_workspace${unsafe}.js`] = ambiguousKey['_workspace.js']!;
      delete ambiguousKey['_workspace.js'];
      assert.throws(() => buildFrontendLoadingReport({
        manifest: ambiguousKey,
        routeNodes: routes,
        measureAsset: (file) => ({ file, bytes: 1, gzipBytes: 1 }),
      }), /control-free text/iu);

      const ambiguousName = structuredClone(fixtureManifest());
      ambiguousName['_workspace.js'].name = `workspace${unsafe}`;
      assert.throws(() => buildFrontendLoadingReport({
        manifest: ambiguousName,
        routeNodes: routes,
        measureAsset: (file) => ({ file, bytes: 1, gzipBytes: 1 }),
      }), /control-free text/iu);
    }

    assert.throws(() => buildFrontendLoadingReport({
      manifest: fixtureManifest(),
      routeNodes: routes,
      measureAsset: (file) => ({ file: `${file}.changed`, bytes: 1, gzipBytes: 1 }),
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

#!/usr/bin/env node

// Post-build, target-free loading report. It measures static client assets from
// the generated Vite manifest and proves that browser-local workspace code does
// not enter public-route dependency closures. It performs no browser request.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

type WritableLike = { write(value: string): unknown };
type ManifestEntry = Readonly<{
  file: string;
  name?: string;
  imports?: readonly string[];
  css?: readonly string[];
}>;
type Manifest = Readonly<Record<string, ManifestEntry>>;
type RouteNode = Readonly<{
  routeKey: string;
  pageNode: number;
  layoutNodes: readonly number[];
}>;
type AssetMeasurement = Readonly<{
  file: string;
  bytes: number;
  gzipBytes: number;
}>;

export type FrontendLoadingReportInput = Readonly<{
  manifest: Manifest;
  routeNodes: readonly RouteNode[];
  measureAsset: (file: string) => AssetMeasurement;
}>;

export const FRONTEND_LOADING_REPORT_SCHEMA = 'whoisleuth.frontend-loading-report';
export const FRONTEND_LOADING_REPORT_VERSION = 1;
export const BROWSER_LOCAL_CHUNK_NAME = 'browser-local-data-service';

function publicPath(routeKey: string): string {
  const value = routeKey.replace(/\/\([^/]+\)/gu, '');
  return value || '/';
}

function nodeKey(manifest: Manifest, node: number): string {
  const suffix = `/nodes/${node}.js`;
  const key = Object.keys(manifest).find((candidate) => candidate.endsWith(suffix));
  if (!key) throw new Error(`Client manifest is missing route node ${node}.`);
  return key;
}

function entryKeys(manifest: Manifest): string[] {
  return Object.entries(manifest)
    .filter(([, entry]) => entry.name === 'entry/start' || entry.name === 'entry/app')
    .map(([key]) => key);
}

function dependencyKeys(manifest: Manifest, roots: readonly string[]): Set<string> {
  const visited = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const key = queue.shift();
    if (!key || visited.has(key)) continue;
    const entry = manifest[key];
    if (!entry) throw new Error(`Client manifest references missing import ${key}.`);
    visited.add(key);
    queue.push(...(entry.imports ?? []));
  }
  return visited;
}

function routeAssets(
  manifest: Manifest,
  route: RouteNode,
  measureAsset: (file: string) => AssetMeasurement,
) {
  const roots = [
    ...entryKeys(manifest),
    nodeKey(manifest, 0),
    ...route.layoutNodes.map((node) => nodeKey(manifest, node)),
    nodeKey(manifest, route.pageNode),
  ];
  const entries = dependencyKeys(manifest, roots);
  const files = new Set<string>();
  for (const key of entries) {
    const entry = manifest[key];
    if (!entry) continue;
    files.add(entry.file);
    for (const css of entry.css ?? []) files.add(css);
  }
  const assets = [...files].sort().map(measureAsset);
  return {
    assets,
    bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    gzipBytes: assets.reduce((sum, asset) => sum + asset.gzipBytes, 0),
  };
}

export function parseGeneratedRouteNodes(source: string): RouteNode[] {
  const match = source.match(/export const dictionary = \{([\s\S]*?)\};/u);
  if (!match) throw new Error('Could not find the generated client route dictionary.');
  const dictionary = match[1] ?? '';
  const routes: RouteNode[] = [];
  const pattern = /"([^"]+)": \[(\d+),\[([^\]]*)\]\]/gu;
  for (const match of dictionary.matchAll(pattern)) {
    const routeKey = match[1];
    const pageNode = Number(match[2]);
    if (!routeKey || !Number.isInteger(pageNode)) continue;
    const layoutNodes = (match[3] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number);
    if (layoutNodes.some((node) => !Number.isInteger(node))) {
      throw new Error(`Generated route ${routeKey} has an invalid layout node.`);
    }
    routes.push(Object.freeze({ routeKey, pageNode, layoutNodes: Object.freeze(layoutNodes) }));
  }
  if (!routes.length) throw new Error('Generated client route dictionary is empty.');
  return routes;
}

export function buildFrontendLoadingReport(input: FrontendLoadingReportInput) {
  const browserLocalEntry = Object.entries(input.manifest)
    .find(([, entry]) => entry.name === BROWSER_LOCAL_CHUNK_NAME);
  if (!browserLocalEntry) throw new Error('Client manifest is missing the browser-local workspace chunk.');
  const browserLocalFile = browserLocalEntry[1].file;
  const routes = input.routeNodes
    .map((route) => {
      const measured = routeAssets(input.manifest, route, input.measureAsset);
      return Object.freeze({
        path: publicPath(route.routeKey),
        access: route.routeKey.includes('(public)') ? 'public' as const : 'protected' as const,
        assetCount: measured.assets.length,
        bytes: measured.bytes,
        gzipBytes: measured.gzipBytes,
        includesBrowserLocalWorkspace: measured.assets.some((asset) => asset.file === browserLocalFile),
      });
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const publicRoutes = routes.filter((route) => route.access === 'public');
  const protectedRoutes = routes.filter((route) => route.access === 'protected');
  const browserLocalWorkspace = input.measureAsset(browserLocalFile);
  const publicRouteLeak = publicRoutes.some((route) => route.includesBrowserLocalWorkspace);
  return Object.freeze({
    schema: FRONTEND_LOADING_REPORT_SCHEMA,
    version: FRONTEND_LOADING_REPORT_VERSION,
    mode: 'post_build_static_manifest',
    ready: !publicRouteLeak,
    browserLocalWorkspace,
    summary: Object.freeze({
      publicRoutes: publicRoutes.length,
      protectedRoutes: protectedRoutes.length,
      publicRouteLeak,
      largestPublicRouteGzipBytes: Math.max(0, ...publicRoutes.map((route) => route.gzipBytes)),
      largestProtectedRouteGzipBytes: Math.max(0, ...protectedRoutes.map((route) => route.gzipBytes)),
    }),
    routes: Object.freeze(routes),
    limitations: Object.freeze([
      'Sizes are per-file gzip estimates from one production build, not measured network timings.',
      'The report models initial static route dependencies and excludes later user-triggered dynamic imports.',
      'A large protected chunk alone does not justify splitting it; run npm run frontend:authenticated-loading-report before changing its boundaries.',
    ]),
  });
}

export function formatFrontendLoadingReport(report: ReturnType<typeof buildFrontendLoadingReport>): string {
  const lines = [
    'Frontend loading report',
    `Browser-local workspace: ${(report.browserLocalWorkspace.gzipBytes / 1024).toFixed(2)} KiB gzip`,
    `Public-route exposure: ${report.summary.publicRouteLeak ? 'FAILED' : 'none'}`,
    '',
    'Route                         Access      Gzip KiB  Workspace',
  ];
  for (const route of report.routes) {
    lines.push(
      `${route.path.padEnd(29)} ${route.access.padEnd(11)} ${(route.gzipBytes / 1024).toFixed(2).padStart(8)}  ${route.includesBrowserLocalWorkspace ? 'yes' : 'no'}`,
    );
  }
  lines.push('', ...report.limitations);
  return `${lines.join('\n')}\n`;
}

export function main(
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
): number {
  try {
    const frontend = path.resolve('frontend');
    const clientRoot = path.join(frontend, '.svelte-kit/output/client');
    const manifest = JSON.parse(
      readFileSync(path.join(clientRoot, '.vite/manifest.json'), 'utf8'),
    ) as Manifest;
    const routeNodes = parseGeneratedRouteNodes(
      readFileSync(path.join(frontend, '.svelte-kit/generated/client/app.js'), 'utf8'),
    );
    const report = buildFrontendLoadingReport({
      manifest,
      routeNodes,
      measureAsset(file) {
        const absolute = path.join(clientRoot, file);
        const bytes = statSync(absolute).size;
        const gzipBytes = gzipSync(readFileSync(absolute)).byteLength;
        return Object.freeze({ file, bytes, gzipBytes });
      },
    });
    output.write(formatFrontendLoadingReport(report));
    return report.ready ? 0 : 1;
  } catch (error) {
    errors.write(`${error instanceof Error ? error.message : 'Frontend loading report failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

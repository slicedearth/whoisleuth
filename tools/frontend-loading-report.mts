#!/usr/bin/env node

// Post-build, target-free loading report. It measures static client assets from
// the generated Vite manifest and proves that browser-local workspace code does
// not enter public-route dependency closures. It performs no browser request.

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseBoundedJsonObject } from '../lib/bounded-json.mts';
import {
  boundedSafeRelativePath,
  compareCodeUnits,
  hasMaintainerUnsafeCharacters,
  pathIsWithin,
} from './maintainer-tool-helpers.mts';

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
  routeGzipBudgets?: Readonly<Record<string, number>>;
}>;

export const FRONTEND_LOADING_REPORT_SCHEMA = 'whoisleuth.frontend-loading-report';
export const FRONTEND_LOADING_REPORT_VERSION = 1;
export const BROWSER_LOCAL_CHUNK_NAME = 'browser-local-data-definitions';
export const MAX_FRONTEND_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_FRONTEND_ROUTE_SOURCE_BYTES = 512 * 1024;
export const MAX_FRONTEND_MANIFEST_ENTRIES = 4096;
export const MAX_FRONTEND_ROUTES = 256;
export const MAX_FRONTEND_LAYOUT_NODES_PER_ROUTE = 32;
export const MAX_FRONTEND_IMPORTS_PER_ENTRY = 256;
export const MAX_FRONTEND_CSS_PER_ENTRY = 64;
export const MAX_FRONTEND_GRAPH_EDGES = 16_384;
export const MAX_FRONTEND_ASSETS = 2048;
export const MAX_FRONTEND_ASSET_BYTES = 16 * 1024 * 1024;
export const MAX_FRONTEND_TOTAL_ASSET_BYTES = 64 * 1024 * 1024;
const kibibytes = (value: number) => value * 1024;

function boundedManifestKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024 || hasMaintainerUnsafeCharacters(value)) {
    throw new TypeError(`${label} must be bounded control-free text.`);
  }
  return value;
}

function boundedStringArray(value: unknown, label: string, maximum: number, paths = false): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} exceeds its item limit.`);
  }
  return value.map((item, index) => paths
    ? boundedSafeRelativePath(item, `${label} item ${index + 1}`, 1024)
    : boundedManifestKey(item, `${label} item ${index + 1}`));
}

function validateManifest(value: unknown): Manifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Client manifest must be an object.');
  }
  const raw = value as Record<string, unknown>;
  const entries = Object.entries(raw);
  if (entries.length < 1 || entries.length > MAX_FRONTEND_MANIFEST_ENTRIES) {
    throw new TypeError('Client manifest exceeds its entry limit.');
  }
  const manifest: Record<string, ManifestEntry> = {};
  for (const [rawKey, rawEntry] of entries) {
    const key = boundedManifestKey(rawKey, 'Client manifest key');
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new TypeError(`Client manifest entry ${key} must be an object.`);
    }
    const entry = rawEntry as Record<string, unknown>;
    const file = boundedSafeRelativePath(entry.file, `Client manifest entry ${key} file`, 1024);
    const name = entry.name === undefined
      ? undefined
      : boundedManifestKey(entry.name, `Client manifest entry ${key} name`);
    manifest[key] = Object.freeze({
      file,
      ...(name === undefined ? {} : { name }),
      imports: Object.freeze(boundedStringArray(
        entry.imports,
        `Client manifest entry ${key} imports`,
        MAX_FRONTEND_IMPORTS_PER_ENTRY,
      )),
      css: Object.freeze(boundedStringArray(
        entry.css,
        `Client manifest entry ${key} CSS assets`,
        MAX_FRONTEND_CSS_PER_ENTRY,
        true,
      )),
    });
  }
  return Object.freeze(manifest);
}

// Reviewed against three clean production builds on 2026-08-24. Each ceiling
// is the largest observed gzip total plus 15% regression headroom, rounded up
// to the next 5 KiB. They are tripwires, not performance targets or network
// guarantees.
export const FRONTEND_ROUTE_BUDGET_BASIS = Object.freeze({
  measuredBuilds: 3,
  reviewedOn: '2026-08-24',
  headroomPercent: 15,
  roundingKibibytes: 5,
});

export const FRONTEND_ROUTE_GZIP_OBSERVED_MAX_KIBIBYTES: Readonly<Record<string, number>> = Object.freeze({
  '/': 85.5,
  '/brands': 325.63,
  '/bulk': 381.51,
  '/cli': 82.98,
  '/contact': 71.52,
  '/coverage': 74.74,
  '/dashboard': 100.09,
  '/demo': 225.34,
  '/discover': 322.79,
  '/examples': 73.81,
  '/guide': 66.19,
  '/login': 68.78,
  '/lookup': 492.16,
  '/methodology': 72.42,
  '/monitor': 454.16,
  '/privacy': 73.75,
  '/registry-support': 112.57,
  '/request-policy': 69.13,
  '/resources': 85.63,
  '/resources/[slug]': 72.61,
  '/terms': 68.94,
});

export function deriveFrontendRouteGzipBudgets(
  observed: Readonly<Record<string, number>> = FRONTEND_ROUTE_GZIP_OBSERVED_MAX_KIBIBYTES,
): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(Object.entries(observed).map(([route, maximum]) => {
    if (!Number.isFinite(maximum) || maximum <= 0) throw new TypeError(`Observed route maximum for ${route} must be positive.`);
    const withHeadroom = maximum * (1 + FRONTEND_ROUTE_BUDGET_BASIS.headroomPercent / 100);
    const rounded = Math.ceil(withHeadroom / FRONTEND_ROUTE_BUDGET_BASIS.roundingKibibytes)
      * FRONTEND_ROUTE_BUDGET_BASIS.roundingKibibytes;
    return [route, kibibytes(rounded)];
  })));
}

export const FRONTEND_ROUTE_GZIP_BUDGETS = deriveFrontendRouteGzipBudgets();

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
  let edges = 0;
  while (queue.length) {
    const key = queue.shift();
    if (!key || visited.has(key)) continue;
    const entry = manifest[key];
    if (!entry) throw new Error(`Client manifest references missing import ${key}.`);
    visited.add(key);
    if (visited.size > MAX_FRONTEND_MANIFEST_ENTRIES) {
      throw new Error('Client manifest dependency graph exceeds its node limit.');
    }
    const imports = entry.imports ?? [];
    edges += imports.length;
    if (edges > MAX_FRONTEND_GRAPH_EDGES) {
      throw new Error('Client manifest dependency graph exceeds its edge limit.');
    }
    queue.push(...imports);
  }
  return visited;
}

function dependencyAssets(
  manifest: Manifest,
  roots: readonly string[],
  measureAsset: (file: string) => AssetMeasurement,
) {
  const entries = dependencyKeys(manifest, roots);
  const files = new Set<string>();
  for (const key of entries) {
    const entry = manifest[key];
    if (!entry) continue;
    files.add(entry.file);
    for (const css of entry.css ?? []) files.add(css);
  }
  const assets = [...files].sort(compareCodeUnits).map((file) => {
    const measurement = measureAsset(file);
    if (measurement.file !== file) {
      throw new TypeError(`Frontend asset measurement for ${file} changed the asset identity.`);
    }
    return measurement;
  });
  if (assets.length > MAX_FRONTEND_ASSETS) {
    throw new TypeError('Frontend route asset set exceeds its item limit.');
  }
  let bytes = 0;
  let gzipBytes = 0;
  for (const asset of assets) {
    if (asset.file.length < 1
      || asset.file.length > 1024
      || !Number.isSafeInteger(asset.bytes)
      || asset.bytes < 0
      || asset.bytes > MAX_FRONTEND_ASSET_BYTES
      || !Number.isSafeInteger(asset.gzipBytes)
      || asset.gzipBytes < 0
      || asset.gzipBytes > MAX_FRONTEND_ASSET_BYTES + 1024) {
      throw new TypeError(`Frontend asset measurement for ${asset.file || 'unknown'} is invalid.`);
    }
    bytes += asset.bytes;
    gzipBytes += asset.gzipBytes;
    if (bytes > MAX_FRONTEND_TOTAL_ASSET_BYTES || gzipBytes > MAX_FRONTEND_TOTAL_ASSET_BYTES) {
      throw new TypeError('Frontend route asset total exceeds its byte limit.');
    }
  }
  return {
    assets,
    bytes,
    gzipBytes,
  };
}

function routeAssets(
  manifest: Manifest,
  route: RouteNode,
  measureAsset: (file: string) => AssetMeasurement,
) {
  return dependencyAssets(manifest, [
    ...entryKeys(manifest),
    nodeKey(manifest, 0),
    ...route.layoutNodes.map((node) => nodeKey(manifest, node)),
    nodeKey(manifest, route.pageNode),
  ], measureAsset);
}

export function parseGeneratedRouteNodes(source: string): RouteNode[] {
  if (typeof source !== 'string'
    || Buffer.byteLength(source, 'utf8') < 1
    || Buffer.byteLength(source, 'utf8') > MAX_FRONTEND_ROUTE_SOURCE_BYTES) {
    throw new TypeError('Generated client route source exceeds its byte limit.');
  }
  const match = source.match(/export const dictionary = \{([\s\S]*?)\};/u);
  if (!match) throw new Error('Could not find the generated client route dictionary.');
  const dictionary = match[1] ?? '';
  const routes: RouteNode[] = [];
  const pattern = /"([^"]+)": \[(\d+),\[([^\]]*)\]\]/gu;
  for (const match of dictionary.matchAll(pattern)) {
    const routeKey = match[1] === undefined
      ? ''
      : boundedManifestKey(match[1], 'Generated route key');
    const pageNode = Number(match[2]);
    if (!routeKey || !Number.isInteger(pageNode)) continue;
    const layoutNodes = (match[3] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number);
    if (layoutNodes.length > MAX_FRONTEND_LAYOUT_NODES_PER_ROUTE) {
      throw new Error(`Generated route ${routeKey} exceeds its layout-node limit.`);
    }
    if (layoutNodes.some((node) => !Number.isInteger(node))) {
      throw new Error(`Generated route ${routeKey} has an invalid layout node.`);
    }
    routes.push(Object.freeze({ routeKey, pageNode, layoutNodes: Object.freeze(layoutNodes) }));
    if (routes.length > MAX_FRONTEND_ROUTES) {
      throw new Error('Generated client route dictionary exceeds its route limit.');
    }
  }
  if (!routes.length) throw new Error('Generated client route dictionary is empty.');
  if (new Set(routes.map((route) => route.routeKey)).size !== routes.length) {
    throw new Error('Generated client route dictionary contains duplicate route keys.');
  }
  return routes;
}

export function buildFrontendLoadingReport(input: FrontendLoadingReportInput) {
  const manifest = validateManifest(input.manifest);
  if (!Array.isArray(input.routeNodes) || input.routeNodes.length < 1 || input.routeNodes.length > MAX_FRONTEND_ROUTES) {
    throw new TypeError('Frontend route inventory exceeds its item limit.');
  }
  const routePaths = input.routeNodes.map((route) => publicPath(route.routeKey));
  if (new Set(routePaths).size !== routePaths.length) {
    throw new TypeError('Frontend route inventory contains duplicate public paths.');
  }
  const browserLocalEntry = Object.entries(manifest)
    .find(([, entry]) => entry.name === BROWSER_LOCAL_CHUNK_NAME);
  if (!browserLocalEntry) throw new Error('Client manifest is missing the browser-local workspace chunk.');
  const browserLocalFile = browserLocalEntry[1].file;
  const measurementCache = new Map<string, AssetMeasurement>();
  let aggregateMeasuredBytes = 0;
  const measureAsset = (file: string): AssetMeasurement => {
    const cached = measurementCache.get(file);
    if (cached) return cached;
    if (measurementCache.size >= MAX_FRONTEND_ASSETS) {
      throw new TypeError('Frontend report exceeds its unique-asset limit.');
    }
    const measured = input.measureAsset(file);
    if (measured.file !== file
      || !Number.isSafeInteger(measured.bytes)
      || measured.bytes < 0
      || measured.bytes > MAX_FRONTEND_ASSET_BYTES
      || !Number.isSafeInteger(measured.gzipBytes)
      || measured.gzipBytes < 0
      || measured.gzipBytes > MAX_FRONTEND_ASSET_BYTES + 1024) {
      throw new TypeError(`Frontend asset measurement for ${file} is invalid.`);
    }
    aggregateMeasuredBytes += measured.bytes;
    if (aggregateMeasuredBytes > MAX_FRONTEND_TOTAL_ASSET_BYTES) {
      throw new TypeError('Frontend report exceeds its aggregate asset-byte limit.');
    }
    measurementCache.set(file, measured);
    return measured;
  };
  const budgets = input.routeGzipBudgets ?? FRONTEND_ROUTE_GZIP_BUDGETS;
  const routes = input.routeNodes
    .map((route) => {
      if (!Number.isSafeInteger(route.pageNode)
        || !Array.isArray(route.layoutNodes)
        || route.layoutNodes.length > MAX_FRONTEND_LAYOUT_NODES_PER_ROUTE
        || route.layoutNodes.some((node: number) => !Number.isSafeInteger(node))) {
        throw new TypeError(`Frontend route ${route.routeKey} has an invalid node contract.`);
      }
      const measured = routeAssets(manifest, route, measureAsset);
      const path = publicPath(route.routeKey);
      const configuredBudget = budgets[path];
      const budgetGzipBytes = Number.isSafeInteger(configuredBudget) && (configuredBudget ?? 0) > 0
        ? configuredBudget as number
        : null;
      return Object.freeze({
        path,
        access: route.routeKey.includes('(public)') ? 'public' as const : 'protected' as const,
        assetCount: measured.assets.length,
        bytes: measured.bytes,
        gzipBytes: measured.gzipBytes,
        budgetGzipBytes,
        overBudget: budgetGzipBytes === null || measured.gzipBytes > budgetGzipBytes,
        includesBrowserLocalWorkspace: measured.assets.some((asset) => asset.file === browserLocalFile),
      });
    })
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  const publicRoutes = routes.filter((route) => route.access === 'public');
  const protectedRoutes = routes.filter((route) => route.access === 'protected');
  const browserLocalAssets = dependencyAssets(manifest, [browserLocalEntry[0]], measureAsset);
  const browserLocalWorkspace = Object.freeze({
    file: browserLocalFile,
    assetCount: browserLocalAssets.assets.length,
    bytes: browserLocalAssets.bytes,
    gzipBytes: browserLocalAssets.gzipBytes,
  });
  const publicRouteLeak = publicRoutes.some((route) => route.includesBrowserLocalWorkspace);
  const missingBudgetPaths = routes.filter((route) => route.budgetGzipBytes === null).map((route) => route.path);
  const overBudgetPaths = routes
    .filter((route) => route.budgetGzipBytes !== null && route.overBudget)
    .map((route) => route.path);
  return Object.freeze({
    schema: FRONTEND_LOADING_REPORT_SCHEMA,
    version: FRONTEND_LOADING_REPORT_VERSION,
    mode: 'post_build_static_manifest',
    ready: !publicRouteLeak && missingBudgetPaths.length === 0 && overBudgetPaths.length === 0,
    browserLocalWorkspace,
    summary: Object.freeze({
      publicRoutes: publicRoutes.length,
      protectedRoutes: protectedRoutes.length,
      publicRouteLeak,
      missingBudgetPaths: Object.freeze(missingBudgetPaths),
      overBudgetPaths: Object.freeze(overBudgetPaths),
      largestPublicRouteGzipBytes: Math.max(0, ...publicRoutes.map((route) => route.gzipBytes)),
      largestProtectedRouteGzipBytes: Math.max(0, ...protectedRoutes.map((route) => route.gzipBytes)),
    }),
    routes: Object.freeze(routes),
    limitations: Object.freeze([
      'Sizes are per-file gzip estimates from one production build, not measured network timings.',
      'Per-route ceilings are reviewed regression tripwires with headroom, not performance targets.',
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
    `Route budgets: ${report.summary.missingBudgetPaths.length || report.summary.overBudgetPaths.length ? 'FAILED' : 'within reviewed ceilings'}`,
    '',
    'Route                         Access      Gzip KiB  Budget KiB  Workspace',
  ];
  for (const route of report.routes) {
    lines.push(
      `${route.path.padEnd(29)} ${route.access.padEnd(11)} ${(route.gzipBytes / 1024).toFixed(2).padStart(8)}  ${route.budgetGzipBytes === null ? 'missing'.padStart(10) : (route.budgetGzipBytes / 1024).toFixed(0).padStart(10)}  ${route.includesBrowserLocalWorkspace ? 'yes' : 'no'}`,
    );
  }
  lines.push('', ...report.limitations);
  return `${lines.join('\n')}\n`;
}

function readBoundedRegularFileSync(filename: string, maximumBytes: number, label: string): Buffer {
  const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > maximumBytes) {
      throw new TypeError(`${label} must be a non-empty regular file within its byte limit.`);
    }
    const bytes = Buffer.allocUnsafe(Math.min(maximumBytes + 1, before.size + 1));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (offset > maximumBytes
      || offset !== before.size
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs) {
      throw new TypeError(`${label} changed while it was being read.`);
    }
    return Buffer.from(bytes.subarray(0, offset));
  } finally {
    closeSync(descriptor);
  }
}

function measureClientAsset(clientRoot: string, realClientRoot: string, file: string): AssetMeasurement {
  const safeFile = boundedSafeRelativePath(file, 'Frontend asset path', 1024);
  const requested = path.resolve(clientRoot, safeFile);
  const resolved = realpathSync(requested);
  if (!pathIsWithin(realClientRoot, resolved)) {
    throw new TypeError(`Frontend asset ${safeFile} resolves outside the client root.`);
  }
  const source = readBoundedRegularFileSync(requested, MAX_FRONTEND_ASSET_BYTES, `Frontend asset ${safeFile}`);
  return Object.freeze({ file: safeFile, bytes: source.byteLength, gzipBytes: gzipSync(source).byteLength });
}

export function measureFrontendAsset(clientRoot: string, file: string): AssetMeasurement {
  const resolvedRoot = realpathSync(clientRoot);
  return measureClientAsset(clientRoot, resolvedRoot, file);
}

export function main(
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
): number {
  try {
    const frontend = path.resolve('frontend');
    const clientRoot = path.join(frontend, '.svelte-kit/output/client');
    const realClientRoot = realpathSync(clientRoot);
    const manifestSource = readBoundedRegularFileSync(
      path.join(clientRoot, '.vite/manifest.json'),
      MAX_FRONTEND_MANIFEST_BYTES,
      'Frontend client manifest',
    ).toString('utf8');
    const manifest = validateManifest(parseBoundedJsonObject(manifestSource, {
      label: 'Frontend client manifest',
      maximumBytes: MAX_FRONTEND_MANIFEST_BYTES,
    }));
    const routeNodes = parseGeneratedRouteNodes(
      readBoundedRegularFileSync(
        path.join(frontend, '.svelte-kit/generated/client/app.js'),
        MAX_FRONTEND_ROUTE_SOURCE_BYTES,
        'Generated client route source',
      ).toString('utf8'),
    );
    const measurements = new Map<string, AssetMeasurement>();
    let measuredBytes = 0;
    const report = buildFrontendLoadingReport({
      manifest,
      routeNodes,
      measureAsset(file) {
        const cached = measurements.get(file);
        if (cached) return cached;
        if (measurements.size >= MAX_FRONTEND_ASSETS) {
          throw new TypeError('Frontend build exceeds its unique-asset limit.');
        }
        const measurement = measureClientAsset(clientRoot, realClientRoot, file);
        measuredBytes += measurement.bytes;
        if (measuredBytes > MAX_FRONTEND_TOTAL_ASSET_BYTES) {
          throw new TypeError('Frontend build exceeds its aggregate asset-byte limit.');
        }
        measurements.set(file, measurement);
        return measurement;
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

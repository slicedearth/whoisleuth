#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBoundedUtf8, readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { MAX_FORWARDING_SOURCE_BYTES, moduleForwardingSpecifier, moduleIsTypeOnly } from './module-forwarding.mts';

export const MAX_PRODUCTION_COVERAGE_BYTES = 16 * 1024 * 1024;
export const MAX_PRODUCTION_COVERAGE_FILES = 2_000;

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_SOURCE_PATH = /^(?:[-a-zA-Z0-9._+()@\[\]]+\/)*[-a-zA-Z0-9._+()@\[\]]+$/u;
const SOURCE_ROOTS = Object.freeze([
  'lib', 'cli', 'bin', 'frontend/src/lib', 'frontend/src/routes', 'netlify/functions', 'packages',
]);
const GENERATED_SOURCE_GLOBS = Object.freeze(['**/generated/**', '**/*.generated.mts', '**/*.generated.ts']);
function generatedSource(source: string): boolean {
  return GENERATED_SOURCE_GLOBS.some((pattern) => path.matchesGlob(source, pattern));
}
const RECORD_FIELDS = Object.freeze(['LF', 'LH', 'BRF', 'BRH', 'FNF', 'FNH'] as const);

export type CoverageCount = Readonly<{
  found: number;
  hit: number;
  percentage: number;
}>;

export type ProductionCoverageRecord = Readonly<{
  source: string;
  lines: CoverageCount;
  branches: CoverageCount;
  functions: CoverageCount;
}>;

export type ProductionCoverageReport = Readonly<{
  records: readonly ProductionCoverageRecord[];
  global: Readonly<{
    lines: CoverageCount;
    branches: CoverageCount;
    functions: CoverageCount;
  }>;
}>;

export type CoveragePolicy = Readonly<{
  global: Readonly<{ lines: number; branches: number; functions: number }>;
  criticalFiles: Readonly<Record<string, Readonly<{ lines: number; branches: number; functions: number }>>>;
  requiredAreas: readonly string[];
}>;

export type CoverageExclusion = Readonly<{
  source: string;
  category: 'type_only' | 'compatibility_re_export' | 'browser_adapter' | 'framework_entry' | 'executable_entry';
  owner: string;
}>;

// These are owners for files outside unit instrumentation, not instrumentation
// filters. A file that becomes measured contributes normally to every coverage
// threshold; its browser/framework owner can remain without a declaration edit.
export const PRODUCTION_COVERAGE_EXCLUSIONS: readonly CoverageExclusion[] = Object.freeze([
  Object.freeze({ source: 'frontend/src/lib/analyst-review-state.ts', category: 'browser_adapter', owner: 'e2e/analyst-operations.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/analyst-undo.ts', category: 'browser_adapter', owner: 'e2e/analyst-operations.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/browser-workspace-provider.ts', category: 'browser_adapter', owner: 'e2e/browser-workspaces.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/browser-workspace-unlock.ts', category: 'browser_adapter', owner: 'e2e/encrypted-workspaces.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/bulk-review.ts', category: 'browser_adapter', owner: 'e2e/bulk-analysis.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/bulk-sessions.ts', category: 'browser_adapter', owner: 'e2e/bulk-session-workflows.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/campaigns.ts', category: 'browser_adapter', owner: 'e2e/investigation-search.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/capabilities.ts', category: 'browser_adapter', owner: 'e2e/capabilities.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/components/demo-stages/brands.ts', category: 'compatibility_re_export', owner: 'e2e/demo.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/components/demo-stages/bulk.ts', category: 'compatibility_re_export', owner: 'e2e/demo.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/components/demo-stages/lookup.ts', category: 'compatibility_re_export', owner: 'e2e/demo.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/components/demo-stages/monitor.ts', category: 'compatibility_re_export', owner: 'e2e/demo.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/console-command-navigation.ts', category: 'browser_adapter', owner: 'e2e/design-system.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/controllers/lookup-anchor-controller.ts', category: 'browser_adapter', owner: 'e2e/lookup-anchor-navigation.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/controllers/case-draft.svelte.ts', category: 'browser_adapter', owner: 'e2e/case-draft-recovery.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/ct-history.ts', category: 'browser_adapter', owner: 'e2e/discover.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/detection-rules.ts', category: 'browser_adapter', owner: 'e2e/hosted-monitoring.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/download-local-file.ts', category: 'browser_adapter', owner: 'e2e/investigation-package.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/investigation-search.ts', category: 'browser_adapter', owner: 'e2e/investigation-search.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/investigation-templates.ts', category: 'browser_adapter', owner: 'e2e/dashboard.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/local-data-platform-probe.ts', category: 'browser_adapter', owner: 'e2e/local-data-platform.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/relationship-observations.ts', category: 'browser_adapter', owner: 'e2e/case-relationship-workflows.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/review-session.ts', category: 'browser_adapter', owner: 'e2e/review-session.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/shortlist.ts', category: 'browser_adapter', owner: 'e2e/shortlist-storage.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/website-snapshots.ts', category: 'browser_adapter', owner: 'e2e/hosted-monitoring.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/workers/investigation-package.worker.ts', category: 'browser_adapter', owner: 'e2e/investigation-package.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/workers/local-application.worker.ts', category: 'browser_adapter', owner: 'e2e/local-application.spec.ts' }),
  Object.freeze({ source: 'frontend/src/lib/workspace-archive.ts', category: 'browser_adapter', owner: 'e2e/dashboard.spec.ts' }),
  Object.freeze({ source: 'frontend/src/routes/(public)/guide/+page.ts', category: 'framework_entry', owner: 'e2e/public-guide.spec.ts' }),
  Object.freeze({ source: 'frontend/src/routes/(public)/resources/[slug]/+page.ts', category: 'framework_entry', owner: 'e2e/public-guide.spec.ts' }),
  Object.freeze({ source: 'frontend/src/routes/+layout.ts', category: 'framework_entry', owner: 'frontend/src/routes/+layout.svelte' }),
  Object.freeze({ source: 'lib/local-application-worker.mts', category: 'executable_entry', owner: 'test/local-application-host.test.mts' }),
]);

export const PRODUCTION_COVERAGE_POLICY: CoveragePolicy = Object.freeze({
  global: Object.freeze({ lines: 90, branches: 75, functions: 85 }),
  criticalFiles: Object.freeze({
    'packages/web-capture/anchored-artifact-writer.mts': Object.freeze({ lines: 90, branches: 75, functions: 85 }),
    'cli/discriminated-command-handlers.mts': Object.freeze({ lines: 100, branches: 100, functions: 100 }),
    'cli/assurance-command-runner.mts': Object.freeze({ lines: 90, branches: 60, functions: 100 }),
    'cli/evidence-command-runner.mts': Object.freeze({ lines: 90, branches: 75, functions: 100 }),
    'cli/history-command-runner.mts': Object.freeze({ lines: 90, branches: 60, functions: 65 }),
    'cli/review-command-runner.mts': Object.freeze({ lines: 95, branches: 50, functions: 80 }),
    'cli/support-command-runner.mts': Object.freeze({ lines: 75, branches: 70, functions: 80 }),
    'cli/workflow-command-runner.mts': Object.freeze({ lines: 95, branches: 65, functions: 100 }),
    'cli/lookup-browser.mts': Object.freeze({ lines: 90, branches: 70, functions: 90 }),
    'cli/lookup-browser-view.mts': Object.freeze({ lines: 95, branches: 75, functions: 100 }),
    'cli/formatters/terminal-shared.mts': Object.freeze({ lines: 100, branches: 85, functions: 100 }),
    'cli/formatters/terminal-metadata.mts': Object.freeze({ lines: 95, branches: 70, functions: 100 }),
    'cli/formatters/terminal-lookup.mts': Object.freeze({ lines: 95, branches: 85, functions: 100 }),
    'cli/formatters/terminal-command-formats.mts': Object.freeze({ lines: 95, branches: 55, functions: 90 }),
    'frontend/src/lib/browser-local-data.ts': Object.freeze({ lines: 80, branches: 65, functions: 75 }),
    'frontend/src/lib/controllers/lookup-case-controller.ts': Object.freeze({ lines: 95, branches: 90, functions: 95 }),
    'frontend/src/lib/analysis/brand-profile-signals.ts': Object.freeze({ lines: 95, branches: 90, functions: 100 }),
    'frontend/src/lib/analysis/lookup-dns-display.ts': Object.freeze({ lines: 95, branches: 80, functions: 100 }),
    'frontend/src/lib/analysis/lookup-http-display.ts': Object.freeze({ lines: 95, branches: 80, functions: 100 }),
    'frontend/src/lib/analysis/lookup-tls-display.ts': Object.freeze({ lines: 95, branches: 85, functions: 100 }),
    'frontend/src/lib/analysis/lookup-page-identity-display.ts': Object.freeze({ lines: 95, branches: 80, functions: 100 }),
    'frontend/src/lib/analysis/lookup-page-network-display.ts': Object.freeze({ lines: 95, branches: 90, functions: 100 }),
    'frontend/src/lib/analysis/lookup-page-profile-display.ts': Object.freeze({ lines: 95, branches: 70, functions: 100 }),
    'packages/investigation/investigation-capsule.mts': Object.freeze({ lines: 98, branches: 75, functions: 100 }),
  }),
  requiredAreas: Object.freeze([
    'runtime entry points',
    'CLI',
    'shared runtime',
    'frontend runtime',
    'hosted functions',
    'Case domain',
    'comparison domain',
    'contract domain',
    'evidence domain',
    'interchange domain',
    'investigation domain',
    'monitoring domain',
    'relationship domain',
    'web-capture domain',
    'workspace domain',
  ]),
});

type MutableRecord = {
  source?: string;
  LF?: number;
  LH?: number;
  BRF?: number;
  BRH?: number;
  FNF?: number;
  FNH?: number;
};

export type CoverageInventorySummary = Readonly<{
  sourceFiles: number;
  measuredFiles: number;
  excludedFiles: number;
  exclusionsByCategory: Readonly<Record<CoverageExclusion['category'], number>>;
}>;

function percentage(hit: number, found: number): number {
  return found === 0 ? 100 : (hit / found) * 100;
}

function count(hit: number, found: number): CoverageCount {
  if (!Number.isSafeInteger(found) || !Number.isSafeInteger(hit) || found < 0 || hit < 0 || hit > found) {
    throw new TypeError('Coverage totals must be non-negative integers with hits no greater than found records.');
  }
  return Object.freeze({ found, hit, percentage: percentage(hit, found) });
}

function sourceArea(source: string): string | null {
  if (source === 'server.mts' || source.startsWith('bin/')) return 'runtime entry points';
  if (source.startsWith('cli/')) return 'CLI';
  if (source.startsWith('lib/')) return 'shared runtime';
  if (source.startsWith('frontend/src/')) return 'frontend runtime';
  if (source.startsWith('netlify/functions/')) return 'hosted functions';
  const packageName = /^packages\/([^/]+)\//u.exec(source)?.[1];
  const packageAreas: Readonly<Record<string, string>> = Object.freeze({
    cases: 'Case domain',
    comparison: 'comparison domain',
    contracts: 'contract domain',
    evidence: 'evidence domain',
    interchange: 'interchange domain',
    investigation: 'investigation domain',
    monitoring: 'monitoring domain',
    relationships: 'relationship domain',
    'web-capture': 'web-capture domain',
    workspace: 'workspace domain',
  });
  return packageName ? packageAreas[packageName] ?? null : null;
}

export function readProductionCoverageInventory(repositoryRoot = REPOSITORY_ROOT): readonly string[] {
  const sources: string[] = [];
  const visit = (relativeDirectory: string): void => {
    const entries = readdirSync(path.join(repositoryRoot, relativeDirectory), { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile() && /\.(?:mts|ts)$/u.test(entry.name) && !generatedSource(relative)) {
        if (!SAFE_SOURCE_PATH.test(relative)) throw new TypeError(`Production source inventory contains an unsafe path: ${relative}.`);
        sources.push(relative);
        if (sources.length > MAX_PRODUCTION_COVERAGE_FILES) throw new TypeError('Production source inventory exceeds the maintained file bound.');
      } else if (entry.isSymbolicLink() && /\.(?:mts|ts)$/u.test(entry.name)) {
        throw new TypeError(`Production source inventory must not follow symbolic links: ${relative}.`);
      }
    }
  };
  for (const root of SOURCE_ROOTS) visit(root);
  if (existsSync(path.join(repositoryRoot, 'server.mts'))) sources.push('server.mts');
  const unique = [...new Set(sources)].sort();
  if (unique.length !== sources.length || unique.length < 1) throw new TypeError('Production source inventory must be non-empty and unique.');
  return Object.freeze(unique);
}

/** Erased types use their compiler; forwarding chains require a measured owner. */
export async function discoverStructuralCoverageExclusions(
  report: ProductionCoverageReport,
  inventory: readonly string[],
  repositoryRoot = REPOSITORY_ROOT,
  explicitExclusions: readonly CoverageExclusion[] = PRODUCTION_COVERAGE_EXCLUSIONS,
): Promise<readonly CoverageExclusion[]> {
  if (inventory.length > MAX_PRODUCTION_COVERAGE_FILES) throw new TypeError('Production source inventory exceeds the maintained file bound.');
  const sources = new Set(inventory);
  const measured = new Set(report.records.map((record) => record.source));
  const explicit = new Set(explicitExclusions.map((item) => item.source));
  const forwards = new Map<string, string>();
  const exclusions: CoverageExclusion[] = [];
  for (const source of inventory) {
    if (measured.has(source) || explicit.has(source)) continue;
    const bytes = await readBoundedRegularFileWithin(repositoryRoot, source, {
      maximumBytes: MAX_FORWARDING_SOURCE_BYTES, label: 'Production structural candidate',
    });
    const content = decodeBoundedUtf8(bytes, 'Production source');
    if (moduleIsTypeOnly(content, source)) {
      exclusions.push(Object.freeze({ source, category: 'type_only',
        owner: source.startsWith('frontend/') ? 'frontend/tsconfig.json' : 'tsconfig.json' }));
      continue;
    }
    const specifier = moduleForwardingSpecifier(content, source);
    if (!specifier?.startsWith('.')) continue;
    const owner = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier));
    if (sources.has(owner)) forwards.set(source, owner);
  }
  for (const [source, firstOwner] of forwards) {
    let owner: string | undefined = firstOwner;
    const seen = new Set([source]);
    while (owner && !seen.has(owner) && !measured.has(owner)) {
      seen.add(owner);
      owner = forwards.get(owner);
    }
    if (owner && measured.has(owner)) {
      exclusions.push(Object.freeze({ source, category: 'compatibility_re_export', owner }));
    }
  }
  return Object.freeze(exclusions);
}

function numericField(value: string, label: string): number {
  if (!/^\d+$/u.test(value)) throw new TypeError(`${label} must be a non-negative integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} exceeds the safe integer range.`);
  return parsed;
}

function finishRecord(raw: MutableRecord, index: number): ProductionCoverageRecord {
  if (!raw.source) throw new TypeError(`Coverage record ${index} is missing its source path.`);
  if (!SAFE_SOURCE_PATH.test(raw.source) || path.isAbsolute(raw.source) || raw.source.includes('..')) {
    throw new TypeError(`Coverage record ${index} has an unsafe source path.`);
  }
  if (generatedSource(raw.source)) {
    throw new TypeError(`Generated source must not contribute to production coverage: ${raw.source}.`);
  }
  for (const field of RECORD_FIELDS) {
    if (raw[field] === undefined) throw new TypeError(`Coverage record ${raw.source} is missing ${field}.`);
  }
  return Object.freeze({
    source: raw.source,
    lines: count(raw.LH as number, raw.LF as number),
    branches: count(raw.BRH as number, raw.BRF as number),
    functions: count(raw.FNH as number, raw.FNF as number),
  });
}

export function parseProductionCoverage(input: string): ProductionCoverageReport {
  const bytes = Buffer.byteLength(input, 'utf8');
  if (bytes < 1 || bytes > MAX_PRODUCTION_COVERAGE_BYTES) {
    throw new TypeError(`LCOV input must be between 1 and ${MAX_PRODUCTION_COVERAGE_BYTES} bytes.`);
  }
  const records: ProductionCoverageRecord[] = [];
  let current: MutableRecord = {};
  let started = false;
  for (const [lineIndex, line] of input.split(/\r?\n/u).entries()) {
    if (!line || line.startsWith('TN:') || /^(?:FN|FNDA|BRDA|DA):/u.test(line)) continue;
    if (line === 'end_of_record') {
      if (!started) throw new TypeError(`Unexpected LCOV record terminator at line ${lineIndex + 1}.`);
      records.push(finishRecord(current, records.length + 1));
      if (records.length > MAX_PRODUCTION_COVERAGE_FILES) throw new TypeError('LCOV input exceeds the maintained file bound.');
      current = {};
      started = false;
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 1) throw new TypeError(`Unsupported LCOV line ${lineIndex + 1}.`);
    const field = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (field === 'SF') {
      if (started || !value) throw new TypeError(`Invalid LCOV source declaration at line ${lineIndex + 1}.`);
      current.source = value.replaceAll('\\', '/');
      started = true;
      continue;
    }
    if ((RECORD_FIELDS as readonly string[]).includes(field)) {
      if (!started || current[field as keyof MutableRecord] !== undefined) {
        throw new TypeError(`Invalid LCOV ${field} declaration at line ${lineIndex + 1}.`);
      }
      current[field as keyof MutableRecord] = numericField(value, `LCOV ${field}`) as never;
      continue;
    }
    throw new TypeError(`Unsupported LCOV field ${field} at line ${lineIndex + 1}.`);
  }
  if (started) throw new TypeError('LCOV input ended before end_of_record.');
  if (records.length < 1) throw new TypeError('LCOV input contains no source records.');
  const identities = records.map((record) => record.source);
  if (new Set(identities).size !== identities.length) throw new TypeError('LCOV source records must be unique.');
  const aggregate = (metric: 'lines' | 'branches' | 'functions'): CoverageCount => count(
    records.reduce((sum, record) => sum + record[metric].hit, 0),
    records.reduce((sum, record) => sum + record[metric].found, 0),
  );
  return Object.freeze({
    records: Object.freeze(records),
    global: Object.freeze({
      lines: aggregate('lines'),
      branches: aggregate('branches'),
      functions: aggregate('functions'),
    }),
  });
}

function thresholdProblem(actual: CoverageCount, minimum: number, label: string): string | null {
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) throw new TypeError(`${label} threshold is invalid.`);
  return actual.percentage + Number.EPSILON < minimum
    ? `${label} is ${actual.percentage.toFixed(2)}%; required ${minimum.toFixed(2)}%.`
    : null;
}

export function validateProductionCoverage(
  report: ProductionCoverageReport,
  policy: CoveragePolicy = PRODUCTION_COVERAGE_POLICY,
): void {
  const problems: string[] = [];
  const observedAreas = new Set(report.records.map((record) => sourceArea(record.source)).filter(Boolean));
  const missingAreas = policy.requiredAreas.filter((area) => !observedAreas.has(area));
  if (missingAreas.length) problems.push(`Production coverage is missing maintained runtime areas: ${missingAreas.join(', ')}.`);
  for (const metric of ['lines', 'branches', 'functions'] as const) {
    const problem = thresholdProblem(report.global[metric], policy.global[metric], `Global ${metric === 'branches' ? 'branch' : metric.slice(0, -1)} coverage`);
    if (problem) problems.push(problem);
  }
  for (const [source, thresholds] of Object.entries(policy.criticalFiles)) {
    const record = report.records.find((candidate) => candidate.source === source);
    if (!record) {
      problems.push(`Production coverage is missing critical source ${source}.`);
      continue;
    }
    for (const metric of ['lines', 'branches', 'functions'] as const) {
      const problem = thresholdProblem(record[metric], thresholds[metric], `${source} ${metric === 'branches' ? 'branch' : metric.slice(0, -1)} coverage`);
      if (problem) problems.push(problem);
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));
}

export function validateProductionCoverageInventory(
  report: ProductionCoverageReport,
  inventory: readonly string[] = readProductionCoverageInventory(),
  exclusions: readonly CoverageExclusion[] = PRODUCTION_COVERAGE_EXCLUSIONS,
  ownerExists: (owner: string) => boolean = (owner) => existsSync(path.join(REPOSITORY_ROOT, owner)),
): CoverageInventorySummary {
  const inventorySet = new Set(inventory);
  if (inventory.length < 1 || inventorySet.size !== inventory.length) {
    throw new TypeError('Production source inventory must be non-empty and unique.');
  }
  const exclusionSources = exclusions.map((item) => item.source);
  if (new Set(exclusionSources).size !== exclusionSources.length) throw new TypeError('Production coverage exclusions must be unique.');
  const problems: string[] = [];
  for (const exclusion of exclusions) {
    if (!inventorySet.has(exclusion.source)) problems.push(`Production coverage exclusion is stale or unknown: ${exclusion.source}.`);
    if (!SAFE_SOURCE_PATH.test(exclusion.owner) || !ownerExists(exclusion.owner)) {
      problems.push(`Production coverage exclusion owner is missing for ${exclusion.source}.`);
    }
  }
  const observed = new Set(report.records.map((record) => record.source));
  const unknown = [...observed].filter((source) => !inventorySet.has(source));
  if (unknown.length) problems.push(`Production coverage measured unknown source files: ${unknown.join(', ')}.`);
  const unmeasuredExclusions = exclusions.filter((item) => !observed.has(item.source));
  const excluded = new Set(unmeasuredExclusions.map((item) => item.source));
  const missing = inventory.filter((source) => !observed.has(source) && !excluded.has(source));
  if (missing.length) problems.push(`Production coverage has unreviewed source omissions: ${missing.join(', ')}.`);
  if (problems.length) throw new Error(problems.join('\n'));
  const categories: Record<CoverageExclusion['category'], number> = {
    type_only: 0,
    compatibility_re_export: 0,
    browser_adapter: 0,
    framework_entry: 0,
    executable_entry: 0,
  };
  for (const exclusion of unmeasuredExclusions) categories[exclusion.category] += 1;
  return Object.freeze({
    sourceFiles: inventory.length,
    measuredFiles: report.records.length,
    excludedFiles: unmeasuredExclusions.length,
    exclusionsByCategory: Object.freeze(categories),
  });
}

function formatMetric(metric: CoverageCount): string {
  return `${metric.percentage.toFixed(2)}% (${metric.hit}/${metric.found})`;
}

export function formatProductionCoverage(
  report: ProductionCoverageReport,
  inventory?: CoverageInventorySummary,
): string {
  const critical = Object.keys(PRODUCTION_COVERAGE_POLICY.criticalFiles).map((source) => {
    const record = report.records.find((candidate) => candidate.source === source);
    if (!record) return `${source}: missing`;
    return `${source}: ${formatMetric(record.lines)} lines; ${formatMetric(record.branches)} branches; ${formatMetric(record.functions)} functions`;
  });
  return [
    `Production coverage: ${report.records.length} executable source files.`,
    ...(inventory ? [
      `Inventory closure: ${inventory.measuredFiles}/${inventory.sourceFiles} measured; ${inventory.excludedFiles} owned outside unit instrumentation `
      + `(${inventory.exclusionsByCategory.type_only} type-only, ${inventory.exclusionsByCategory.compatibility_re_export} compatibility re-exports, `
      + `${inventory.exclusionsByCategory.browser_adapter} browser adapters, ${inventory.exclusionsByCategory.framework_entry} framework entries, `
      + `${inventory.exclusionsByCategory.executable_entry} executable entries).`,
    ] : []),
    `Global: ${formatMetric(report.global.lines)} lines; ${formatMetric(report.global.branches)} branches; ${formatMetric(report.global.functions)} functions.`,
    ...critical,
  ].join('\n');
}

// Instrumentation and validation share the same source boundaries and global
// floors. Generated files discovered in another package need no script edit.
export function productionCoverageArguments(testPattern = 'test/*.test.mts'): string[] {
  return [
    '--test', '--test-concurrency=4', '--experimental-test-coverage',
    ...Object.entries(PRODUCTION_COVERAGE_POLICY.global).map(([metric, minimum]) => `--test-coverage-${metric}=${minimum}`),
    ...SOURCE_ROOTS.flatMap((root) => ['mts', 'ts'].map((extension) => `--test-coverage-include=${root}/**/*.${extension}`)),
    '--test-coverage-include=server.mts',
    ...GENERATED_SOURCE_GLOBS.map((pattern) => `--test-coverage-exclude=${pattern}`),
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=lcov', '--test-reporter-destination=test-coverage.lcov',
    testPattern,
  ];
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    if (args.length === 1 && args[0] === '--run') {
      const result = spawnSync(process.execPath, productionCoverageArguments(), {
        cwd: REPOSITORY_ROOT, env: process.env, stdio: 'inherit',
      });
      if (result.error) throw result.error;
      if (result.status !== 0) return result.status ?? 2;
      args = [];
    }
    if (args.length > 1 || args[0]?.startsWith('-')) throw new TypeError('Usage: node tools/production-coverage.mts [--run|lcov-path]');
    const coveragePath = path.resolve(REPOSITORY_ROOT, args[0] ?? 'test-coverage.lcov');
    const size = statSync(coveragePath).size;
    if (size < 1 || size > MAX_PRODUCTION_COVERAGE_BYTES) throw new TypeError('LCOV file has an invalid byte count.');
    const report = parseProductionCoverage(readFileSync(coveragePath, 'utf8'));
    const problems: string[] = [];
    let inventory: CoverageInventorySummary | undefined;
    try { validateProductionCoverage(report); }
    catch (error) { problems.push(error instanceof Error ? error.message : 'Production coverage thresholds failed.'); }
    // Inventory validation is independent of the measured percentages. Report
    // both sets of failures from this run instead of hiding later omissions.
    try {
      const sources = readProductionCoverageInventory();
      const structural = await discoverStructuralCoverageExclusions(report, sources);
      inventory = validateProductionCoverageInventory(report, sources, [...PRODUCTION_COVERAGE_EXCLUSIONS, ...structural]);
    } catch (error) { problems.push(error instanceof Error ? error.message : 'Production coverage inventory failed.'); }
    if (problems.length) throw new Error(problems.join('\n'));
    process.stdout.write(`${formatProductionCoverage(report, inventory)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Production coverage validation failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

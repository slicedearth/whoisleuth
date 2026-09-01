#!/usr/bin/env node

// Composes existing local dataset and evaluation status owners. This command
// reads only checked-in assets; it never refreshes a source or performs a
// network request.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sslblSnapshotHealth,
  type SslblSnapshotHealth,
} from '../lib/sslbl-intelligence.mts';
import { buildCatalogStatus } from './cisa-kev-catalog-status.mts';
import { buildRegistryFixtureFreshnessReport } from './registry-fixture-freshness.mts';
import { buildReviewedAccuracyStatus } from './reviewed-accuracy-status.mts';
import { auditServiceDependencySignatures } from './service-dependency-signature-audit.mts';

export const SOURCE_HEALTH_SCHEMA = 'whoisleuth.source-health';
export const SOURCE_HEALTH_VERSION = 1;

type WritableLike = { write(value: string): unknown };
type SourceHealthState = 'current' | 'limited' | 'malformed' | 'measured' | 'stale' | 'unavailable' | 'unproven';
type SourceHealthKind = 'evaluation' | 'retained_dataset';
type SourceHealthEntry = Readonly<{
  id: string;
  label: string;
  kind: SourceHealthKind;
  state: SourceHealthState;
  sourceObservedAt: string | null;
  ageDays: number | null;
  itemCount: number | null;
  detail: string;
  limitation: string;
  action: string;
  strictCommand: string;
}>;
type SourceHealthBuilders = Readonly<{
  sslbl: (now: Date) => ReturnType<typeof sslblSnapshotHealth>;
  kev: (now: Date) => ReturnType<typeof buildCatalogStatus>;
  registryFixtures: (now: Date) => ReturnType<typeof buildRegistryFixtureFreshnessReport>;
  reviewedAccuracy: (now: Date) => ReturnType<typeof buildReviewedAccuracyStatus>;
  serviceDependencies: (now: Date) => ReturnType<typeof auditServiceDependencySignatures>;
}>;
type BuildOptions = Readonly<{
  now?: Date;
  builders?: Partial<SourceHealthBuilders>;
}>;
type MainOptions = BuildOptions & Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;
type SslblStatusOptions = Readonly<{
  snapshot?: unknown;
  now?: string | number | Date;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

const STATES = Object.freeze([
  'current',
  'limited',
  'measured',
  'unproven',
  'stale',
  'unavailable',
  'malformed',
] satisfies readonly SourceHealthState[]);

const DEFAULT_BUILDERS: SourceHealthBuilders = Object.freeze({
  sslbl: (now) => sslblSnapshotHealth({ now }),
  kev: (now) => buildCatalogStatus(now),
  registryFixtures: (now) => buildRegistryFixtureFreshnessReport({ now: () => now }),
  reviewedAccuracy: (now) => buildReviewedAccuracyStatus(now),
  serviceDependencies: (now) => auditServiceDependencySignatures({ now: () => now }),
});

function entry(value: SourceHealthEntry): SourceHealthEntry {
  return Object.freeze(value);
}

function unavailableEntry(
  id: string,
  label: string,
  kind: SourceHealthKind,
  strictCommand: string,
): SourceHealthEntry {
  return entry({
    id,
    label,
    kind,
    state: 'unavailable',
    sourceObservedAt: null,
    ageDays: null,
    itemCount: null,
    detail: 'The local status owner could not complete, so retained source health is unavailable.',
    limitation: 'Unavailable status is not a zero count, a healthy result, or evidence that the source contains no matching records.',
    action: `Run ${strictCommand} directly to inspect the bounded local failure.`,
    strictCommand,
  });
}

async function observedEntry(
  id: string,
  label: string,
  kind: SourceHealthKind,
  strictCommand: string,
  builder: () => SourceHealthEntry | Promise<SourceHealthEntry>,
): Promise<SourceHealthEntry> {
  try {
    return await builder();
  } catch {
    return unavailableEntry(id, label, kind, strictCommand);
  }
}

function latestDate(values: readonly (string | null | undefined)[]): string | null {
  const valid = values
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  return valid[0] ?? null;
}

function maximumFinite(values: readonly (number | null | undefined)[]): number | null {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

export function formatSslblSnapshotHealth(health: SslblSnapshotHealth): string {
  return [
    'WHOISleuth SSLBL snapshot health',
    `State: ${health.state}`,
    `Source updated: ${health.sourceUpdatedAt ?? 'unavailable'}`,
    `Generated: ${health.generatedAt ?? 'unavailable'}`,
    `Age: ${health.ageSeconds === null ? 'unavailable' : `${health.ageSeconds} seconds`}`,
    `Entries: ${health.entryCount ?? 'unavailable'}`,
    `Digest: ${health.digestSha256 ? `sha256:${health.digestSha256}` : 'unavailable'}`,
    `Detail: ${health.detail}`,
    'Network requests: 0',
  ].join('\n').concat('\n');
}

export function sslblStatusMain(
  args: readonly string[],
  options: SslblStatusOptions = {},
): number {
  try {
    if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
      throw new TypeError('Usage: npm run sslbl:status -- [--json]');
    }
    const health = sslblSnapshotHealth({
      ...(options.snapshot !== undefined ? { snapshot: options.snapshot } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
    });
    (options.stdout ?? process.stdout).write(
      args[0] === '--json'
        ? `${JSON.stringify(health, null, 2)}\n`
        : formatSslblSnapshotHealth(health),
    );
    return health.state === 'current' ? 0 : health.state === 'stale' ? 1 : 2;
  } catch (error) {
    (options.stderr ?? process.stderr).write(
      `${error instanceof Error ? error.message : 'SSLBL snapshot health check failed.'}\n`,
    );
    return 2;
  }
}

export async function buildSourceHealthReport(options: BuildOptions = {}) {
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Source-health generation time must be valid.');
  }
  const builders: SourceHealthBuilders = Object.freeze({ ...DEFAULT_BUILDERS, ...options.builders });

  const retainedEntries = await Promise.all([
    observedEntry('sslbl_certificate_snapshot', 'SSL certificate intelligence snapshot', 'retained_dataset', 'npm run sslbl:status', async () => {
      const health = await builders.sslbl(now);
      const state: SourceHealthState = health.state === 'current'
        ? 'current'
        : health.state === 'stale'
          ? 'stale'
          : health.state === 'expired'
            ? 'unavailable'
            : 'malformed';
      return entry({
        id: 'sslbl_certificate_snapshot',
        label: 'SSL certificate intelligence snapshot',
        kind: 'retained_dataset',
        state,
        sourceObservedAt: health.sourceUpdatedAt,
        ageDays: health.ageSeconds === null ? null : Math.floor(health.ageSeconds / 86_400),
        itemCount: health.entryCount,
        detail: health.detail,
        limitation: 'This is an offline retained snapshot. A match is a review lead; a miss is inconclusive when the snapshot is stale or unavailable.',
        action: state === 'current' ? 'No local maintenance action is currently indicated.' : 'Review the separately authorised snapshot refresh procedure.',
        strictCommand: 'npm run sslbl:status',
      });
    }),
    observedEntry('cisa_kev_catalogue', 'CISA KEV catalogue projection', 'retained_dataset', 'npm run catalog:kev:status', async () => {
      const report = await builders.kev(now);
      const state: SourceHealthState = report.state === 'invalid' ? 'malformed' : report.state;
      return entry({
        id: 'cisa_kev_catalogue',
        label: 'CISA KEV catalogue projection',
        kind: 'retained_dataset',
        state,
        sourceObservedAt: report.releasedAt,
        ageDays: report.ageDays,
        itemCount: report.identifierCount,
        detail: `Pinned catalogue ${report.catalogVersion} is ${report.ageDays ?? 'an unknown number of'} days old against the ${report.maxAgeDays}-day review threshold.`,
        limitation: report.limitation,
        action: state === 'current' ? 'No local maintenance action is currently indicated.' : 'Review the separately authorised catalogue update procedure.',
        strictCommand: 'npm run catalog:kev:status',
      });
    }),
    observedEntry('registry_fixtures', 'Registry compatibility fixtures', 'retained_dataset', 'npm run registry:fixtures', async () => {
      const report = await builders.registryFixtures(now);
      const counts = report.summary.fileStates;
      const state: SourceHealthState = counts.changed > 0
        ? 'malformed'
        : counts.inconclusive > 0
          ? 'unavailable'
          : counts.stale > 0
            ? 'stale'
            : 'current';
      return entry({
        id: 'registry_fixtures',
        label: 'Registry compatibility fixtures',
        kind: 'retained_dataset',
        state,
        sourceObservedAt: latestDate(report.files.map((file) => file.verifiedAt)),
        ageDays: maximumFinite(report.files.map((file) => file.ageDays)),
        itemCount: report.summary.files,
        detail: `${counts.current} current, ${counts.stale} stale, ${counts.changed} changed and ${counts.inconclusive} unavailable fixture files; ${report.summary.profiles} mapped profiles.`,
        limitation: report.policy.interpretation,
        action: state === 'current' ? 'No local maintenance action is currently indicated.' : 'Inspect changed, stale or unreadable fixtures before updating provenance.',
        strictCommand: 'npm run registry:fixtures',
      });
    }),
    observedEntry('service_dependency_signatures', 'Service-dependency signature catalogue', 'retained_dataset', 'npm run service-dependencies:audit', async () => {
      const report = await builders.serviceDependencies(now);
      const state: SourceHealthState = report.status === 'invalid' ? 'malformed' : report.status;
      return entry({
        id: 'service_dependency_signatures',
        label: 'Service-dependency signature catalogue',
        kind: 'retained_dataset',
        state,
        sourceObservedAt: null,
        ageDays: maximumFinite(report.findings.map((finding) => finding.ageDays)),
        itemCount: report.signatureCount,
        detail: `${report.summary.current} current, ${report.summary.stale} stale and ${report.summary.invalid} malformed signatures; digest ${report.digestMatches ? 'matches' : 'does not match'}.`,
        limitation: report.limitations[0] ?? 'This local status does not establish live service state.',
        action: state === 'current' ? 'No local maintenance action is currently indicated.' : 'Review the bounded catalogue metadata and digest before changing a signature.',
        strictCommand: 'npm run service-dependencies:audit',
      });
    }),
  ]);

  let evaluationEntries: SourceHealthEntry[];
  try {
    const accuracy = await builders.reviewedAccuracy(now);
    evaluationEntries = accuracy.corpora.map((corpus) => entry({
      id: `accuracy_${corpus.key.replaceAll('-', '_')}`,
      label: `${corpus.label} evaluation`,
      kind: 'evaluation',
      state: corpus.readiness,
      sourceObservedAt: accuracy.generatedAt,
      ageDays: null,
      itemCount: corpus.reviewedCases,
      detail: `${corpus.reviewedPositiveCases} reviewed positive and ${corpus.reviewedBenignCases} reviewed benign or collision cases. ${corpus.limitation}`,
      limitation: accuracy.limitation,
      action: corpus.nextStep,
      strictCommand: 'npm run accuracy:status',
    }));
  } catch {
    evaluationEntries = [unavailableEntry(
      'reviewed_accuracy',
      'Reviewed evaluation status',
      'evaluation',
      'npm run accuracy:status',
    )];
  }

  const entries = Object.freeze([...retainedEntries, ...evaluationEntries]);
  const stateCounts = Object.fromEntries(STATES.map((state) => [state, 0])) as Record<SourceHealthState, number>;
  for (const item of entries) stateCounts[item.state] += 1;
  const strictFailures = stateCounts.stale + stateCounts.unavailable + stateCounts.malformed;
  return Object.freeze({
    schema: SOURCE_HEALTH_SCHEMA,
    version: SOURCE_HEALTH_VERSION,
    generatedAt: now.toISOString(),
    mode: 'offline_checked_in_assets' as const,
    networkRequests: 0,
    summary: Object.freeze({
      entries: entries.length,
      states: Object.freeze(stateCounts),
      strictFailures,
    }),
    entries,
    limitations: Object.freeze([
      'This command reads checked-in metadata and fixtures only; it does not query upstream publishers, domains, providers or registries.',
      'Current means the local owner passed its reviewed age and integrity policy. It does not prove that the upstream source is the newest publication.',
      'Reviewed evaluation maturity describes checked-in corpus coverage only; it does not establish general accuracy or recall.',
    ]),
  });
}

export function formatSourceHealthReport(
  report: Awaited<ReturnType<typeof buildSourceHealthReport>>,
): string {
  const lines = [
    'WHOISleuth offline source health',
    `Generated: ${report.generatedAt}`,
    `Sources: ${report.summary.entries}; network requests: ${report.networkRequests}`,
    `States: ${STATES.map((state) => `${state} ${report.summary.states[state]}`).join(', ')}`,
    '',
  ];
  for (const item of report.entries) {
    lines.push(`${item.state.toUpperCase().padEnd(12)} ${item.label}`);
    lines.push(`  Items: ${item.itemCount === null ? 'unavailable' : item.itemCount}; age: ${item.ageDays === null ? 'unavailable' : `${item.ageDays} days`}`);
    lines.push(`  Detail: ${item.detail}`);
    if (item.state !== 'current' && item.state !== 'measured') lines.push(`  Action: ${item.action}`);
    lines.push(`  Strict drill-down: ${item.strictCommand}`);
  }
  lines.push('', ...report.limitations, '');
  return lines.join('\n');
}

function githubAnnotationValue(value: string, property = false): string {
  const bounded = value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1_000)
    .replaceAll('%', '%25');
  return property ? bounded.replaceAll(':', '%3A').replaceAll(',', '%2C') : bounded;
}

export function formatSourceHealthAnnotations(
  report: Awaited<ReturnType<typeof buildSourceHealthReport>>,
): string {
  const warnings = report.entries.filter((item) => item.kind === 'retained_dataset'
    && (item.state === 'stale' || item.state === 'unavailable'));
  if (!warnings.length) return '';
  return `${warnings.map((item) => {
    const title = githubAnnotationValue(`Retained source ${item.state}: ${item.label}`, true);
    const message = githubAnnotationValue(
      `${item.label} is ${item.state}. ${item.action} Drill-down: ${item.strictCommand}.`,
    );
    return `::warning title=${title}::${message}`;
  }).join('\n')}\n`;
}

function parseArguments(args: readonly string[]): Readonly<{
  githubAnnotations: boolean;
  json: boolean;
  strict: boolean;
}> {
  let githubAnnotations = false;
  let json = false;
  let strict = false;
  for (const argument of args) {
    if (argument === '--github-annotations' && !githubAnnotations) githubAnnotations = true;
    else if (argument === '--json' && !json) json = true;
    else if (argument === '--strict' && !strict) strict = true;
    else throw new TypeError('Usage: npm run sources:health -- [--github-annotations | --json] [--strict]');
  }
  if (githubAnnotations && json) {
    throw new TypeError('Usage: npm run sources:health -- [--github-annotations | --json] [--strict]');
  }
  return { githubAnnotations, json, strict };
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  if (args.filter((argument) => argument === '--sslbl-status').length === 1) {
    return sslblStatusMain(args.filter((argument) => argument !== '--sslbl-status'), {
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.stdout !== undefined ? { stdout: options.stdout } : {}),
      ...(options.stderr !== undefined ? { stderr: options.stderr } : {}),
    });
  }
  try {
    const parsed = parseArguments(args);
    const report = await buildSourceHealthReport(options);
    (options.stdout ?? process.stdout).write(parsed.githubAnnotations
      ? formatSourceHealthAnnotations(report)
      : parsed.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatSourceHealthReport(report));
    if (report.summary.states.malformed > 0) return 2;
    return parsed.strict && report.summary.strictFailures > 0 ? 1 : 0;
  } catch (error) {
    (options.stderr ?? process.stderr).write(
      `${error instanceof Error ? error.message : 'Offline source-health report failed.'}\n`,
    );
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; });
}

export type {
  SourceHealthBuilders,
  SourceHealthEntry,
  SourceHealthState,
};

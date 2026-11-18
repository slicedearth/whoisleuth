import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMonitoringPlan } from '../packages/monitoring/monitoring-plan.mts';
import { MONITORING_PLAN_INPUT_SCHEMA, MONITORING_PLAN_VERSION } from '../packages/contracts/monitoring-plan.mts';
import { normalizeWatchlistEntry } from '../packages/workspace/watchlist-history.mts';
import { buildWatchlistExport } from '../packages/workspace/watchlist-store.mts';
import { runCli } from '../cli/runner.mts';

const AT = '2026-11-01T00:00:00.000Z';
const selection = (watchlists: unknown, overrides = {}) => ({ schema: MONITORING_PLAN_INPUT_SCHEMA,
  version: MONITORING_PLAN_VERSION, watchlists, purpose: 'registration', intervalHours: 24, ...overrides });
function entry(domains: string[], priority = 'p3') {
  return normalizeWatchlistEntry({ results: domains.map(domain => ({ domain, scanDepth: 'fast', availability: 'registered' })),
    domainMetadata: domains.map(domain => ({ domain, contexts: [{ brandProfileId: null, priority,
      changedAt: AT, reviewDueAt: null, reason: 'Private analyst reason must not enter a planning report' }] })) });
}

test('plans exact active membership and compatible overlaps without copying private context', () => {
  const source = buildWatchlistExport({ First: entry(['alpha.example', 'beta.example']), Second: entry(['beta.example'], 'p1') }, AT);
  const original = structuredClone(source);
  const result = buildMonitoringPlan(selection(source), AT);
  assert.deepEqual(result.targets.map(target => target.domain), ['alpha.example', 'beta.example']);
  assert.equal(result.counts.watchlistMemberships, 3);
  assert.equal(result.counts.sharedMemberships, 1);
  assert.equal(result.counts.plannedLookupsPerWeek, 14);
  assert.deepEqual(result.targets[1]?.priorities, ['p1', 'p3']);
  assert.deepEqual(result.sources, ['rdap', 'domain_evidence']);
  assert.deepEqual(result.estimates, { networkRequests: null, storageBytes: null, cost: null });
  assert.equal(JSON.stringify(result).includes('Private analyst reason'), false);
  assert.equal(result.networkRequestsMade, false);
  assert.equal(result.changesSchedules, false);
  assert.deepEqual(source, original);
});

test('keeps requested purpose, cadence and review priority independent', () => {
  const ordinary = buildMonitoringPlan(selection({ One: entry(['alpha.example'], 'p4') }), AT);
  const urgent = buildMonitoringPlan(selection({ One: entry(['alpha.example'], 'p1') }), AT);
  assert.equal(ordinary.mode, urgent.mode);
  assert.equal(ordinary.intervalHours, urgent.intervalHours);
  assert.equal(ordinary.counts.plannedLookupsPerWeek, urgent.counts.plannedLookupsPerWeek);
  const deeper = buildMonitoringPlan(selection({ One: entry(['alpha.example']) }, { purpose: 'configuration', intervalHours: 6 }), AT);
  assert.equal(deeper.mode, 'deep');
  assert.ok(deeper.sources.includes('whois'));
  assert.equal(deeper.counts.plannedLookupsPerWeek, 28);
  assert.equal(deeper.execution.hosted.collectionModeCompatible, false);
  assert.equal(deeper.execution.hosted.enabledByPlan, false);
});

test('includes selected candidates without inventing observations and excludes historical-only targets', () => {
  const value = entry(['alpha.example']);
  value.baseline.push(...entry(['historical.example']).results);
  value.domainMetadata.push({ domain: 'candidate.example', candidate: null, contexts: [] });
  const result = buildMonitoringPlan(selection({ One: value }), AT);
  assert.deepEqual(result.targets.map(target => target.domain), ['alpha.example', 'candidate.example']);
  assert.equal(result.counts.withoutRetainedObservation, 1);
  assert.equal(result.targets[1]?.hasRetainedObservation, false);
  assert.equal(result.execution.hosted.targetCountWithinCapacity, true);
});

test('rejects unsupported planning inputs rather than enabling a schedule', () => {
  assert.throws(() => buildMonitoringPlan(selection({}, { version: 99 }), AT), TypeError);
  assert.throws(() => buildMonitoringPlan(selection({}, { intervalHours: 1 }), AT), TypeError);
  assert.throws(() => buildMonitoringPlan(selection({}, { purpose: 'paid-provider' }), AT), TypeError);
  assert.throws(() => buildMonitoringPlan(selection({ schema: 'whoisleuth.watchlists', version: 99, watchlists: {} }), AT), /unsupported/iu);
  assert.equal(buildMonitoringPlan(selection({}), AT).counts.plannedLookupsPerWeek, 0);
});

test('the production CLI reviews the same local plan with valid JSON and quiet output', async () => {
  const source = JSON.stringify(selection(buildWatchlistExport({ One: entry(['alpha.example']) }, AT)));
  let stdout = '', stderr = '', requests = 0;
  const dependencies = { readArtifactInput: () => source, now: () => AT,
    stdout: { write: (value: string) => { stdout += value; } }, stderr: { write: (value: string) => { stderr += value; } },
    runUnifiedLookup: async () => { requests++; throw new Error('No collection is permitted'); } };
  assert.equal(await runCli(['review-evidence', 'plan.json', '--json'], dependencies), 0);
  const report = JSON.parse(stdout);
  assert.equal(report.kind, 'monitoring_plan');
  assert.equal(report.result.counts.plannedLookupsPerWeek, 7);
  assert.equal(report.result.networkRequestsMade, false);
  assert.equal(requests, 0);
  assert.equal(stderr, '');
  stdout = '';
  assert.equal(await runCli(['review-evidence', 'plan.json', '--quiet'], dependencies), 0);
  assert.equal(stdout, '');
  assert.equal(requests, 0);
});

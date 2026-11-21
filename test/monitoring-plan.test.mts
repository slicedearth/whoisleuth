import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { buildMonitoringPlan } from '../packages/monitoring/monitoring-plan.mts';
import { MONITORING_PLAN_INPUT_SCHEMA, MONITORING_PLAN_VERSION } from '../packages/contracts/monitoring-plan.mts';
import { normalizeWatchlistEntry } from '../packages/workspace/watchlist-history.mts';
import { buildWatchlistExport } from '../packages/workspace/watchlist-store.mts';
import { runCli } from '../cli/runner.mts';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturedWebCollectionQuality } from '../packages/evidence/collection-quality.mts';
import { cliInvocationNetworkEffect } from '../cli/command-reference.mts';

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

test('per-domain purpose, cadence and priority remain independent and version-1 plans keep their defaults', () => {
  const source = { One: entry(['alpha.example', 'beta.example']) };
  const plan = buildMonitoringPlan(selection(source, { targetPolicies: [{ domain: 'beta.example', purpose: 'configuration', intervalHours: 6, priority: 'p1' }] }), AT);
  assert.deepEqual(plan.targets.map(({ domain, mode, intervalHours, priority }) => ({ domain, mode, intervalHours, priority })), [
    { domain: 'alpha.example', mode: 'fast', intervalHours: 24, priority: 'p3' },
    { domain: 'beta.example', mode: 'deep', intervalHours: 6, priority: 'p1' },
  ]);
  assert.equal(plan.counts.plannedLookupsPerWeek, 35);
  assert.equal(plan.counts.checksPerTargetPerWeek, null);
  const historical = buildMonitoringPlan({ ...selection(source), version: 1 }, AT);
  assert.ok(historical.targets.every(target => target.mode === 'fast' && target.intervalHours === 24));
  assert.throws(() => buildMonitoringPlan(selection(source, { targetPolicies: [{ domain: 'absent.example', purpose: 'registration', intervalHours: 24, priority: 'p1' }] }), AT));
  assert.throws(() => buildMonitoringPlan({ ...selection(source), version: 1, targetPolicies: [] }, AT));
});

async function localHarness(t: TestContext, input: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-local-monitor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = join(root, 'plan.json'), state = join(root, 'state.json');
  await writeFile(plan, JSON.stringify(input), { mode: 0o600 });
  let now = AT, stdout = '', stderr = '';
  const calls: Array<{ domain: string; fast: boolean | undefined }> = [];
  let collect = async () => ({ availability: { state: 'registered', nameservers: ['ns.example'], hasMx: true, hasSpf: false, hasDmarc: true,
    activityStatus: 'active', pageTitle: 'Selected website', hasPasswordField: true, hasExternalPasswordForm: false,
    webCollectionQuality: capturedWebCollectionQuality('complete', 'complete'), ignoredPrivateField: 'not retained' }, diagnostics: { rdap: { status: 'success' } } });
  return { plan, state, root, calls, advance: (hours: number) => { now = new Date(Date.parse(now) + hours * 3_600_000).toISOString(); },
    setCollect: (callback: typeof collect) => { collect = callback; },
    async run(extra: string[] = [], signal?: AbortSignal) {
      stdout = ''; stderr = '';
      const code = await runCli(['monitor-tick', plan, '--state', state, '--json', ...extra], { now: () => now,
        ...(signal ? { signal } : {}), stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } },
        runUnifiedLookup: async (target, options) => { calls.push({ domain: target.value, fast: options?.fast }); return collect(); } });
      return { code, stdout, stderr };
    }, readState: async () => JSON.parse(await readFile(state, 'utf8')) };
}

test('the real command previews without requests and executes resumable priority-ordered compact evidence', async t => {
  const h = await localHarness(t, selection({ One: entry(['alpha.example', 'beta.example', 'gamma.example']) }, { purpose: 'configuration',
    targetPolicies: [{ domain: 'gamma.example', purpose: 'configuration', intervalHours: 24, priority: 'p1' }] }));
  assert.equal((await h.run()).code, 0);
  assert.deepEqual(await readdir(h.root), ['plan.json']);
  assert.equal(h.calls.length, 0);
  assert.equal(cliInvocationNetworkEffect('monitor-tick', [h.plan]), 'offline');
  assert.equal(cliInvocationNetworkEffect('monitor-tick', [h.plan, '--approve-network']), 'network');
  const first = await h.run(['--approve-network']);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(h.calls, [{ domain: 'gamma.example', fast: false }, { domain: 'alpha.example', fast: false }]);
  assert.equal((await h.readState()).scheduler.activeRun.cursor, 2);
  assert.equal((await h.readState()).quota.attempts, 2);
  h.advance(24);
  const second = await h.run(['--approve-network']);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(h.calls.at(-1)?.domain, 'beta.example');
  const stored = await h.readState(), exported = JSON.parse(second.stdout);
  assert.equal(stored.scheduler.activeRun, null);
  assert.equal(stored.scheduler.watchlists[0].entry.history.at(-1).mode, 'deep');
  assert.equal(stored.quota.attempts, 1);
  assert.equal(stored.scheduler.watchlists[0].entry.results[0].hasPasswordField, true);
  assert.equal(stored.scheduler.watchlists[0].entry.results[0].hasExternalPasswordForm, undefined);
  assert.equal(stored.scheduler.watchlists[0].entry.results[0].riskScore, null);
  assert.equal(normalizeWatchlistEntry(Object.values(exported.watchlists)[0]).results.length, 3);
  assert.equal(JSON.stringify(stored).includes('not retained'), false);
  assert.equal((await h.run(['--approve-network', '--quiet'])).stdout, '');
  assert.equal(h.calls.length, 3);
  assert.deepEqual((await readdir(h.root)).sort(), ['plan.json', 'state.json']);
  assert.notEqual((await h.run(['--approve-network', '--output', h.state, '--force'])).code, 0);
  assert.equal(h.calls.length, 3);
});

test('daily attempts, cancellation and exact configuration binding survive real file resumes', async t => {
  const h = await localHarness(t, selection({ One: entry(['alpha.example']) }, { intervalHours: 6, maxLookupsPerDay: 1 }));
  assert.equal((await h.run(['--approve-network'])).code, 0);
  h.advance(6);
  const held = await h.run(['--approve-network']);
  assert.equal(held.code, 0);
  assert.match(held.stderr, /daily_quota/u);
  assert.equal(h.calls.length, 1);
  h.advance(18);
  const controller = new AbortController();
  h.setCollect(async () => { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); });
  assert.equal((await h.run(['--approve-network'], controller.signal)).code, 130);
  assert.equal((await h.readState()).quota.attempts, 1);
  assert.equal((await h.readState()).scheduler.activeRun.cursor, 0);
  await writeFile(h.plan, JSON.stringify(selection({ One: entry(['alpha.example']) }, { purpose: 'configuration' })));
  assert.notEqual((await h.run(['--approve-network'])).code, 0);
  assert.equal(h.calls.length, 2);
});

test('unsupported exact hosts and incomplete web collection never become retargeting or conclusive drift', async t => {
  const child = await localHarness(t, selection({ One: entry(['child.alpha.example']) }));
  assert.notEqual((await child.run(['--approve-network'])).code, 0);
  assert.equal(child.calls.length, 0);
  const h = await localHarness(t, selection({ One: entry(['alpha.example']) }, { purpose: 'configuration', intervalHours: 6 }));
  assert.equal((await h.run(['--approve-network'])).code, 0);
  h.advance(6);
  h.setCollect(async () => ({ availability: { state: 'registered', nameservers: ['ns.example'], hasMx: true, hasSpf: false, hasDmarc: true,
    activityStatus: 'active', pageTitle: 'Selected website', hasPasswordField: false, hasExternalPasswordForm: false,
    webCollectionQuality: capturedWebCollectionQuality('unavailable', 'unavailable'), ignoredPrivateField: 'not retained' }, diagnostics: { rdap: { status: 'success' } } }));
  const result = await h.run(['--approve-network']);
  assert.equal(result.code, 4, result.stderr);
  const group = (await h.readState()).scheduler.watchlists[0];
  assert.equal(group.entry.baseline[0].hasPasswordField, true);
  assert.equal(group.entry.results[0].webCollectionQuality.page, 'unavailable');
  assert.equal(group.entry.history.at(-1).changes.some((change: { field: string }) => change.field === 'hasPasswordField'), false);
});

test('a fulfilled constituent-source failure remains partial without discarding valid current evidence', async t => {
  const h = await localHarness(t, selection({ One: entry(['alpha.example']) }, { purpose: 'configuration' }));
  h.setCollect(async () => ({ availability: { state: 'registered', nameservers: ['ns.example'], hasMx: true, hasSpf: false, hasDmarc: true,
    activityStatus: 'active', pageTitle: 'Selected website', hasPasswordField: true, hasExternalPasswordForm: false,
    webCollectionQuality: capturedWebCollectionQuality('complete', 'complete'), ignoredPrivateField: 'not retained' }, diagnostics: { rdap: { status: 'partial' } } }));
  assert.equal((await h.run(['--approve-network'])).code, 4);
  const group = (await h.readState()).scheduler.watchlists[0];
  assert.equal(group.status, 'partial');
  assert.equal(group.entry.results[0].availability, 'registered');
});

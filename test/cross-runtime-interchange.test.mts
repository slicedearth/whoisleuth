import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import {
  buildLookupReplayCaseEvidence,
  parseLookupEvidenceReplay,
} from '../frontend/src/lib/analysis/lookup-evidence-replay.ts';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { mergeCases } from '../packages/cases/case-migration-model.mts';
import { MONITORING_PLAN_INPUT_SCHEMA, MONITORING_PLAN_VERSION } from '../packages/contracts/monitoring-plan.mts';
import { capturedWebCollectionQuality } from '../packages/evidence/collection-quality.mts';
import { normalizeWatchlistEntry } from '../packages/workspace/watchlist-history.mts';
import { mergeWatchlistStores, parseWatchlistExport } from '../packages/workspace/watchlist-store.mts';
import {
  buildWorkspaceArchive,
  mergeReadyWorkspaceArchiveData,
  previewWorkspaceArchive,
} from '../packages/workspace/workspace-archive.mts';

// Each workflow crosses the real CLI command boundary and the browser's own
// readers and merge owners. Fixtures use reserved names and make no request.

const NOW = '2026-11-01T00:00:00.000Z';

async function scratch(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-cross-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return async (name: string, value: string) => {
    const path = join(root, name);
    await writeFile(path, value, { mode: 0o600 });
    return path;
  };
}

// Mirrors the Dashboard import: every ready data section through its merge
// owner, and workspace settings through their separate normalised preview.
async function importAsBrowser(raw: unknown): Promise<Record<string, unknown>> {
  const preview = await previewWorkspaceArchive(raw, {});
  assert.equal(preview.unsupportedCount, 0);
  const data = preview.sections.filter(section => section.status === 'ready' && section.id !== 'settings');
  const merged = mergeReadyWorkspaceArchiveData({}, data, NOW);
  return {
    ...Object.fromEntries(merged.map(section => [section.id, section.document])),
    settings: preview.sections.find(section => section.id === 'settings')?.normalizedSettings ?? {},
  };
}

async function cli(args: string[], dependencies: Record<string, unknown> = {}) {
  let stdout = '', stderr = '';
  const code = await runCli(args, {
    now: () => NOW,
    stdout: { write: (value: string) => { stdout += value; } },
    stderr: { write: (value: string) => { stderr += value; } },
    ...dependencies,
  });
  return { code, stdout, stderr };
}

test('a CLI Lookup export replays in the browser and becomes Case evidence that the CLI verifies again', async t => {
  const file = await scratch(t);
  const saved = readFileSync(new URL('./fixtures/cli-lookup-v1.json', import.meta.url), 'utf8');
  const exported = await cli(['export', await file('lookup.json', saved)]);
  assert.equal(exported.code, EXIT_CODES.SUCCESS, exported.stderr);

  const document = JSON.parse(exported.stdout);
  const replay = await parseLookupEvidenceReplay(exported.stdout, {
    expectedSha256: createHash('sha256').update(exported.stdout).digest('hex'),
  });
  assert.equal(replay.digestVerified, true);
  assert.equal(replay.schemaVersion, document.schemaVersion);
  assert.equal(replay.target, document.query.inputHostname);
  assert.equal(replay.caseDomain, document.query.registrableDomain);
  assert.equal(replay.exportedAt, document.generatedAt);
  assert.ok(replay.sources.length > 0);

  const evidence = buildLookupReplayCaseEvidence(replay);
  const record = createCase({ domain: replay.caseDomain!, source: 'import', evidence }, NOW);
  assert.equal(record.evidenceHistory.length, 1);
  assert.equal(record.evidenceHistory[0]?.capturedAt, replay.exportedAt);

  const archive = JSON.stringify(await buildWorkspaceArchive({ cases: [record] }, { generatedAt: NOW }));
  // Unsigned workspace archives are integrity-checked, not authenticated, so
  // the documented handoff uses verify-artifact without --strict-exit.
  const verified = await cli(['verify-artifact', await file('workspace.json', archive), '--json']);
  assert.equal(verified.code, EXIT_CODES.SUCCESS, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).artifact.kind, 'workspace_archive');
  assert.equal(JSON.parse(verified.stdout).summary.fullyImportable, true);
  const restored = mergeCases([], (await previewWorkspaceArchive(JSON.parse(archive), {}))
    .sections.find(section => section.id === 'cases')?.data).cases;
  assert.deepEqual(restored, [record]);
});

test('a browser monitoring plan runs through the CLI and its Watchlist export merges back without losing evidence', async t => {
  const file = await scratch(t);
  const domains = ['alpha.example', 'beta.example'];
  const watchlist = normalizeWatchlistEntry({
    results: domains.map(domain => ({ domain, scanDepth: 'fast', availability: 'registered' })),
  });
  // The same input shape the Watchlist History plan control downloads.
  const plan = { schema: MONITORING_PLAN_INPUT_SCHEMA, version: MONITORING_PLAN_VERSION,
    watchlists: { Launch: watchlist }, purpose: 'configuration', intervalHours: 24, targetPolicies: [], maxLookupsPerDay: 2 };
  const planPath = await file('monitoring-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
  const statePath = join(planPath, '..', 'state.json');
  const collected: string[] = [];
  const run = await cli(['monitor-tick', planPath, '--state', statePath, '--approve-network', '--json'], {
    runUnifiedLookup: async (target: { value: string }) => {
      collected.push(target.value);
      return { availability: { state: 'registered', nameservers: ['ns.example'], hasMx: true, hasSpf: true, hasDmarc: false,
        activityStatus: 'active', pageTitle: 'Example page', webCollectionQuality: capturedWebCollectionQuality('complete', 'complete') },
        diagnostics: { rdap: { status: 'success' } } };
    },
  });
  assert.equal(run.code, EXIT_CODES.SUCCESS, run.stderr);
  assert.deepEqual(collected.sort(), domains);

  const imported = parseWatchlistExport(run.stdout);
  const merged = mergeWatchlistStores({ Launch: watchlist }, imported);
  const names = Object.keys(merged.watchlists);
  assert.ok(names.includes('Launch'), 'the original watchlist stays in place');
  const added = names.filter(name => name !== 'Launch');
  assert.equal(added.length, 1);
  const entry = normalizeWatchlistEntry(merged.watchlists[added[0]!]);
  assert.deepEqual(entry.results.map(result => result.domain).sort(), domains);
  assert.ok(entry.results.every(result => result.scanDepth === 'deep' && result.hasMx === true && result.pageTitle === 'Example page'));
  assert.equal(entry.history.at(-1)?.mode, 'deep');
});

test('a populated current workspace passes CLI verification and fidelity review and re-imports byte for byte', async t => {
  const file = await scratch(t);
  const caseExport = JSON.parse(readFileSync(new URL('./fixtures/case-lifecycle/case-export-v21-context.json', import.meta.url), 'utf8'));
  const legacy = JSON.parse(readFileSync(new URL('./fixtures/workspace-populated-v5-public.json', import.meta.url), 'utf8'));
  const workspace = await importAsBrowser(legacy);
  workspace.cases = mergeCases(workspace.cases as never[] ?? [], caseExport).cases;
  const archive = JSON.stringify(await buildWorkspaceArchive(workspace, { generatedAt: NOW }));
  const path = await file('workspace.json', archive);

  const verified = await cli(['verify-artifact', path, '--json']);
  assert.equal(verified.code, EXIT_CODES.SUCCESS, verified.stderr);
  const verification = JSON.parse(verified.stdout);
  assert.equal(verification.checks.structure, 'verified');
  assert.equal(verification.checks.contentIntegrity, 'verified');
  const report = await cli(['interchange-report', path, '--json']);
  assert.equal(report.code, EXIT_CODES.SUCCESS, report.stderr);
  assert.equal(JSON.parse(report.stdout).compatibility.fullyImportable, true);

  const restoredWorkspace = await importAsBrowser(JSON.parse(archive));
  const restored = JSON.stringify(await buildWorkspaceArchive(restoredWorkspace, { generatedAt: NOW }));
  assert.equal(restored, archive);
  const sighting = (restoredWorkspace.cases as ReturnType<typeof mergeCases>['cases'])
    .flatMap(record => record.sightings).find(item => item.context);
  assert.ok(sighting, 'current sighting encounter context survives the round trip');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BulkCaseActions, bulkCaseInput, type BulkCaseContext } from '../frontend/src/lib/controllers/bulk-case-actions.ts';
import { BulkMonitorActions } from '../frontend/src/lib/controllers/bulk-monitor-actions.ts';
import { BrowserLocalDataError } from '../frontend/src/lib/browser-local-data-content.ts';
import { createCase, type CaseRecord } from '../packages/cases/case-model.mts';
import { relationshipObservation } from '../packages/comparison/relationship-evidence.mts';
import type { ScanResult } from '../frontend/src/lib/analysis/bulk-result-model.ts';
import { buildBulkResultsCsv } from '../frontend/src/lib/analysis/bulk-export.ts';
import { casePruningNotice } from '../frontend/src/lib/analysis/case-mutation-feedback.ts';

function row(domain = 'candidate.example'): ScanResult {
  return {
    domain, status: 'complete', availability: 'registered', confidence: 'high', registrar: 'Example registrar',
    activity: 'Active site', risk: null, opportunity: null, mutationTypes: [], trusted: null, error: '',
    saved: { domain, scanDepth: 'fast', availability: 'registered', registrarName: 'Example registrar',
      nameservers: [], faviconHash: null, faviconPHash: null, riskFactors: [], mutationTypes: [],
      profileContext: { sourceState: 'ready', activeProfileId: null, profileUpdatedAt: null, limitation: '' } },
    nameservers: [], faviconHash: null, faviconPHash: null, faviconMatch: false, faviconNearMatch: false,
    reusesOfficialAssets: false, hasPasswordField: false, hasExternalFormAction: null, hasExternalPasswordForm: null, phishingLanguageMatch: null,
    registrant: null, abuseEvidence: null, ct: null, idn: null, dns: null, dnssec: null,
    relationship: relationshipObservation({}), sourceCoverage: [],
  };
}

function harness(overrides: Partial<BulkCaseContext['api']> = {}) {
  const record = createCase({ domain: 'candidate.example' }, '2026-01-01T00:00:00.000Z');
  let published: CaseRecord[] = [];
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected operation'); };
  const api: BulkCaseContext['api'] = {
    openCase: unexpected, editCase: unexpected, setCaseDispositions: unexpected,
    loadCases: async () => [record], dispositionLabel: value => String(value), MAX_CASE_BATCH_MUTATIONS: 2,
    ...overrides,
  };
  const context: BulkCaseContext = { api, selected: new Map([[record.domain, record]]) };
  const actions = new BulkCaseActions({ context: async () => context,
    publish: records => { published = records; }, changed: () => {}, confirm: () => true });
  return { actions, context, record, published: () => published };
}

test('Bulk Case projection retains unknown evidence and excludes contacts', () => {
  const input = row();
  input.registrant = { name: 'Private person', org: null, email: 'private@example.test' };
  input.abuseEvidence = { abuseEmail: 'private@example.test' };
  input.saved.profileContext = { sourceState: 'unavailable', activeProfileId: null, profileUpdatedAt: null, limitation: 'Unavailable context' };
  const projected = bulkCaseInput(input);
  assert.equal(projected.source, 'bulk');
  assert.equal(projected.evidence?.riskScore, null);
  assert.equal(projected.evidence?.profileContextState, 'unavailable');
  assert.equal(projected.evidence?.profileContextLimitation, 'Unavailable context');
  assert.doesNotMatch(JSON.stringify(projected), /Private person|private@example|registrant|abuseEmail/u);
});

test('committed pruning receipts survive aggregate summaries, later rejection and refresh failure', async () => {
  assert.equal(casePruningNotice(0), '');
  assert.equal(casePruningNotice(1), ' Removed 1 older evidence snapshot to fit workspace storage.');
  const h = harness({ loadCases: async () => { throw new Error('Unavailable'); } });
  let writes = 0;
  h.context.api.openCase = async () => {
    writes++;
    if (writes === 3) throw new Error('Rejected');
    return { cases: [h.record], record: h.record, created: true, pruned: writes };
  };
  await h.actions.createSelected([row(), row('two.example'), row('three.example')]);
  assert.match(h.actions.state.status, /2 committed, 1 rejected/u);
  assert.match(h.actions.state.status, /Removed 3 older evidence snapshots/u);
  assert.match(h.actions.state.status, /change was saved, but Cases could not be reread/u);
  h.context.api.openCase = async () => ({ cases: [h.record], record: h.record, created: true, pruned: 0 });
  await h.actions.open(row());
  assert.doesNotMatch(h.actions.state.status, /Removed/u);
});

test('Case actions preserve the selected incident and publish the committed snapshot if rereading fails', async () => {
  const h = harness({ loadCases: async () => { throw new Error('read unavailable'); } });
  let writes = 0;
  h.context.api.openCase = async (input, selection) => {
    assert.equal(input.domain, h.record.domain);
    assert.equal(selection?.caseId, h.record.id);
    return { cases: [h.record], record: h.record, created: false, pruned: 0 };
  };
  h.context.api.editCase = async (id, input) => {
    writes++;
    assert.equal(id, h.record.id);
    assert.deepEqual(input, { source: 'bulk', evidence: bulkCaseInput(row()).evidence });
    return { cases: [h.record], record: h.record, pruned: 0 };
  };
  await h.actions.open(row());
  assert.equal(writes, 1);
  assert.deepEqual(h.published(), [h.record]);
  assert.match(h.actions.state.status, /change was saved, but Cases could not be reread/u);
  assert.equal(h.actions.state.busy, false);
});

test('single-row and batch Case actions cannot overlap', async () => {
  const h = harness();
  let finish!: () => void, writes = 0;
  h.context.api.openCase = async () => {
    writes++;
    await new Promise<void>(resolve => { finish = resolve; });
    return { cases: [h.record], record: h.record, created: true, pruned: 0 };
  };
  const first = h.actions.open(row());
  await Promise.resolve();
  await h.actions.createSelected([row()]);
  await h.actions.setDisposition(row(), 'suspicious');
  assert.equal(writes, 1);
  assert.equal(h.actions.state.busy, true);
  finish(); await first;
  assert.equal(h.actions.state.busy, false);
});

test('a creation batch stops after uncertain commit state and never reports unattempted rows as rejected', async () => {
  let writes = 0;
  const h = harness({ openCase: async () => {
    writes++;
    throw new BrowserLocalDataError('LOCAL_DATA_COMMIT_UNKNOWN', 'Commit acknowledgement unavailable');
  } });
  await h.actions.createSelected([row(), row('second.example'), row('third.example')]);
  assert.equal(writes, 1);
  assert.match(h.actions.state.status, /0 committed, 0 rejected, 1 with unknown commit state/u);
  assert.match(h.actions.state.status, /2 not attempted/u);
});

test('Case disposition batches follow the service bound and preserve explicit incident membership', async () => {
  const rows = [row(), row('second.example'), row('third.example')];
  const h = harness();
  const records = rows.map(item => createCase({ domain: item.domain }, '2026-01-01T00:00:00.000Z'));
  const selected = h.context.selected as Map<string, CaseRecord>;
  for (const record of records) selected.set(record.domain, record);
  let submitted: readonly string[] = [];
  h.context.api.setCaseDispositions = async (ids, disposition) => {
    submitted = ids; assert.equal(disposition, 'suspicious');
    return { cases: records, changed: ids.length, pruned: 0 };
  };
  await h.actions.setSelectedDisposition(rows, 'suspicious');
  assert.deepEqual(submitted, records.slice(0, 2).map(record => record.id));
  assert.match(h.actions.state.status, /1 target was not changed.*2-Case batch limit/u);
});

test('unavailable Case context and cancelled confirmation perform no mutation', async () => {
  const unavailable = new BulkCaseActions({ context: async () => null, publish: () => assert.fail(), changed: () => {}, confirm: () => assert.fail() });
  await unavailable.open(row());
  assert.match(unavailable.state.status, /Cases are unavailable/u);
  const h = harness();
  const cancelled = new BulkCaseActions({ context: async () => h.context, publish: () => assert.fail(), changed: () => {}, confirm: () => false });
  await cancelled.createSelected([row()]);
  assert.equal(cancelled.state.busy, false);
});

for (const scope of ['all', 'selected', 'row'] as const) test(`Monitor ${scope} saves apply the same admission and exclusion rules`, async () => {
  let writes = 0;
  const actions = new BulkMonitorActions({
    saveSnapshot: async (_name, rows, mode) => {
      assert.notEqual(scope, 'row');
      writes++; assert.equal(rows.length, 1); assert.equal(mode, 'fast'); return [];
    },
    saveSingle: async (name, result, mode) => {
      assert.equal(scope, 'row');
      writes++; assert.equal(result.domain, 'candidate.example'); assert.equal(mode, 'fast');
      return { changes: [], created: true, name };
    },
  });
  const candidate = row();
  const request = { name: ' Review ', mode: 'fast' as const, profileReady: true, scope, rows: [candidate] };
  assert.equal((await actions.submit({ ...request, profileReady: false }))?.clearName, false);
  candidate.saved.profileContext.sourceState = 'unavailable';
  assert.match((await actions.submit(request))!.status, /Nothing was saved/u);
  candidate.saved.profileContext.sourceState = 'ready';
  candidate.trusted = 'official';
  assert.equal((await actions.submit(request))?.clearName, false);
  assert.equal(writes, 0);
  candidate.trusted = null;
  const saved = await actions.submit(request);
  assert.equal(writes, 1);
  assert.match(saved!.status, /to Review/u);
  assert.equal(saved?.clearName, scope !== 'row');
});

test('Monitor writes reject overlap and retain the draft after a failed write', async () => {
  let finish!: () => void, writes = 0;
  const actions = new BulkMonitorActions({
    saveSnapshot: async () => {
      writes++; await new Promise<void>(resolve => { finish = resolve; }); throw new Error('Storage unavailable');
    },
    saveSingle: async () => assert.fail('A selected snapshot must not use the single-domain operation'),
  });
  const request = { rows: [row()], name: 'Review', mode: 'fast' as const, profileReady: true, scope: 'selected' as const };
  const first = actions.submit(request);
  assert.equal(await actions.submit(request), null);
  finish();
  assert.deepEqual(await first, { status: 'Storage unavailable', clearName: false });
  assert.equal(writes, 1);
});

test('complete Bulk CSV preserves the independent column contract, unknowns and formula safety', () => {
  const candidate = row();
  candidate.registrar = '=formula';
  candidate.trusted = 'official';
  candidate.saved.profileContext.sourceState = 'unavailable';
  const csv = buildBulkResultsCsv([candidate]);
  const [header, values] = csv.split('\n').map(line => line.split(','));
  assert.deepEqual(header, ['domain', 'unicode_domain', 'idn_scripts', 'idn_mixed_script', 'idn_official_skeleton_matches',
    'availability', 'confidence', 'profile_context_state', 'profile_context_limitation', 'profile_status', 'registrar', 'activity',
    'risk', 'risk_model_version', 'risk_factors', 'opportunity', 'opportunity_model_version', 'mutations', 'error',
    'dns_status', 'dnssec', 'dns_a', 'dns_aaaa', 'dns_cname', 'dns_caa', 'technology_ids', 'tls_issuer', 'tls_spki_sha256',
    'ct_first_observed', 'ct_last_observed', 'ct_certificate_count', 'ct_hostnames']);
  assert.equal(values?.length, header?.length);
  assert.equal(values?.[9], '');
  assert.equal(values?.[10], "'=formula");
  assert.equal(values?.[12], '');
  assert.equal(buildBulkResultsCsv([]), header!.join(','));
});

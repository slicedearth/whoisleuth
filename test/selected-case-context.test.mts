import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCase, type CaseRecord } from '../frontend/src/lib/analysis/case-model.ts';
import { caseWorkspaceContext } from '../frontend/src/lib/analysis/case-workspace-context.ts';
import { createSelectedCaseContextReader, type SelectedCaseContextState } from '../frontend/src/lib/controllers/selected-case-context.ts';

function fixture(id = 'case-one'): CaseRecord {
  const record = normalizeCase({ id, domain: 'case-context.example', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' });
  assert.ok(record);
  return record;
}

test('selected Case context preserves tied and undated decisions without choosing an authority', () => {
  const record = fixture();
  const decision = { id: 'one', summary: 'Supporting assessment', rationale: 'First explanation', confidence: 'unknown' as const, confidenceBasis: '', evidencePinIds: [], createdAt: '2026-06-02T00:00:00.000Z' };
  record.decisions = [
    { ...decision, id: 'older', createdAt: '2026-06-01T00:00:00.000Z' },
    decision,
    { ...decision, id: 'two', summary: 'Contradicting assessment' },
    { ...decision, id: 'undated', createdAt: '' },
  ];
  const projected = caseWorkspaceContext(record);
  assert.deepEqual(projected.decisions.map((item) => item.id), ['one', 'two', 'undated']);
  assert.equal(projected.undatedDecisions, 1);
  assert.equal(projected.earlierDecisions, 1);
  assert.equal(projected.decisionTime, '2026-06-02T00:00:00.000Z');
  assert.deepEqual(record.decisions.map((item) => item.id), ['older', 'one', 'two', 'undated']);
});

test('context keeps active follow-ups, rejects invalid dates and retains tied independent review dates', () => {
  const record = fixture();
  const action: CaseRecord['actions'][number] = {
    id: 'open', type: 'security_contact_report', recipient: 'contact@example.test', contactSource: 'Reviewed route', routeObservedAt: null, routeReviewAfter: null,
    contactLimitations: [], dueAt: '2026-06-04T00:00:00.000Z', followUpAt: '2026-06-04T00:00:00.000Z', state: 'drafting', reference: null, providerOutcome: null, outcome: null,
    originActionId: null, history: [], historyOmitted: 0, historyLimitations: [], createdAt: record.createdAt, metadataUpdatedAt: record.updatedAt, updatedAt: record.updatedAt,
  };
  record.actions = [action, { ...action, id: 'closed', state: 'terminal', dueAt: '2026-06-01T00:00:00.000Z' }, { ...action, id: 'invalid', dueAt: '2026-02-31T00:00:00Z', followUpAt: null }];
  const review: CaseRecord['observedEffects']['reviews'][number] = {
    id: 'latest', state: 'not_checked', observedAt: '2026-06-02T00:00:00.000Z', sourceClass: 'analyst', source: 'Local review', completeness: 'unknown', limitations: [], evidencePinId: null, sightingId: null, followUpAt: '2026-06-05T00:00:00.000Z', createdAt: record.createdAt,
  };
  record.observedEffects.reviews = [{ ...review, id: 'old', observedAt: record.createdAt, followUpAt: '2026-06-03T00:00:00.000Z' }, review, { ...review, id: 'tie', followUpAt: '2026-06-06T00:00:00.000Z' }];
  assert.deepEqual(caseWorkspaceContext(record).followUps.map((item) => [item.id, item.at]), [
    ['due:open', '2026-06-04T00:00:00.000Z'], ['effect:latest', '2026-06-05T00:00:00.000Z'], ['effect:tie', '2026-06-06T00:00:00.000Z'],
  ]);
});

test('context exposes all retained open hypotheses without treating other assertions as hypotheses', () => {
  const record = fixture();
  const assertion = { id: 'one', kind: 'hypothesis' as const, statement: 'A possible explanation', rationale: null, evidencePinIds: [], state: 'open' as const, createdAt: record.createdAt, updatedAt: record.updatedAt };
  record.assertions = [assertion, { ...assertion, id: 'two' }, { ...assertion, id: 'fact', kind: 'verified_fact' }];
  assert.deepEqual(caseWorkspaceContext(record).hypotheses.map((item) => item.id), ['one', 'two']);
});

test('context reader coalesces refreshes and discards an old selected Case result', async () => {
  let selected = 'case-one';
  const published: SelectedCaseContextState[] = [];
  const reads: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reader = createSelectedCaseContextReader({
    selectedId: () => selected,
    read: async (id) => { reads.push(id); if (id === 'case-one') await gate; return fixture(id); },
    publish: (state) => { published.push(state); },
  });
  const first = reader.refresh();
  await Promise.resolve();
  selected = 'case-two';
  const second = reader.refresh();
  reader.refresh();
  assert.equal(first, second);
  release(); await first;
  assert.deepEqual(reads, ['case-one', 'case-two']);
  assert.deepEqual(published.filter((state) => state.phase === 'ready').map((state) => state.id), ['case-two']);
  reader.stop();
});

test('context reader retains the current view while refreshing but never presents missing, failed or mismatched reads as ready', async () => {
  let mode: 'ready' | 'missing' | 'failed' | 'mismatch' = 'ready';
  const published: SelectedCaseContextState[] = [];
  const reader = createSelectedCaseContextReader({
    selectedId: () => 'case-one',
    read: async () => { if (mode === 'failed') throw new Error('Store unavailable'); return mode === 'missing' ? null : fixture(mode === 'mismatch' ? 'other-case' : 'case-one'); },
    publish: (state) => { published.push(state); },
  });
  await reader.refresh();
  await reader.refresh();
  assert.equal(published[2]?.phase, 'loading');
  assert.equal(published[2]?.record?.id, 'case-one');
  for (const scenario of ['missing', 'failed', 'mismatch'] as const) {
    mode = scenario;
    await reader.refresh();
    assert.equal(published.at(-1)?.phase, scenario === 'missing' ? 'missing' : 'unavailable');
    assert.equal(published.at(-1)?.record, null);
  }
  reader.stop();
});

test('context reader cannot publish a completion after unmount or sign-out', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const phases: string[] = [];
  const reader = createSelectedCaseContextReader({ selectedId: () => 'case-one', read: async () => { await gate; return fixture(); }, publish: (state) => { phases.push(state.phase); } });
  const pending = reader.refresh();
  await Promise.resolve(); reader.stop(); release(); await pending;
  await reader.refresh();
  assert.deepEqual(phases, ['loading']);
});

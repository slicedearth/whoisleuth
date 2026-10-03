import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bulkNavigationView, bulkReviewView, clearBulkViewFilters, createBulkViewState, restoreBulkView, type BulkViewState } from '../frontend/src/lib/controllers/bulk-view-state.ts';

test('Bulk view reset owns every filter while preserving table choices', () => {
  const initial = createBulkViewState();
  const edited: BulkViewState = { ...initial, filter: 'registered', mutationFilter: 'addition', signalFilters: new Set(['has_mx']),
    sourceFilter: 'limited' as const, lifecycleFilter: 'expiring' as const, ageFilter: 'new_30' as const,
    mailFilter: 'mail' as const, registrarFilter: 'Example registrar', caseDispositionFilter: 'malicious',
    reviewStateFilter: 'reviewed' as const, groupBy: 'registrar' as const, sortKey: 'domain' as const,
    sortDirection: 1, resultColumns: ['registration'], page: 3 };
  const reset = clearBulkViewFilters(edited);
  assert.deepEqual(reset, { ...initial, groupBy: 'registrar', sortKey: 'domain', sortDirection: 1, resultColumns: ['registration'] });
  reset.signalFilters.add('new-signal');
  reset.resultColumns.push('risk');
  assert.deepEqual([...edited.signalFilters], ['has_mx']);
  assert.deepEqual(edited.resultColumns, ['registration']);
  assert.deepEqual(createBulkViewState(), initial);
});

test('saved review views round-trip all filters without sharing mutable selections', () => {
  const state = createBulkViewState();
  state.filter = 'errors';
  state.signalFilters.add('has_mx');
  state.reviewStateFilter = 'reviewed';
  state.page = 4;
  const saved = bulkReviewView(state);
  const restored = restoreBulkView(saved);
  assert.deepEqual(restored, { ...state, page: 1 });
  restored.signalFilters.clear();
  restored.resultColumns.length = 0;
  assert.deepEqual(saved.signalFilters, ['has_mx']);
  assert.ok(saved.columns.length);
  assert.ok(state.resultColumns.length);
});

test('navigation retains constraints and page but resets independently loaded review state and columns', () => {
  const state = createBulkViewState();
  state.registrarFilter = 'Example registrar';
  state.reviewStateFilter = 'reviewed';
  state.resultColumns = ['registration'];
  state.page = 3;
  const restored = restoreBulkView(bulkNavigationView(state), state.page);
  assert.equal(restored.registrarFilter, state.registrarFilter);
  assert.equal(restored.page, 3);
  assert.equal(restored.reviewStateFilter, '');
  assert.deepEqual(restored.resultColumns, createBulkViewState().resultColumns);
  assert.equal(state.reviewStateFilter, 'reviewed');
  assert.deepEqual(state.resultColumns, ['registration']);
});

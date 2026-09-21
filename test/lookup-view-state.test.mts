import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLookupResultState, createLookupWatchlistState, restoreLookupResultState } from '../frontend/src/lib/controllers/lookup-view-state.ts';
import type { LookupWorkflowState } from '../frontend/src/lib/console-workflow-state.ts';

function saved(): LookupWorkflowState {
  return {
    query: 'other.test', completedTarget: 'example.test', completedIncidentUrl: 'https://example.test/path?case=example',
    completedLookupDepth: 'deep', lookupMode: 'fast', includeExternalIntelligence: false,
    includeMalwareHostIntelligence: false, includeMalwareIocIntelligence: false, includeSecurityTxt: false,
    error: '', result: { query: 'example.test', type: 'domain', registrableDomain: 'example.test',
      rdap: {}, whois: {}, availability: {}, diagnostics: {} },
  };
}

test('each observation begins with independent transient state', () => {
  const before = createLookupResultState();
  before.expandedSections.push('web-evidence');
  before.draftStatus = 'Copied an earlier draft';
  before.serviceScope = 'Earlier scope';
  const next = createLookupResultState();
  assert.deepEqual(next.expandedSections, []);
  assert.equal(next.draftStatus, '');
  assert.equal(next.serviceScope, '');
  assert.equal(next.response, null);
  assert.equal(next.refreshLedger, null);
});

test('navigation restores completed observation identity, not the current form input or presentation', () => {
  const input = saved();
  const restored = restoreLookupResultState(input);
  assert.equal(restored.response, input.result);
  assert.equal(restored.target, 'example.test');
  assert.equal(restored.depth, 'deep');
  assert.equal(restored.incidentUrl, input.completedIncidentUrl);
  assert.deepEqual(restored.expandedSections, []);
  assert.equal(restored.exportStatus, '');
});

test('restoration retains supported legacy depth evidence but rejects unknown depth and invalid URLs', () => {
  const input = saved();
  delete input.completedLookupDepth;
  assert.deepEqual(restoreLookupResultState(input), createLookupResultState());
  input.result = { ...input.result!, availability: { deepScanComplete: false } };
  input.completedIncidentUrl = 'https://user:secret@example.test/';
  const restored = restoreLookupResultState(input);
  assert.equal(restored.depth, 'fast');
  assert.equal(restored.incidentUrl, '');
  input.result = null;
  input.completedLookupDepth = 'deep';
  assert.deepEqual(restoreLookupResultState(input), createLookupResultState());
});

test('watchlist resets preserve a deliberate name only when the caller retains that draft', () => {
  const initial = createLookupWatchlistState();
  const prior = { ...initial, name: 'Review example', target: 'example.test', names: ['Earlier watch'],
    busy: true, sourceState: 'ready' as const, status: 'Earlier save' };
  assert.deepEqual(createLookupWatchlistState(), initial);
  assert.deepEqual(createLookupWatchlistState(prior), { ...initial, name: prior.name, target: prior.target });
});

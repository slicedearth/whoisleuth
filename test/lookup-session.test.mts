import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLookupSessionState, LookupSession } from '../frontend/src/lib/controllers/lookup-session.ts';
import type { LookupWorkflowState } from '../frontend/src/lib/console-workflow-state.ts';

function harness() {
  const state = createLookupSessionState();
  let invalidations = 0;
  const resets: boolean[] = [];
  const session = new LookupSession(state, {
    invalidateRequest: () => { invalidations++; },
    resetSavedContext: preserve => resets.push(preserve),
  });
  return { state, session, resets, get invalidations() { return invalidations; } };
}

function saved(): LookupWorkflowState {
  return {
    query: 'example.test', lookupMode: 'deep', includeExternalIntelligence: true,
    includeMalwareHostIntelligence: true, includeMalwareIocIntelligence: false, includeSecurityTxt: true,
    completedTarget: 'example.test', completedIncidentUrl: 'https://example.test/review',
    completedLookupDepth: 'deep', error: '',
    result: { query: 'example.test', type: 'domain', rdap: {}, whois: {}, diagnostics: {}, availability: {} },
  };
}

test('Lookup navigation restores request options and evidence without retaining active collection permission', () => {
  const h = harness(), input = saved();
  h.session.restore(input, 'owned', new URL('https://console.test/lookup'));
  assert.deepEqual(h.session.snapshot(), input);
  assert.equal(h.state.collectSelectedUrl, false);
  assert.equal(h.state.task, 'owned');
  assert.equal(h.state.visualView, 'timeline');
  assert.equal(h.state.urlReady, true);
  h.state.collectSelectedUrl = true;
  h.state.observation.expandedSections.push('web-evidence');
  const restored = harness();
  restored.session.restore(h.session.snapshot(), 'general', new URL('https://console.test/lookup'));
  assert.equal(restored.state.collectSelectedUrl, false);
  assert.deepEqual(restored.state.observation.expandedSections, []);
  assert.deepEqual(createLookupSessionState().request.query, '');
});

test('URL reconciliation invalidates a different request and cannot relabel completed evidence', () => {
  const h = harness();
  h.session.restore(saved(), 'general', new URL('https://console.test/lookup'));
  h.state.loading = true;
  h.state.loadingElapsedMs = 42;
  h.session.reconcileUrl(new URL('https://console.test/lookup?q=other.test&depth=fast&task=incident#registry'));
  assert.equal(h.invalidations, 1);
  assert.deepEqual(h.resets, [false]);
  assert.equal(h.state.observation.response, null);
  assert.equal(h.state.observation.target, '');
  assert.equal(h.state.loading, false);
  assert.equal(h.state.loadingElapsedMs, 0);
  assert.equal(h.state.request.query, 'other.test');
  assert.equal(h.state.request.lookupMode, 'fast');
  assert.equal(h.state.task, 'incident');
  assert.equal(h.state.visualView, 'relationships');
  assert.equal(h.state.lastUrl, '/lookup?q=other.test&depth=fast&task=incident');
});

test('editing an idle draft preserves observation identity while editing a pending request cancels it', () => {
  const h = harness();
  h.session.restore(saved(), 'general', new URL('https://console.test/lookup'));
  h.session.changeQuery('other.test');
  assert.equal(h.state.observation.target, 'example.test');
  assert.equal(h.invalidations, 0);
  h.state.loading = true;
  h.state.error = 'Previous failure';
  h.session.changeQuery('third.test');
  assert.equal(h.invalidations, 1);
  assert.equal(h.state.observation.response, null);
  assert.equal(h.state.error, '');
});

test('ambiguous historical depth is discarded and fragment navigation does not change the request identity', () => {
  const h = harness(), input = saved();
  delete input.completedLookupDepth;
  input.error = 'Old failure';
  h.session.restore(input, 'general', new URL('https://console.test/lookup#registry'));
  assert.equal(h.state.observation.response, null);
  assert.equal(h.state.error, '');
  assert.equal(h.state.lastUrl, '/lookup');
  h.session.selectTask('brand');
  assert.equal(h.state.preferredTask, 'brand');
  assert.equal(h.state.visualView, 'relationships');
  h.session.clearCompleted(true);
  assert.deepEqual(h.resets, [true]);
});

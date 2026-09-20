import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LOOKUP_GUIDANCE_TASKS,
  LOOKUP_TASK_VIEWS,
  lookupTaskGuidance,
} from '../packages/investigation/lookup-task-guidance.mts';
import { LOOKUP_TASK_VIEWS as presentationTasks } from '../frontend/src/lib/analysis/lookup-presentation.ts';

describe('Lookup task guidance', () => {
  test('recommends existing request modes without changing their contracts', () => {
    assert.equal(lookupTaskGuidance('general').recommendation, 'fast');
    assert.equal(lookupTaskGuidance('brand').recommendation, 'deep');
    assert.equal(lookupTaskGuidance('acquisition').recommendation, 'deep');
    assert.equal(lookupTaskGuidance('incident').recommendation, 'deep');
    assert.equal(lookupTaskGuidance('owned').recommendation, 'deep');
    assert.match(lookupTaskGuidance('general').requestExplanation, /omits WHOIS, DNS, HTTP, TLS/iu);
  });

  test('is bounded, deterministic, and defaults unknown input without starting work', () => {
    assert.deepEqual(LOOKUP_GUIDANCE_TASKS, [
      'general',
      'acquisition',
      'brand',
      'incident',
      'owned',
    ]);
    assert.deepEqual(lookupTaskGuidance({ task: 'acquisition' }), lookupTaskGuidance('general'));
    assert.equal(lookupTaskGuidance('brand'), lookupTaskGuidance('brand'));
  });

  test('keeps one immutable task catalogue and the independently expected public labels', () => {
    assert.equal(presentationTasks, LOOKUP_TASK_VIEWS);
    assert.deepEqual(LOOKUP_TASK_VIEWS, [
      { id: 'general', label: 'General investigation' },
      { id: 'acquisition', label: 'Acquisition review' },
      { id: 'brand', label: 'Brand review' },
      { id: 'incident', label: 'Incident response' },
      { id: 'owned', label: 'Owned-domain posture' },
    ]);
    assert.ok(Object.isFrozen(LOOKUP_TASK_VIEWS));
    assert.ok(LOOKUP_TASK_VIEWS.every(Object.isFrozen));
  });
});

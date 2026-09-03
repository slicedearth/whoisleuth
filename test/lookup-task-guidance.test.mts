import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LOOKUP_GUIDANCE_TASKS,
  lookupTaskGuidance,
} from '../packages/investigation/lookup-task-guidance.mts';

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
});

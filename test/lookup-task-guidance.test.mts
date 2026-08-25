import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LOOKUP_GUIDANCE_TASKS,
  lookupTaskGuidance,
} from '../packages/investigation/lookup-task-guidance.mts';

describe('Lookup task guidance', () => {
  test('recommends existing request modes without changing their contracts', () => {
    assert.equal(lookupTaskGuidance('registration_authority').recommendation, 'fast');
    assert.equal(lookupTaskGuidance('brand_impersonation').recommendation, 'deep');
    assert.equal(lookupTaskGuidance('acquisition').recommendation, 'deep');
    assert.equal(lookupTaskGuidance('retained_comparison').recommendation, 'review_retained');
    assert.match(lookupTaskGuidance('registration_authority').requestExplanation, /omits WHOIS, DNS, HTTP, TLS/iu);
    assert.match(lookupTaskGuidance('retained_comparison').requestExplanation, /zero target requests/iu);
  });

  test('is bounded, deterministic, and defaults unknown input without starting work', () => {
    assert.deepEqual(LOOKUP_GUIDANCE_TASKS, [
      'registration_authority',
      'brand_impersonation',
      'acquisition',
      'retained_comparison',
    ]);
    assert.deepEqual(lookupTaskGuidance({ task: 'acquisition' }), lookupTaskGuidance('registration_authority'));
    assert.equal(lookupTaskGuidance('brand_impersonation'), lookupTaskGuidance('brand_impersonation'));
  });
});

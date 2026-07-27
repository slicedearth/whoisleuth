import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { nonEmptyErrorMessage } from '../lib/error-detail.mts';

describe('nonEmptyErrorMessage', () => {
  test('preserves a meaningful Error message', () => {
    assert.equal(nonEmptyErrorMessage(new Error('resolver failed'), 'fallback'), 'resolver failed');
  });

  test('uses the fallback for empty, whitespace-only, and non-string messages', () => {
    assert.equal(nonEmptyErrorMessage(new Error(), 'fallback'), 'fallback');
    assert.equal(nonEmptyErrorMessage({ message: '   ' }, 'fallback'), 'fallback');
    assert.equal(nonEmptyErrorMessage({ message: 503 }, 'fallback'), 'fallback');
  });

  test('uses the fallback for primitive and null values', () => {
    assert.equal(nonEmptyErrorMessage(null, 'fallback'), 'fallback');
    assert.equal(nonEmptyErrorMessage('failure', 'fallback'), 'fallback');
  });
});

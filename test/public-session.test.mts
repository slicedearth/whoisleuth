import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyPublicSessionResponse } from '../frontend/src/lib/public-session.ts';

test('distinguishes explicit anonymous sessions from an unavailable session check', () => {
  assert.equal(classifyPublicSessionResponse(true, { authenticated: true }), 'authenticated');
  assert.equal(classifyPublicSessionResponse(true, { authenticated: false }), 'anonymous');
  assert.equal(classifyPublicSessionResponse(false, { authenticated: false }), 'unavailable');
  assert.equal(classifyPublicSessionResponse(true, {}), 'unavailable');
  assert.equal(classifyPublicSessionResponse(true, 'malformed'), 'unavailable');
});

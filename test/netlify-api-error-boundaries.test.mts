import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { NetlifyFunctionEvent } from '../lib/netlify-function-types.mts';

process.env.SITE_PASSWORD ||= 'test-only-secret';
process.env.SESSION_SECRET ||= 'test-only-session-signing-secret';

const [
  { default: loginHandler },
  { handler: capabilitiesHandler },
  { handler: sessionHandler },
  { handler: logoutHandler },
] = await Promise.all([
  import('../netlify/functions/login.mts'),
  import('../netlify/functions/capabilities.mts'),
  import('../netlify/functions/session.mts'),
  import('../netlify/functions/logout.mts'),
]);

function throwingLegacyEvent(property: string): NetlifyFunctionEvent {
  return Object.defineProperty({}, property, {
    get() {
      throw new Error('/private/path secret upstream detail');
    },
  });
}

function throwingRequest(property: string): Request {
  return Object.defineProperty(new Request('https://example.test/'), property, {
    get() {
      throw new Error('/private/path secret upstream detail');
    },
  });
}

function assertSanitizedNetlifyResponse(
  response: Awaited<ReturnType<typeof capabilitiesHandler>>,
): void {
  assert.ok(response);
  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const body = response.body;
  assert.equal(typeof body, 'string');
  if (typeof body !== 'string') return;
  assert.deepEqual(JSON.parse(body), {
    error: 'Internal server error',
    errorCode: 'INTERNAL_ERROR',
  });
  assert.doesNotMatch(body, /private|secret|upstream|path|node_modules/i);
}

describe('Netlify unexpected-error coverage', () => {
  test('sanitizes unexpected failures in simple legacy handlers', async () => {
    assertSanitizedNetlifyResponse(await capabilitiesHandler(throwingLegacyEvent('headers')));
    assertSanitizedNetlifyResponse(await sessionHandler(throwingLegacyEvent('headers')));
    assertSanitizedNetlifyResponse(await logoutHandler(throwingLegacyEvent('httpMethod')));
  });

  test('sanitizes unexpected failures in the modern login handler', async () => {
    const response = await loginHandler(throwingRequest('method'));
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {
      error: 'Internal server error',
      errorCode: 'INTERNAL_ERROR',
    });
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

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

function throwingEvent(property) {
  return Object.defineProperty({}, property, {
    get() {
      throw new Error('/private/path secret upstream detail');
    },
  });
}

function assertSanitizedNetlifyResponse(response) {
  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(JSON.parse(response.body), {
    error: 'Internal server error',
    errorCode: 'INTERNAL_ERROR',
  });
  assert.doesNotMatch(response.body, /private|secret|upstream|path|node_modules/i);
}

describe('Netlify unexpected-error coverage', () => {
  test('sanitizes unexpected failures in simple legacy handlers', async () => {
    assertSanitizedNetlifyResponse(await capabilitiesHandler(throwingEvent('headers')));
    assertSanitizedNetlifyResponse(await sessionHandler(throwingEvent('headers')));
    assertSanitizedNetlifyResponse(await logoutHandler(throwingEvent('httpMethod')));
  });

  test('sanitizes unexpected failures in the modern login handler', async () => {
    const response = await loginHandler(throwingEvent('method'));
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {
      error: 'Internal server error',
      errorCode: 'INTERNAL_ERROR',
    });
  });
});

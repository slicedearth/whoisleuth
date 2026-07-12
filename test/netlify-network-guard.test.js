const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const previousPassword = process.env.SITE_PASSWORD;
const previousSecret = process.env.SESSION_SECRET;
process.env.SITE_PASSWORD = 'network-guard-test-password';
process.env.SESSION_SECRET = 'network-guard-test-secret-with-sufficient-length';

const {
  buildSessionCookie,
  createSessionToken,
  sessionFingerprintFromCookieHeader,
} = require('../lib/auth');
const {
  DEFAULT_OPERATION_LIMITS,
  OPERATION_CLASSES,
  defaultOperationBudget,
} = require('../lib/operation-budget');
const { withNetlifyOperationBudget } = require('../lib/netlify-network-guard');

let cookie;
before(() => {
  cookie = buildSessionCookie(createSessionToken(), { secure: true }).split(';')[0];
});
after(() => {
  if (previousPassword === undefined) delete process.env.SITE_PASSWORD;
  else process.env.SITE_PASSWORD = previousPassword;
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

const networkHandlers = [
  ['lookup', require('../netlify/functions/lookup').handler],
  ['rdap', require('../netlify/functions/rdap').handler],
  ['whois', require('../netlify/functions/whois').handler],
  ['availability', require('../netlify/functions/availability').handler],
  ['certificate search', require('../netlify/functions/ct-search').handler],
  ['domain posture', require('../netlify/functions/domain-posture').handler],
];

describe('direct serverless network paths', () => {
  for (const [name, handler] of networkHandlers) {
    test(`${name} requires authentication before doing network work`, async () => {
      const response = await handler({ headers: {}, queryStringParameters: { q: 'example.com' } });
      assert.equal(response.statusCode, 401);
      assert.equal(JSON.parse(response.body).errorCode, 'AUTH_REQUIRED');
    });
  }

  test('returns a retryable stable error when the session concurrency budget is exhausted', async () => {
    const sessionKey = sessionFingerprintFromCookieHeader(cookie);
    const leases = [];
    try {
      for (let index = 0; index < DEFAULT_OPERATION_LIMITS.registry_light.session; index += 1) {
        const lease = defaultOperationBudget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, sessionKey);
        assert.equal(lease.allowed, true);
        leases.push(lease);
      }
      const response = await require('../netlify/functions/rdap').handler({
        headers: { cookie },
        queryStringParameters: { q: 'example.com' },
      });
      assert.equal(response.statusCode, 429);
      assert.equal(response.headers['Retry-After'], '1');
      const body = JSON.parse(response.body);
      assert.equal(body.errorCode, 'NETWORK_CONCURRENCY_LIMITED');
      assert.equal(body.operationClass, 'registry_light');
      assert.equal(body.limitScope, 'session');
    } finally {
      for (const lease of leases) lease.release();
    }
  });

  test('releases an acquired lease when downstream work throws', async () => {
    const sessionKey = sessionFingerprintFromCookieHeader(cookie);
    const before = defaultOperationBudget.status()
      .find((entry) => entry.id === OPERATION_CLASSES.REGISTRY_DEEP).active;
    await assert.rejects(
      withNetlifyOperationBudget(sessionKey, OPERATION_CLASSES.REGISTRY_DEEP, async () => {
        throw new Error('simulated downstream failure');
      }),
      /simulated downstream failure/,
    );
    const afterFailure = defaultOperationBudget.status()
      .find((entry) => entry.id === OPERATION_CLASSES.REGISTRY_DEEP).active;
    assert.equal(afterFailure, before);
  });
});

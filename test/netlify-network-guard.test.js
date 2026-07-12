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
const disabledNetworkHandlers = [
  ['lookup', 'WHOISLEUTH_DISABLE_LOOKUP', require('../netlify/functions/lookup').handler],
  ['rdap', 'WHOISLEUTH_DISABLE_RDAP', require('../netlify/functions/rdap').handler],
  ['whois', 'WHOISLEUTH_DISABLE_WHOIS', require('../netlify/functions/whois').handler],
  ['availability', 'WHOISLEUTH_DISABLE_AVAILABILITY', require('../netlify/functions/availability').handler],
  ['certificate_transparency', 'WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY', require('../netlify/functions/ct-search').handler],
  ['domain_posture', 'WHOISLEUTH_DISABLE_DOMAIN_POSTURE', require('../netlify/functions/domain-posture').handler],
];

async function withEnvironment(name, value, callback) {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

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

  for (const [feature, environmentName, handler] of disabledNetworkHandlers) {
    test(`blocks disabled ${feature} before any upstream work can begin`, async () => {
      await withEnvironment(environmentName, '1', async () => {
        const response = await handler({
          headers: { cookie },
          queryStringParameters: { q: 'example.com' },
        });
        assert.equal(response.statusCode, 503);
        const body = JSON.parse(response.body);
        assert.equal(body.errorCode, 'FEATURE_DISABLED');
        assert.equal(body.feature, feature);
        assert.equal(body.disabledBy, feature);
      });
    });
  }

  test('enforces dependency shutdown for direct posture audits', async () => {
    await withEnvironment('WHOISLEUTH_DISABLE_DNS_INTELLIGENCE', 'true', async () => {
      const response = await require('../netlify/functions/domain-posture').handler({
        headers: { cookie },
        queryStringParameters: { q: 'example.com' },
      });
      assert.equal(response.statusCode, 503);
      const body = JSON.parse(response.body);
      assert.equal(body.errorCode, 'FEATURE_DISABLED');
      assert.equal(body.feature, 'domain_posture');
      assert.equal(body.disabledBy, 'dns_intelligence');
    });
  });

  test('does not disclose disabled feature state to an unauthenticated caller', async () => {
    await withEnvironment('WHOISLEUTH_DISABLE_RDAP', '1', async () => {
      const response = await require('../netlify/functions/rdap').handler({
        headers: {},
        queryStringParameters: { q: 'example.com' },
      });
      assert.equal(response.statusCode, 401);
      assert.equal(JSON.parse(response.body).errorCode, 'AUTH_REQUIRED');
    });
  });
});

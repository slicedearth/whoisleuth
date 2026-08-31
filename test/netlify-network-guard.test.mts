import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const previousPassword = process.env.SITE_PASSWORD;
const previousSecret = process.env.SESSION_SECRET;
process.env.SITE_PASSWORD = 'network-guard-test-password';
process.env.SESSION_SECRET = 'network-guard-test-secret-with-sufficient-length';

import {
  buildSessionCookie,
  createSessionToken,
  sessionFingerprintFromCookieHeader,
} from '../lib/auth.mts';
import {
  DEFAULT_OPERATION_LIMITS,
  OPERATION_CLASSES,
  defaultOperationBudget,
} from '../lib/operation-budget.mts';
import { withNetlifyOperationBudget } from '../lib/netlify-network-guard.mts';
import { requiredValue } from './value-assertions.mts';

let cookie = '';
before(() => {
  cookie = requiredValue(buildSessionCookie(createSessionToken(), { secure: true }).split(';')[0]);
});
after(() => {
  if (previousPassword === undefined) delete process.env.SITE_PASSWORD;
  else process.env.SITE_PASSWORD = previousPassword;
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

function sameOriginHeaders() {
  return { cookie, host: 'console.example', 'sec-fetch-site': 'same-origin' };
}

const [
  { handler: lookupHandler },
  { handler: rdapHandler },
  { handler: rdapNameserverSearchHandler },
  { handler: whoisHandler },
  { handler: availabilityHandler },
  { handler: certificateSearchHandler },
  { handler: domainPostureHandler },
] = await Promise.all([
  import('../netlify/functions/lookup.mts'),
  import('../netlify/functions/rdap.mts'),
  import('../netlify/functions/rdap-nameserver-search.mts'),
  import('../netlify/functions/whois.mts'),
  import('../netlify/functions/availability.mts'),
  import('../netlify/functions/ct-search.mts'),
  import('../netlify/functions/domain-posture.mts'),
]);

type NetworkHandler = typeof lookupHandler;
type NetworkHandlerEntry = readonly [string, NetworkHandler];
type DisabledNetworkHandlerEntry = readonly [string, string, NetworkHandler];

const networkHandlers: NetworkHandlerEntry[] = [
  ['lookup', lookupHandler],
  ['rdap', rdapHandler],
  ['RDAP nameserver search', rdapNameserverSearchHandler],
  ['whois', whoisHandler],
  ['availability', availabilityHandler],
  ['certificate search', certificateSearchHandler],
  ['domain posture', domainPostureHandler],
];
const disabledNetworkHandlers: DisabledNetworkHandlerEntry[] = [
  ['lookup', 'WHOISLEUTH_DISABLE_LOOKUP', lookupHandler],
  ['rdap', 'WHOISLEUTH_DISABLE_RDAP', rdapHandler],
  ['rdap_nameserver_search', 'WHOISLEUTH_DISABLE_RDAP_NAMESERVER_SEARCH', rdapNameserverSearchHandler],
  ['whois', 'WHOISLEUTH_DISABLE_WHOIS', whoisHandler],
  ['availability', 'WHOISLEUTH_DISABLE_AVAILABILITY', availabilityHandler],
  ['certificate_transparency', 'WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY', certificateSearchHandler],
  ['domain_posture', 'WHOISLEUTH_DISABLE_DOMAIN_POSTURE', domainPostureHandler],
];

async function withEnvironment<T>(name: string, value: string, callback: () => Promise<T>): Promise<T> {
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
      assert.equal(JSON.parse(requiredValue(response.body)).errorCode, 'AUTH_REQUIRED');
    });
  }

  for (const [name, handler] of networkHandlers) {
    test(`${name} rejects an authenticated cross-site browser request before network work`, async () => {
      const response = await handler({
        headers: { cookie, host: 'example.com', 'sec-fetch-site': 'cross-site' },
        queryStringParameters: { q: 'example.com' },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(JSON.parse(requiredValue(response.body)).errorCode, 'CROSS_SITE_REQUEST_BLOCKED');
    });
  }

  for (const [name, handler] of networkHandlers) {
    test(`${name} rejects an originless same-site sibling request before network work`, async () => {
      const response = await handler({
        headers: { cookie, host: 'app.example.test', 'sec-fetch-site': 'same-site' },
        queryStringParameters: { q: 'example.test' },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(JSON.parse(requiredValue(response.body)).errorCode, 'CROSS_SITE_REQUEST_BLOCKED');
    });
  }

  for (const [name, handler] of networkHandlers) {
    test(`${name} rejects authenticated requests with no Origin or Fetch Metadata`, async () => {
      const response = await handler({
        headers: { cookie, host: 'console.example' },
        queryStringParameters: { q: 'example.test' },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(JSON.parse(requiredValue(response.body)).errorCode, 'CROSS_SITE_REQUEST_BLOCKED');
    });
  }

  for (const [name, handler] of networkHandlers) {
    test(`${name} rejects an HTTP Origin for the same HTTPS deployment host`, async () => {
      const response = await handler({
        headers: { cookie, host: 'console.example', origin: 'http://console.example' },
        queryStringParameters: { q: 'example.test' },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(JSON.parse(requiredValue(response.body)).errorCode, 'CROSS_SITE_REQUEST_BLOCKED');
    });
  }

  test('returns a retryable stable error when the session concurrency budget is exhausted', async () => {
    const sessionKey = sessionFingerprintFromCookieHeader(cookie);
    const leases: Array<Extract<Awaited<ReturnType<typeof defaultOperationBudget.acquire>>, { allowed: true }>> = [];
    try {
      for (let index = 0; index < DEFAULT_OPERATION_LIMITS.registry_light.session; index += 1) {
        const lease = await defaultOperationBudget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, sessionKey);
        assert.equal(lease.allowed, true);
        if (lease.allowed) leases.push(lease);
      }
      const response = await rdapHandler({
        headers: sameOriginHeaders(),
        queryStringParameters: { q: 'example.com' },
      });
      assert.equal(response.statusCode, 429);
      assert.equal(response.headers['Retry-After'], '1');
      const body = JSON.parse(requiredValue(response.body));
      assert.equal(body.errorCode, 'NETWORK_CONCURRENCY_LIMITED');
      assert.equal(body.operationClass, 'registry_light');
      assert.equal(body.operationFeature, 'rdap');
      assert.equal(body.operationFeatureModelVersion, 1);
      assert.equal(body.limitScope, 'session');
    } finally {
      for (const lease of leases) await lease.release();
    }
  });

  test('releases an acquired lease when downstream work throws', async () => {
    const sessionKey = sessionFingerprintFromCookieHeader(cookie);
    const before = requiredValue((await defaultOperationBudget.status())
      .find((entry) => entry.id === OPERATION_CLASSES.REGISTRY_DEEP)).active;
    await assert.rejects(
      withNetlifyOperationBudget(sessionKey, OPERATION_CLASSES.REGISTRY_DEEP, async () => {
        throw new Error('simulated downstream failure');
      }),
      /simulated downstream failure/,
    );
    const afterFailure = requiredValue((await defaultOperationBudget.status())
      .find((entry) => entry.id === OPERATION_CLASSES.REGISTRY_DEEP)).active;
    assert.equal(afterFailure, before);
  });

  test('nameserver search rejects malformed input before registry discovery', async () => {
    const response = await rdapNameserverSearchHandler({
      headers: sameOriginHeaders(),
      queryStringParameters: { nameserver: 'not a hostname', scope: 'co.uk' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(requiredValue(response.body)).errorCode, 'INVALID_RDAP_NAMESERVER_SEARCH');
  });

  for (const [feature, environmentName, handler] of disabledNetworkHandlers) {
    test(`blocks disabled ${feature} before any upstream work can begin`, async () => {
      await withEnvironment(environmentName, '1', async () => {
        const response = await handler({
          headers: sameOriginHeaders(),
          queryStringParameters: { q: 'example.com' },
        });
        assert.equal(response.statusCode, 503);
        const body = JSON.parse(requiredValue(response.body));
        assert.equal(body.errorCode, 'FEATURE_DISABLED');
        assert.equal(body.feature, feature);
        assert.equal(body.disabledBy, feature);
      });
    });
  }

  test('enforces dependency shutdown for direct posture audits', async () => {
    await withEnvironment('WHOISLEUTH_DISABLE_DNS_INTELLIGENCE', 'true', async () => {
      const response = await domainPostureHandler({
        headers: sameOriginHeaders(),
        queryStringParameters: { q: 'example.com' },
      });
      assert.equal(response.statusCode, 503);
      const body = JSON.parse(requiredValue(response.body));
      assert.equal(body.errorCode, 'FEATURE_DISABLED');
      assert.equal(body.feature, 'domain_posture');
      assert.equal(body.disabledBy, 'dns_intelligence');
    });
  });

  test('enforces RDAP shutdown for direct nameserver searches', async () => {
    await withEnvironment('WHOISLEUTH_DISABLE_RDAP', 'true', async () => {
      const response = await rdapNameserverSearchHandler({
        headers: sameOriginHeaders(),
        queryStringParameters: { nameserver: 'ns1.infra.example', scope: 'example' },
      });
      assert.equal(response.statusCode, 503);
      const body = JSON.parse(requiredValue(response.body));
      assert.equal(body.errorCode, 'FEATURE_DISABLED');
      assert.equal(body.feature, 'rdap_nameserver_search');
      assert.equal(body.disabledBy, 'rdap');
    });
  });

  test('does not disclose disabled feature state to an unauthenticated caller', async () => {
    await withEnvironment('WHOISLEUTH_DISABLE_RDAP', '1', async () => {
      const response = await rdapHandler({
        headers: {},
        queryStringParameters: { q: 'example.com' },
      });
      assert.equal(response.statusCode, 401);
      assert.equal(JSON.parse(requiredValue(response.body)).errorCode, 'AUTH_REQUIRED');
    });
  });
});

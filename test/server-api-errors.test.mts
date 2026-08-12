import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { recordValue, requiredValue, stringValue } from './value-assertions.mts';
import type { NetworkRouteServices } from '../server.mts';

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const { app, apiErrorHandler, registerNetworkApiRoutes } = await import('../server.mts');
const { buildSessionCookie, createSessionToken } = await import('../lib/auth.mts');

let server: Server | null = null;
let origin = '';
let fixtureServer: Server | null = null;
let fixtureOrigin = '';
const serviceCalls: Array<readonly [string, unknown, unknown?]> = [];

function serviceFailure(value: unknown): void {
  if (value === 'throw.test') throw new Error('/private/path fixture upstream failure');
}

const fixtureServices = {
  runUnifiedLookup: async (classified: { value: string }, options: unknown) => {
    serviceFailure(classified.value);
    serviceCalls.push(['lookup', classified.value, options]);
    return { fixture: 'lookup-result' };
  },
  createLookupHttpResponse: (query: string, classified: { value: string }, result: unknown) => ({
    fixtureRoute: 'lookup', query, normalized: classified.value, result,
  }),
  fetchRdapRecord: async (_type: string, value: string) => {
    serviceFailure(value);
    serviceCalls.push(['rdap', value]);
    return value === 'missing.test' ? null : { fixtureRdap: true };
  },
  searchRdapNameserver: async (nameserver: unknown, scope: unknown) => {
    serviceFailure(nameserver);
    serviceCalls.push(['rdap-nameserver-search', nameserver, scope]);
    return { fixtureSearch: true, nameserver, scope };
  },
  buildWhoisChain: async (query: string) => {
    serviceFailure(query);
    serviceCalls.push(['whois', query]);
    return [];
  },
  parseWhoisChain: () => ({ fixtureParsed: true }),
  checkDomainAvailability: async (domain: string, options: unknown) => {
    serviceFailure(domain);
    serviceCalls.push(['availability', domain, options]);
    return { fixtureAvailability: true };
  },
  searchCertificateTransparency: async (query: unknown) => {
    serviceFailure(query);
    serviceCalls.push(['ct-search', query]);
    return { fixtureCt: true };
  },
  checkDomainPosture: async (domain: string, options: unknown) => {
    serviceFailure(domain);
    serviceCalls.push(['domain-posture', domain, options]);
    return { fixturePosture: true };
  },
} as unknown as NetworkRouteServices;

before(async () => {
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;

  const fixtureApp = express();
  registerNetworkApiRoutes(fixtureApp, fixtureServices);
  fixtureApp.use('/api', apiErrorHandler);
  fixtureServer = await new Promise<Server>((resolve, reject) => {
    const listener = fixtureApp.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const fixtureAddress = fixtureServer.address();
  assert.ok(fixtureAddress && typeof fixtureAddress !== 'string');
  fixtureOrigin = `http://127.0.0.1:${fixtureAddress.port}`;
});

after(async () => {
  await Promise.all([server, fixtureServer].filter((entry): entry is Server => entry !== null).map((entry) => (
    new Promise<void>((resolve, reject) => {
      entry.close((error) => error ? reject(error) : resolve());
    })
  )));
});

async function postLogin(body: string, requestOrigin = origin): Promise<Response> {
  return fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: requestOrigin,
    },
    body,
  });
}

async function expectSanitizedJson(response: Response, statusCode: number, expectedBody: unknown) {
  assert.equal(response.status, statusCode);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/i);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), expectedBody);
  assert.doesNotMatch(text, /SyntaxError|PayloadTooLargeError|node_modules|whois-rdap-tool|at\s+\S+/i);
}

describe('Express API request-body errors', () => {
  test('reject cross-site requests before attempting to parse their bodies', async () => {
    const response = await postLogin('{bad', 'https://outside.example');
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Cross-site request blocked' });
  });

  test('return bounded JSON for malformed JSON without parser details', async () => {
    await expectSanitizedJson(await postLogin('{bad'), 400, {
      error: 'Invalid request body',
      errorCode: 'INVALID_REQUEST_BODY',
    });
  });

  test('return bounded JSON for request bodies over one MiB', async () => {
    const oversizedBody = JSON.stringify({ password: 'x'.repeat(1024 * 1024) });
    await expectSanitizedJson(await postLogin(oversizedBody), 413, {
      error: 'Request bodies are limited to 1 MiB.',
      errorCode: 'REQUEST_TOO_LARGE',
    });
  });
});

describe('Express API response parity', () => {
  test('keeps the public contact route narrow and fail-closed', async () => {
    const configuration = await fetch(`${origin}/api/contact-route`);
    assert.equal(configuration.status, 200);
    const configurationBody = recordValue(await configuration.json());
    assert.deepEqual(Object.keys(configurationBody).sort(), ['available', 'categories', 'siteKey']);
    assert.equal(Object.hasOwn(configurationBody, 'route'), false);

    const extraField = await fetch(`${origin}/api/contact-route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({
        category: 'privacy',
        token: 'test-token',
        message: 'this draft must stay local',
      }),
    });
    assert.equal(extraField.status, 400);
    assert.deepEqual(await extraField.json(), { error: 'Invalid request body' });
  });

  test('preserves success and expected validation responses', async () => {
    const session = requiredValue(buildSessionCookie(createSessionToken(), { secure: false }).split(';')[0]);
    const success = await fetch(`${origin}/api/session`, {
      headers: { Cookie: session },
    });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { authenticated: true });

    const capabilities = await fetch(`${origin}/api/capabilities`, {
      headers: { Cookie: session },
    });
    assert.equal(capabilities.status, 200);
    assert.equal(recordValue(await capabilities.json()).runtime, 'express');

    const privateQuery = 'private analyst note not a valid domain';
    for (const route of ['lookup', 'rdap', 'whois', 'availability', 'domain-posture']) {
      const expectedError = await fetch(`${origin}/api/${route}?q=${encodeURIComponent(privateQuery)}`, {
        headers: { Cookie: session },
      });
      assert.equal(expectedError.status, 400, route);
      const expectedBody = recordValue(await expectedError.json());
      assert.equal(stringValue(expectedBody.error), 'Invalid query', route);
      assert.equal(JSON.stringify(expectedBody).includes(privateQuery), false, route);
      if (route === 'lookup') assert.equal(expectedBody.errorCode, 'INVALID_QUERY');
    }
  });

  test('sanitizes unexpected errors without exposing internal details', () => {
    let statusCode: number | null = null;
    let body: unknown = null;
    const response = {
      headersSent: false,
      setHeader() {
        return response;
      },
      status(value: number) {
        statusCode = value;
        return response;
      },
      json(value: unknown) {
        body = value;
        return value;
      },
      redirect() {
        return response;
      },
    };
    apiErrorHandler(
      new Error('/private/path secret upstream detail'),
      { protocol: 'https', headers: {}, query: {}, path: '/api/test' },
      response,
      () => assert.fail('unexpected errors should be handled before next()'),
    );
    assert.equal(statusCode, 500);
    assert.deepEqual(body, {
      error: 'Internal server error',
      errorCode: 'INTERNAL_ERROR',
    });
    assert.doesNotMatch(JSON.stringify(body), /private|secret|upstream|path/i);
  });
});

describe('fixture-injected Express network routes', () => {
  function sessionCookie(): string {
    return requiredValue(buildSessionCookie(createSessionToken(), { secure: false }).split(';')[0]);
  }

  async function request(route: string): Promise<Response> {
    return fetch(`${fixtureOrigin}${route}`, { headers: { Cookie: sessionCookie() } });
  }

  test('covers every successful route projection without upstream traffic', async () => {
    serviceCalls.length = 0;
    const routes = [
      ['/api/lookup?q=example.test&fast=true&compact=1&intelligence=true&malware=1&ioc=true&security_txt=1', 'lookup'],
      ['/api/rdap?q=example.test', 'rdap'],
      ['/api/rdap-nameserver-search?nameserver=ns1.example.test&scope=test', 'rdap-nameserver-search'],
      ['/api/whois?q=example.test', 'whois'],
      ['/api/availability?q=example.test&fast=1', 'availability'],
      ['/api/ct-search?q=Example', 'ct-search'],
      ['/api/domain-posture?q=example.test&selectors=active&retiredSelectors=retired&mailProfile=parked', 'domain-posture'],
    ] as const;

    for (const [route, expectedService] of routes) {
      const response = await request(route);
      assert.equal(response.status, 200, route);
      assert.ok(JSON.stringify(await response.json()).includes('fixture'), route);
      assert.equal(serviceCalls.at(-1)?.[0], expectedService, route);
    }
    const lookupOptions = serviceCalls.find(([service]) => service === 'lookup')?.[2] as Record<string, unknown>;
    assert.equal(lookupOptions.fast, true);
    assert.equal(lookupOptions.compact, true);
    assert.equal(lookupOptions.externalIntelligence, true);
    assert.equal(lookupOptions.malwareHostIntelligence, true);
    assert.equal(lookupOptions.malwareIocIntelligence, true);
    assert.equal(lookupOptions.securityTxt, true);
  });

  test('preserves missing-query and non-domain responses without calling services', async () => {
    for (const route of ['lookup', 'rdap', 'whois', 'availability', 'ct-search', 'domain-posture']) {
      const beforeCalls = serviceCalls.length;
      const response = await request(`/api/${route}`);
      assert.equal(response.status, 400, route);
      assert.equal(serviceCalls.length, beforeCalls, route);
    }

    const beforeAvailability = serviceCalls.length;
    const availability = await request('/api/availability?q=192.0.2.1');
    assert.equal(availability.status, 200);
    assert.deepEqual(await availability.json(), { applicable: false, type: 'ipv4' });
    assert.equal(serviceCalls.length, beforeAvailability);

    const beforePosture = serviceCalls.length;
    const posture = await request('/api/domain-posture?q=192.0.2.1');
    assert.equal(posture.status, 400);
    assert.equal(serviceCalls.length, beforePosture);
  });

  test('retains RDAP no-registry state and sanitizes every service failure', async () => {
    const missing = await request('/api/rdap?q=missing.test');
    assert.equal(missing.status, 404);
    assert.match(String(recordValue(await missing.json()).error), /No RDAP registry found/u);

    const routes = [
      '/api/lookup?q=throw.test',
      '/api/rdap?q=throw.test',
      '/api/rdap-nameserver-search?nameserver=throw.test&scope=test',
      '/api/whois?q=throw.test',
      '/api/availability?q=throw.test',
      '/api/ct-search?q=throw.test',
      '/api/domain-posture?q=throw.test',
    ];
    for (const route of routes) {
      const response = await request(route);
      assert.equal(response.status, 500, route);
      const text = await response.text();
      assert.equal(JSON.parse(text).error, 'Internal server error', route);
      assert.doesNotMatch(text, /private|upstream|path|fixture failure/iu, route);
    }
  });
});

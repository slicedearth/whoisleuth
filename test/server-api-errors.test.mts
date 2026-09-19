import { request as httpRequest, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { recordValue, requiredValue, stringValue } from './value-assertions.mts';
import { deferred } from './deferred.mts';
import type { NetworkRouteServices } from '../server.mts';

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const { app, apiErrorHandler, registerNetworkApiRoutes } = await import('../server.mts');
const { buildSessionCookie, createSessionToken } = await import('../lib/auth.mts');
const { defaultOperationBudget, operationClassFor } = await import('../lib/operation-budget.mts');

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
    return value === 'missing.test' || value === 'example.gt' ? null : { fixtureRdap: true };
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
        headers: { Cookie: session, Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
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
    return fetch(`${fixtureOrigin}${route}`, {
      headers: { Cookie: sessionCookie(), Origin: fixtureOrigin, 'Sec-Fetch-Site': 'same-origin' },
    });
  }

  test('disconnected individual routes cancel collectors, retain their lease until settlement and send no late response', async () => {
    const routes = [
      { route: 'rdap?q=example.test', feature: 'rdap', service: 'fetchRdapRecord', optionsIndex: 2 },
      { route: 'rdap-nameserver-search?nameserver=ns.example.test&scope=test', feature: 'rdap_nameserver_search', service: 'searchRdapNameserver', optionsIndex: 2 },
      { route: 'whois?q=example.test', feature: 'whois', service: 'buildWhoisChain', optionsIndex: 1 },
      { route: 'availability?q=example.test', feature: 'availability', service: 'checkDomainAvailability', optionsIndex: 1 },
      { route: 'ct-search?q=example', feature: 'certificate_transparency', service: 'searchCertificateTransparency', optionsIndex: 1 },
      { route: 'domain-posture?q=example.test', feature: 'domain_posture', service: 'checkDomainPosture', optionsIndex: 1 },
    ];
    for (const { route, feature, service, optionsIndex } of routes) {
      const started = deferred<AbortSignal>(), cancelled = deferred<void>();
      const complete = deferred<never>();
      const fixture = express();
      let lateWrites = 0;
      fixture.use((_request, response, next) => {
        const json = response.json.bind(response);
        response.json = body => { if (response.destroyed) lateWrites += 1; return json(body); };
        next();
      });
      registerNetworkApiRoutes(fixture, { ...fixtureServices,
        [service]: async (...args: unknown[]) => {
          const signal = (args[optionsIndex] as { signal: AbortSignal }).signal;
          assert.ok(signal instanceof AbortSignal, service);
          signal.addEventListener('abort', () => cancelled.resolve(), { once: true });
          started.resolve(signal);
          return complete.promise;
        },
      });
      const listener = await new Promise<Server>(resolve => {
        const listener = fixture.listen(0, '127.0.0.1', () => resolve(listener));
      });
      const address = listener.address(); assert.ok(address && typeof address !== 'string');
      const localOrigin = `http://127.0.0.1:${address.port}`;
      const active = async () => (await defaultOperationBudget.status()).find(item => item.id === operationClassFor(feature))!.active;
      const before = await active(); assert.equal(typeof before, 'number');
      const request = httpRequest(`${localOrigin}/api/${route}`, { headers: {
        Cookie: sessionCookie(), Origin: localOrigin, 'Sec-Fetch-Site': 'same-origin',
      } }, () => assert.fail('disconnected request must not receive a result'));
      request.on('error', () => {});
      try {
        request.end();
        const signal = await started.promise;
        assert.equal(await active(), before! + 1, service);
        request.destroy();
        await cancelled.promise;
        assert.equal(signal.aborted, true);
        assert.equal(await active(), before! + 1, `${service} must retain its capacity while its collector drains`);
        complete.reject(new Error('fixture collector drained'));
        // Yield to the completed promise chain, not an elapsed-time guess.
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(await active(), before, service);
        assert.equal(lateWrites, 0, service);
      } finally {
        request.destroy(); complete.reject(new Error('fixture cleanup'));
        await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
      }
    }
  });

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

  test('domain source refresh keeps registration and observation targets distinct in both depths', async () => {
    for (const fast of [false, true]) {
      serviceCalls.length = 0;
      const response = await request(`/api/availability?q=portal.example.test${fast ? '&fast=1' : ''}`);
      assert.equal(response.status, 200);
      assert.equal(serviceCalls.length, 1);
      const call = serviceCalls[0]!;
      assert.equal(call[0], 'availability');
      assert.equal(call[1], 'example.test');
      assert.equal((call[2] as Record<string, unknown>).observationHostname, fast ? undefined : 'portal.example.test');
    }
  });

  test('POST Lookup admits selected URLs through the same authenticated network guards', async () => {
    const url = 'https://portal.example.test/review?a=private-example#local-fragment';
    const send = (suffix = '', origin = fixtureOrigin, payload = JSON.stringify({ url })) => fetch(`${fixtureOrigin}/api/lookup?q=portal.example.test${suffix}`, {
      method: 'POST', headers: { Cookie: sessionCookie(), Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: payload,
    });
    serviceCalls.length = 0;
    const response = await send();
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /private-example|local-fragment/);
    assert.equal((serviceCalls[0]?.[2] as Record<string, unknown>).selectedUrl, 'https://portal.example.test/review?a=private-example');
    for (const response of [await send('&fast=1'), await send('&compact=1'), await send('', 'https://other.invalid'), await send('', fixtureOrigin, '{')]) {
      assert.ok([400, 403].includes(response.status));
    }
    assert.equal(serviceCalls.length, 1);
  });

  test('selected URL bodies reject declared and streamed excess and invalid UTF-8 before collection', async () => {
    const { MAX_LOOKUP_SELECTION_BODY_BYTES } = await import('../lib/lookup-selected-request.mts');
    const send = (bytes: Buffer, declared: boolean) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest(`${fixtureOrigin}/api/lookup?q=portal.example.test`, { method: 'POST', headers: {
        Cookie: sessionCookie(), Origin: fixtureOrigin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json',
        ...(declared ? { 'Content-Length': String(bytes.length) } : { 'Transfer-Encoding': 'chunked' }),
      } }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      });
      request.on('error', reject);
      request.setTimeout(5_000, () => request.destroy(new Error('Fixture request did not complete.')));
      if (declared) request.end(bytes);
      else request.write(bytes);
    });
    serviceCalls.length = 0;
    for (const declared of [true, false]) {
      const response = await send(Buffer.alloc(MAX_LOOKUP_SELECTION_BODY_BYTES + 1, 'x'), declared);
      assert.equal(response.status, 413);
      assert.deepEqual(JSON.parse(response.body), { error: 'Selected URL request is too large.' });
    }
    const invalid = await send(Buffer.from([0xc3, 0x28]), true);
    assert.equal(invalid.status, 400);
    assert.deepEqual(JSON.parse(invalid.body), { error: 'Invalid request encoding.' });
    assert.equal(serviceCalls.length, 0);
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
    const refused = await request('/api/rdap?q=example.gt');
    assert.equal(refused.status, 404);
    const refusal = recordValue(await refused.json());
    assert.equal(refusal.source, 'retained_registry_capability_policy');
    assert.match(String(refusal.error), /collection was not attempted/u);
    assert.doesNotMatch(String(refusal.error), /via IANA bootstrap/u);

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

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import type { AvailabilityHandlerDependencies } from '../netlify/functions/availability.mts';
import type { CtSearchHandlerDependencies } from '../netlify/functions/ct-search.mts';
import type { DomainPostureHandlerDependencies } from '../netlify/functions/domain-posture.mts';
import type { LookupHandlerDependencies } from '../netlify/functions/lookup.mts';
import type { RdapNameserverSearchHandlerDependencies } from '../netlify/functions/rdap-nameserver-search.mts';
import type { RdapHandlerDependencies } from '../netlify/functions/rdap.mts';
import type { WhoisHandlerDependencies } from '../netlify/functions/whois.mts';
import type { NetlifyFunctionEvent } from '../lib/netlify-function-types.mts';
import { requiredValue } from './value-assertions.mts';

process.env.SITE_PASSWORD ||= 'test-only-secret';
process.env.SESSION_SECRET ||= 'test-only-session-signing-secret';

const [
  { buildSessionCookie, createSessionToken },
  { createAvailabilityHandler },
  { createCtSearchHandler },
  { createDomainPostureHandler },
  { createLookupHandler },
  { createRdapNameserverSearchHandler },
  { createRdapHandler },
  { createWhoisHandler },
  { RdapNameserverSearchInputError },
] = await Promise.all([
  import('../lib/auth.mts'),
  import('../netlify/functions/availability.mts'),
  import('../netlify/functions/ct-search.mts'),
  import('../netlify/functions/domain-posture.mts'),
  import('../netlify/functions/lookup.mts'),
  import('../netlify/functions/rdap-nameserver-search.mts'),
  import('../netlify/functions/rdap.mts'),
  import('../netlify/functions/whois.mts'),
  import('../lib/rdap-nameserver-search.mts'),
]);

let cookie = '';
before(() => {
  cookie = requiredValue(buildSessionCookie(createSessionToken(), { secure: true }).split(';')[0]);
});

function event(parameters: Readonly<Record<string, string | undefined>>): NetlifyFunctionEvent {
  return {
    headers: { cookie, host: 'console.example', 'sec-fetch-site': 'same-origin' },
    queryStringParameters: parameters,
  };
}

function body(response: { body: string | undefined }): Record<string, unknown> {
  assert.equal(typeof response.body, 'string');
  return JSON.parse(requiredValue(response.body)) as Record<string, unknown>;
}

function fixtureService<T extends (...args: never[]) => unknown>(
  implementation: T,
): T {
  return implementation;
}

describe('fixture-injected Netlify network handlers', () => {
  test('projects availability success and skips service work for non-domain input', async () => {
    const calls: Array<readonly [string, Record<string, unknown>]> = [];
    const checkDomainAvailability = fixtureService<AvailabilityHandlerDependencies['checkDomainAvailability']>(
      async (domain, options) => {
        calls.push([domain, options as unknown as Record<string, unknown>]);
        return { fixtureAvailability: 'observed' } as unknown as Awaited<ReturnType<AvailabilityHandlerDependencies['checkDomainAvailability']>>;
      },
    );
    const handler = createAvailabilityHandler({ checkDomainAvailability });

    const response = await handler(event({ q: 'sub.example.test', fast: 'true' }));
    assert.equal(response.statusCode, 200);
    assert.equal(body(response).applicable, true);
    assert.equal(body(response).fixtureAvailability, 'observed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.[0], 'example.test');
    assert.equal(calls[0]?.[1].fast, true);

    const notApplicable = await handler(event({ q: '192.0.2.1' }));
    assert.deepEqual(body(notApplicable), { applicable: false, type: 'ipv4' });
    assert.equal(calls.length, 1);
  });

  test('projects WHOIS chain and parser output without transport traffic', async () => {
    const queried: string[] = [];
    const buildWhoisChain = fixtureService<WhoisHandlerDependencies['buildWhoisChain']>(async (query) => {
      queried.push(query);
      return [] as unknown as Awaited<ReturnType<WhoisHandlerDependencies['buildWhoisChain']>>;
    });
    const parseWhoisChain = fixtureService<WhoisHandlerDependencies['parseWhoisChain']>(() => {
      return { fixtureParsed: true } as unknown as ReturnType<WhoisHandlerDependencies['parseWhoisChain']>;
    });
    const response = await createWhoisHandler({ buildWhoisChain, parseWhoisChain })(event({ q: 'example.test' }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(queried, ['example.test']);
    assert.deepEqual(body(response).chain, []);
    assert.deepEqual(body(response).parsed, { fixtureParsed: true });
  });

  test('projects RDAP success and preserves the no-registry 404', async () => {
    const calls: Array<readonly [string, string]> = [];
    const success = createRdapHandler({
      fetchRdapRecord: (async (type: string, value: string) => {
        calls.push([type, value]);
        return { fixtureRdap: true } as unknown as Awaited<ReturnType<RdapHandlerDependencies['fetchRdapRecord']>>;
      }) as RdapHandlerDependencies['fetchRdapRecord'],
    });
    const response = await success(event({ q: 'example.test' }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls, [['domain', 'example.test']]);
    assert.equal(body(response).fixtureRdap, true);

    const missing = createRdapHandler({
      fetchRdapRecord: (async () => null) as RdapHandlerDependencies['fetchRdapRecord'],
    });
    const missingResponse = await missing(event({ q: 'example.test' }));
    assert.equal(missingResponse.statusCode, 404);
    assert.match(String(body(missingResponse).error), /No RDAP registry found/u);
  });

  test('normalizes Certificate Transparency and nameserver-search inputs before fixture services', async () => {
    const ctQueries: string[] = [];
    const ctResponse = await createCtSearchHandler({
      searchCertificateTransparency: fixtureService<CtSearchHandlerDependencies['searchCertificateTransparency']>(async (query) => {
        if (typeof query !== 'string') throw new TypeError('Expected normalized CT query.');
        ctQueries.push(query);
        return { fixtureCt: true } as unknown as Awaited<ReturnType<CtSearchHandlerDependencies['searchCertificateTransparency']>>;
      }),
    })(event({ q: '  Example  ' }));
    assert.equal(ctResponse.statusCode, 200);
    assert.deepEqual(ctQueries, ['Example']);
    assert.equal(body(ctResponse).keyword, 'Example');
    assert.equal(body(ctResponse).fixtureCt, true);

    const searches: Array<readonly [unknown, unknown]> = [];
    const nameserverHandler = createRdapNameserverSearchHandler({
      searchRdapNameserver: fixtureService<RdapNameserverSearchHandlerDependencies['searchRdapNameserver']>(async (nameserver, scope) => {
        searches.push([nameserver, scope]);
        return { fixtureSearch: true } as unknown as Awaited<ReturnType<RdapNameserverSearchHandlerDependencies['searchRdapNameserver']>>;
      }),
    });
    const nameserverResponse = await nameserverHandler(event({ nameserver: 'ns1.example.test', scope: 'test' }));
    assert.equal(nameserverResponse.statusCode, 200);
    assert.deepEqual(searches, [['ns1.example.test', 'test']]);
    assert.equal(body(nameserverResponse).fixtureSearch, true);

    const rejected = await createRdapNameserverSearchHandler({
      searchRdapNameserver: fixtureService<RdapNameserverSearchHandlerDependencies['searchRdapNameserver']>(async () => {
        throw new RdapNameserverSearchInputError('Enter a valid nameserver hostname.');
      }),
    })(event({ nameserver: 'bad value', scope: 'test' }));
    assert.equal(rejected.statusCode, 400);
    assert.equal(body(rejected).errorCode, 'INVALID_RDAP_NAMESERVER_SEARCH');
  });

  test('passes every bounded Lookup option and projects the response contract', async () => {
    const calls: unknown[][] = [];
    const runUnifiedLookup = fixtureService<LookupHandlerDependencies['runUnifiedLookup']>(async (...args) => {
      calls.push(args);
      return { fixtureLookup: true } as unknown as Awaited<ReturnType<LookupHandlerDependencies['runUnifiedLookup']>>;
    });
    const createLookupHttpResponse = fixtureService<LookupHandlerDependencies['createLookupHttpResponse']>((query, classified, result) => {
      return { fixtureResponse: true, query, type: classified.type, result } as unknown as ReturnType<LookupHandlerDependencies['createLookupHttpResponse']>;
    });
    const response = await createLookupHandler({ runUnifiedLookup, createLookupHttpResponse })(event({
      q: 'example.test',
      fast: '1',
      compact: 'true',
      intelligence: '1',
      malware: 'true',
      ioc: '1',
      security_txt: 'true',
    }));

    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 1);
    const options = calls[0]?.[1] as Record<string, unknown>;
    assert.equal(options.fast, true);
    assert.equal(options.compact, true);
    assert.equal(options.externalIntelligence, true);
    assert.equal(options.malwareHostIntelligence, true);
    assert.equal(options.malwareIocIntelligence, true);
    assert.equal(options.securityTxt, true);
    assert.equal(body(response).fixtureResponse, true);
  });

  test('bounds active and retired DKIM selectors before the posture service', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const handler = createDomainPostureHandler({
      checkDomainPosture: fixtureService<DomainPostureHandlerDependencies['checkDomainPosture']>(async (_domain, options) => {
        calls.push(options as unknown as Record<string, unknown>);
        return { fixturePosture: true } as unknown as Awaited<ReturnType<DomainPostureHandlerDependencies['checkDomainPosture']>>;
      }),
    });
    const tenSelectors = Array.from({ length: 10 }, (_, index) => `selector${index}`).join(',');
    const fullResponse = await handler(event({
      q: 'example.test',
      selectors: tenSelectors,
      retiredSelectors: 'retired-one,retired-two',
      mailProfile: 'parked',
    }));
    assert.equal(fullResponse.statusCode, 200);
    assert.equal(body(fullResponse).fixturePosture, true);
    assert.equal((calls[0]?.dkimSelectors as unknown[]).length, 10);
    assert.deepEqual(calls[0]?.retiredDkimSelectors, []);
    assert.equal(calls[0]?.mailProtectionProfile, 'parked');

    await handler(event({
      q: 'example.test',
      selectors: Array.from({ length: 9 }, (_, index) => `selector${index}`).join(','),
      retiredSelectors: 'selector0,retired-one,retired-two',
    }));
    assert.deepEqual(calls[1]?.retiredDkimSelectors, ['retired-one']);

    const callsBeforeRejectedInput = calls.length;
    const rejected = await handler(event({ q: '192.0.2.1' }));
    assert.equal(rejected.statusCode, 400);
    assert.equal(calls.length, callsBeforeRejectedInput);
  });

  test('sanitizes injected service failures at every handler boundary', async () => {
    const failure = new Error('/private/path upstream secret');
    const handlers = [
      createAvailabilityHandler({
        checkDomainAvailability: fixtureService<AvailabilityHandlerDependencies['checkDomainAvailability']>(async () => { throw failure; }),
      }),
      createWhoisHandler({
        buildWhoisChain: fixtureService<WhoisHandlerDependencies['buildWhoisChain']>(async () => { throw failure; }),
        parseWhoisChain: fixtureService<WhoisHandlerDependencies['parseWhoisChain']>(() => { throw failure; }),
      }),
      createRdapHandler({
        fetchRdapRecord: fixtureService<RdapHandlerDependencies['fetchRdapRecord']>(async () => { throw failure; }),
      }),
      createCtSearchHandler({
        searchCertificateTransparency: fixtureService<CtSearchHandlerDependencies['searchCertificateTransparency']>(async () => { throw failure; }),
      }),
      createDomainPostureHandler({
        checkDomainPosture: fixtureService<DomainPostureHandlerDependencies['checkDomainPosture']>(async () => { throw failure; }),
      }),
      createRdapNameserverSearchHandler({
        searchRdapNameserver: fixtureService<RdapNameserverSearchHandlerDependencies['searchRdapNameserver']>(async () => { throw failure; }),
      }),
      createLookupHandler({
        runUnifiedLookup: fixtureService<LookupHandlerDependencies['runUnifiedLookup']>(async () => { throw failure; }),
        createLookupHttpResponse: fixtureService<LookupHandlerDependencies['createLookupHttpResponse']>(() => { throw failure; }),
      }),
    ];

    for (const [index, handler] of handlers.entries()) {
      const response = await handler(event({ q: 'example.test' }));
      assert.equal(response.statusCode, 500, String(index));
      const responseBody = body(response);
      assert.equal(responseBody.error, 'Internal server error', String(index));
      assert.equal(responseBody.errorCode, index === handlers.length - 1 ? 'LOOKUP_FAILED' : 'INTERNAL_ERROR');
      assert.doesNotMatch(JSON.stringify(responseBody), /private|secret|upstream|path/iu);
    }
  });
});

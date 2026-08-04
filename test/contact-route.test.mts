import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_CONTACT_ADDRESS_LENGTH,
  MAX_TURNSTILE_TOKEN_LENGTH,
  TURNSTILE_EXPECTED_ACTION,
  TURNSTILE_VERIFY_URL,
  contactRoutePublicConfig,
  parseContactRouteBody,
  verifyContactRoute,
} from '../lib/contact-route.mts';
import { normalizeContactAddress } from '../lib/contact-address.mts';

const ENV = Object.freeze({
  TURNSTILE_SITE_KEY: 'public-site-key',
  TURNSTILE_SECRET_KEY: 'private-secret-key',
  TURNSTILE_ALLOWED_HOSTNAMES: 'whoisleuth.example, www.whoisleuth.example',
  WHOISLEUTH_PRIVACY_CONTACT: 'privacy@example.test',
  WHOISLEUTH_OUTBOUND_CONTACT: 'outbound@example.test',
  WHOISLEUTH_SECURITY_CONTACT: 'security@example.test',
});

function verificationResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    success: true,
    hostname: 'whoisleuth.example',
    action: TURNSTILE_EXPECTED_ACTION,
    ...overrides,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('public contact configuration', () => {
  test('shares one strict address normalizer with the browser handoff', () => {
    assert.equal(normalizeContactAddress(' Privacy@Example.Test '), 'privacy@example.test');
    for (const value of [
      'not an address',
      'missing-tld@example',
      'route@example..test',
      `route@${'a'.repeat(64)}.test`,
      `a@b.${'c'.repeat(MAX_CONTACT_ADDRESS_LENGTH)}`,
    ]) {
      assert.equal(normalizeContactAddress(value), null, value);
    }
  });

  test('publishes only the site key and configured category names', () => {
    const config = contactRoutePublicConfig(ENV);

    assert.deepEqual(config, {
      available: true,
      siteKey: 'public-site-key',
      categories: ['privacy', 'outbound', 'security'],
    });
    const serialized = JSON.stringify(config);
    assert.doesNotMatch(serialized, /private-secret|@example\.test/u);
  });

  test('fails closed for incomplete, invalid, or excessive configuration', () => {
    assert.deepEqual(contactRoutePublicConfig({}), {
      available: false,
      siteKey: null,
      categories: [],
    });
    assert.equal(contactRoutePublicConfig({
      ...ENV,
      TURNSTILE_ALLOWED_HOSTNAMES: Array.from({ length: 11 }, (_, index) => `h${index}.example`).join(','),
    }).available, false);
    assert.equal(contactRoutePublicConfig({
      ...ENV,
      WHOISLEUTH_PRIVACY_CONTACT: 'not an address',
      WHOISLEUTH_OUTBOUND_CONTACT: '',
      WHOISLEUTH_SECURITY_CONTACT: '',
    }).available, false);
  });
});

describe('contact request boundary', () => {
  test('accepts exactly category and token', () => {
    assert.deepEqual(parseContactRouteBody({ category: 'privacy', token: 'token-value' }), {
      category: 'privacy',
      token: 'token-value',
    });
    assert.equal(parseContactRouteBody({ category: 'privacy', token: 'token', message: 'must stay local' }), null);
    assert.equal(parseContactRouteBody({ category: 'unknown', token: 'token' }), null);
    assert.equal(parseContactRouteBody({ category: 'privacy', token: 'x'.repeat(MAX_TURNSTILE_TOKEN_LENGTH + 1) }), null);
    assert.equal(parseContactRouteBody(['privacy', 'token']), null);
  });

  test('verifies the fixed endpoint without forwarding an IP or draft', async () => {
    const calls: Array<{ url: string; options: RequestInit; maxRedirects: number | undefined }> = [];
    const result = await verifyContactRoute('privacy', 'short-lived-token', {
      env: ENV,
      dependencies: {
        request: async (url, options, dependencies) => {
          calls.push({ url, options, maxRedirects: dependencies?.maxRedirects });
          return {
            response: verificationResponse(),
            finalUrl: TURNSTILE_VERIFY_URL,
            redirected: false,
            redirectLimitReached: false,
          };
        },
      },
    });

    assert.deepEqual(result, {
      status: 'ok',
      category: 'privacy',
      route: 'privacy@example.test',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, TURNSTILE_VERIFY_URL);
    assert.equal(calls[0]?.options.method, 'POST');
    assert.equal(calls[0]?.maxRedirects, 0);
    const body = new URLSearchParams(String(calls[0]?.options.body));
    assert.equal(body.get('secret'), 'private-secret-key');
    assert.equal(body.get('response'), 'short-lived-token');
    assert.equal(body.has('remoteip'), false);
    assert.equal(body.has('subject'), false);
    assert.equal(body.has('message'), false);
  });

  test('rejects unsuccessful, wrong-action, and wrong-hostname verification', async () => {
    for (const response of [
      verificationResponse({ success: false }),
      verificationResponse({ action: 'different_action' }),
      verificationResponse({ hostname: 'other.example' }),
      new Response('not json', { status: 200 }),
      new Response('{}', { status: 503 }),
    ]) {
      const result = await verifyContactRoute('security', 'token', {
        env: ENV,
        dependencies: {
          request: async () => ({
            response,
            finalUrl: TURNSTILE_VERIFY_URL,
            redirected: false,
            redirectLimitReached: false,
          }),
        },
      });
      assert.deepEqual(result, { status: 'challenge_failed' });
    }
  });

  test('rejects redirect metadata and never requests for invalid or unavailable input', async () => {
    let calls = 0;
    const request = async () => {
      calls += 1;
      return {
        response: verificationResponse(),
        finalUrl: `${TURNSTILE_VERIFY_URL}/redirected`,
        redirected: true,
        redirectLimitReached: true,
      };
    };
    assert.deepEqual(await verifyContactRoute('privacy', 'token', {
      env: ENV,
      dependencies: { request },
    }), { status: 'challenge_failed' });
    assert.deepEqual(await verifyContactRoute('privacy', '', {
      env: ENV,
      dependencies: { request },
    }), { status: 'invalid_request' });
    assert.deepEqual(await verifyContactRoute('privacy', 'token', {
      env: {},
      dependencies: { request },
    }), { status: 'unavailable' });
    assert.equal(calls, 1);
  });
});

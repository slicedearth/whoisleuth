import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RESPONSE_COOKIES,
  MAX_RESPONSE_POLICY_HEADER_BYTES,
  MIN_RECOMMENDED_HSTS_SECONDS,
  RESPONSE_POLICY_VERSION,
  analyzeResponsePolicyHeaders,
} from '../lib/response-policy.mts';
import type { ResponsePolicyHeaderReader } from '../lib/response-policy.mts';

function headers(
  values: Record<string, string> = {},
  cookies: string[] = [],
): ResponsePolicyHeaderReader {
  const normalized = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    get: (name) => normalized.get(name.toLowerCase()) ?? null,
    getSetCookie: () => [...cookies],
  };
}

function signalIds(result: ReturnType<typeof analyzeResponsePolicyHeaders>): string[] {
  return result.signals.map((signal) => signal.id);
}

describe('privacy-minimized response-policy analysis', () => {
  test('accepts bounded restrictive policies without retaining their values', () => {
    const secret = 'private-nonce-value';
    const result = analyzeResponsePolicyHeaders(headers({
      'content-security-policy': `default-src 'self'; base-uri 'none'; object-src 'none'; script-src 'nonce-${secret}'`,
      'strict-transport-security': `max-age=${MIN_RECOMMENDED_HSTS_SECONDS}; includeSubDomains`,
      'referrer-policy': 'strict-origin-when-cross-origin',
    }, [
      `session=${secret}; Secure; HttpOnly; SameSite=Lax; Path=/private`,
    ]));

    assert.equal(result.responsePolicyVersion, RESPONSE_POLICY_VERSION);
    assert.equal(result.status, 'success');
    assert.equal(result.complete, true);
    assert.deepEqual(result.signals, []);
    assert.equal(result.diagnostics.cookieCount, 1);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(result), /session|Path|includeSubDomains/);
  });

  test('emits fixed CSP review signals without copying source expressions', () => {
    const result = analyzeResponsePolicyHeaders(headers({
      'content-security-policy': "script-src * 'unsafe-inline' 'unsafe-eval'; report-uri https://reports.invalid/private",
    }));

    assert.deepEqual(signalIds(result), [
      'csp_default_source_missing',
      'csp_base_uri_missing',
      'csp_object_source_unbounded',
      'csp_permissive_script_source',
      'csp_unsafe_eval',
      'csp_unsafe_inline',
    ]);
    assert.doesNotMatch(JSON.stringify(result), /reports\.invalid|report-uri/);
  });

  test('does not flag unsafe-inline when the same effective directive has a nonce or hash source', () => {
    const result = analyzeResponsePolicyHeaders(headers({
      'content-security-policy': "default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'unsafe-inline' 'nonce-private'",
    }));
    assert.equal(signalIds(result).includes('csp_unsafe_inline'), false);
    assert.doesNotMatch(JSON.stringify(result), /private/);
  });

  test('distinguishes disabled, short, and sufficiently long HSTS durations', () => {
    assert.deepEqual(signalIds(analyzeResponsePolicyHeaders(headers({
      'strict-transport-security': 'max-age=0',
    }))), ['hsts_disabled']);
    assert.deepEqual(signalIds(analyzeResponsePolicyHeaders(headers({
      'strict-transport-security': 'max-age=86400',
    }))), ['hsts_short_max_age']);
    assert.deepEqual(signalIds(analyzeResponsePolicyHeaders(headers({
      'strict-transport-security': `max-age=${MIN_RECOMMENDED_HSTS_SECONDS}`,
    }))), []);
  });

  test('uses the last recognized referrer policy and identifies permissive values', () => {
    const restrictive = analyzeResponsePolicyHeaders(headers({
      'referrer-policy': 'unsafe-url, strict-origin-when-cross-origin',
    }));
    assert.equal(signalIds(restrictive).includes('referrer_policy_permissive'), false);

    const permissive = analyzeResponsePolicyHeaders(headers({
      'referrer-policy': 'strict-origin, unsafe-url',
    }));
    assert.equal(signalIds(permissive).includes('referrer_policy_permissive'), true);
  });

  test('retains only bounded cookie counts for missing attributes', () => {
    const secret = 'private-cookie-value';
    const result = analyzeResponsePolicyHeaders(headers({}, [
      `first=${secret}; Path=/account`,
      'second=other; SameSite=None; HttpOnly; Domain=private.invalid',
      'third=value; Secure; HttpOnly; SameSite=Strict',
    ]));
    assert.deepEqual(result.signals, [
      { id: 'cookies_missing_secure', count: 2 },
      { id: 'cookies_missing_http_only', count: 1 },
      { id: 'cookies_missing_same_site', count: 1 },
      { id: 'cookies_same_site_none_without_secure', count: 1 },
    ]);
    assert.equal(result.diagnostics.cookieCount, 3);
    assert.doesNotMatch(JSON.stringify(result), /first|second|third|private|account|Domain/);
  });

  test('marks malformed and oversized values partial instead of deriving negative conclusions', () => {
    const malformed = analyzeResponsePolicyHeaders(headers({
      'content-security-policy': '!!! invalid',
      'strict-transport-security': 'includeSubDomains',
      'referrer-policy': 'future-policy',
    }));
    assert.equal(malformed.status, 'partial');
    assert.equal(malformed.complete, false);
    assert.deepEqual(malformed.components, {
      contentSecurityPolicy: 'malformed',
      strictTransportSecurity: 'malformed',
      referrerPolicy: 'malformed',
      responseCookies: 'absent',
    });

    const oversized = analyzeResponsePolicyHeaders(headers({
      'content-security-policy': 'x'.repeat(MAX_RESPONSE_POLICY_HEADER_BYTES + 1),
    }));
    assert.equal(oversized.status, 'partial');
    assert.equal(oversized.components.contentSecurityPolicy, 'partial');
    assert.deepEqual(oversized.signals, []);
  });

  test('caps cookie count and cumulative analysis without retaining excess values', () => {
    const result = analyzeResponsePolicyHeaders(headers({}, Array.from(
      { length: MAX_RESPONSE_COOKIES + 5 },
      (_, index) => `cookie${index}=value`,
    )));
    assert.equal(result.status, 'partial');
    assert.equal(result.diagnostics.cookieCount, MAX_RESPONSE_COOKIES);
    assert.equal(result.diagnostics.cookiesTruncated, true);
    assert.deepEqual(result.signals, [
      { id: 'cookies_missing_secure', count: MAX_RESPONSE_COOKIES },
      { id: 'cookies_missing_http_only', count: MAX_RESPONSE_COOKIES },
      { id: 'cookies_missing_same_site', count: MAX_RESPONSE_COOKIES },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /cookie31/);
  });
});

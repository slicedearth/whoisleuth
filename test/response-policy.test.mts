import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RESPONSE_COOKIES,
  MAX_RESPONSE_POLICY_DIRECTIVES,
  MAX_RESPONSE_POLICY_HEADER_BYTES,
  MAX_RESPONSE_POLICY_TOKENS,
  MIN_RECOMMENDED_HSTS_SECONDS,
  RESPONSE_POLICY_VERSION,
  analyzeCspMetaPolicies,
  analyzeResponsePolicyHeaders,
  qualifyResponsePolicyWithCspMeta,
} from '../lib/response-policy.mts';
import type { ResponsePolicyHeaderReader } from '../lib/response-policy.mts';
import { CSP_POLICY_FIXTURES } from './csp-policy-fixtures.mts';

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
  for (const fixture of CSP_POLICY_FIXTURES) {
    test(`native policy contract: ${fixture.name}`, () => {
      const result = analyzeResponsePolicyHeaders(headers({ 'content-security-policy': fixture.policy }));
      assert.equal(result.components.contentSecurityPolicy, 'parsed');
      assert.equal(signalIds(result).includes('csp_unsafe_inline'), fixture.blocks);
      assert.equal(signalIds(result).includes('csp_unsafe_inline_attributes'), fixture.attributes);
    });
  }
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
      'csp_unsafe_inline_attributes',
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

  test('qualifies a response-header inline allowance only when an earlier bounded meta policy constrains it', () => {
    const headerPolicy = analyzeResponsePolicyHeaders(headers({
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'",
    }));
    const meta = analyzeCspMetaPolicies([{
      content: "default-src 'self'; script-src 'self' 'sha256-private-page-hash'",
      beforeScript: true,
    }]);
    const qualified = qualifyResponsePolicyWithCspMeta(headerPolicy, meta);
    assert.ok(qualified);
    assert.equal(signalIds(qualified).includes('csp_unsafe_inline'), false);
    assert.equal(signalIds(qualified).includes('csp_inline_constrained_by_meta'), true);
    assert.deepEqual(qualified.diagnostics, {
      signalCount: 3,
      cookieCount: 0,
      cookiesTruncated: false,
      cspMetaPoliciesObserved: 1,
      cspMetaPoliciesParsed: 1,
      cspMetaPoliciesTruncated: false,
    });
    assert.doesNotMatch(JSON.stringify(qualified), /private-page-hash|sha256-/u);

    const lateMeta = analyzeCspMetaPolicies([{
      content: "script-src 'self'",
      beforeScript: false,
    }]);
    const unqualified = qualifyResponsePolicyWithCspMeta(headerPolicy, lateMeta);
    assert.ok(unqualified);
    assert.equal(signalIds(unqualified).includes('csp_unsafe_inline'), true);
    assert.equal(signalIds(unqualified).includes('csp_inline_constrained_by_meta'), false);
  });

  test('uses source-expression grammar rather than accepting every nonce-shaped token', () => {
    for (const source of ["'nonce-!invalid'", "'nonce-a=b'", "'nonce-abc==='", "'sha256-'", "'sha512-x%20y'"]) {
      const result = analyzeResponsePolicyHeaders(headers({ 'content-security-policy': `script-src 'unsafe-inline' ${source}` }));
      assert.equal(signalIds(result).includes('csp_unsafe_inline'), true, source);
      assert.equal(signalIds(result).includes('csp_unsafe_inline_attributes'), true, source);
    }
    for (const source of ["'nonce-a'", "'nonce-aB+/_-=='", "'sha256-abcd='", "'sha384-abcd'", "'strict-dynamic'"]) {
      const result = analyzeResponsePolicyHeaders(headers({ 'content-security-policy': `script-src 'unsafe-inline' ${source}` }));
      assert.equal(signalIds(result).includes('csp_unsafe_inline'), false, source);
      assert.equal(signalIds(result).includes('csp_unsafe_inline_attributes'), false, source);
    }
  });

  test('keeps element, attribute and evaluation directive fallbacks independent', () => {
    const signals = (policy: string) => signalIds(analyzeResponsePolicyHeaders(headers({ 'content-security-policy': policy })));
    const blocks = signals("default-src 'none'; script-src 'none'; script-src-elem 'unsafe-inline' 'unsafe-eval'");
    assert.equal(blocks.includes('csp_unsafe_inline'), true);
    assert.equal(blocks.includes('csp_unsafe_inline_attributes'), false);
    assert.equal(blocks.includes('csp_unsafe_eval'), false);
    const attributes = signals("script-src 'unsafe-inline' 'unsafe-eval'; script-src-elem 'none'");
    assert.equal(attributes.includes('csp_unsafe_inline'), false);
    assert.equal(attributes.includes('csp_unsafe_inline_attributes'), true);
    assert.equal(attributes.includes('csp_unsafe_eval'), true);
    const both = signals("default-src 'unsafe-inline'; script-src-attr 'none'");
    assert.equal(both.includes('csp_unsafe_inline'), true);
    assert.equal(both.includes('csp_unsafe_inline_attributes'), false);
    const duplicate = signals("script-src-elem 'none'; script-src-elem 'unsafe-inline'");
    assert.equal(duplicate.includes('csp_unsafe_inline'), false);
  });

  test('intersects repeated response policies and does not weaken a restrictive policy', () => {
    for (const policy of [
      "script-src 'unsafe-inline' 'unsafe-eval', default-src 'none'",
      "script-src-elem 'none', script-src-elem 'unsafe-inline'",
      "script-src 'unsafe-inline' 'unsafe-eval'; sandbox allow-forms",
    ]) {
      const result = analyzeResponsePolicyHeaders(headers({ 'content-security-policy': policy }));
      assert.equal(result.status, 'success');
      assert.equal(signalIds(result).includes('csp_unsafe_inline'), false);
      assert.equal(signalIds(result).includes('csp_unsafe_eval'), false);
    }
    const repeated = analyzeResponsePolicyHeaders(headers({
      'content-security-policy': "script-src 'unsafe-inline', script-src-elem 'unsafe-inline'; script-src-attr 'none'",
    }));
    assert.equal(signalIds(repeated).includes('csp_unsafe_inline'), true);
    assert.equal(signalIds(repeated).includes('csp_unsafe_inline_attributes'), false);
  });

  test('does not interpret a truncated policy as permission or reset bounds for each policy', () => {
    const tokenBoundary = `script-src ${Array.from({ length: MAX_RESPONSE_POLICY_TOKENS - 1 }, () => "'self'").join(' ')} 'unsafe-inline'`;
    const atBoundary = analyzeResponsePolicyHeaders(headers({ 'content-security-policy': tokenBoundary }));
    assert.equal(atBoundary.components.contentSecurityPolicy, 'parsed');
    assert.equal(signalIds(atBoundary).includes('csp_unsafe_inline'), true);
    const over = analyzeResponsePolicyHeaders(headers({ 'content-security-policy': `${tokenBoundary}, script-src 'none'` }));
    assert.equal(over.components.contentSecurityPolicy, 'partial');
    assert.deepEqual(over.signals, []);
    const directives = analyzeResponsePolicyHeaders(headers({
      'content-security-policy': Array.from({ length: MAX_RESPONSE_POLICY_DIRECTIVES + 1 }, () => 'default-src').join(','),
    }));
    assert.equal(directives.components.contentSecurityPolicy, 'partial');
    assert.deepEqual(directives.signals, []);
  });

  test('meta qualification does not claim to evaluate attribute timing or enforce a meta sandbox', () => {
    const header = analyzeResponsePolicyHeaders(headers({ 'content-security-policy': "script-src 'unsafe-inline'" }));
    const qualified = qualifyResponsePolicyWithCspMeta(header, analyzeCspMetaPolicies([{
      content: "script-src-elem 'none'", beforeScript: true,
    }]));
    assert.ok(qualified);
    assert.equal(signalIds(qualified).includes('csp_unsafe_inline'), false);
    assert.equal(signalIds(qualified).includes('csp_unsafe_inline_attributes'), true);
    const sandbox = analyzeCspMetaPolicies([{ content: 'sandbox', beforeScript: true }]);
    assert.equal(sandbox.inlineScriptConstrained, false);
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

  test('rejects duplicate HSTS directives without deriving order-dependent signals', () => {
    for (const value of [
      'max-age=31536000; max-age=0',
      'max-age=0; max-age=31536000',
      'max-age=31536000; includeSubDomains; includeSubDomains',
    ]) {
      const result = analyzeResponsePolicyHeaders(headers({ 'strict-transport-security': value }));
      assert.equal(result.status, 'partial');
      assert.equal(result.complete, false);
      assert.equal(result.components.strictTransportSecurity, 'malformed');
      assert.equal(signalIds(result).includes('hsts_disabled'), false);
      assert.equal(signalIds(result).includes('hsts_short_max_age'), false);
    }
  });

  test('marks cookie attribute omission partial without deriving missing-attribute signals', () => {
    const exact = analyzeResponsePolicyHeaders(headers({}, [
      `session=value; ${Array.from({ length: MAX_RESPONSE_POLICY_TOKENS - 3 }, (_, index) => `x${index}=1`).join('; ')}; Secure; HttpOnly; SameSite=Lax`,
    ]));
    assert.equal(exact.components.responseCookies, 'parsed');
    assert.equal(exact.diagnostics.cookiesTruncated, false);
    assert.deepEqual(exact.signals, []);

    const over = analyzeResponsePolicyHeaders(headers({}, [
      `session=value; ${Array.from({ length: MAX_RESPONSE_POLICY_TOKENS }, (_, index) => `x${index}=1`).join('; ')}; Secure; HttpOnly; SameSite=Lax`,
    ]));
    assert.equal(over.status, 'partial');
    assert.equal(over.complete, false);
    assert.equal(over.components.responseCookies, 'partial');
    assert.equal(over.diagnostics.cookiesTruncated, true);
    assert.deepEqual(over.signals, []);
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

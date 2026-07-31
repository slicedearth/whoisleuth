import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRateLimitChecker,
  createScopedRateLimitCheckers,
  getClientIp,
  getForwardedProtocol,
  PRERENDERED_HTML_RATE_LIMIT,
  trustsForwardedHeaders,
} from '../lib/rate-limit.mts';

describe('fixed-window bucket bounds', () => {
  test('evicts the oldest identity at capacity instead of locking out every new identity', () => {
    const check = createRateLimitChecker({ limit: 2, windowMs: 60_000 }, 2);

    assert.deepEqual(check('first', 1_000), { allowed: true });
    assert.deepEqual(check('first', 1_001), { allowed: true });
    assert.deepEqual(check('first', 1_002), { allowed: false, retryAfterSeconds: 60 });
    assert.deepEqual(check('second', 1_003), { allowed: true });
    assert.deepEqual(check('third', 1_004), { allowed: true });
    assert.deepEqual(check('first', 1_005), { allowed: true });
  });

  test('reclaims expired buckets before admitting a new identity', () => {
    const check = createRateLimitChecker({ limit: 1, windowMs: 60_000 }, 1);

    assert.deepEqual(check('first', 1_000), { allowed: true });
    assert.deepEqual(check('second', 61_001), { allowed: true });
  });

  test('rejects empty and overlong bucket keys instead of retaining them', () => {
    const check = createRateLimitChecker({ limit: 1, windowMs: 60_000 }, 2);
    assert.deepEqual(check('', 1_000), {
      allowed: false,
      retryAfterSeconds: 60,
    });
    assert.deepEqual(check('x'.repeat(200), 1_000), {
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  test('isolates login capacity from high-cardinality API traffic', () => {
    const checkers = createScopedRateLimitCheckers(2);

    assert.deepEqual(checkers.api('api-first', 1_000), { allowed: true });
    assert.deepEqual(checkers.api('api-second', 1_001), { allowed: true });
    assert.deepEqual(checkers.api('api-third', 1_002), { allowed: true });
    assert.deepEqual(checkers.login('new-login', 1_003), { allowed: true });
  });

  test('isolates fixed HTML capacity from the other request classes', () => {
    const checkers = createScopedRateLimitCheckers(1);

    assert.deepEqual(checkers.login('login', 1_000), { allowed: true });
    assert.deepEqual(checkers.api('api', 1_001), { allowed: true });
    assert.deepEqual(checkers.scheduledMonitorManagement('monitor', 1_002), { allowed: true });
    assert.deepEqual(checkers.prerenderedHtml('html', 1_003), { allowed: true });
  });

  test('keeps the fixed HTML override generous but bounded', () => {
    assert.deepEqual(PRERENDERED_HTML_RATE_LIMIT, {
      limit: 600,
      windowMs: 60_000,
    });
  });
});

describe('forwarded-header trust', () => {
  test('is opt-in for self-hosting and enabled by the Netlify runtime', () => {
    assert.equal(trustsForwardedHeaders({}), false);
    assert.equal(trustsForwardedHeaders({ TRUST_PROXY: '0' }), false);
    assert.equal(trustsForwardedHeaders({ NETLIFY: 'false' }), false);
    assert.equal(trustsForwardedHeaders({ TRUST_PROXY: '1' }), true);
    assert.equal(trustsForwardedHeaders({ NETLIFY: 'true' }), true);
  });

  test('ignores spoofable forwarded values unless proxy trust is enabled', () => {
    const headers = { 'x-forwarded-for': '198.51.100.2', 'x-forwarded-proto': 'https' };
    assert.equal(getClientIp(headers, '203.0.113.9', {}), '203.0.113.9');
    assert.equal(getForwardedProtocol(headers, {}), null);
  });

  test('uses the last proxy-appended address and protocol when trusted', () => {
    const headers = {
      'x-forwarded-for': 'spoofed.example, 198.51.100.2',
      'x-forwarded-proto': 'http, https',
    };
    const env = { TRUST_PROXY: '1' };
    assert.equal(getClientIp(headers, '203.0.113.9', env), '198.51.100.2');
    assert.equal(getForwardedProtocol(headers, env), 'https');
  });

  test('ignores repeated forwarded identity headers instead of coercing them', () => {
    const headers = {
      'x-forwarded-for': ['198.51.100.2', '198.51.100.3'],
      'x-forwarded-proto': ['http', 'https'],
      'x-nf-client-connection-ip': ['198.51.100.4'],
    };

    assert.equal(getClientIp(headers, '203.0.113.9', { TRUST_PROXY: '1' }), '203.0.113.9');
    assert.equal(getClientIp(headers, '203.0.113.9', { NETLIFY: 'true' }), '203.0.113.9');
    assert.equal(getForwardedProtocol(headers, { TRUST_PROXY: '1' }), null);
  });

  test('ignores Netlify-specific and non-standard client IP headers behind a generic proxy', () => {
    const headers = {
      'x-nf-client-connection-ip': '192.0.2.10',
      'client-ip': '192.0.2.11',
      'x-forwarded-for': 'spoofed.example, 198.51.100.2',
    };

    assert.equal(getClientIp(headers, '203.0.113.9', { TRUST_PROXY: '1' }), '198.51.100.2');
  });

  test('uses only the edge-assigned client IP header in the Netlify runtime', () => {
    const headers = {
      'x-nf-client-connection-ip': '198.51.100.3',
      'client-ip': '192.0.2.11',
      'x-forwarded-for': 'spoofed.example, 198.51.100.2',
    };

    assert.equal(getClientIp(headers, '203.0.113.9', { NETLIFY: 'true' }), '198.51.100.3');
    assert.equal(
      getClientIp({ 'client-ip': '192.0.2.11', 'x-forwarded-for': '198.51.100.2' }, null, { NETLIFY: 'true' }),
      '198.51.100.2',
    );
  });
});

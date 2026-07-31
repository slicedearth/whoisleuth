import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRateLimitChecker,
  getClientIp,
  getForwardedProtocol,
  trustsForwardedHeaders,
} from '../lib/rate-limit.mts';

describe('fixed-window bucket bounds', () => {
  test('fails closed for new identities at capacity without evicting active buckets', () => {
    const check = createRateLimitChecker(2);
    const config = { limit: 2, windowMs: 60_000 };

    assert.deepEqual(check('login:first', config, 1_000), { allowed: true });
    assert.deepEqual(check('login:second', config, 1_000), { allowed: true });
    assert.deepEqual(check('login:third', config, 1_000), {
      allowed: false,
      retryAfterSeconds: 60,
    });
    assert.deepEqual(check('login:first', config, 1_001), { allowed: true });
  });

  test('reclaims expired buckets before admitting a new identity', () => {
    const check = createRateLimitChecker(1);
    const config = { limit: 1, windowMs: 60_000 };

    assert.deepEqual(check('api:first', config, 1_000), { allowed: true });
    assert.deepEqual(check('api:second', config, 61_001), { allowed: true });
  });

  test('rejects an overlong bucket key instead of retaining it', () => {
    const check = createRateLimitChecker(2);
    assert.deepEqual(check(`login:${'x'.repeat(200)}`, { limit: 1, windowMs: 60_000 }, 1_000), {
      allowed: false,
      retryAfterSeconds: 60,
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

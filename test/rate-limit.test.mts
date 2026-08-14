import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRateLimitChecker,
  createScopedRateLimitCheckers,
  getClientIp,
  getForwardedProtocol,
  CONTACT_ROUTE_RATE_LIMIT,
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

  test('evicts by expiry order after an expired identity is renewed', () => {
    // Renewing an expired bucket rewrites its window. If the renewal kept the
    // original insertion index, eviction at capacity would drop the renewed
    // identity - the one furthest from expiry, and the one actively sending -
    // and hand it a fresh counter, while a nearer-to-expiry entry survived.
    const evictionProbe = (probe: string) => {
      const check = createRateLimitChecker({ limit: 1, windowMs: 100_000 }, 3);
      check('renewed', 0); // resetAt 100_000, inserted first
      check('older', 99_000); // resetAt 199_000, nearest to expiry once renewed
      check('newer', 99_001); // resetAt 199_001
      check('renewed', 100_001); // expired, renewed to resetAt 200_001
      check('fresh', 100_002); // new identity at capacity -> one eviction
      // limit is 1, so a surviving bucket denies the probe and an evicted key
      // is recreated and allowed.
      return check(probe, 100_003).allowed;
    };

    assert.equal(evictionProbe('older'), true, 'the nearest-to-expiry identity should be evicted');
    assert.equal(evictionProbe('renewed'), false, 'a just-renewed identity must keep its counter');
    assert.equal(evictionProbe('newer'), false, 'a non-expiring identity must keep its counter');
  });

  test('still evicts the oldest identity when no bucket was renewed', () => {
    // Negative control for the renewal case above: without a renewal,
    // insertion order already matches expiry order, so the first-inserted
    // identity is both the oldest and the correct eviction victim.
    const evictionProbe = (probe: string) => {
      const check = createRateLimitChecker({ limit: 1, windowMs: 100_000 }, 3);
      check('oldest', 0);
      check('middle', 99_000);
      check('newest', 99_001);
      check('fresh', 100_002);
      return check(probe, 100_003).allowed;
    };

    assert.equal(evictionProbe('oldest'), true, 'the oldest identity should be evicted');
    assert.equal(evictionProbe('middle'), false);
    assert.equal(evictionProbe('newest'), false);
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
    assert.deepEqual(checkers.contactRoute('contact', 1_002), { allowed: true });
    assert.deepEqual(checkers.scheduledMonitorManagement('monitor', 1_003), { allowed: true });
    assert.deepEqual(checkers.prerenderedHtml('html', 1_004), { allowed: true });
  });

  test('keeps the fixed HTML override generous but bounded', () => {
    assert.deepEqual(PRERENDERED_HTML_RATE_LIMIT, {
      limit: 600,
      windowMs: 60_000,
    });
  });

  test('keeps contact verification separately and conservatively bounded', () => {
    assert.deepEqual(CONTACT_ROUTE_RATE_LIMIT, {
      limit: 60,
      windowMs: 600_000,
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

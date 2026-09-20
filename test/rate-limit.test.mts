import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRateLimitChecker,
  createScopedRateLimitCheckers,
  getClientIp,
  getForwardedProtocol,
  CONTACT_ROUTE_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  PRERENDERED_HTML_RATE_LIMIT,
  trustsForwardedHeaders,
  serverlessClientIdentity,
} from '../lib/rate-limit.mts';
import { headerFact, strictHeader, lastHeaderToken } from '../lib/request-header-facts.mts';

test('header facts reject ambiguous inputs without merging origin and proxy policies', () => {
  const chain = { 'X-Forwarded-Proto': 'http, https' };
  assert.deepEqual(headerFact(chain, 'x-forwarded-proto'), { state: 'valid', value: 'http, https' });
  assert.equal(strictHeader(chain, 'x-forwarded-proto').state, 'invalid');
  assert.equal(lastHeaderToken(chain, 'x-forwarded-proto'), 'https');
  for (const headers of [
    { 'x-forwarded-proto': 'https', 'X-Forwarded-Proto': 'http' },
    { 'x-forwarded-proto': ['https'] }, { 'x-forwarded-proto': 'https\n' },
    { 'x-forwarded-proto': 'x'.repeat(2049) },
  ]) {
    assert.equal(headerFact(headers, 'x-forwarded-proto').state, 'invalid');
    assert.equal(getForwardedProtocol(headers, { TRUST_PROXY: '1' }), null);
  }
  assert.equal(getClientIp({ 'x-forwarded-for': 'not-an-address' }, '192.0.2.1', { TRUST_PROXY: '1' }), '192.0.2.1');
  assert.equal(getClientIp({ 'x-forwarded-for': '192.0.2.2,' }, '192.0.2.1', { TRUST_PROXY: '1' }), '192.0.2.1');
  assert.equal(getClientIp({ 'x-forwarded-for': '192.0.2.2', 'X-Forwarded-For': '192.0.2.3' }, '192.0.2.1', { TRUST_PROXY: '1' }), '192.0.2.1');
});

test('deployed serverless identity refuses missing markers, malformed addresses and spoofed alternatives', () => {
  const valid = { 'x-nf-client-connection-ip': '192.0.2.1' };
  assert.deepEqual(serverlessClientIdentity(valid, { NETLIFY: 'true' }), { ip: '192.0.2.1' });
  assert.deepEqual(serverlessClientIdentity({ 'X-Nf-Client-Connection-Ip': '2001:db8::1' }, { NETLIFY: '1' }), { ip: '2001:db8::1' });
  const runtime = { SITE_ID: '01234567-89ab-cdef-0123-456789abcdef', NODE_ENV: 'production' };
  assert.deepEqual(serverlessClientIdentity(valid, runtime), { ip: '192.0.2.1' });
  assert.equal(trustsForwardedHeaders(runtime), false, 'function identity cannot opt a generic host into proxy trust');
  assert.match(serverlessClientIdentity(valid, { NODE_ENV: 'production', TRUST_PROXY: '1' }).error!, /site identity/u);
  for (const headers of [{}, { 'x-forwarded-for': '192.0.2.1' }, { 'x-nf-client-connection-ip': '192.0.2.1,192.0.2.2' },
    { ...valid, 'X-Nf-Client-Connection-Ip': '192.0.2.2' }, { 'x-nf-client-connection-ip': 'not-an-address' }]) {
    assert.match(serverlessClientIdentity(headers, { NETLIFY: 'true' }).error!, /client identity/u);
  }
  assert.deepEqual(serverlessClientIdentity({}, {}), { ip: 'unknown' }, 'local fixture execution does not claim deployed identity');
});

describe('fixed-window bucket bounds', () => {
  test('aggregates rotating IPv6 login addresses by /64 without merging adjacent prefixes', () => {
    const checkers = createScopedRateLimitCheckers();
    for (let index = 1; index <= LOGIN_RATE_LIMIT.limit; index++) {
      assert.equal(checkers.login(`2001:db8:1:2::${index.toString(16)}`, 1_000).allowed, true);
    }
    assert.equal(checkers.login('2001:0DB8:0001:0002:1234:5678:abcd:ffff', 1_001).allowed, false);
    assert.equal(checkers.login('2001:db8:1:3::1', 1_001).allowed, true);
    assert.equal(checkers.api('2001:db8:1:2::1', 1_001).allowed, true);
    assert.equal(checkers.login('2001:db8:1:2::1', 1_000 + LOGIN_RATE_LIMIT.windowMs).allowed, true);
  });

  test('maps equivalent IPv4 login identities together without merging neighbouring addresses', () => {
    const checkers = createScopedRateLimitCheckers();
    for (let index = 0; index < LOGIN_RATE_LIMIT.limit; index++) {
      assert.equal(checkers.login('192.0.2.1', 1_000).allowed, true);
    }
    assert.equal(checkers.login('::ffff:192.0.2.1', 1_001).allowed, false);
    assert.equal(checkers.login('::ffff:c000:201', 1_001).allowed, false);
    assert.equal(checkers.login('192.0.2.2', 1_001).allowed, true);
    assert.equal(checkers.login('::ffff:192.0.2.2', 1_001).allowed, true);
  });

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

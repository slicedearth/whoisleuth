import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  ACQUIRE_SCRIPT, ACQUIRE_WITH_USAGE_SCRIPT, RELEASE_SCRIPT, STATUS_SCRIPT,
  DAY_WINDOW_MS, THIRTY_DAY_WINDOW_MS,
} from '../lib/distributed-operation-budget.mts';
import { startRedisVerification } from '../tools/redis-verification.mts';

describe('distributed-budget scripts in the isolated production-compatible engine', { concurrency: false }, () => {
  let redis: Awaited<ReturnType<typeof startRedisVerification>>;
  before(async () => { redis = await startRedisVerification(); });
  after(async () => { await redis?.stop(); });
  beforeEach(() => { assert.equal(redis.command(['FLUSHDB']), 'OK'); });
  const evalScript = (script: string, keys: string[], args: (string | number)[] = []) =>
    redis.command(['EVAL', script, keys.length, ...keys, ...args]) as number[];
  const runtime = 'fixture:runtime';
  const session = 'fixture:session';
  const prefixes = ['usage:global:day', 'usage:global:month', 'usage:feature:day', 'usage:feature:month'];
  const usageKeys = () => {
    const [seconds, micros] = redis.command(['TIME']) as string[];
    const now = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
    return prefixes.map((prefix, index) => `${prefix}:${Math.floor(now / (index % 2 ? THIRTY_DAY_WINDOW_MS : DAY_WINDOW_MS))}`);
  };
  // Seed both adjacent buckets so a real UTC boundary during a test is harmless.
  // The scripts still use the engine's TIME, not a substituted test clock.
  const adjacent = (key: string) => {
    const colon = key.lastIndexOf(':');
    return [key, `${key.slice(0, colon)}:${Number(key.slice(colon + 1)) + 1}`];
  };
  const acquire = (script: string, id: string, options: { sessionKey?: string; runtimeLimit?: number; sessionLimit?: number; usage?: number[] } = {}) =>
    evalScript(script, [runtime, options.sessionKey ?? session, ...(script === ACQUIRE_WITH_USAGE_SCRIPT ? prefixes : [])],
      [options.runtimeLimit ?? 2, options.sessionLimit ?? 1, 30_000, id, ...(options.usage ?? [100, 100, 100, 100])]);

  for (const [label, script] of [['leases', ACQUIRE_SCRIPT], ['leases with usage', ACQUIRE_WITH_USAGE_SCRIPT]] as const) {
    test(`${label}: session and runtime boundaries reject without admitting a lease`, () => {
      assert.deepEqual(acquire(script, 'one').slice(0, 4), [1, 0, 1, 1]);
      assert.deepEqual(acquire(script, 'session-denied').slice(0, 4), [0, 1, 1, 1]);
      assert.deepEqual(acquire(script, 'two', { sessionKey: 'fixture:other' }).slice(0, 4), [1, 0, 2, 1]);
      assert.deepEqual(acquire(script, 'runtime-denied', { sessionKey: 'fixture:third' }).slice(0, 4), [0, 2, 2, 0]);
      assert.deepEqual(redis.command(['ZRANGE', runtime, 0, -1]), ['one', 'two']);
      assert.equal(redis.command(['EXISTS', 'fixture:third']), 0);
      if (script === ACQUIRE_WITH_USAGE_SCRIPT) for (const prefix of prefixes) {
        const keys = redis.command(['KEYS', `${prefix}:*`]) as string[];
        assert.equal(keys.reduce((total, key) => total + Number(redis.command(['GET', key])), 0), 2);
      }
    });

    test(`${label}: expired scores release capacity and live leases get a finite expiry`, () => {
      for (const key of [runtime, session]) redis.command(['ZADD', key, 0, 'expired']);
      assert.deepEqual(acquire(script, 'current').slice(0, 4), [1, 0, 1, 1]);
      for (const key of [runtime, session]) {
        assert.deepEqual(redis.command(['ZRANGE', key, 0, -1]), ['current']);
        const ttl = redis.command(['PTTL', key]) as number;
        assert.ok(ttl > 0 && ttl <= 90_000);
      }
    });
  }

  test('release removes only its lease, is idempotent and removes empty sets', () => {
    acquire(ACQUIRE_SCRIPT, 'one', { sessionLimit: 2 });
    acquire(ACQUIRE_SCRIPT, 'two', { sessionLimit: 2 });
    assert.deepEqual(evalScript(RELEASE_SCRIPT, [runtime, session], ['one']), [1, 1]);
    assert.deepEqual(evalScript(RELEASE_SCRIPT, [runtime, session], ['one']), [0, 0]);
    assert.deepEqual(redis.command(['ZRANGE', runtime, 0, -1]), ['two']);
    assert.deepEqual(evalScript(RELEASE_SCRIPT, [runtime, session], ['two']), [1, 1]);
    assert.equal(redis.command(['EXISTS', runtime, session]), 0);
  });

  test('status expires stale members in every requested class without creating empty keys', () => {
    acquire(ACQUIRE_SCRIPT, 'current');
    for (const key of [runtime, 'fixture:expired']) redis.command(['ZADD', key, 0, 'expired']);
    assert.deepEqual(evalScript(STATUS_SCRIPT, [runtime, 'fixture:expired', 'fixture:absent']), [1, 0, 0]);
    assert.equal(redis.command(['EXISTS', 'fixture:expired', 'fixture:absent']), 0);
  });

  for (const [index, label] of ['global daily', 'global thirty-day', 'feature daily', 'feature thirty-day'].entries()) {
    test(`${label} usage denial leaves all counters unchanged and creates no lease`, () => {
      const limits = [100, 100, 100, 100];
      limits[index] = 1;
      const keys = usageKeys().flatMap(adjacent);
      for (const key of keys) redis.command(['SET', key, '1']);
      const result = acquire(ACQUIRE_WITH_USAGE_SCRIPT, 'denied', { usage: limits });
      assert.deepEqual(result.slice(0, 8), [0, index + 3, 0, 0, 1, 1, 1, 1]);
      const retry = result[8];
      assert.ok(typeof retry === 'number' && retry >= 1 && retry <= THIRTY_DAY_WINDOW_MS / 1000);
      assert.equal(redis.command(['EXISTS', runtime, session]), 0);
      for (const key of keys) assert.equal(redis.command(['GET', key]), '1');
    });
  }

  test('malformed counts at each scope fail closed before any live lease or counter mutation', () => {
    for (const bad of ['-1', '1.5', 'no-count', '1000000001']) {
      for (const index of [0, 1, 2, 3]) {
        redis.command(['FLUSHDB']);
        const keys = usageKeys();
        keys.forEach((key, position) => adjacent(key).forEach(bucket => redis.command(['SET', bucket, position === index ? bad : '7'])));
        assert.deepEqual(acquire(ACQUIRE_WITH_USAGE_SCRIPT, 'denied'), [-1, 0, 0, 0, 0, 0, 0, 0, 1]);
        assert.equal(redis.command(['EXISTS', runtime, session]), 0);
        keys.forEach((key, position) => adjacent(key).forEach(bucket => assert.equal(redis.command(['GET', bucket]), position === index ? bad : '7')));
      }
    }
  });

  test('wrong-type counters fail closed before acquiring a lease or incrementing an earlier counter', () => {
    const keys = usageKeys();
    const first = keys[0];
    const fourth = keys[3];
    assert.ok(first && fourth);
    for (const bucket of adjacent(first)) redis.command(['SET', bucket, '7']);
    for (const bucket of adjacent(fourth)) redis.command(['LPUSH', bucket, 'invalid']);
    assert.throws(() => acquire(ACQUIRE_WITH_USAGE_SCRIPT, 'denied'), /WRONGTYPE/u);
    assert.equal(redis.command(['GET', first]), '7');
    assert.equal(redis.command(['EXISTS', runtime, session]), 0);
  });

  test('prior windows do not block the current window, and feature disabling never disables global limits', () => {
    for (const key of usageKeys()) {
      const colon = key.lastIndexOf(':');
      redis.command(['SET', `${key.slice(0, colon)}:${Number(key.slice(colon + 1)) - 2}`, '1000000000']);
    }
    const options = { usage: [1, 1, 0, 0] };
    assert.deepEqual(acquire(ACQUIRE_WITH_USAGE_SCRIPT, 'one', options), [1, 0, 1, 1, 1, 1, 1, 1, 0]);
    for (const key of usageKeys()) {
      const ttl = redis.command(['PTTL', key]) as number;
      // Current/new buckets only: earlier-window keys deliberately lack expiry.
      if (ttl !== -2) assert.ok(ttl > 0 && ttl <= THIRTY_DAY_WINDOW_MS + 60_000);
      for (const bucket of adjacent(key)) redis.command(['SET', bucket, '1']);
    }
    evalScript(RELEASE_SCRIPT, [runtime, session], ['one']);
    assert.equal(acquire(ACQUIRE_WITH_USAGE_SCRIPT, 'denied', options)[1], 3);
  });
});

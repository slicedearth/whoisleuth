const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_OPERATION_LIMITS,
  OPERATION_CLASSES,
  OPERATION_BUDGET_UNAVAILABLE_ERROR_CODE,
  OPERATION_FEATURES,
  OPERATION_USAGE_ERROR_CODE,
  createConfiguredOperationBudget,
  normalizeOperationUsageLimits,
  operationBudgetTargetFor,
  operationBudgetError,
  operationBudgetHttpStatus,
  operationBudgetReport,
  runWithOperationBudget,
} = require('../lib/operation-budget.mts');
const {
  ACQUIRE_SCRIPT,
  ACQUIRE_WITH_USAGE_SCRIPT,
  DAY_WINDOW_MS,
  RELEASE_SCRIPT,
  STATUS_SCRIPT,
  THIRTY_DAY_WINDOW_MS,
  createDistributedOperationBudget,
  createRestCommandClient,
  normalizedNamespace,
  normalizedLimits,
  normalizedOperationFeature,
  normalizedRestUrl,
  normalizedToken,
  normalizedUsageLimits,
} = require('../lib/distributed-operation-budget.mts');

const TEST_LIMITS = {
  [OPERATION_CLASSES.REGISTRY_LIGHT]: { session: 2, runtime: 3 },
  [OPERATION_CLASSES.REGISTRY_DEEP]: { session: 1, runtime: 2 },
};

describe('distributed budget configuration', () => {
  test('validates the HTTPS REST origin, token, and bounded namespace', () => {
    assert.equal(normalizedRestUrl('https://test-budget.upstash.io/'), 'https://test-budget.upstash.io');
    assert.throws(() => normalizedRestUrl('http://test-budget.upstash.io'), /HTTPS origin/);
    assert.throws(() => normalizedRestUrl('https://budget.example'), /service endpoint domain/);
    assert.throws(() => normalizedRestUrl('https://test-budget.upstash.io/path'), /must not include a path/);
    assert.throws(() => normalizedRestUrl('https://user:pass@test-budget.upstash.io'), /without credentials/);
    assert.equal(normalizedToken('secret-token'), 'secret-token');
    assert.throws(() => normalizedToken('bad\ntoken'), /bounded.*token/);
    assert.equal(normalizedNamespace('deployment_1:budget'), 'deployment_1:budget');
    assert.throws(() => normalizedNamespace('spaces are unsafe'), /namespace/);
    assert.throws(() => normalizedLimits({}), /At least one distributed/);
    assert.throws(() => normalizedLimits({ unsafe: { session: 3, runtime: 2 } }), /Invalid distributed/);
  });

  test('keeps the in-memory default unless both distributed credentials exist', () => {
    assert.equal(createConfiguredOperationBudget({}).mode, 'in_memory');
    assert.equal(createConfiguredOperationBudget({ UPSTASH_REDIS_REST_URL: 'https://test-budget.upstash.io' }).mode, 'unavailable');
    assert.equal(createConfiguredOperationBudget({ UPSTASH_REDIS_REST_TOKEN: 'token' }).mode, 'unavailable');
    const provider = createConfiguredOperationBudget({
      UPSTASH_REDIS_REST_URL: 'https://test-budget.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      WHOISLEUTH_BUDGET_NAMESPACE: 'test:budget',
    }, {
      command: async () => [1, 0, 1, 1],
      createLeaseId: () => 'a'.repeat(32),
    });
    assert.equal(provider.mode, 'redis_rest');
    assert.equal(provider.distributed, true);
    assert.equal(provider.usageLimits, null);
  });

  test('validates a bounded global and per-feature usage policy', () => {
    const policy = normalizeOperationUsageLimits(JSON.stringify({
      daily: 1000,
      monthly: 10_000,
      features: {
        lookup_fast: { daily: 400, monthly: 4000 },
        bulk_deep: { daily: 100, monthly: 1000 },
      },
    }));
    assert.deepEqual(policy, {
      modelVersion: 1,
      daily: 1000,
      monthly: 10_000,
      features: {
        lookup_fast: { daily: 400, monthly: 4000 },
        bulk_deep: { daily: 100, monthly: 1000 },
      },
    });
    assert.throws(() => normalizeOperationUsageLimits('{'), /valid JSON/);
    assert.throws(() => normalizeOperationUsageLimits({ daily: 10, monthly: 9 }), /must not be lower/);
    assert.throws(() => normalizeOperationUsageLimits({ daily: 10, monthly: 100, unknown: true }), /unknown fields/);
    assert.throws(() => normalizeOperationUsageLimits({
      daily: 10,
      monthly: 100,
      features: { not_implemented: { daily: 1, monthly: 2 } },
    }), /Invalid feature/);
    assert.throws(() => normalizeOperationUsageLimits({
      daily: 10,
      monthly: 100,
      features: { lookup_fast: { daily: 11, monthly: 20 } },
    }), /fit within global/);
  });

  test('requires distributed credentials for an explicitly configured usage policy', () => {
    const policy = JSON.stringify({ daily: 100, monthly: 1000 });
    assert.equal(createConfiguredOperationBudget({
      WHOISLEUTH_OPERATION_USAGE_LIMITS: policy,
    }).mode, 'unavailable');
    assert.equal(createConfiguredOperationBudget({
      UPSTASH_REDIS_REST_URL: 'https://test-budget.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      WHOISLEUTH_OPERATION_USAGE_LIMITS: '{malformed',
    }).mode, 'unavailable');
    const configured = createConfiguredOperationBudget({
      UPSTASH_REDIS_REST_URL: 'https://test-budget.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      WHOISLEUTH_OPERATION_USAGE_LIMITS: policy,
    }, {
      command: async () => [1, 0, 1, 1, 1, 1, 1, 1, 0],
      createLeaseId: () => 'a'.repeat(32),
    });
    assert.equal(configured.mode, 'redis_rest');
    assert.equal(configured.usageLimits.daily, 100);
    assert.equal(configured.usageLimits.monthly, 1000);
  });

  test('reports distributed and unavailable provider scopes honestly', () => {
    const distributed = createDistributedOperationBudget({
      limits: TEST_LIMITS,
      namespace: 'test:budget',
    }, { command: async () => [], createLeaseId: () => 'a'.repeat(32) });
    assert.deepEqual(operationBudgetReport('netlify', distributed), {
      mode: 'redis_rest',
      scope: 'deployment',
      distributed: true,
      classes: [
        { id: OPERATION_CLASSES.REGISTRY_LIGHT, sessionLimit: 2, runtimeLimit: 3 },
        { id: OPERATION_CLASSES.REGISTRY_DEEP, sessionLimit: 1, runtimeLimit: 2 },
      ],
      usage: {
        mode: 'disabled',
        modelVersion: 1,
        windowModel: 'utc_epoch_fixed',
        dailyLimit: null,
        thirtyDayLimit: null,
        features: [],
      },
    });
    const unavailable = createConfiguredOperationBudget({ UPSTASH_REDIS_REST_TOKEN: 'token' });
    assert.equal(operationBudgetReport('netlify', unavailable).scope, 'unavailable');
  });
});

describe('bounded REST command client', () => {
  test('posts one JSON command without following redirects or exposing the token in the URL', async () => {
    let captured;
    const command = createRestCommandClient({
      url: 'https://test-budget.upstash.io',
      token: 'server-secret',
    }, {
      safeFetch: async (url, options, redirects) => {
        captured = { url, options, redirects };
        return new Response(JSON.stringify({ result: [1, 2, 3] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    assert.deepEqual(await command(['PING']), [1, 2, 3]);
    assert.equal(captured.url, 'https://test-budget.upstash.io');
    assert.equal(captured.redirects, 0);
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.redirect, 'manual');
    assert.equal(captured.options.headers.Authorization, 'Bearer server-secret');
    assert.equal(captured.options.body, '["PING"]');
    assert.doesNotMatch(captured.url + captured.options.body, /server-secret/);
  });

  test('rejects malformed, failed, and provider-error responses without echoing details', async () => {
    const scenarios = [
      new Response('not json', { status: 200 }),
      new Response(JSON.stringify({ result: null }), { status: 500 }),
      new Response(JSON.stringify({ error: 'sensitive provider detail' }), { status: 200 }),
      new Response(JSON.stringify({ other: 'missing result' }), { status: 200 }),
    ];
    for (const response of scenarios) {
      const command = createRestCommandClient({ url: 'https://test-budget.upstash.io', token: 'token' }, {
        safeFetch: async () => response,
      });
      await assert.rejects(command(['PING']), (error) => {
        assert.doesNotMatch(error.message, /sensitive provider detail|token/);
        return true;
      });
    }
  });
});

describe('distributed sorted-set leases', () => {
  test('acquires and idempotently releases an opaque expiring lease', async () => {
    const commands = [];
    const provider = createDistributedOperationBudget({
      limits: TEST_LIMITS,
      namespace: 'test:budget',
      leaseTtlMs: 60_000,
    }, {
      command: async (command) => {
        commands.push(command);
        if (command[1] === ACQUIRE_SCRIPT) return [1, 0, 1, 1];
        if (command[1] === RELEASE_SCRIPT) return [1, 1];
        throw new Error('unexpected command');
      },
      createLeaseId: () => 'a'.repeat(32),
    });
    const lease = await provider.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'opaque-session-key');
    assert.equal(lease.allowed, true);
    assert.equal(commands[0][0], 'EVAL');
    assert.equal(commands[0][2], 2);
    assert.equal(commands[0][7], 60_000);
    assert.equal(commands[0][8], 'a'.repeat(32));
    assert.ok(commands[0][3].endsWith(':runtime:registry_light'));
    assert.match(commands[0][4], /:session:registry_light:[a-f0-9]{64}$/);
    assert.doesNotMatch(commands[0][4], /opaque-session-key/);
    assert.equal(await lease.release(), true);
    assert.equal(await lease.release(), true);
    assert.equal(commands.filter((command) => command[1] === RELEASE_SCRIPT).length, 1);
  });

  test('checks and increments fixed-window usage in the same atomic admission command', async () => {
    const commands = [];
    const provider = createDistributedOperationBudget({
      limits: TEST_LIMITS,
      namespace: 'test:budget',
      usageLimits: {
        daily: 100,
        monthly: 1000,
        features: { bulk_deep: { daily: 20, monthly: 200 } },
      },
    }, {
      command: async (command) => {
        commands.push(command);
        if (command[1] === ACQUIRE_WITH_USAGE_SCRIPT) return [1, 0, 1, 1, 3, 20, 2, 10, 0];
        if (command[1] === RELEASE_SCRIPT) return [1, 1];
        throw new Error('unexpected command');
      },
      createLeaseId: () => '1'.repeat(32),
    });
    const lease = await provider.acquire(
      OPERATION_CLASSES.REGISTRY_DEEP,
      'session-a',
      { operationFeature: OPERATION_FEATURES.BULK_DEEP },
    );
    assert.equal(lease.allowed, true);
    const acquire = commands[0];
    assert.equal(acquire[0], 'EVAL');
    assert.equal(acquire[1], ACQUIRE_WITH_USAGE_SCRIPT);
    assert.equal(acquire[2], 6);
    assert.ok(acquire[5].endsWith(':usage:global:day'));
    assert.ok(acquire[6].endsWith(':usage:global:thirty_day'));
    assert.ok(acquire[7].endsWith(':usage:feature:bulk_deep:day'));
    assert.ok(acquire[8].endsWith(':usage:feature:bulk_deep:thirty_day'));
    assert.deepEqual(acquire.slice(-4), [100, 1000, 20, 200]);
    assert.ok(ACQUIRE_WITH_USAGE_SCRIPT.indexOf('local function read_counter(key)')
      < ACQUIRE_WITH_USAGE_SCRIPT.indexOf('local expires_at ='));
    assert.ok(ACQUIRE_WITH_USAGE_SCRIPT.indexOf("redis.call('INCR', global_day_key)")
      > ACQUIRE_WITH_USAGE_SCRIPT.indexOf('feature_thirty_day_count >= tonumber(ARGV[8])'));
    assert.equal(await lease.release(), true);
    assert.equal(commands.filter((command) => command[1] === ACQUIRE_WITH_USAGE_SCRIPT).length, 1);
  });

  test('shares global counters across features while retaining separate feature counters', async () => {
    const commands = [];
    const provider = createDistributedOperationBudget({
      limits: TEST_LIMITS,
      namespace: 'test:budget',
      usageLimits: { daily: 100, monthly: 1000 },
    }, {
      command: async (command) => {
        commands.push(command);
        return [1, 0, 1, 1, 1, 1, 1, 1, 0];
      },
      createLeaseId: () => '5'.repeat(32),
    });
    await provider.acquire(
      OPERATION_CLASSES.REGISTRY_LIGHT,
      'session-a',
      { operationFeature: OPERATION_FEATURES.LOOKUP_FAST },
    );
    await provider.acquire(
      OPERATION_CLASSES.REGISTRY_DEEP,
      'session-b',
      { operationFeature: OPERATION_FEATURES.BULK_DEEP },
    );

    assert.equal(commands[0][5], commands[1][5]);
    assert.equal(commands[0][6], commands[1][6]);
    assert.notEqual(commands[0][7], commands[1][7]);
    assert.notEqual(commands[0][8], commands[1][8]);
  });

  test('tracks unattributed legacy operations under the global policy without a feature ceiling', async () => {
    let captured;
    const provider = createDistributedOperationBudget({
      limits: TEST_LIMITS,
      usageLimits: { daily: 10, monthly: 100 },
    }, {
      command: async (command) => {
        captured = command;
        return [1, 0, 1, 1, 1, 1, 1, 1, 0];
      },
      createLeaseId: () => '2'.repeat(32),
    });
    const lease = await provider.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    assert.equal(lease.allowed, true);
    assert.ok(captured[7].includes(':usage:feature:unattributed:day'));
    assert.deepEqual(captured.slice(-2), [0, 0]);
  });

  test('maps atomic global and feature usage denials to stable retry windows', async () => {
    const cases = [
      [3, 'global_daily', 3600],
      [4, 'global_30_day', THIRTY_DAY_WINDOW_MS / 1000],
      [5, 'feature_daily', 120],
      [6, 'feature_30_day', 240],
    ];
    for (const [scopeCode, scope, retryAfterSeconds] of cases) {
      const provider = createDistributedOperationBudget({
        limits: TEST_LIMITS,
        usageLimits: {
          daily: 10,
          monthly: 100,
          features: { lookup_fast: { daily: 5, monthly: 50 } },
        },
      }, {
        command: async () => [0, scopeCode, 0, 0, 10, 50, 5, 25, retryAfterSeconds],
        createLeaseId: () => '3'.repeat(32),
      });
      const outcome = await runWithOperationBudget(
        provider,
        operationBudgetTargetFor('lookup', { fast: true }),
        'session-a',
        async () => 'not reached',
      );
      assert.equal(outcome.allowed, false);
      assert.equal(outcome.denial.scope, scope);
      assert.equal(outcome.denial.retryAfterSeconds, retryAfterSeconds);
      assert.equal(operationBudgetHttpStatus(outcome.denial), 429);
      const error = operationBudgetError(outcome.denial);
      assert.equal(error.errorCode, OPERATION_USAGE_ERROR_CODE);
      assert.equal(error.operationFeature, OPERATION_FEATURES.LOOKUP_FAST);
      assert.equal(error.usageModelVersion, 1);
    }
  });

  test('rejects malformed usage results and retry windows as provider failures', async () => {
    for (const result of [
      [0, 3, 0, 0, 10, 10, 10, 10, 0],
      [0, 4, 0, 0, 10, 10, 10, 10, (THIRTY_DAY_WINDOW_MS / 1000) + 1],
      [1, 0, 1, 1],
    ]) {
      const provider = createDistributedOperationBudget({
        limits: TEST_LIMITS,
        usageLimits: { daily: 10, monthly: 100 },
      }, {
        command: async () => result,
        createLeaseId: () => '4'.repeat(32),
      });
      const denial = await provider.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
      assert.equal(denial.allowed, false);
      assert.equal(denial.scope, 'provider');
    }
  });

  test('maps atomic provider denials to existing session and runtime scopes', async () => {
    for (const [scopeCode, expectedScope] of [[1, 'session'], [2, 'runtime']]) {
      const provider = createDistributedOperationBudget({ limits: TEST_LIMITS }, {
        command: async () => [0, scopeCode, 3, 2],
        createLeaseId: () => 'b'.repeat(32),
      });
      const denial = await provider.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
      assert.deepEqual(denial, {
        allowed: false,
        operationClass: OPERATION_CLASSES.REGISTRY_LIGHT,
        scope: expectedScope,
        retryAfterSeconds: 1,
      });
    }
  });

  test('fails closed with a stable retryable provider response on outages or malformed results', async () => {
    for (const command of [async () => { throw new Error('outage'); }, async () => ['bad']]) {
      const provider = createDistributedOperationBudget({ limits: TEST_LIMITS }, {
        command,
        createLeaseId: () => 'c'.repeat(32),
      });
      let callbackCalls = 0;
      const outcome = await runWithOperationBudget(
        provider,
        OPERATION_CLASSES.REGISTRY_DEEP,
        'session-a',
        () => { callbackCalls += 1; },
      );
      assert.equal(callbackCalls, 0);
      assert.equal(outcome.allowed, false);
      assert.equal(outcome.denial.scope, 'provider');
      assert.equal(operationBudgetHttpStatus(outcome.denial), 503);
      const payload = operationBudgetError(outcome.denial);
      assert.equal(payload.errorCode, OPERATION_BUDGET_UNAVAILABLE_ERROR_CODE);
      assert.equal(payload.limitScope, 'provider');
    }
  });

  test('lets a completed operation stand when release is temporarily unavailable', async () => {
    let commands = 0;
    const provider = createDistributedOperationBudget({ limits: TEST_LIMITS }, {
      command: async () => {
        commands += 1;
        if (commands === 1) return [1, 0, 1, 1];
        throw new Error('release outage');
      },
      createLeaseId: () => 'd'.repeat(32),
    });
    const outcome = await runWithOperationBudget(
      provider,
      OPERATION_CLASSES.REGISTRY_LIGHT,
      'session-a',
      () => 'completed',
    );
    assert.deepEqual(outcome, { allowed: true, value: 'completed' });
  });

  test('returns bounded deployment-wide status without session identifiers', async () => {
    let captured;
    const provider = createDistributedOperationBudget({ limits: TEST_LIMITS, namespace: 'test:budget' }, {
      command: async (command) => {
        captured = command;
        return [2, 1];
      },
      createLeaseId: () => 'e'.repeat(32),
    });
    assert.deepEqual(await provider.status(), [
      { id: OPERATION_CLASSES.REGISTRY_LIGHT, sessionLimit: 2, runtimeLimit: 3, active: 2 },
      { id: OPERATION_CLASSES.REGISTRY_DEEP, sessionLimit: 1, runtimeLimit: 2, active: 1 },
    ]);
    assert.equal(captured[0], 'EVAL');
    assert.equal(captured[1], STATUS_SCRIPT);
    assert.equal(captured[2], 2);
    assert.ok(captured.slice(3).every((key) => key.includes(':runtime:')));
  });
});

test('the default limits remain compatible with the distributed provider', () => {
  const provider = createDistributedOperationBudget({ limits: DEFAULT_OPERATION_LIMITS }, {
    command: async () => [],
    createLeaseId: () => 'f'.repeat(32),
  });
  assert.deepEqual(provider.limits, DEFAULT_OPERATION_LIMITS);
});

test('usage window constants remain fixed and operation features are bounded', () => {
  assert.equal(DAY_WINDOW_MS, 86_400_000);
  assert.equal(THIRTY_DAY_WINDOW_MS, DAY_WINDOW_MS * 30);
  assert.equal(normalizedOperationFeature({ operationFeature: 'bulk_fast' }), 'bulk_fast');
  assert.equal(normalizedOperationFeature({}), 'unattributed');
  assert.throws(() => normalizedOperationFeature({ operationFeature: 'bad feature' }), /bounded operation feature/);
  assert.deepEqual(normalizedUsageLimits({ daily: 10, monthly: 100 }), {
    modelVersion: 1,
    daily: 10,
    monthly: 100,
    features: {},
  });
});

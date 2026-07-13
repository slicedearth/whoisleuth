const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_OPERATION_LIMITS,
  OPERATION_CLASSES,
  OPERATION_BUDGET_UNAVAILABLE_ERROR_CODE,
  createConfiguredOperationBudget,
  operationBudgetError,
  operationBudgetHttpStatus,
  operationBudgetReport,
  runWithOperationBudget,
} = require('../lib/operation-budget');
const {
  ACQUIRE_SCRIPT,
  RELEASE_SCRIPT,
  STATUS_SCRIPT,
  createDistributedOperationBudget,
  createRestCommandClient,
  normalizedNamespace,
  normalizedLimits,
  normalizedRestUrl,
  normalizedToken,
} = require('../lib/distributed-operation-budget');

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

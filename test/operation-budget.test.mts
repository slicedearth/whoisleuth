import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATION_BUDGET_ERROR_CODE,
  OPERATION_CLASSES,
  OPERATION_FEATURE_MODEL_VERSION,
  OPERATION_FEATURES,
  assertOperationBudgetProvider,
  createOperationBudget,
  normalizeOperationBudgetTarget,
  operationBudgetTargetFor,
  operationBudgetError,
  operationBudgetReport,
  operationClassFor,
  operationFeatureFor,
  runWithOperationBudget,
} from '../lib/operation-budget.mts';
import { requiredValue } from './value-assertions.mts';

const TEST_LIMITS = {
  [OPERATION_CLASSES.REGISTRY_LIGHT]: { session: 2, runtime: 3 },
  [OPERATION_CLASSES.REGISTRY_DEEP]: { session: 1, runtime: 2 },
};

describe('network operation classification', () => {
  test('maps established endpoints and scan depths to bounded cost classes', () => {
    assert.equal(operationClassFor('lookup', { fast: true }), OPERATION_CLASSES.REGISTRY_LIGHT);
    assert.equal(operationClassFor('lookup'), OPERATION_CLASSES.REGISTRY_DEEP);
    assert.equal(operationClassFor('availability', { fast: true }), OPERATION_CLASSES.REGISTRY_LIGHT);
    assert.equal(operationClassFor('rdap'), OPERATION_CLASSES.REGISTRY_LIGHT);
    assert.equal(operationClassFor('whois'), OPERATION_CLASSES.REGISTRY_DEEP);
    assert.equal(operationClassFor('certificate_transparency'), OPERATION_CLASSES.CERTIFICATE_SEARCH);
    assert.equal(operationClassFor('domain_posture'), OPERATION_CLASSES.POSTURE_AUDIT);
    assert.equal(operationClassFor('not-implemented'), null);
  });

  test('derives versioned feature identities from server-observed request shape', () => {
    assert.equal(OPERATION_FEATURE_MODEL_VERSION, 1);
    assert.equal(operationFeatureFor('lookup', { fast: true }), OPERATION_FEATURES.LOOKUP_FAST);
    assert.equal(operationFeatureFor('lookup'), OPERATION_FEATURES.LOOKUP_DEEP);
    assert.equal(operationFeatureFor('lookup', { fast: true, compact: true }), OPERATION_FEATURES.BULK_FAST);
    assert.equal(operationFeatureFor('lookup', { compact: true }), OPERATION_FEATURES.BULK_DEEP);
    assert.equal(operationFeatureFor('availability', { fast: true }), OPERATION_FEATURES.AVAILABILITY_FAST);
    assert.equal(operationFeatureFor('availability'), OPERATION_FEATURES.AVAILABILITY_DEEP);
    assert.equal(operationFeatureFor('rdap'), OPERATION_FEATURES.RDAP);
    assert.equal(operationFeatureFor('whois'), OPERATION_FEATURES.WHOIS);
    assert.equal(operationFeatureFor('certificate_transparency'), OPERATION_FEATURES.CERTIFICATE_TRANSPARENCY);
    assert.equal(operationFeatureFor('domain_posture'), OPERATION_FEATURES.DOMAIN_POSTURE);
    assert.equal(operationFeatureFor('not-implemented'), null);
  });

  test('binds feature identities to their established concurrency class', () => {
    assert.deepEqual(operationBudgetTargetFor('lookup', { fast: true, compact: true }), {
      operationFeature: OPERATION_FEATURES.BULK_FAST,
      operationClass: OPERATION_CLASSES.REGISTRY_LIGHT,
    });
    assert.deepEqual(operationBudgetTargetFor('lookup'), {
      operationFeature: OPERATION_FEATURES.LOOKUP_DEEP,
      operationClass: OPERATION_CLASSES.REGISTRY_DEEP,
    });
    assert.equal(operationBudgetTargetFor('not-implemented'), null);
    assert.deepEqual(normalizeOperationBudgetTarget('custom_class'), {
      operationClass: 'custom_class',
      operationFeature: null,
    });
    assert.throws(() => normalizeOperationBudgetTarget('unsafe class'), /valid operation budget target/);
    assert.throws(() => normalizeOperationBudgetTarget(null), /valid operation budget target/);
    assert.throws(() => normalizeOperationBudgetTarget({
      operationFeature: OPERATION_FEATURES.BULK_FAST,
      operationClass: OPERATION_CLASSES.REGISTRY_DEEP,
    }), /do not match/);
  });

  test('reports conservative non-distributed runtime limits', () => {
    const express = operationBudgetReport('express');
    const netlify = operationBudgetReport('netlify');
    assert.equal(express.mode, 'in_memory');
    assert.equal(express.scope, 'process');
    assert.equal(express.distributed, false);
    assert.equal(netlify.scope, 'serverless_instance');
    assert.ok(netlify.classes.every((entry) => entry.runtimeLimit >= entry.sessionLimit));
  });
});

describe('in-memory operation leases', () => {
  test('enforces a per-session ceiling and releases idempotently', async () => {
    const budget = createOperationBudget(TEST_LIMITS);
    const first = await budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    const second = await budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    const denied = await budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.deepEqual(denied, {
      allowed: false,
      operationClass: OPERATION_CLASSES.REGISTRY_LIGHT,
      scope: 'session',
      retryAfterSeconds: 1,
    });
    if (!first.allowed || !second.allowed) assert.fail('expected the first two leases to be allowed');
    await first.release();
    await first.release();
    const replacement = await budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    assert.equal(replacement.allowed, true);
    if (!replacement.allowed) assert.fail('expected the released capacity to be reusable');
    await second.release();
    await replacement.release();
    assert.equal(
      requiredValue((await budget.status()).find((entry) => entry.id === OPERATION_CLASSES.REGISTRY_LIGHT)).active,
      0,
    );
  });

  test('enforces a runtime ceiling across independent sessions', async () => {
    const budget = createOperationBudget(TEST_LIMITS);
    const leases = await Promise.all([
      budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a'),
      budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a'),
      budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-b'),
    ]);
    const denied = await budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-c');
    assert.equal(denied.allowed, false);
    if (denied.allowed) assert.fail('expected the runtime ceiling to deny the fourth lease');
    assert.equal(denied.scope, 'runtime');
    for (const lease of leases) {
      if (!lease.allowed) assert.fail('expected the first three leases to be allowed');
      await lease.release();
    }
  });

  test('keeps unrelated cost classes independent', async () => {
    const budget = createOperationBudget(TEST_LIMITS);
    const light = await budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    const deep = await budget.acquire(OPERATION_CLASSES.REGISTRY_DEEP, 'session-a');
    assert.equal(light.allowed, true);
    assert.equal(deep.allowed, true);
    const denied = await budget.acquire(OPERATION_CLASSES.REGISTRY_DEEP, 'session-a');
    if (denied.allowed) assert.fail('expected the deep session ceiling to deny another lease');
    assert.equal(denied.scope, 'session');
    if (!light.allowed || !deep.allowed) assert.fail('expected unrelated cost classes to acquire independently');
    await light.release();
    await deep.release();
  });

  test('rejects unknown classes and missing session identifiers', () => {
    const budget = createOperationBudget(TEST_LIMITS);
    assert.throws(() => budget.acquire('unknown', 'session-a'), /Unknown operation class/);
    assert.throws(() => budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, ''), /session key/);
  });

  test('rejects malformed limit definitions before creating a provider', () => {
    assert.throws(() => createOperationBudget({}), /At least one operation limit/);
    assert.throws(() => createOperationBudget({ unsafe: { session: 0, runtime: 2 } }), /Invalid operation limits/);
    assert.throws(() => createOperationBudget({ unsafe: { session: 3, runtime: 2 } }), /Invalid operation limits/);
  });

  test('returns a stable machine-readable overload response', () => {
    const payload = operationBudgetError({
      operationClass: OPERATION_CLASSES.REGISTRY_DEEP,
      scope: 'session',
    });
    assert.equal(payload.errorCode, OPERATION_BUDGET_ERROR_CODE);
    assert.equal(payload.operationClass, OPERATION_CLASSES.REGISTRY_DEEP);
    assert.equal(payload.limitScope, 'session');
    assert.match(payload.error, /maximum number of network operations/i);
  });
});

describe('provider-neutral operation runner', () => {
  test('accepts the established in-memory provider contract', () => {
    const provider = createOperationBudget(TEST_LIMITS);
    assert.equal(assertOperationBudgetProvider(provider), provider);
    assert.throws(() => assertOperationBudgetProvider(null), /acquire\(\) and status\(\)/);
    assert.throws(() => assertOperationBudgetProvider({ acquire() {} }), /acquire\(\) and status\(\)/);
  });

  test('supports asynchronous providers and releases after downstream work', async () => {
    const events: string[] = [];
    const provider = {
      async acquire(
        operationClass: string,
        sessionKey: unknown,
        context: { operationFeature?: string | null } = {},
      ) {
        events.push(`acquire:${operationClass}:${sessionKey}:${context.operationFeature}`);
        return {
          allowed: true,
          async release() {
            events.push('release');
          },
        };
      },
      async status() {
        return [];
      },
    };
    const outcome = await runWithOperationBudget(
      provider,
      operationBudgetTargetFor('lookup', { fast: true }),
      'session-a',
      async () => {
        events.push('callback');
        return 'result';
      },
    );
    assert.deepEqual(outcome, { allowed: true, value: 'result' });
    assert.deepEqual(events, [
      `acquire:${OPERATION_CLASSES.REGISTRY_LIGHT}:session-a:${OPERATION_FEATURES.LOOKUP_FAST}`,
      'callback',
      'release',
    ]);
  });

  test('attributes a provider denial to the server-derived operation feature', async () => {
    const outcome = await runWithOperationBudget(
      {
        acquire: async () => ({
          allowed: false,
          operationClass: OPERATION_CLASSES.REGISTRY_LIGHT,
          scope: 'runtime',
          retryAfterSeconds: 1,
        }),
        status: () => [],
      },
      operationBudgetTargetFor('lookup', { fast: true, compact: true }),
      'session-a',
      async () => 'not reached',
    );
    assert.equal(outcome.allowed, false);
    if (outcome.allowed) assert.fail('expected a provider denial');
    assert.equal(outcome.denial.operationFeature, OPERATION_FEATURES.BULK_FAST);
    assert.equal(operationBudgetError(outcome.denial).operationFeature, OPERATION_FEATURES.BULK_FAST);
    assert.equal(operationBudgetError(outcome.denial).operationFeatureModelVersion, 1);
  });

  test('does not accept a provider-supplied feature identity over the server-derived target', async () => {
    const outcome = await runWithOperationBudget(
      {
        acquire: async () => ({
          allowed: false,
          operationClass: OPERATION_CLASSES.REGISTRY_DEEP,
          operationFeature: OPERATION_FEATURES.WHOIS,
          scope: 'runtime',
          retryAfterSeconds: 1,
        }),
        status: () => [],
      },
      operationBudgetTargetFor('lookup', { fast: true }),
      'session-a',
      async () => 'not reached',
    );
    if (outcome.allowed) assert.fail('expected a provider denial');
    assert.equal(outcome.denial.operationClass, OPERATION_CLASSES.REGISTRY_LIGHT);
    assert.equal(outcome.denial.operationFeature, OPERATION_FEATURES.LOOKUP_FAST);
  });

  test('returns provider denials without running downstream work', async () => {
    let callbackCalls = 0;
    const denial = {
      allowed: false,
      operationClass: OPERATION_CLASSES.REGISTRY_DEEP,
      scope: 'runtime',
      retryAfterSeconds: 2,
    };
    const outcome = await runWithOperationBudget(
      { acquire: async () => denial, status: () => [] },
      OPERATION_CLASSES.REGISTRY_DEEP,
      'session-a',
      () => { callbackCalls += 1; },
    );
    assert.equal(callbackCalls, 0);
    assert.deepEqual(outcome, { allowed: false, denial });
  });

  test('releases an acquired lease when downstream work throws', async () => {
    let releases = 0;
    const provider = {
      acquire: () => ({
        allowed: true,
        release: async () => { releases += 1; },
      }),
      status: () => [],
    };
    await assert.rejects(
      runWithOperationBudget(provider, OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a', async () => {
        throw new Error('downstream failed');
      }),
      /downstream failed/,
    );
    assert.equal(releases, 1);
  });

  test('rejects malformed provider decisions before running downstream work', async () => {
    let callbackCalls = 0;
    const callback = () => { callbackCalls += 1; };
    await assert.rejects(
      runWithOperationBudget(
        { acquire: () => null, status: () => [] },
        OPERATION_CLASSES.REGISTRY_LIGHT,
        'session-a',
        callback,
      ),
      /allowed decision/,
    );
    await assert.rejects(
      runWithOperationBudget(
        { acquire: () => ({ allowed: true }), status: () => [] },
        OPERATION_CLASSES.REGISTRY_LIGHT,
        'session-a',
        callback,
      ),
      /include release/,
    );
    assert.equal(callbackCalls, 0);
  });
});

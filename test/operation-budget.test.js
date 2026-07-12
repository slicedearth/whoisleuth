const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  OPERATION_BUDGET_ERROR_CODE,
  OPERATION_CLASSES,
  createOperationBudget,
  operationBudgetError,
  operationBudgetReport,
  operationClassFor,
} = require('../lib/operation-budget');

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
  test('enforces a per-session ceiling and releases idempotently', () => {
    const budget = createOperationBudget(TEST_LIMITS);
    const first = budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    const second = budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    const denied = budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.deepEqual(denied, {
      allowed: false,
      operationClass: OPERATION_CLASSES.REGISTRY_LIGHT,
      scope: 'session',
      retryAfterSeconds: 1,
    });
    first.release();
    first.release();
    const replacement = budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    assert.equal(replacement.allowed, true);
    second.release();
    replacement.release();
    assert.equal(budget.status().find((entry) => entry.id === OPERATION_CLASSES.REGISTRY_LIGHT).active, 0);
  });

  test('enforces a runtime ceiling across independent sessions', () => {
    const budget = createOperationBudget(TEST_LIMITS);
    const leases = [
      budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a'),
      budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a'),
      budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-b'),
    ];
    const denied = budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-c');
    assert.equal(denied.allowed, false);
    assert.equal(denied.scope, 'runtime');
    for (const lease of leases) lease.release();
  });

  test('keeps unrelated cost classes independent', () => {
    const budget = createOperationBudget(TEST_LIMITS);
    const light = budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, 'session-a');
    const deep = budget.acquire(OPERATION_CLASSES.REGISTRY_DEEP, 'session-a');
    assert.equal(light.allowed, true);
    assert.equal(deep.allowed, true);
    assert.equal(budget.acquire(OPERATION_CLASSES.REGISTRY_DEEP, 'session-a').scope, 'session');
    light.release();
    deep.release();
  });

  test('rejects unknown classes and missing session identifiers', () => {
    const budget = createOperationBudget(TEST_LIMITS);
    assert.throws(() => budget.acquire('unknown', 'session-a'), /Unknown operation class/);
    assert.throws(() => budget.acquire(OPERATION_CLASSES.REGISTRY_LIGHT, ''), /session key/);
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

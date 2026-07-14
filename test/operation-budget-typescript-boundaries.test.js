const test = require('node:test');
const assert = require('node:assert/strict');

test('operation-budget CommonJS entry points resolve to their typed implementations', () => {
  for (const moduleName of ['operation-budget', 'distributed-operation-budget']) {
    assert.deepEqual(
      Object.keys(require(`../lib/${moduleName}`)).sort(),
      Object.keys(require(`../lib/${moduleName}.mts`)).sort(),
      `${moduleName} must preserve its complete public export surface`,
    );
  }

  assert.strictEqual(
    require('../lib/operation-budget').createOperationBudget,
    require('../lib/operation-budget.mts').createOperationBudget,
  );
  assert.strictEqual(
    require('../lib/operation-budget').defaultOperationBudget,
    require('../lib/operation-budget.mts').defaultOperationBudget,
  );
  assert.strictEqual(
    require('../lib/distributed-operation-budget').createDistributedOperationBudget,
    require('../lib/distributed-operation-budget.mts').createDistributedOperationBudget,
  );
});

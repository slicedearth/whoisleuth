const test = require('node:test');
const assert = require('node:assert/strict');

test('lookup-orchestration CommonJS entry points resolve to their typed implementations', () => {
  for (const moduleName of ['availability', 'domain-posture', 'lookup']) {
    assert.deepEqual(
      Object.keys(require(`../lib/${moduleName}`)).sort(),
      Object.keys(require(`../lib/${moduleName}.mts`)).sort(),
      `${moduleName} must preserve its complete public export surface`,
    );
  }

  assert.strictEqual(
    require('../lib/availability').checkDomainAvailability,
    require('../lib/availability.mts').checkDomainAvailability,
  );
  assert.strictEqual(
    require('../lib/domain-posture').checkDomainPosture,
    require('../lib/domain-posture.mts').checkDomainPosture,
  );
  assert.strictEqual(
    require('../lib/lookup').runUnifiedLookup,
    require('../lib/lookup.mts').runUnifiedLookup,
  );
});

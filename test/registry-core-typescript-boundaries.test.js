const test = require('node:test');
const assert = require('node:assert/strict');

test('registry-core CommonJS entry points resolve to their typed implementations', () => {
  for (const moduleName of ['rdap', 'whois']) {
    assert.deepEqual(
      Object.keys(require(`../lib/${moduleName}`)).sort(),
      Object.keys(require(`../lib/${moduleName}.mts`)).sort(),
      `${moduleName} must preserve its complete public export surface`,
    );
  }

  assert.strictEqual(
    require('../lib/rdap').fetchRdapRecord,
    require('../lib/rdap.mts').fetchRdapRecord,
  );
  assert.strictEqual(
    require('../lib/rdap').parseRdap,
    require('../lib/rdap.mts').parseRdap,
  );
  assert.strictEqual(
    require('../lib/whois').buildWhoisChain,
    require('../lib/whois.mts').buildWhoisChain,
  );
  assert.strictEqual(
    require('../lib/whois').parseWhoisChain,
    require('../lib/whois.mts').parseWhoisChain,
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');

test('network-intelligence CommonJS entry points resolve to their typed implementations', () => {
  for (const moduleName of ['safe-fetch', 'dns-intelligence', 'http-intelligence', 'tls-intelligence', 'ct-search']) {
    assert.deepEqual(
      Object.keys(require(`../lib/${moduleName}`)).sort(),
      Object.keys(require(`../lib/${moduleName}.mts`)).sort(),
      `${moduleName} must preserve its complete public export surface`,
    );
  }

  assert.strictEqual(
    require('../lib/safe-fetch').safeFetchDetailed,
    require('../lib/safe-fetch.mts').safeFetchDetailed,
  );
  assert.strictEqual(
    require('../lib/dns-intelligence').collectDnsIntelligence,
    require('../lib/dns-intelligence.mts').collectDnsIntelligence,
  );
  assert.strictEqual(
    require('../lib/http-intelligence').buildHttpObservation,
    require('../lib/http-intelligence.mts').buildHttpObservation,
  );
  assert.strictEqual(
    require('../lib/tls-intelligence').collectTlsIntelligence,
    require('../lib/tls-intelligence.mts').collectTlsIntelligence,
  );
  assert.strictEqual(
    require('../lib/ct-search').searchCertificateTransparency,
    require('../lib/ct-search.mts').searchCertificateTransparency,
  );
});

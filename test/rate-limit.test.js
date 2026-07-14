const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { getClientIp, getForwardedProtocol, trustsForwardedHeaders } = require('../lib/rate-limit');
const typedRateLimit = require('../lib/rate-limit.mts');

test('retains the CommonJS rate-limit entry point over the typed implementation', () => {
  assert.strictEqual(getClientIp, typedRateLimit.getClientIp);
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
});

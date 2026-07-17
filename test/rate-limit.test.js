const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  getClientIp,
  getForwardedProtocol,
  trustsForwardedHeaders,
} = require('../lib/rate-limit.mts');

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

  test('ignores Netlify-specific and non-standard client IP headers behind a generic proxy', () => {
    const headers = {
      'x-nf-client-connection-ip': '192.0.2.10',
      'client-ip': '192.0.2.11',
      'x-forwarded-for': 'spoofed.example, 198.51.100.2',
    };

    assert.equal(getClientIp(headers, '203.0.113.9', { TRUST_PROXY: '1' }), '198.51.100.2');
  });

  test('uses only the edge-assigned client IP header in the Netlify runtime', () => {
    const headers = {
      'x-nf-client-connection-ip': '198.51.100.3',
      'client-ip': '192.0.2.11',
      'x-forwarded-for': 'spoofed.example, 198.51.100.2',
    };

    assert.equal(getClientIp(headers, '203.0.113.9', { NETLIFY: 'true' }), '198.51.100.3');
    assert.equal(
      getClientIp({ 'client-ip': '192.0.2.11', 'x-forwarded-for': '198.51.100.2' }, null, { NETLIFY: 'true' }),
      '198.51.100.2',
    );
  });
});

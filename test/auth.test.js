// Covers lib/auth.js's isTrustedOrigin - the same-origin check that closes
// the logout CSRF gap a plain POST-method restriction leaves open (see
// test/logout.test.js for the end-to-end handler behavior).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSessionToken,
  isTrustedOrigin,
  isValidSessionToken,
  parseCookies,
} = require('../lib/auth');

describe('isTrustedOrigin', () => {
  test('accepts a matching Origin/Host pair', () => {
    assert.equal(isTrustedOrigin({ origin: 'https://example.com', host: 'example.com' }), true);
  });

  test('ignores the scheme, matching on host only', () => {
    assert.equal(isTrustedOrigin({ origin: 'http://example.com', host: 'example.com' }), true);
  });

  test('is case-insensitive', () => {
    assert.equal(isTrustedOrigin({ origin: 'https://Example.com', host: 'example.COM' }), true);
  });

  test('accepts a matching non-default port', () => {
    assert.equal(isTrustedOrigin({ origin: 'http://localhost:3000', host: 'localhost:3000' }), true);
  });

  test('rejects a mismatched origin (cross-site request)', () => {
    assert.equal(isTrustedOrigin({ origin: 'https://attacker.example', host: 'example.com' }), false);
  });

  test('rejects a subdomain that is not an exact host match', () => {
    assert.equal(isTrustedOrigin({ origin: 'https://evil.example.com', host: 'example.com' }), false);
  });

  test('rejects when either header is missing', () => {
    assert.equal(isTrustedOrigin({ host: 'example.com' }), false);
    assert.equal(isTrustedOrigin({ origin: 'https://example.com' }), false);
    assert.equal(isTrustedOrigin({}), false);
  });

  test('fails closed on a malformed Origin value', () => {
    assert.equal(isTrustedOrigin({ origin: 'not-a-url', host: 'example.com' }), false);
  });

  test('fails closed when headers is null/undefined', () => {
    assert.equal(isTrustedOrigin(null), false);
    assert.equal(isTrustedOrigin(undefined), false);
  });
});

describe('parseCookies', () => {
  test('ignores malformed percent-encoded values instead of throwing', () => {
    assert.deepEqual(parseCookies('wrt_session=%; theme=dark'), { theme: 'dark' });
  });
});

describe('session signing', () => {
  test('uses an independent SESSION_SECRET when configured', () => {
    const previousPassword = process.env.SITE_PASSWORD;
    const previousSessionSecret = process.env.SESSION_SECRET;
    try {
      process.env.SITE_PASSWORD = 'test-password';
      process.env.SESSION_SECRET = 'first-independent-signing-secret';
      const token = createSessionToken();
      assert.equal(isValidSessionToken(token), true);
      process.env.SESSION_SECRET = 'different-independent-signing-secret';
      assert.equal(isValidSessionToken(token), false);
    } finally {
      if (previousPassword === undefined) delete process.env.SITE_PASSWORD;
      else process.env.SITE_PASSWORD = previousPassword;
      if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previousSessionSecret;
    }
  });

  test('derives a compatible signing key when SESSION_SECRET is absent', () => {
    const previousPassword = process.env.SITE_PASSWORD;
    const previousSessionSecret = process.env.SESSION_SECRET;
    try {
      process.env.SITE_PASSWORD = 'fallback-test-password';
      delete process.env.SESSION_SECRET;
      assert.equal(isValidSessionToken(createSessionToken()), true);
    } finally {
      if (previousPassword === undefined) delete process.env.SITE_PASSWORD;
      else process.env.SITE_PASSWORD = previousPassword;
      if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previousSessionSecret;
    }
  });
});

// Covers the shared authentication boundary's isTrustedOrigin - the same-origin check that closes
// the logout CSRF gap a plain POST-method restriction leaves open (see
// test/logout.test.mts for the end-to-end handler behavior).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionCookie,
  createSessionToken,
  isPermittedAuthenticatedNetworkRequest,
  isTrustedLoginOrigin,
  isTrustedOrigin,
  isValidSessionToken,
  parseCookies,
  sessionFingerprintFromCookieHeader,
} from '../lib/auth.mts';
import { LOCAL_API_PROXY } from '../frontend/vite.config.ts';
import { requiredValue } from './value-assertions.mts';

test('the development API proxy preserves the browser-facing host for origin checks', () => {
  assert.deepEqual(LOCAL_API_PROXY, {
    target: 'http://localhost:3000',
    changeOrigin: false,
  });
});

function withSessionTestSecrets(run: () => void): void {
  const previousPassword = process.env.SITE_PASSWORD;
  const previousSessionSecret = process.env.SESSION_SECRET;
  try {
    process.env.SITE_PASSWORD = 'session-policy-test-password';
    process.env.SESSION_SECRET = 'session-policy-test-signing-secret';
    run();
  } finally {
    if (previousPassword === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = previousPassword;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
  }
}

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

  test('fails closed on repeated Origin or Host headers', () => {
    assert.equal(isTrustedOrigin({ origin: ['https://example.com'], host: 'example.com' }), false);
    assert.equal(isTrustedOrigin({ origin: 'https://example.com', host: ['example.com'] }), false);
  });

  test('fails closed when headers is null/undefined', () => {
    assert.equal(isTrustedOrigin(null), false);
    assert.equal(isTrustedOrigin(undefined), false);
  });
});

describe('isTrustedLoginOrigin', () => {
  test('rejects a present cross-site Origin', () => {
    assert.equal(isTrustedLoginOrigin({ origin: 'https://attacker.example', host: 'example.com' }), false);
  });

  test('accepts a matching browser Origin and an omitted non-browser Origin', () => {
    assert.equal(isTrustedLoginOrigin({ origin: 'https://example.com', host: 'example.com' }), true);
    assert.equal(isTrustedLoginOrigin({ host: 'example.com' }), true);
    assert.equal(isTrustedLoginOrigin(undefined), true);
  });
});

describe('authenticated network request admission', () => {
  test('permits same-origin browser requests, deliberate navigation, and clients that omit browser metadata', () => {
    assert.equal(isPermittedAuthenticatedNetworkRequest({
      host: 'example.com',
      origin: 'https://example.com',
      'sec-fetch-site': 'same-origin',
    }), true);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', 'sec-fetch-site': 'none' }), true);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com' }), true);
    assert.equal(isPermittedAuthenticatedNetworkRequest(undefined), true);
  });

  test('rejects cross-site, malformed, repeated, and mismatched browser metadata', () => {
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', 'sec-fetch-site': 'cross-site' }), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'app.example.com', 'sec-fetch-site': 'same-site' }), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'app.example.com', origin: 'https://sibling.example.com', 'sec-fetch-site': 'same-site' }), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', 'sec-fetch-site': 'future-state' }), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', 'sec-fetch-site': ['same-origin'] }), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', origin: 'https://attacker.example' }), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', origin: ['https://example.com'] }), false);
  });
});

describe('parseCookies', () => {
  test('ignores malformed percent-encoded values instead of throwing', () => {
    assert.deepEqual(parseCookies('wrt_session=%; theme=dark'), { theme: 'dark' });
  });
});

describe('session signing', () => {
  test('defaults new sessions and cookies to seven days', () => {
    const previousMaxAge = process.env.SESSION_MAX_AGE_DAYS;
    const actualNow = Date.now;
    const now = 1_750_000_000_000;
    try {
      withSessionTestSecrets(() => {
        delete process.env.SESSION_MAX_AGE_DAYS;
        Date.now = () => now;
        const token = createSessionToken();
        assert.equal(Number(token.split('.')[0]), now + (7 * 24 * 60 * 60 * 1000));
        assert.match(buildSessionCookie(token), /(?:^|; )Max-Age=604800(?:;|$)/u);
        assert.equal(isValidSessionToken(token), true);
        Date.now = () => now + (7 * 24 * 60 * 60 * 1000);
        assert.equal(isValidSessionToken(token), false);
      });
    } finally {
      Date.now = actualNow;
      if (previousMaxAge === undefined) delete process.env.SESSION_MAX_AGE_DAYS;
      else process.env.SESSION_MAX_AGE_DAYS = previousMaxAge;
    }
  });

  test('uses a bounded configured session lifetime for tokens and cookies', () => {
    const previousMaxAge = process.env.SESSION_MAX_AGE_DAYS;
    const actualNow = Date.now;
    const now = 1_750_000_000_000;
    try {
      withSessionTestSecrets(() => {
        process.env.SESSION_MAX_AGE_DAYS = '2';
        Date.now = () => now;
        const token = createSessionToken();
        assert.equal(Number(token.split('.')[0]), now + (2 * 24 * 60 * 60 * 1000));
        assert.match(buildSessionCookie(token), /(?:^|; )Max-Age=172800(?:;|$)/u);
        assert.equal(isValidSessionToken(token), true);
      });
    } finally {
      Date.now = actualNow;
      if (previousMaxAge === undefined) delete process.env.SESSION_MAX_AGE_DAYS;
      else process.env.SESSION_MAX_AGE_DAYS = previousMaxAge;
    }
  });

  test('rejects invalid session lifetime configuration without accepting existing tokens', () => {
    const previousMaxAge = process.env.SESSION_MAX_AGE_DAYS;
    const actualNow = Date.now;
    const now = 1_750_000_000_000;
    try {
      withSessionTestSecrets(() => {
        delete process.env.SESSION_MAX_AGE_DAYS;
        Date.now = () => now;
        const token = createSessionToken();
        for (const invalid of ['', '0', '31', '7.5', ' 7', '99999999999999999999']) {
          process.env.SESSION_MAX_AGE_DAYS = invalid;
          assert.throws(() => createSessionToken(), /SESSION_MAX_AGE_DAYS must be a whole number from 1 to 30/u);
          assert.throws(() => buildSessionCookie(token), /SESSION_MAX_AGE_DAYS must be a whole number from 1 to 30/u);
          assert.equal(isValidSessionToken(token), false);
        }
      });
    } finally {
      Date.now = actualNow;
      if (previousMaxAge === undefined) delete process.env.SESSION_MAX_AGE_DAYS;
      else process.env.SESSION_MAX_AGE_DAYS = previousMaxAge;
    }
  });

  test('invalidates a token whose remaining lifetime exceeds a lowered maximum', () => {
    const previousMaxAge = process.env.SESSION_MAX_AGE_DAYS;
    const actualNow = Date.now;
    const now = 1_750_000_000_000;
    try {
      withSessionTestSecrets(() => {
        process.env.SESSION_MAX_AGE_DAYS = '30';
        Date.now = () => now;
        const token = createSessionToken();
        assert.equal(isValidSessionToken(token), true);
        process.env.SESSION_MAX_AGE_DAYS = '7';
        assert.equal(isValidSessionToken(token), false);
      });
    } finally {
      Date.now = actualNow;
      if (previousMaxAge === undefined) delete process.env.SESSION_MAX_AGE_DAYS;
      else process.env.SESSION_MAX_AGE_DAYS = previousMaxAge;
    }
  });

  test('derives an opaque stable concurrency key without retaining the bearer token', () => {
    const cookie = 'theme=dark; wrt_session=12345.signature';
    const fingerprint = requiredValue(sessionFingerprintFromCookieHeader(cookie));
    assert.equal(fingerprint, sessionFingerprintFromCookieHeader(cookie));
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(fingerprint.includes('12345'), false);
    assert.equal(sessionFingerprintFromCookieHeader('theme=dark'), null);
  });

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

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
  productionSessionSecretWarning,
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
  test('accepts a matching HTTPS Origin/Host pair', () => {
    assert.equal(isTrustedOrigin(
      { origin: 'https://example.com', host: 'example.com' },
      { protocol: 'https' },
    ), true);
  });

  test('rejects HTTP Origin on the same host as an HTTPS deployment', () => {
    assert.equal(isTrustedOrigin(
      { origin: 'http://example.com', host: 'example.com' },
      { protocol: 'https' },
    ), false);
  });

  test('is case-insensitive', () => {
    assert.equal(isTrustedOrigin(
      { origin: 'https://Example.com', host: 'example.COM' },
      { protocol: 'HTTPS:' },
    ), true);
  });

  test('accepts matching ordinary HTTP localhost and rejects a port mismatch', () => {
    assert.equal(isTrustedOrigin(
      { origin: 'http://localhost:3000', host: 'localhost:3000' },
      { protocol: 'http' },
    ), true);
    assert.equal(isTrustedOrigin(
      { origin: 'http://localhost:3001', host: 'localhost:3000' },
      { protocol: 'http' },
    ), false);
  });

  test('uses only an explicitly trusted, singular forwarded protocol', () => {
    assert.equal(isTrustedOrigin(
      { origin: 'https://example.com', host: 'example.com', 'x-forwarded-proto': 'https' },
      { protocol: 'http', trustForwardedProtocol: true },
    ), true);
    assert.equal(isTrustedOrigin(
      { origin: 'https://example.com', host: 'example.com', 'x-forwarded-proto': 'https' },
      { protocol: 'http' },
    ), false);
    assert.equal(isTrustedOrigin(
      { origin: 'https://example.com', host: 'example.com', 'x-forwarded-proto': 'http, https' },
      { protocol: 'http', trustForwardedProtocol: true },
    ), false);
  });

  test('rejects a mismatched origin (cross-site request)', () => {
    assert.equal(isTrustedOrigin({ origin: 'https://attacker.example', host: 'example.com' }, { protocol: 'https' }), false);
  });

  test('rejects a subdomain that is not an exact host match', () => {
    assert.equal(isTrustedOrigin({ origin: 'https://evil.example.com', host: 'example.com' }, { protocol: 'https' }), false);
  });

  test('rejects when either header is missing', () => {
    assert.equal(isTrustedOrigin({ host: 'example.com' }, { protocol: 'https' }), false);
    assert.equal(isTrustedOrigin({ origin: 'https://example.com' }, { protocol: 'https' }), false);
    assert.equal(isTrustedOrigin({}, { protocol: 'https' }), false);
  });

  test('fails closed on a malformed Origin value', () => {
    assert.equal(isTrustedOrigin({ origin: 'not-a-url', host: 'example.com' }, { protocol: 'https' }), false);
    assert.equal(isTrustedOrigin({ origin: 'https://example.com/path', host: 'example.com' }, { protocol: 'https' }), false);
  });

  test('fails closed on repeated Origin or Host headers', () => {
    assert.equal(isTrustedOrigin({ origin: ['https://example.com'], host: 'example.com' }, { protocol: 'https' }), false);
    assert.equal(isTrustedOrigin({ origin: 'https://example.com', host: ['example.com'] }, { protocol: 'https' }), false);
    assert.equal(isTrustedOrigin({ origin: 'https://example.com', Origin: 'https://example.com', host: 'example.com' }, { protocol: 'https' }), false);
    assert.equal(isTrustedOrigin({ origin: 'https://example.com', host: 'example.com', Host: 'example.com' }, { protocol: 'https' }), false);
  });

  test('fails closed on non-canonical Host and contradictory untrusted protocol metadata', () => {
    assert.equal(isTrustedOrigin(
      { origin: 'https://example.com', host: '%65xample.com' },
      { protocol: 'https' },
    ), false);
    assert.equal(isTrustedOrigin(
      { origin: 'http://example.com', host: 'example.com', 'x-forwarded-proto': 'http' },
      { protocol: 'https' },
    ), false);
  });

  test('fails closed when headers is null/undefined', () => {
    assert.equal(isTrustedOrigin(null, { protocol: 'https' }), false);
    assert.equal(isTrustedOrigin(undefined, { protocol: 'https' }), false);
  });
});

describe('isTrustedLoginOrigin', () => {
  test('rejects a present cross-site Origin', () => {
    assert.equal(isTrustedLoginOrigin({ origin: 'https://attacker.example', host: 'example.com' }, { protocol: 'https' }), false);
  });

  test('accepts a matching browser Origin and an originless client with an unambiguous request origin', () => {
    assert.equal(isTrustedLoginOrigin({ origin: 'https://example.com', host: 'example.com' }, { protocol: 'https' }), true);
    assert.equal(isTrustedLoginOrigin({ host: 'example.com' }, { protocol: 'https' }), true);
    assert.equal(isTrustedLoginOrigin(undefined, { protocol: 'https' }), false);
  });
});

describe('authenticated network request admission', () => {
  test('permits same-origin browser requests and deliberate browser navigation', () => {
    assert.equal(isPermittedAuthenticatedNetworkRequest({
      host: 'example.com',
      origin: 'https://example.com',
      'sec-fetch-site': 'same-origin',
    }, { protocol: 'https' }), true);
    assert.equal(isPermittedAuthenticatedNetworkRequest(
      { host: 'example.com', 'sec-fetch-site': 'none' },
      { protocol: 'https' },
    ), true);
    assert.equal(isPermittedAuthenticatedNetworkRequest(
      { host: 'example.com', origin: 'https://example.com' },
      { protocol: 'https' },
    ), true);
  });

  test('rejects metadata-free browser-reachable collection requests', () => {
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com' }, { protocol: 'https' }), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest(undefined, { protocol: 'https' }), false);
  });

  test('rejects cross-site, malformed, repeated, and mismatched browser metadata', () => {
    const https = { protocol: 'https' } as const;
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', 'sec-fetch-site': 'cross-site' }, https), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'app.example.com', 'sec-fetch-site': 'same-site' }, https), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'app.example.com', origin: 'https://sibling.example.com', 'sec-fetch-site': 'same-site' }, https), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', 'sec-fetch-site': 'future-state' }, https), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', 'sec-fetch-site': ['same-origin'] }, https), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', origin: 'https://attacker.example' }, https), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', origin: ['https://example.com'] }, https), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', 'sec-fetch-site': 'same-origin, cross-site' }, https), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', Host: 'example.com', 'sec-fetch-site': 'same-origin' }, https), false);
    assert.equal(isPermittedAuthenticatedNetworkRequest({ host: 'example.com', 'sec-fetch-site': 'same-origin', 'x-forwarded-proto': ['https'] }, https), false);
  });
});

describe('parseCookies', () => {
  test('ignores malformed percent-encoded values instead of throwing', () => {
    assert.deepEqual(parseCookies('wrt_session=%; theme=dark'), { theme: 'dark' });
  });
});

describe('session signing', () => {
  test('warns when a production password falls back to derived session signing', () => {
    assert.match(productionSessionSecretWarning({
      NODE_ENV: 'production',
      SITE_PASSWORD: 'test-only-secret',
    }) ?? '', /SESSION_SECRET is not set in production/u);
    assert.match(productionSessionSecretWarning({
      CONTEXT: 'production',
      SITE_PASSWORD: 'test-only-secret',
    }) ?? '', /configure a separate random SESSION_SECRET/u);
    assert.equal(productionSessionSecretWarning({
      NODE_ENV: 'production',
      SITE_PASSWORD: 'test-only-secret',
      SESSION_SECRET: 'test-only-session-signing-secret',
    }), null);
    assert.equal(productionSessionSecretWarning({
      NODE_ENV: 'development',
      SITE_PASSWORD: 'test-only-secret',
    }), null);
    assert.equal(productionSessionSecretWarning({ NODE_ENV: 'production' }), null);
  });

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

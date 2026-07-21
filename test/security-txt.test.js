const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_SECURITY_TXT_BYTES,
  MAX_SECURITY_TXT_REDIRECTS,
  SECURITY_TXT_PATH,
  collectSecurityTxt,
  parseSecurityTxt,
} = require('../lib/security-txt.mts');

const now = Date.parse('2026-07-22T01:00:00.000Z');
const validBody = [
  'Contact: mailto:security@example.test',
  'Contact: https://example.test/report?channel=security#form',
  'Expires: 2027-01-01T00:00:00Z',
  'Policy: https://example.test/security-policy',
  'Encryption: openpgp4fpr:0123456789ABCDEF',
  'Preferred-Languages: en, fr-AU',
  'Canonical: https://example.test/.well-known/security.txt',
].join('\n');

function responseResult(url, status, body = '', headers = { 'content-type': 'text/plain; charset=utf-8' }, location = null) {
  return {
    response: new Response(body, { status, headers: { ...headers, ...(location ? { location } : {}) } }),
    requestedUrl: url,
    finalUrl: url,
    redirected: false,
    redirectCount: 0,
    redirectLimitReached: Boolean(location),
    hops: [{ url, status, location, durationMs: 1 }],
    durationMs: 1,
  };
}

describe('parseSecurityTxt', () => {
  test('normalizes the bounded standardized disclosure fields', () => {
    const result = parseSecurityTxt(validBody, {
      finalUrl: 'https://example.test/.well-known/security.txt',
      now,
    });

    assert.equal(result.securityTxtVersion, 1);
    assert.equal(result.state, 'present');
    assert.equal(result.status, 'success');
    assert.equal(result.complete, true);
    assert.deepEqual(result.contacts, [
      'mailto:security@example.test',
      'https://example.test/report',
    ]);
    assert.deepEqual(result.policies, ['https://example.test/security-policy']);
    assert.deepEqual(result.encryption, ['openpgp4fpr:0123456789ABCDEF']);
    assert.deepEqual(result.preferredLanguages, ['en', 'fr-au']);
    assert.equal(result.expiresAt, '2027-01-01T00:00:00.000Z');
    assert.equal(result.canonicalMatches, true);
  });

  test('requires at least one valid Contact and exactly one valid Expires', () => {
    const missingContact = parseSecurityTxt('Expires: 2027-01-01T00:00:00Z', { now });
    const duplicateExpires = parseSecurityTxt([
      'Contact: mailto:security@example.test',
      'Expires: 2027-01-01T00:00:00Z',
      'Expires: 2028-01-01T00:00:00Z',
    ].join('\n'), { now });

    assert.equal(missingContact.state, 'malformed');
    assert.equal(duplicateExpires.state, 'malformed');
    assert.equal(duplicateExpires.expiresAt, null);
  });

  test('distinguishes stale and partially valid publications', () => {
    const stale = parseSecurityTxt(validBody.replace('2027-01-01', '2025-01-01'), { now });
    const partial = parseSecurityTxt(`${validBody}\nPolicy: http://example.test/insecure`, {
      finalUrl: 'https://other.example.test/.well-known/security.txt',
      now,
    });

    assert.equal(stale.state, 'stale');
    assert.equal(stale.status, 'partial');
    assert.equal(partial.state, 'partial');
    assert.equal(partial.canonicalMatches, false);
    assert.equal(partial.diagnostics.malformedCount, 1);
  });

  test('rejects malformed UTF-8 replacement and control characters', () => {
    assert.equal(parseSecurityTxt(`${validBody}\ufffd`, { now }).state, 'malformed');
    assert.equal(parseSecurityTxt(`${validBody}\u0000`, { now }).state, 'malformed');
  });

  test('bounds lines and values while retaining required fields', () => {
    const contacts = Array.from({ length: 12 }, (_, index) => `Contact: mailto:security${index}@example.test`);
    const result = parseSecurityTxt([...contacts, 'Expires: 2027-01-01T00:00:00Z'].join('\n'), { now });
    assert.equal(result.contacts.length, 10);
    assert.equal(result.truncated, true);
    assert.equal(result.state, 'partial');
  });

  test('does not mislabel a capped prefix with missing required fields as malformed', () => {
    const result = parseSecurityTxt('Contact: mailto:security@example.test', { now, truncated: true });
    assert.equal(result.state, 'partial');
    assert.equal(result.truncated, true);
  });

  test('extracts clear-signed content without claiming signature verification', () => {
    const signed = [
      '-----BEGIN PGP SIGNED MESSAGE-----',
      'Hash: SHA256',
      '',
      'Contact: mailto:security@example.test',
      'Expires: 2027-01-01T00:00:00Z',
      '-----BEGIN PGP SIGNATURE-----',
      'fixture-only-signature',
      '-----END PGP SIGNATURE-----',
    ].join('\n');
    const result = parseSecurityTxt(signed, { now });
    assert.equal(result.state, 'present');
    assert.equal(result.signed, true);
    assert.match(result.limitations[0], /not cryptographically verified/u);
  });
});

describe('collectSecurityTxt', () => {
  test('requests the exact hostname over HTTPS with bounded safe-fetch settings', async () => {
    const calls = [];
    let requestedCap = 0;
    const hostBody = validBody.replace(
      'Canonical: https://example.test/.well-known/security.txt',
      'Canonical: https://portal.example.test/.well-known/security.txt',
    );
    const result = await collectSecurityTxt('Portal.Example.Test', {
      now: () => now,
      fetchDetailed: async (url, options, dependencies) => {
        calls.push({ url, options, dependencies });
        return responseResult(url, 200, hostBody);
      },
      readResponse: async (response, cap) => {
        requestedCap = cap;
        return { text: await response.text(), truncated: false, bytesRead: hostBody.length };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://portal.example.test${SECURITY_TXT_PATH}`);
    assert.equal(calls[0].options.headers.accept, 'text/plain; charset=utf-8');
    assert.equal(calls[0].dependencies.maxRedirects, 0);
    assert.equal(requestedCap, MAX_SECURITY_TXT_BYTES);
    assert.equal(result.state, 'present');
  });

  test('follows a bounded HTTPS redirect but rejects a downgrade', async () => {
    let calls = 0;
    const redirected = await collectSecurityTxt('example.test', {
      now: () => now,
      fetchDetailed: async (url) => {
        calls += 1;
        return calls === 1
          ? responseResult(url, 302, '', {}, 'https://contact.example.test/.well-known/security.txt')
          : responseResult(url, 200, validBody);
      },
    });
    assert.equal(calls, 2);
    assert.equal(redirected.redirectCount, 1);
    assert.equal(redirected.finalUrl, 'https://contact.example.test/.well-known/security.txt');

    const downgrade = await collectSecurityTxt('example.test', {
      now: () => now,
      fetchDetailed: async (url) => responseResult(url, 302, '', {}, 'http://example.test/security.txt'),
    });
    assert.equal(downgrade.state, 'unavailable');
    assert.match(downgrade.detail, /non-HTTPS/u);
  });

  test('enforces the redirect limit', async () => {
    let calls = 0;
    const result = await collectSecurityTxt('example.test', {
      now: () => now,
      fetchDetailed: async (url) => {
        calls += 1;
        return responseResult(url, 302, '', {}, `https://redirect${calls}.example.test/.well-known/security.txt`);
      },
    });
    assert.equal(calls, MAX_SECURITY_TXT_REDIRECTS + 1);
    assert.equal(result.state, 'unavailable');
    assert.match(result.detail, /redirect limit/u);
  });

  test('maps missing, unsupported, upstream, and transport outcomes explicitly', async () => {
    const collect = (factory) => collectSecurityTxt('example.test', { now: () => now, fetchDetailed: factory });
    assert.equal((await collect(async (url) => responseResult(url, 404))).state, 'absent');
    assert.equal((await collect(async (url) => responseResult(url, 200, validBody, { 'content-type': 'text/html' }))).state, 'unsupported');
    assert.equal((await collect(async (url) => responseResult(url, 200, validBody, { 'content-type': 'text/plain; charset=iso-8859-1' }))).state, 'unsupported');
    assert.equal((await collect(async (url) => responseResult(url, 503))).state, 'unavailable');
    assert.equal((await collect(async () => { throw new Error('fixture network failure'); })).state, 'unavailable');
  });

  test('reports capped content as partial and does not mutate inputs', async () => {
    const original = { hostname: 'example.test' };
    const result = await collectSecurityTxt(original.hostname, {
      now: () => now,
      fetchDetailed: async (url) => responseResult(url, 200, validBody),
      readResponse: async () => ({ text: validBody, truncated: true, bytesRead: MAX_SECURITY_TXT_BYTES }),
    });
    assert.equal(result.state, 'partial');
    assert.equal(result.truncated, true);
    assert.deepEqual(original, { hostname: 'example.test' });
  });

  test('rejects an invalid hostname before any request', async () => {
    let calls = 0;
    await assert.rejects(collectSecurityTxt('not-a-domain', {
      fetchDetailed: async () => { calls += 1; throw new Error('must not run'); },
    }), /valid domain hostname/u);
    await assert.rejects(collectSecurityTxt('example.test/path', {
      fetchDetailed: async () => { calls += 1; throw new Error('must not run'); },
    }), /valid domain hostname/u);
    assert.equal(calls, 0);
  });
});

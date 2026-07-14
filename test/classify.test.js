// Covers lib/classify.js - the one place a raw query string is turned into
// a typed, validated value before it reaches a WHOIS TCP socket write, a
// DNS query, or an RDAP/MTA-STS fetch URL.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { classifyQuery } = require('../lib/classify');

test('loads the typed implementation through the stable CommonJS entry point', () => {
  assert.strictEqual(require('../lib/classify.mts').classifyQuery, classifyQuery);
});

describe('control characters', () => {
  test('rejects an embedded CRLF (WHOIS protocol injection)', () => {
    // A normal URL-encoded query string (?q=example.com%0D%0AHELP) decodes
    // back into exactly this raw string before classifyQuery ever sees it -
    // lib/whois.js writes the classified value straight onto a TCP socket
    // (`socket.write(query + '\r\n')`), so an embedded CR/LF here would let
    // one query become multiple WHOIS protocol lines.
    assert.throws(() => classifyQuery('example.com\r\nHELP'), /control characters/);
  });

  test('rejects a bare LF or CR', () => {
    assert.throws(() => classifyQuery('example.com\nHELP'), /control characters/);
    assert.throws(() => classifyQuery('example.com\rHELP'), /control characters/);
  });

  test('rejects a NUL byte and other C0 controls', () => {
    assert.throws(() => classifyQuery('example.com\x00'), /control characters/);
    assert.throws(() => classifyQuery('example.com\x1b'), /control characters/);
  });
});

describe('IP/ASN classification', () => {
  test('classifies a valid IPv4 address', () => {
    assert.deepEqual(classifyQuery('8.8.8.8'), { type: 'ipv4', value: '8.8.8.8' });
  });

  test('rejects an out-of-range IPv4 octet instead of misclassifying it as a domain', () => {
    assert.throws(() => classifyQuery('999.999.999.999'), /not a valid domain, IP, or ASN/);
  });

  test('classifies a valid IPv6 address, in whichever form it was written', () => {
    assert.deepEqual(classifyQuery('2606:4700:4700::1111'), { type: 'ipv6', value: '2606:4700:4700::1111' });
    assert.deepEqual(classifyQuery('::ffff:127.0.0.1'), { type: 'ipv6', value: '::ffff:127.0.0.1' });
  });

  test('classifies AS-prefixed and bare-numeric ASNs', () => {
    assert.deepEqual(classifyQuery('AS15169'), { type: 'asn', value: 'AS15169' });
    assert.deepEqual(classifyQuery('15169'), { type: 'asn', value: 'AS15169' });
  });

  test('accepts the boundary ASNs and rejects one past the 32-bit ceiling', () => {
    assert.equal(classifyQuery('AS0').value, 'AS0');
    assert.equal(classifyQuery('AS4294967295').value, 'AS4294967295');
    assert.throws(() => classifyQuery('AS4294967296'), /not a valid ASN/);
    assert.throws(() => classifyQuery('4294967296'), /not a valid ASN/);
  });
});

describe('domain classification', () => {
  test('lowercases and strips a protocol/www prefix and path, keeping input + registrable domain', () => {
    assert.deepEqual(classifyQuery('HTTPS://WWW.Example.COM/path?x=1'), {
      type: 'domain',
      value: 'example.com',
      inputHostname: 'www.example.com',
      registrableDomain: 'example.com',
      isSubdomain: true,
    });
  });

  test('trims surrounding whitespace', () => {
    assert.equal(classifyQuery('   example.com   ').value, 'example.com');
  });

  test('strips a stray port suffix rather than treating it as part of the hostname', () => {
    assert.equal(classifyQuery('example.com:8080').value, 'example.com');
  });

  test('punycode-encodes an internationalized domain name', () => {
    assert.equal(classifyQuery('münchen.de').value, 'xn--mnchen-3ya.de');
  });

  test('resolves a multi-level public suffix to the registrable domain', () => {
    const r = classifyQuery('shop.example.co.uk');
    assert.equal(r.value, 'example.co.uk');
    assert.equal(r.registrableDomain, 'example.co.uk');
  });

  test('rejects an embedded space', () => {
    assert.throws(() => classifyQuery('exa mple.com'), /not a valid domain, IP, or ASN/);
  });

  test('rejects a bare, dot-less string', () => {
    assert.throws(() => classifyQuery('notadomain'), /not a valid domain, IP, or ASN/);
  });

  test('rejects a bare public suffix (no registrable domain)', () => {
    assert.throws(() => classifyQuery('co.uk'), /not a registrable domain/);
    assert.throws(() => classifyQuery('com'), /not a valid domain, IP, or ASN/);
  });
});

// Priority-1 correctness: never let an arbitrary subdomain's RDAP 404 read as
// "available", and reject registration-domain labels that can't exist.
describe('registrable-domain safety (eliminating false availability)', () => {
  test('a subdomain resolves to its registrable domain, so it cannot be reported available', () => {
    const r = classifyQuery('login.example.com');
    // The lookup value is the registrable domain (example.com) - an RDAP 404
    // on `login.example.com` is never produced, because we never query it.
    assert.equal(r.value, 'example.com');
    assert.equal(r.registrableDomain, 'example.com');
    assert.equal(r.inputHostname, 'login.example.com');
    assert.equal(r.isSubdomain, true);
  });

  test('rejects underscores in the registration domain (foo_bar.com)', () => {
    assert.throws(() => classifyQuery('foo_bar.com'), /invalid domain label/);
  });

  test('rejects empty and hyphen-edged labels (a..com, -bad.com, bad-.com)', () => {
    assert.throws(() => classifyQuery('a..com'), /not a registrable domain|invalid domain label/);
    assert.throws(() => classifyQuery('-bad.com'), /not a registrable domain|invalid domain label/);
    assert.throws(() => classifyQuery('bad-.com'), /not a registrable domain|invalid domain label/);
  });

  test('rejects a label over 63 characters', () => {
    const longLabel = 'a'.repeat(64);
    assert.throws(() => classifyQuery(`${longLabel}.com`), /not a registrable domain|invalid domain label/);
  });

  test('normalizes a single terminal root dot', () => {
    assert.equal(classifyQuery('example.com.').value, 'example.com');
    assert.equal(classifyQuery('example.com.').inputHostname, 'example.com');
  });

  test('rejects more than one terminal dot', () => {
    assert.throws(() => classifyQuery('example.com..'), /more than one terminal dot/);
    assert.throws(() => classifyQuery('example.com...'), /more than one terminal dot/);
    assert.throws(() => classifyQuery(`example.com${'.'.repeat(100_000)}`), /more than one terminal dot/);
  });
});

// Covers lib/classify.js - the one place a raw query string is turned into
// a typed, validated value before it reaches a WHOIS TCP socket write, a
// DNS query, or an RDAP/MTA-STS fetch URL.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { classifyQuery } = require('../lib/classify');

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
});

describe('domain classification', () => {
  test('lowercases and strips a protocol/www prefix and path', () => {
    assert.deepEqual(classifyQuery('HTTPS://WWW.Example.COM/path?x=1'), { type: 'domain', value: 'example.com' });
  });

  test('trims surrounding whitespace', () => {
    assert.deepEqual(classifyQuery('   example.com   '), { type: 'domain', value: 'example.com' });
  });

  test('strips a stray port suffix rather than treating it as part of the hostname', () => {
    assert.deepEqual(classifyQuery('example.com:8080'), { type: 'domain', value: 'example.com' });
  });

  test('punycode-encodes an internationalized domain name', () => {
    assert.deepEqual(classifyQuery('münchen.de'), { type: 'domain', value: 'xn--mnchen-3ya.de' });
  });

  test('rejects an embedded space', () => {
    assert.throws(() => classifyQuery('exa mple.com'), /not a valid domain, IP, or ASN/);
  });

  test('rejects a bare, dot-less string', () => {
    assert.throws(() => classifyQuery('notadomain'), /not a valid domain, IP, or ASN/);
  });
});

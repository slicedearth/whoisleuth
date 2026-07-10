// Covers lib/safe-fetch.js's isPrivateAddress() - the SSRF guard used
// before every outbound fetch this app makes to a domain-controlled target
// (homepage text, favicon, MTA-STS policy). The same address can be
// written multiple ways (a "::" shorthand, an embedded IPv4 as either
// dotted-decimal or hex groups, several distinct IPv4-in-IPv6 embedding
// schemes), and a hostile authoritative DNS server is free to choose
// whichever string form it wants - every form has to resolve to the same
// classification.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress } = require('../lib/safe-fetch');

describe('IPv4', () => {
  test('flags loopback, RFC1918, and link-local ranges', () => {
    assert.equal(isPrivateAddress('127.0.0.1'), true);
    assert.equal(isPrivateAddress('10.1.2.3'), true);
    assert.equal(isPrivateAddress('172.16.0.1'), true);
    assert.equal(isPrivateAddress('192.168.1.1'), true);
    assert.equal(isPrivateAddress('169.254.169.254'), true); // cloud metadata endpoint
  });

  test('does not flag an ordinary public address', () => {
    assert.equal(isPrivateAddress('8.8.8.8'), false);
  });
});

describe('IPv6', () => {
  test('flags unspecified and loopback', () => {
    assert.equal(isPrivateAddress('::'), true);
    assert.equal(isPrivateAddress('::1'), true);
  });

  test('flags an IPv4-mapped loopback in dotted-decimal form', () => {
    assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  });

  test('flags the same IPv4-mapped loopback written in hex-group form', () => {
    // ::ffff:127.0.0.1 and ::ffff:7f00:1 are the same address - a resolver
    // is free to return either string. Only the dotted-decimal form used to
    // be recognized as private.
    assert.equal(isPrivateAddress('::ffff:7f00:1'), true);
  });

  test('does not flag an IPv4-mapped public address, in either written form', () => {
    assert.equal(isPrivateAddress('::ffff:8.8.8.8'), false);
    assert.equal(isPrivateAddress('::ffff:808:808'), false);
  });

  test('flags a NAT64-synthesized loopback address', () => {
    assert.equal(isPrivateAddress('64:ff9b::7f00:1'), true);
  });

  test('does not flag a NAT64-synthesized public address', () => {
    assert.equal(isPrivateAddress('64:ff9b::808:808'), false);
  });

  test('flags a 6to4 address embedding a loopback IPv4 payload', () => {
    assert.equal(isPrivateAddress('2002:7f00:0001::'), true);
  });

  test('does not flag a 6to4 address embedding a public IPv4 payload', () => {
    assert.equal(isPrivateAddress('2002:0808:0808::'), false);
  });

  test('flags link-local and unique-local ranges', () => {
    assert.equal(isPrivateAddress('fe80::1'), true);
    assert.equal(isPrivateAddress('fc00::1'), true);
    assert.equal(isPrivateAddress('fd12:3456:789a::1'), true);
  });

  test('does not flag an ordinary public IPv6 address', () => {
    assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
    assert.equal(isPrivateAddress('2001:db8::1'), false);
  });
});

describe('malformed input', () => {
  test('fails closed on something that is not a recognizable IP literal', () => {
    assert.equal(isPrivateAddress('not-an-ip'), true);
  });
});

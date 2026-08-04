import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatIpPrefix, parseIpPrefix, prefixContains } from '../lib/ip-prefix.mts';

describe('IP prefix primitives', () => {
  test('compares canonical IPv4 and IPv6 prefixes without network access', () => {
    const ipv4 = parseIpPrefix('192.0.2.0/24');
    const ipv4Host = parseIpPrefix('192.0.2.10');
    const ipv6 = parseIpPrefix('2001:db8::/32');
    const ipv6Child = parseIpPrefix('2001:db8:1::/48');
    assert.ok(ipv4 && ipv4Host && prefixContains(ipv4, ipv4Host));
    assert.ok(ipv6 && ipv6Child && prefixContains(ipv6, ipv6Child));
    assert.equal(prefixContains(ipv4, ipv6), false);
  });

  test('rejects invalid, scoped, and non-canonical embedded IPv4 forms', () => {
    assert.equal(parseIpPrefix('192.0.2.0/33'), null);
    assert.equal(parseIpPrefix('192.0.2.0/'), null);
    assert.equal(parseIpPrefix('192.0.2.0/+8'), null);
    assert.equal(parseIpPrefix('192.0.2.0/1e1'), null);
    assert.equal(parseIpPrefix('192.0.2.0/0x10'), null);
    assert.equal(parseIpPrefix('fe80::1%en0'), null);
    assert.equal(parseIpPrefix('::ffff:192.0.2.1'), null);
  });

  test('formats canonical network addresses with RFC 5952 IPv6 compression', () => {
    const ipv4 = parseIpPrefix('192.0.2.55/24');
    const ipv6 = parseIpPrefix('2001:db8:0:1:0:0:0:1/64');
    const tied = parseIpPrefix('2001:0:0:1:0:0:1:1/128');
    const zero = parseIpPrefix('::/0');
    assert.ok(ipv4 && ipv6 && tied && zero);
    assert.equal(formatIpPrefix(ipv4), '192.0.2.0/24');
    assert.equal(formatIpPrefix(ipv6), '2001:db8:0:1::/64');
    assert.equal(formatIpPrefix(tied), '2001::1:0:0:1:1/128');
    assert.equal(formatIpPrefix(zero), '::/0');
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalPublicIpAddress } from '../packages/evidence/public-address-policy.mts';

// Admission facts for stored address evidence, not permission to connect.
// No address in these tables is resolved or contacted.
test('rejects special-use IPv4 blocks and admits their policy-admitted neighbours', () => {
  const blocked = [
    '0.0.0.0', '0.255.255.255', '10.0.0.0', '10.255.255.255',
    '127.0.0.0', '127.255.255.255', '100.64.0.0', '100.127.255.255',
    '169.254.0.0', '169.254.255.255', '172.16.0.0', '172.31.255.255',
    '192.168.0.0', '192.168.255.255', '198.18.0.0', '198.19.255.255',
    '192.0.0.0', '192.0.0.255', '192.0.2.0', '192.0.2.255',
    '192.88.99.0', '192.88.99.255', '198.51.100.0', '198.51.100.255',
    '203.0.113.0', '203.0.113.255', '224.0.0.0', '239.255.255.255',
    '240.0.0.0', '255.255.255.255',
  ];
  const admitted = [
    '1.0.0.0', '9.255.255.255', '11.0.0.0', '126.255.255.255', '128.0.0.0',
    '100.63.255.255', '100.128.0.0', '169.253.255.255', '169.255.0.0',
    '172.15.255.255', '172.32.0.0', '192.167.255.255', '192.169.0.0',
    '198.17.255.255', '198.20.0.0', '191.255.255.255', '192.0.1.0',
    '192.0.1.255', '192.0.3.0', '192.88.98.255', '192.88.100.0',
    '198.51.99.255', '198.51.101.0', '203.0.112.255', '203.0.114.0', '223.255.255.255',
  ];
  for (const address of blocked) assert.equal(canonicalPublicIpAddress(address), null, address);
  for (const address of admitted) assert.equal(canonicalPublicIpAddress(address), address, address);
});

test('keeps IPv6 special-use, translated and mapped addresses outside evidence admission', () => {
  for (const address of [
    '::', '::1', '::ffff:8.8.8.8', '::ffff:808:808', '0:0:0:0:0:ffff:808:808',
    '64:ff9b::808:808', '100::', '100:0:0:0:ffff:ffff:ffff:ffff',
    'fc00::', 'fdff:ffff::', 'fe80::', 'febf:ffff::', 'fec0::', 'feff:ffff::',
    'ff00::', 'ffff:ffff::', '2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:2::', '2001:2:0:ffff:ffff:ffff:ffff:ffff',
    '2001:10::', '2001:1f:ffff::', '2001:20::', '2001:2f:ffff::',
    '2001::', '2001:0:ffff::', '2002::', '2002:ffff:ffff::',
    '3fff::', '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff',
    '1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '4000::',
  ]) assert.equal(canonicalPublicIpAddress(address), null, address);

  for (const address of [
    '2000::', '2000:ffff:ffff::', '2001:1::', '2001:2:1::', '2001:f:ffff::',
    '2001:30::', '2001:db7:ffff::', '2001:db9::', '2001:ffff:ffff::',
    '2003::', '3ffe:ffff:ffff::', '3fff:1000::', '3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  ]) assert.equal(canonicalPublicIpAddress(address), address, address);
});

test('canonicalises equivalent public addresses and refuses non-address input', () => {
  assert.equal(canonicalPublicIpAddress(' 001.002.003.004 '), '1.2.3.4');
  assert.equal(canonicalPublicIpAddress(' 2001:0DB9:0000:0000:0000:0000:0000:000A '), '2001:db9::a');
  for (const value of [
    null, undefined, 123, {}, [], '', 'example.test', '1.2.3', '1.2.3.256',
    '0x01020304', '1.2.3.4:80', 'https://1.2.3.4/', '1.2.3.4\u0000',
    '[2001:db9::1]', '2001:db9::1%en0', '2001:db9::1/64', '2001:db9:::1',
    '2001:db9::g', '2001:db9:0:0:0:0:0:0:1',
  ]) assert.equal(canonicalPublicIpAddress(value), null, String(value));
});

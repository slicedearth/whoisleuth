import assert from 'node:assert/strict';
import test from 'node:test';
import { addressValue } from '../packages/contracts/ip-address.mts';

test('numeric address comparison preserves IPv4, expanded/compressed IPv6 and embedded IPv4 identity', () => {
  assert.deepEqual(addressValue('192.0.2.10'), { family: 4, value: 3_221_225_994 });
  assert.deepEqual(addressValue('2001:db8::1'), addressValue('2001:0db8:0000:0000:0000:0000:0000:0001'));
  assert.deepEqual(addressValue('::ffff:192.0.2.10'), addressValue('::ffff:c000:20a'));
  assert.deepEqual(addressValue('::'), { family: 6, value: 0n });
  assert.deepEqual(addressValue('255.255.255.255'), { family: 4, value: 0xffff_ffff });
  assert.deepEqual(addressValue('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'), { family: 6, value: (1n << 128n) - 1n });
});

test('invalid, scoped and oversized addresses fail without interpreting URLs or endpoints', () => {
  for (const value of [null, {}, '256.0.0.1', '127.1', '0x7f000001', '2001:db8::1%eth0',
    'https://192.0.2.10/', '[2001:db8::1]', '2001:::1', '2001:db8:1', '1:2:3:4:5:6:7:8:9',
    '192.0.2.10\n', '192.0.2.10:443', ':'.repeat(97)]) assert.equal(addressValue(value), null);
});

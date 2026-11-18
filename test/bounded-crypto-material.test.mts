import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeCryptoBase64, parseCryptoDer } from '../packages/evidence/bounded-crypto-material.mts';

test('canonical base64 decoding reaches the supported artefact bound without a repeated-group parser overflow', () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024, 123);
  const decoded = decodeCryptoBase64(bytes.toString('base64'), bytes.length);
  assert.equal(decoded.length, bytes.length);
  assert.deepEqual(Buffer.from(decoded), bytes);
  for (const value of ['AA=A', 'A===', 'AB==', 'AA==\n', 'A', '']) assert.throws(() => decodeCryptoBase64(value, 10), TypeError);
  assert.equal(decodeCryptoBase64('', 10, 'Empty test value', true).length, 0);
  assert.throws(() => decodeCryptoBase64('AAAA', 2), TypeError);
});

test('bounded ASN.1 parsing rejects trailing bytes and excessive nested containers', () => {
  const valid = new Uint8Array([0x30, 0x03, 0x02, 0x01, 1]);
  assert.equal(parseCryptoDer(valid, 100, 'Synthetic value').idBlock.tagNumber, 16);
  assert.throws(() => parseCryptoDer(new Uint8Array([...valid, 0]), 100, 'Synthetic value'), TypeError);
  let encoded = Buffer.from([0x05, 0]);
  for (let index = 0; index < 40; index++) encoded = Buffer.concat([Buffer.from([0x30, encoded.length]), encoded]);
  assert.throws(() => parseCryptoDer(new Uint8Array(encoded), 100, 'Nested value'), TypeError);
});

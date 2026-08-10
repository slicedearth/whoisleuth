import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPortableGeneratorMetadata,
  portableGeneratorAttribution,
} from '../lib/portable-generator.mts';

test('portable generator metadata keeps one bounded project identity', () => {
  const generator = buildPortableGeneratorMetadata('1.45.0');
  assert.deepEqual(generator, {
    name: 'WHOISleuth',
    version: '1.45.0',
    projectUrl: 'https://github.com/slicedearth/whoisleuth',
  });
  assert.equal(
    portableGeneratorAttribution(generator),
    'Generated with WHOISleuth 1.45.0 · Source: https://github.com/slicedearth/whoisleuth',
  );
});

test('portable generator metadata rejects untrusted version text without losing provenance', () => {
  const generator = buildPortableGeneratorMetadata('1.45.0\nhttps://untrusted.example');
  assert.deepEqual(generator, {
    name: 'WHOISleuth',
    version: null,
    projectUrl: 'https://github.com/slicedearth/whoisleuth',
  });
  assert.equal(
    portableGeneratorAttribution(generator),
    'Generated with WHOISleuth · Source: https://github.com/slicedearth/whoisleuth',
  );
});

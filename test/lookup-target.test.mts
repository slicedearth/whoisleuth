import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_LOOKUP_INPUT_CHARACTERS, parseCredentialFreeHttpUrl, prepareLookupCollectionTarget } from '../packages/evidence/lookup-target.mts';
import { classifyQuery } from '../lib/classify.mts';
import { parseIncidentUrlContext } from '../packages/cases/case-record-operations.mts';

test('collection retains the full hostname but never URL path, query, fragment, port or credentials', () => {
  const input = 'https://portal.example.test:8443/private-path?private-query=present#private-fragment';
  assert.equal(prepareLookupCollectionTarget(input), 'portal.example.test');
  assert.equal(classifyQuery(input).inputHostname, 'portal.example.test');
  assert.equal(classifyQuery(input).value, 'example.test');
  assert.equal(parseIncidentUrlContext(input)?.exactUrl, input);
  for (const input of ['https://synthetic:private@portal.example.test/path', 'synthetic@portal.example.test',
    'ftp://portal.example.test/path', 'https://portal.example.test\n/private', 'https://portal.example.test\\private']) {
    assert.throws(() => prepareLookupCollectionTarget(input));
  }
  assert.equal(parseIncidentUrlContext('https://synthetic:private@portal.example.test/path'), null);
});

test('URL preparation preserves canonical address and ASN classification without admitting numeric aliases', () => {
  for (const [input, output] of [
    ['AS64496', 'AS64496'], ['64496', '64496'], ['192.0.2.1', '192.0.2.1'],
    ['https://192.0.2.1/path', '192.0.2.1'], ['2001:db8::1', '2001:db8::1'],
    ['https://[2001:db8::1]:8443/path', '2001:db8::1'], ['[2001:db8::1]', '2001:db8::1'],
    ['portal.example.test:8080/path', 'portal.example.test'],
  ]) assert.equal(prepareLookupCollectionTarget(input!), output);
  for (const input of ['127.1', '0x7f.0.0.1', '127.000.0.1', 'https://2130706433/path', '999.999.999.999',
    'foo:bar:baz', '2001:db8:::1', 'fe80::1%en0']) {
    assert.throws(() => prepareLookupCollectionTarget(input));
  }
});

test('the shared URL admission applies caller bounds and rejects credentials before retention', () => {
  assert.equal(parseCredentialFreeHttpUrl('https://example.test/', 10), null);
  assert.equal(parseCredentialFreeHttpUrl(' https://example.test/', 100), null);
  assert.equal(parseCredentialFreeHttpUrl('https://name@example.test/', 100), null);
  assert.throws(() => prepareLookupCollectionTarget('a'.repeat(MAX_LOOKUP_INPUT_CHARACTERS + 1)));
});

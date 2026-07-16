const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  CT_QUERY_ERROR_CODE,
  CT_QUERY_ERROR_MESSAGE,
  isCtQueryError,
  MAX_CT_QUERY_LENGTH,
  normalizeCtQuery,
} = require('../lib/ct-query.mts');

describe('Certificate Transparency query normalization', () => {
  test('trims a bounded printable keyword without changing its content', () => {
    assert.equal(normalizeCtQuery('  Example brand  '), 'Example brand');
  });

  test('treats absent and whitespace-only input as missing', () => {
    assert.equal(normalizeCtQuery(undefined), '');
    assert.equal(normalizeCtQuery(null), '');
    assert.equal(normalizeCtQuery('   '), '');
  });

  test('accepts the exact character bound', () => {
    const value = 'a'.repeat(MAX_CT_QUERY_LENGTH);
    assert.equal(normalizeCtQuery(value), value);
  });

  test('rejects overlong, control-character, and non-string input consistently', () => {
    for (const value of ['a'.repeat(MAX_CT_QUERY_LENGTH + 1), 'brand\nname', 'brand\u007fname', ['brand']]) {
      assert.throws(() => normalizeCtQuery(value), (error) => {
        assert.equal(isCtQueryError(error), true);
        assert.equal(error.code, CT_QUERY_ERROR_CODE);
        assert.equal(error.message, CT_QUERY_ERROR_MESSAGE);
        return true;
      });
    }
  });

  test('accepts multibyte input at the same browser-visible character bound', () => {
    assert.equal(normalizeCtQuery('🔐'.repeat(MAX_CT_QUERY_LENGTH / 2)).length, MAX_CT_QUERY_LENGTH);
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseWhoisDate } = require('../lib/availability.mts');

test('parses dotted day-first WHOIS dates without month/day ambiguity', () => {
  assert.equal(parseWhoisDate('03.04.2024').toISOString(), '2024-04-03T00:00:00.000Z');
  assert.equal(parseWhoisDate('05.11.2023 08:00:00').toISOString(), '2023-11-05T08:00:00.000Z');
  assert.equal(parseWhoisDate('14.03.2024 10:46:48').toISOString(), '2024-03-14T10:46:48.000Z');
});

test('parses supported year-first dotted and named-month WHOIS dates in UTC', () => {
  assert.equal(parseWhoisDate('2006. 09. 18.').toISOString(), '2006-09-18T00:00:00.000Z');
  assert.equal(parseWhoisDate('1999-Feb-16.').toISOString(), '1999-02-16T00:00:00.000Z');
});

test('parses ISO-shaped dates deterministically with or without an offset', () => {
  assert.equal(parseWhoisDate('2024-03-14').toISOString(), '2024-03-14T00:00:00.000Z');
  assert.equal(parseWhoisDate('2024-03-14T10:46:48.125Z').toISOString(), '2024-03-14T10:46:48.125Z');
  assert.equal(parseWhoisDate('2024-03-14 10:46:48').toISOString(), '2024-03-14T10:46:48.000Z');
  assert.equal(parseWhoisDate('2024-03-14T10:46:48+10:00').toISOString(), '2024-03-14T00:46:48.000Z');
  assert.equal(parseWhoisDate('2024-03-14T10:46:48-0530').toISOString(), '2024-03-14T16:16:48.000Z');
});

test('rejects invalid calendars, unsupported ambiguous formats, and trailing data', () => {
  for (const value of [
    '31.02.2024',
    '2024-02-31',
    '2024-Abc-01',
    '03/04/2024',
    '03.04.2024 trailing',
    '2024-03-14T24:00:00Z',
    '2024-03-14T10:46:48+24:00',
    '',
    null,
  ]) {
    assert.equal(parseWhoisDate(value), null, String(value));
  }
});

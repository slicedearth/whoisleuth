import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWhoisDate } from '../lib/availability.mts';
import { requiredValue } from './value-assertions.mts';

function parsedDate(value: unknown): Date {
  return requiredValue(parseWhoisDate(value));
}

test('parses dotted day-first WHOIS dates without month/day ambiguity', () => {
  assert.equal(parsedDate('03.04.2024').toISOString(), '2024-04-03T00:00:00.000Z');
  assert.equal(parsedDate('05.11.2023 08:00:00').toISOString(), '2023-11-05T08:00:00.000Z');
  assert.equal(parsedDate('14.03.2024 10:46:48').toISOString(), '2024-03-14T10:46:48.000Z');
});

test('parses supported year-first dotted and named-month WHOIS dates in UTC', () => {
  assert.equal(parsedDate('2006. 09. 18.').toISOString(), '2006-09-18T00:00:00.000Z');
  assert.equal(parsedDate('1999-Feb-16.').toISOString(), '1999-02-16T00:00:00.000Z');
});

test('parses ISO-shaped dates deterministically with or without an offset', () => {
  assert.equal(parsedDate('2024-03-14').toISOString(), '2024-03-14T00:00:00.000Z');
  assert.equal(parsedDate('2024-03-14T10:46:48.125Z').toISOString(), '2024-03-14T10:46:48.125Z');
  assert.equal(parsedDate('2024-03-14 10:46:48').toISOString(), '2024-03-14T10:46:48.000Z');
  assert.equal(parsedDate('2024-03-14T10:46:48+10:00').toISOString(), '2024-03-14T00:46:48.000Z');
  assert.equal(parsedDate('2024-03-14T10:46:48-0530').toISOString(), '2024-03-14T16:16:48.000Z');
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

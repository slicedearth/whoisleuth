const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRegistryDate, registryDateIso } = require('../lib/registry-dates.mts');
const { parseWhoisDate } = require('../lib/availability.mts');

test('normalizes supported registry date shapes to canonical ISO timestamps', () => {
  assert.equal(registryDateIso('03.04.2024'), '2024-04-03T00:00:00.000Z');
  assert.equal(registryDateIso('2006. 09. 18.'), '2006-09-18T00:00:00.000Z');
  assert.equal(registryDateIso('1999-Feb-16.'), '1999-02-16T00:00:00.000Z');
  assert.equal(registryDateIso('2024-03-14T10:46:48+10:00'), '2024-03-14T00:46:48.000Z');
  assert.equal(registryDateIso('2024-03-14 10:46:48 +03:00'), '2024-03-14T07:46:48.000Z');
  assert.equal(registryDateIso('2024-03-14 T10:46:48+12:00'), '2024-03-13T22:46:48.000Z');
  assert.equal(registryDateIso('2024.03.14 10:46:48'), '2024-03-14T10:46:48.000Z');
  assert.equal(registryDateIso('2024/03/14'), '2024-03-14T00:00:00.000Z');
  assert.equal(registryDateIso('20240314 #123456'), '2024-03-14T00:00:00.000Z');
  assert.equal(registryDateIso('20240314 10:46:48'), '2024-03-14T10:46:48.000Z');
  assert.equal(registryDateIso('14-Mar-2024 10:46:48'), '2024-03-14T10:46:48.000Z');
  assert.equal(registryDateIso('14-03-2024'), '2024-03-14T00:00:00.000Z');
  assert.equal(registryDateIso('Thu Mar 14 2024'), '2024-03-14T00:00:00.000Z');
  assert.equal(registryDateIso('September  5 2000'), '2000-09-05T00:00:00.000Z');
  assert.equal(registryDateIso('2024-03-14 10:46:48 (GMT+0:00)'), '2024-03-14T10:46:48.000Z');
  assert.equal(registryDateIso('14-03-2024 10:46:48 GMT+1'), '2024-03-14T09:46:48.000Z');
  assert.equal(registryDateIso('14 Mar 2024'), '2024-03-14T00:00:00.000Z');
  assert.equal(registryDateIso('24th April 1997 at 00:00:00.000'), '1997-04-24T00:00:00.000Z');
});

test('returns null for missing, invalid, and unsupported registry date values', () => {
  for (const value of [null, '', '31.02.2024', '14/03/2024', '31-02-2024', '03-14-2024', '32-Mar-2024', '24st April 1997 at 00:00:00.000', 'Thu Nope 14 2024', 'Janua 14 2024', 'Nonsense 14 2024', '2024-03-14 10:46:48 (GMT+24:00)', '14-03-2024 10:46:48 GMT+25', 'not-a-date']) {
    assert.equal(parseRegistryDate(value), null, String(value));
    assert.equal(registryDateIso(value), null, String(value));
  }
});

test('retains the historical parseWhoisDate export as the shared parser', () => {
  assert.equal(parseWhoisDate('2024-03-14 10:46:48').toISOString(), '2024-03-14T10:46:48.000Z');
});

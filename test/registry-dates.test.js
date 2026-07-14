const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRegistryDate, registryDateIso } = require('../lib/registry-dates');
const typedRegistryDates = require('../lib/registry-dates.mts');
const { parseWhoisDate } = require('../lib/availability');

test('retains the CommonJS registry-date entry point over the typed implementation', () => {
  assert.strictEqual(parseRegistryDate, typedRegistryDates.parseRegistryDate);
  assert.strictEqual(registryDateIso, typedRegistryDates.registryDateIso);
});

test('normalizes supported registry date shapes to canonical ISO timestamps', () => {
  assert.equal(registryDateIso('03.04.2024'), '2024-04-03T00:00:00.000Z');
  assert.equal(registryDateIso('2006. 09. 18.'), '2006-09-18T00:00:00.000Z');
  assert.equal(registryDateIso('1999-Feb-16.'), '1999-02-16T00:00:00.000Z');
  assert.equal(registryDateIso('2024-03-14T10:46:48+10:00'), '2024-03-14T00:46:48.000Z');
});

test('returns null for missing, invalid, and unsupported registry date values', () => {
  for (const value of [null, '', '31.02.2024', '2024/03/14', 'not-a-date']) {
    assert.equal(parseRegistryDate(value), null, String(value));
    assert.equal(registryDateIso(value), null, String(value));
  }
});

test('retains the historical parseWhoisDate export as the shared parser', () => {
  assert.equal(parseWhoisDate('2024-03-14 10:46:48').toISOString(), '2024-03-14T10:46:48.000Z');
});

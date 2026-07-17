// The view consumes the shared static catalogue without making network requests.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_REGISTRY_SUPPORT_FILTER_LENGTH,
  MAX_REGISTRY_SUPPORT_ROWS,
  filterRegistrySupportRows,
  registryAccessLabel,
  registryCoverageLabel,
  registrySupportCatalogue,
  registrySupportLabel,
} from '../frontend/src/lib/analysis/registry-support.js';

test('builds the bounded registry-support catalogue from the shared capability matrix', () => {
  const catalogue = registrySupportCatalogue();

  assert.equal(catalogue.version, 5);
  assert.equal(catalogue.rows.length, 12);
  assert.equal(catalogue.truncated, false);
  assert.deepEqual(catalogue.summary, {
    profiles: 12,
    fixtureVerified: 10,
    accessDocumented: 2,
    fallbacks: 1,
  });
  assert.deepEqual(catalogue.rows.map((row) => row.suffixes[0]), [
    'au', 'cz', 'de', 'edu', 'es', 'gt', 'it', 'jp', 'kr', 'tr', 'uk', 'vn',
  ]);
});

test('returns independent catalogue rows rather than exposing shared mutable arrays', () => {
  const first = registrySupportCatalogue();
  first.rows[0].suffixes[0] = 'changed';
  first.rows[0].fixtureScenarios.push('changed');

  const second = registrySupportCatalogue();
  assert.equal(second.rows[0].suffixes[0], 'au');
  assert.equal(second.rows[0].fixtureScenarios.includes('changed'), false);
});

test('filters registry profiles by suffix, capability text, and explicit coverage state', () => {
  const { rows } = registrySupportCatalogue();

  assert.deepEqual(filterRegistrySupportRows(rows, '.vn', 'all').map((row) => row.suffixes[0]), ['vn']);
  assert.deepEqual(filterRegistrySupportRows(rows, 'bracketed', 'all').map((row) => row.suffixes[0]), ['jp']);
  assert.deepEqual(filterRegistrySupportRows(rows, '', 'access_documented').map((row) => row.suffixes[0]), ['es', 'vn']);
  assert.deepEqual(filterRegistrySupportRows(rows, 'access', 'fixture_verified'), []);
});

test('bounds and sanitizes untrusted filter input without mutating the rows', () => {
  const { rows } = registrySupportCatalogue();
  const before = structuredClone(rows);
  const overlong = `\u0000\u0007${'x'.repeat(MAX_REGISTRY_SUPPORT_FILTER_LENGTH + 20)}vn`;

  assert.deepEqual(filterRegistrySupportRows(rows, overlong, 'unexpected'), []);
  assert.deepEqual(filterRegistrySupportRows(null, 'vn', 'all'), []);
  assert.deepEqual(rows, before);
});

test('caps injected catalogue rows before filtering', () => {
  const template = registrySupportCatalogue().rows[0];
  const rows = Array.from({ length: MAX_REGISTRY_SUPPORT_ROWS + 5 }, (_, index) => ({
    ...template,
    suffixes: [`suffix-${index}`],
  }));

  assert.equal(filterRegistrySupportRows(rows, '', 'all').length, MAX_REGISTRY_SUPPORT_ROWS);
  assert.deepEqual(filterRegistrySupportRows(rows, `suffix-${MAX_REGISTRY_SUPPORT_ROWS + 1}`, 'all'), []);
});

test('renders stable human-readable labels for known and unknown catalogue values', () => {
  assert.equal(registryCoverageLabel('fixture_verified'), 'Fixture verified');
  assert.equal(registryCoverageLabel('other'), 'Unknown');
  assert.equal(registryAccessLabel('iana-bootstrap'), 'IANA bootstrap discovery');
  assert.equal(registryAccessLabel(null), 'Unknown');
  assert.equal(registrySupportLabel('jprs-domain-english'), 'Jprs Domain English');
  assert.equal(registrySupportLabel('\u0000'), 'Unknown');
});

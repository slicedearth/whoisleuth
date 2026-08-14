import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';

import {
  normalizeCtTimestamp,
  normalizeExplicitIsoTimestamp,
  normalizeLegacyIsoTimestamp,
} from '../lib/observation.mts';

describe('deterministic evidence timestamps', () => {
  test('assigns UTC only to the documented zone-less CT form', () => {
    assert.equal(normalizeCtTimestamp('2026-01-15 12:00:00.125'), '2026-01-15T12:00:00.125Z');
    assert.equal(normalizeCtTimestamp('2026-01-15T12:00:00+11:00'), '2026-01-15T01:00:00.000Z');
    assert.equal(normalizeCtTimestamp('2026-02-30T12:00:00'), null);
    assert.equal(normalizeCtTimestamp('January 15, 2026 12:00:00'), null);
  });

  test('requires explicit zones for general evidence timestamps', () => {
    assert.equal(normalizeExplicitIsoTimestamp('2026-01-15T12:00:00Z'), '2026-01-15T12:00:00.000Z');
    assert.equal(normalizeExplicitIsoTimestamp('2026-01-15T12:00:00+11:00'), '2026-01-15T01:00:00.000Z');
    assert.equal(normalizeExplicitIsoTimestamp('2026-01-15T12:00:00'), null);
    assert.equal(normalizeExplicitIsoTimestamp('2026-01-15 12:00:00Z'), null);
  });

  test('assigns UTC deterministically only for frozen legacy ISO readers', () => {
    assert.equal(normalizeLegacyIsoTimestamp('2026-01-15T12:00:00'), '2026-01-15T12:00:00.000Z');
    assert.equal(normalizeLegacyIsoTimestamp('2026-01-15T12:00:00+11:00'), '2026-01-15T01:00:00.000Z');
    assert.equal(normalizeLegacyIsoTimestamp('2026-01-15 12:00:00'), null);
    assert.equal(normalizeLegacyIsoTimestamp('January 15, 2026 12:00:00'), null);
  });

  test('rejects offsets that cross the supported four-digit UTC year boundary', () => {
    assert.equal(normalizeExplicitIsoTimestamp('0001-01-01T00:00:00+14:00'), null);
    assert.equal(normalizeExplicitIsoTimestamp('9999-12-31T23:59:59-14:00'), null);
    assert.equal(normalizeExplicitIsoTimestamp('0001-01-01T00:00:00Z'), '0001-01-01T00:00:00.000Z');
    assert.equal(normalizeExplicitIsoTimestamp('9999-12-31T23:59:59Z'), '9999-12-31T23:59:59.000Z');
  });

  test('every accepted explicit timestamp is canonical and idempotent', () => {
    for (const input of [
      '0001-01-01T00:00:00Z',
      '2026-01-15T12:00:00+11:00',
      '9999-12-31T23:59:59Z',
    ]) {
      const normalized = normalizeExplicitIsoTimestamp(input);
      assert.notEqual(normalized, null);
      assert.equal(normalizeExplicitIsoTimestamp(normalized), normalized);
    }
  });

  test('returns identical zone-less CT output under different host timezones', () => {
    const moduleUrl = new URL('../lib/observation.mts', import.meta.url).href;
    const source = `import { normalizeCtTimestamp } from ${JSON.stringify(moduleUrl)}; process.stdout.write(String(normalizeCtTimestamp('2026-01-15T12:00:00.000')));`;
    const run = (timezone: string) => execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8',
      env: { ...process.env, TZ: timezone },
    });
    assert.equal(run('UTC'), '2026-01-15T12:00:00.000Z');
    assert.equal(run('Australia/Melbourne'), '2026-01-15T12:00:00.000Z');
  });
});

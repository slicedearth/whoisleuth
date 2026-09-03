import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SOURCE_RELEASED_AT } from '../tools/cisa-kev-catalog.mts';
import {
  buildCatalogStatus,
  main,
  parseArguments,
} from '../tools/cisa-kev-catalog-status.mts';

const DAY_MS = 24 * 60 * 60 * 1_000;
const daysAfterRelease = (days: number) => new Date(Date.parse(SOURCE_RELEASED_AT) + (days * DAY_MS));

describe('pinned CISA KEV catalogue status', () => {
  test('reports age locally without implying that the upstream feed was checked', () => {
    const current = buildCatalogStatus(daysAfterRelease(1), 30);
    const stale = buildCatalogStatus(daysAfterRelease(32), 30);
    assert.equal(current.state, 'current');
    assert.equal(current.ageDays, 1);
    assert.equal(stale.state, 'stale');
    assert.equal(stale.ageDays, 32);
    assert.match(current.limitation, /does not fetch/u);
  });

  test('bounds arguments and returns a non-zero status for a stale projection', async () => {
    assert.deepEqual(parseArguments(['--max-age-days', '45', '--json']), { json: true, maxAgeDays: 45 });
    assert.throws(() => parseArguments(['--max-age-days', '0']), /1 to 365/u);
    let stdout = '';
    let stderr = '';
    const code = await main(['--json'], {
      now: daysAfterRelease(32),
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    });
    assert.equal(code, 2);
    assert.equal(JSON.parse(stdout).state, 'stale');
    assert.equal(stderr, '');
  });
});

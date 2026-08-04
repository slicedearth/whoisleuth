import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCatalogStatus,
  main,
  parseArguments,
} from '../tools/cisa-kev-catalog-status.mts';

describe('pinned CISA KEV catalogue status', () => {
  test('reports age locally without implying that the upstream feed was checked', () => {
    const current = buildCatalogStatus(new Date('2026-08-04T18:55:09.067Z'), 30);
    const stale = buildCatalogStatus(new Date('2026-09-04T18:55:09.067Z'), 30);
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
      now: new Date('2026-10-04T18:55:09.067Z'),
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    });
    assert.equal(code, 2);
    assert.equal(JSON.parse(stdout).state, 'stale');
    assert.equal(stderr, '');
  });
});

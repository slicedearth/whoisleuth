import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('retained Bulk and watchlist registry dates are identical in distinct host timezones', () => {
  const historyUrl = new URL('../packages/workspace/watchlist-history.mts', import.meta.url).href;
  const bulkUrl = new URL('../frontend/src/lib/analysis/bulk-scan-normalizer.ts', import.meta.url).href;
  const script = `
    import { normalizeWatchlistEntry } from ${JSON.stringify(historyUrl)};
    import { normalizeBulkScanResult } from ${JSON.stringify(bulkUrl)};
    const rows = ['2026-08-07T00:30:00', '2026-08-07T00:30:00Z', '2026-08-07T00:30:00+10:00', '2026-02-30'].map(date => {
      const entry = normalizeWatchlistEntry({ updatedAt: '2026-08-08T00:00:00Z', results: [{ domain: 'example.test', createdDate: date, expiryDate: date }] });
      const bulk = normalizeBulkScanResult({ availability: { applicable: true, domain: 'example.test', state: 'registered', confidence: 'high', createdDate: date, expiryDate: date }, diagnostics: { version: 7, rdap: { status: 'complete' }, whois: { status: 'skipped' }, availability: { status: 'complete' } } }, { targetDomain: 'example.test', mode: 'fast', profile: null, candidate: null });
      return { created: entry.baseline[0].createdDate, expiry: entry.baseline[0].expiryDate, bulkCreated: bulk.saved.createdDate, bulkExpiry: bulk.saved.expiryDate };
    });
    process.stdout.write(JSON.stringify(rows));
  `;
  const expected = [
    ['2026-08-07', '2026-08-07T00:30:00.000Z'],
    ['2026-08-07', '2026-08-07T00:30:00.000Z'],
    ['2026-08-06', '2026-08-06T14:30:00.000Z'],
    [null, null],
  ].map(([date, instant]) => ({ ...(date === null ? {} : { created: date, expiry: date }), bulkCreated: instant, bulkExpiry: instant }));
  for (const timezone of ['UTC', 'Australia/Melbourne', 'America/Los_Angeles']) {
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024,
    });
    assert.deepEqual(JSON.parse(output), expected, timezone);
  }
});

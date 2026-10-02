import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { evidenceDate, evidenceTime, formatEvidenceDate } from '../frontend/src/lib/analysis/evidence-time.ts';
import { dateTimeAttribute, formatDate } from '../frontend/src/lib/analysis/lookup-display-shared.ts';

test('readable evidence times use UTC and keep the exact source value for copying', () => {
  for (const source of ['2026-04-05T02:30:12.345+11:00', '2026-04-05T01:30:12.345+10:00', '2026-04-04T15:30:12.345Z']) {
    const result = evidenceTime(source);
    assert.equal(result?.exact, source);
    assert.equal(result?.datetime, '2026-04-04T15:30:12.345Z');
    assert.equal(result?.readable, '04 Apr 2026, 15:30:12 UTC');
  }
});

test('missing, ambiguous and invalid evidence times do not acquire an invented instant', () => {
  for (const source of [null, undefined, '', '2026-04-05', '2026-04-05T02:30:12', '2026-02-30T02:00:00Z', '<script>', 'a'.repeat(1000)]) assert.equal(evidenceTime(source), null);
  assert.equal(evidenceTime('0001-01-01T00:00:00.000Z')?.datetime, '0001-01-01T00:00:00.000Z');
  assert.equal(evidenceTime('9999-12-31T23:59:59.999Z')?.datetime, '9999-12-31T23:59:59.999Z');
});

test('calendar evidence keeps its exact day without inventing a source timestamp', () => {
  assert.deepEqual(evidenceDate('2026-01-01'), {
    exact: '2026-01-01', datetime: '2026-01-01', readable: '01 Jan 2026',
  });
  assert.equal(evidenceDate('2024-02-29')?.readable, '29 Feb 2024');
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '0000-01-01', '2026-1-1', 'Jan 1 2026', '2026-01-01T12:00:00']) {
    assert.equal(evidenceDate(value), null, value);
    assert.equal(dateTimeAttribute(value), undefined, value);
  }
  assert.equal(dateTimeAttribute('2026-01-01'), '2026-01-01');
  assert.equal(formatEvidenceDate(null, 'Not retained'), 'Not retained');
  assert.equal(formatEvidenceDate('invalid'), 'Unknown time');
  assert.equal(formatEvidenceDate('invalid', 'Not retained'), 'Unknown time');
  assert.equal(formatDate('unparsed registry date'), 'unparsed registry date');
});

test('Lookup and shared evidence displays do not change with the viewer timezone', () => {
  const displayUrl = new URL('../frontend/src/lib/analysis/lookup-display-shared.ts', import.meta.url).href;
  const evidenceUrl = new URL('../frontend/src/lib/analysis/evidence-time.ts', import.meta.url).href;
  for (const zone of ['Pacific/Honolulu', 'Pacific/Kiritimati', 'Australia/Melbourne', 'America/New_York']) {
    const result = spawnSync(process.execPath, ['--import', new URL('../tools/browser-server-egress-guard.mts', import.meta.url).href, '--input-type=module', '-e', `
      import { formatDate, dateTimeAttribute } from ${JSON.stringify(displayUrl)};
      import { formatEvidenceDate } from ${JSON.stringify(evidenceUrl)};
      console.log(JSON.stringify([
        formatEvidenceDate('2026-01-01'), formatDate('2026-01-01'),
        formatEvidenceDate('2026-01-01T01:30:00+11:00'), formatDate('2026-01-01T01:30:00+11:00'),
        dateTimeAttribute('2026-01-01T01:30:00+11:00'),
      ]));
    `], { env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, `${zone}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), [
      '01 Jan 2026', '01 Jan 2026', '31 Dec 2025, 14:30:00 UTC', '31 Dec 2025, 14:30:00 UTC',
      '2025-12-31T14:30:00.000Z',
    ], zone);
  }
});

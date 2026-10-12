import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectHarWaterfall } from '../packages/investigation/har-waterfall.mts';
import { MAX_HAR_ENTRIES, type HarEntry } from '../packages/contracts/har-review.mts';
import { reviewHarInput } from '../packages/investigation/har-intake.mts';
import { selectedHarFixture } from '../fixtures/selected-input-examples.mts';

function entry(sequence: number, startedAt: string | null, durationMs: number | null): HarEntry {
  return { sequence, startedAt, durationMs, origin: 'https://request.example', method: 'GET', status: 200,
    mimeCategory: 'html', resourceType: 'document', reportedFailure: false,
    timings: { blocked: null, dns: null, connect: 80, ssl: 50, send: 5, wait: 10, receive: 5 } };
}

test('archive order and exact record identity survive a separate chronological view', () => {
  const records = [entry(3, '2026-10-11T10:00:00.200Z', 100), entry(8, null, 250),
    entry(12, '2026-10-11T10:00:00.000Z', 0), entry(15, '2026-10-11T10:00:00.200Z', null)];
  const before = structuredClone(records);
  const archive = projectHarWaterfall(records);
  assert.deepEqual(archive.rows.map(row => row.entry.sequence), [3, 8, 12, 15]);
  assert.deepEqual(archive.rows.map(row => row.offsetMs), [200, null, 0, 200]);
  assert.equal(archive.referenceTime, '2026-10-11T10:00:00.000Z');
  assert.equal(archive.rangeMs, 300);
  assert.deepEqual(projectHarWaterfall(records, 'started').rows.map(row => row.entry.sequence), [12, 3, 15, 8]);
  assert.deepEqual(records, before);
  assert.equal(archive.rows[0]!.entry, records[0]);
});

test('reported total duration is independent of overlapping connect and TLS phases', () => {
  const result = projectHarWaterfall([entry(1, '2026-10-11T10:00:00Z', 100)]);
  assert.equal(result.rangeMs, 100);
  assert.equal(result.rows[0]!.position?.durationPercent, 100);
  assert.deepEqual(result.rows[0]!.entry.timings, { blocked: null, dns: null, connect: 80, ssl: 50, send: 5, wait: 10, receive: 5 });
});

test('the real HAR reader keeps negative and missing timing distinct from valid zero', async () => {
  const { report } = await reviewHarInput(selectedHarFixture(), '2026-10-11T12:00:00Z');
  const entries = report.harReview!.entries;
  const result = projectHarWaterfall(entries, 'started');
  assert.deepEqual(result.rows.map(row => row.entry.sequence), [2, 1]);
  assert.deepEqual(result.rows.map(row => row.offsetMs), [0, 1000]);
  assert.equal(result.rows[0]!.entry.durationMs, null);
  assert.equal(result.rows[0]!.position?.durationPercent, null);
  assert.equal(result.rows[1]!.entry.durationMs, 0);
  assert.equal(result.rows[1]!.position?.durationPercent, 0);
  assert.equal(result.rows[1]!.entry.timings.dns, null);
});

test('undated and empty archives do not gain an invented start or duration', () => {
  const records = [entry(2, null, 50), entry(5, 'invalid', null)];
  const result = projectHarWaterfall(records, 'started');
  assert.equal(result.referenceTime, null);
  assert.equal(result.rangeMs, null);
  assert.deepEqual(result.rows.map(row => row.entry.sequence), [2, 5]);
  assert.ok(result.rows.every(row => row.offsetMs === null && row.position === null));
  assert.deepEqual(projectHarWaterfall([]), { rows: [], referenceTime: null, rangeMs: null, omittedEntries: 0 });
});

test('fractional duration and a zero-length scale remain finite and explicit', () => {
  const fractional = projectHarWaterfall([entry(1, '2026-10-11T10:00:00Z', 1.5)]);
  assert.equal(fractional.rangeMs, 1.5);
  assert.equal(fractional.rows[0]!.position?.durationPercent, 100);
  const zero = projectHarWaterfall([entry(1, '2026-10-11T10:00:00Z', 0), entry(2, '2026-10-11T10:00:00Z', null)]);
  assert.equal(zero.rangeMs, 0);
  assert.deepEqual(zero.rows.map(row => row.position), [
    { startPercent: 0, durationPercent: 0 }, { startPercent: 0, durationPercent: null },
  ]);
});

test('an unrepresentable timing scale leaves every retained record and exact duration available', () => {
  const result = projectHarWaterfall([entry(1, '2026-10-11T10:00:00Z', 10),
    entry(2, '2026-10-11T10:00:00.001Z', Number.MAX_SAFE_INTEGER)]);
  assert.equal(result.rangeMs, null);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1]!.entry.durationMs, Number.MAX_SAFE_INTEGER);
  assert.equal(result.rows[1]!.offsetMs, 1);
  assert.ok(result.rows.every(row => row.position === null));
});

test('presentation work uses the existing archive-entry bound with omissions explicit', () => {
  const records = Array.from({ length: MAX_HAR_ENTRIES + 1 }, (_, index) => entry(index + 1, null, null));
  const result = projectHarWaterfall(records);
  assert.equal(result.rows.length, MAX_HAR_ENTRIES);
  assert.equal(result.omittedEntries, 1);
  assert.equal(result.rows.at(-1)!.entry.sequence, MAX_HAR_ENTRIES);
  assert.equal(records.length, MAX_HAR_ENTRIES + 1);
});

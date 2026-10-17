import { MAX_HAR_ENTRIES, type HarEntry } from '../contracts/har-review.mts';

export type HarRequestOrder = 'archive' | 'started';
export type HarWaterfallRow = Readonly<{
  entry: HarEntry;
  offsetMs: number | null;
  position: Readonly<{ startPercent: number; durationPercent: number | null }> | null;
}>;
export type HarWaterfall = Readonly<{
  rows: readonly HarWaterfallRow[];
  referenceTime: string | null;
  rangeMs: number | null;
  omittedEntries: number;
}>;

/** Present admitted archive timing; phases are never added to invent a duration. */
export function projectHarWaterfall(entries: readonly HarEntry[], order: HarRequestOrder = 'archive'): HarWaterfall {
  const records = entries.slice(0, MAX_HAR_ENTRIES).map((entry, index) => {
    const parsed = entry.startedAt === null ? NaN : Date.parse(entry.startedAt);
    return { entry, index, start: Number.isFinite(parsed) ? parsed : null };
  });
  let referenceStart: number | null = null;
  let referenceTime: string | null = null;
  for (const record of records) {
    if (record.start !== null && (referenceStart === null || record.start < referenceStart)) {
      referenceStart = record.start;
      referenceTime = record.entry.startedAt;
    }
  }
  let rangeMs: number | null = referenceStart === null ? null : 0;
  const rows = records.map(record => {
    const offsetMs = record.start !== null && referenceStart !== null ? record.start - referenceStart : null;
    const duration = record.entry.durationMs;
    const end = offsetMs === null ? null : duration === null ? offsetMs : offsetMs + duration;
    if (end !== null && (!Number.isFinite(end) || end < 0 || end > Number.MAX_SAFE_INTEGER)) rangeMs = null;
    else if (rangeMs !== null && end !== null) rangeMs = Math.max(rangeMs, end);
    return { ...record, offsetMs };
  });
  if (order === 'started') rows.sort((left, right) => {
    if (left.start === null || right.start === null) {
      return left.start === right.start ? left.index - right.index : left.start === null ? 1 : -1;
    }
    return left.start - right.start || left.index - right.index;
  });
  const scale = rangeMs;
  return {
    referenceTime,
    rangeMs,
    omittedEntries: entries.length - records.length,
    rows: rows.map(({ entry, offsetMs }) => ({
      entry, offsetMs,
      position: scale === null || offsetMs === null ? null : {
        startPercent: scale === 0 ? 0 : offsetMs / scale * 100,
        durationPercent: entry.durationMs === null ? null : scale === 0 ? 0 : entry.durationMs / scale * 100,
      },
    })),
  };
}

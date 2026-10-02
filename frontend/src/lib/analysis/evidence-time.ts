import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

const readableUtc = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const readableCalendarDate = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
});

/** Display an explicit instant without guessing the timezone of an incomplete date. */
export function evidenceTime(value: string | null | undefined): Readonly<{ exact: string; datetime: string; readable: string }> | null {
  const datetime = normalizeExplicitIsoTimestamp(value);
  if (!datetime || typeof value !== 'string') return null;
  return { exact: value, datetime, readable: `${readableUtc.format(new Date(datetime))} UTC` };
}

/** Calendar dates retain day precision; only explicitly zoned timestamps become instants. */
export function evidenceDate(value: string | null | undefined): ReturnType<typeof evidenceTime> {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const instant = normalizeExplicitIsoTimestamp(`${value}T00:00:00.000Z`);
    if (!instant) return null;
    return { exact: value, datetime: value, readable: readableCalendarDate.format(new Date(instant)) };
  }
  return evidenceTime(value);
}

export function formatEvidenceDate(value: string | null | undefined, missing = 'Unknown time'): string {
  return evidenceDate(value)?.readable ?? (value ? 'Unknown time' : missing);
}

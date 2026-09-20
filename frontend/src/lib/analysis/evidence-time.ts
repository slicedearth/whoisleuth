import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

const readableUtc = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Display an explicit instant without guessing the timezone of an incomplete date. */
export function evidenceTime(value: string | null | undefined): Readonly<{ exact: string; datetime: string; readable: string }> | null {
  const datetime = normalizeExplicitIsoTimestamp(value);
  if (!datetime || typeof value !== 'string') return null;
  return { exact: value, datetime, readable: `${readableUtc.format(new Date(datetime))} UTC` };
}

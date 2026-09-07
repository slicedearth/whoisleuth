import { normalizeExplicitIsoTimestamp } from './observation.mts';

/** Select a time cohort from an already bounded source; never rank undated evidence as older. */
export function latestObservationCohort<T>(
  values: readonly T[],
  observedAt: (value: T) => unknown,
): Readonly<{ observedAt: string | null; latest: readonly T[]; undated: readonly T[]; superseded: number }> {
  let latestTime: string | null = null;
  let latestMillis = -Infinity;
  let latest: T[] = [];
  const undated: T[] = [];
  let superseded = 0;
  for (const value of values) {
    const time = normalizeExplicitIsoTimestamp(observedAt(value));
    if (time === null) { undated.push(value); continue; }
    const millis = Date.parse(time);
    if (millis > latestMillis) {
      superseded += latest.length;
      latestTime = time;
      latestMillis = millis;
      latest = [value];
    } else if (millis === latestMillis) latest.push(value);
    else superseded += 1;
  }
  return { observedAt: latestTime, latest, undated, superseded };
}

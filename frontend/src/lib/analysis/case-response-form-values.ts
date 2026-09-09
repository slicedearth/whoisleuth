import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

export const utcDateTimeInputAttributes = Object.freeze({
  min: '0001-01-01T00:00',
  max: '9999-12-31T23:59:59.999',
  step: '0.001',
});

// Native date/time fields carry UTC wall time; saved values are explicit instants.
export function isoFromUtcInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/u.test(value)) return null;
  return normalizeExplicitIsoTimestamp(`${value.length === 16 ? `${value}:00` : value}Z`);
}

export function utcInputFromIso(value: string | null): string {
  return normalizeExplicitIsoTimestamp(value)?.slice(0, -1) ?? '';
}

export function list(value: string): string[] {
  return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
}

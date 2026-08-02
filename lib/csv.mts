// Shared bounded CSV serialization for browser and CLI exports. Values can
// contain upstream evidence, so normalize controls and prevent spreadsheet
// formula execution before applying ordinary CSV quoting.

const CSV_FORMULA_TRIGGER_RE = /^[=+\-@]/u;

export const MAX_CSV_CELL_LENGTH = 32_768;

function csvText(value: unknown): string {
  const raw = Array.isArray(value)
    ? value.map((item) => item == null ? '' : String(item)).join(' | ')
    : value == null ? '' : String(value);
  return raw
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_CSV_CELL_LENGTH);
}

export function serializeCsvCell(value: unknown): string {
  const text = csvText(value);
  const safe = CSV_FORMULA_TRIGGER_RE.test(text) ? `'${text}` : text;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function serializeCsvRows(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(serializeCsvCell).join(',')).join('\n');
}

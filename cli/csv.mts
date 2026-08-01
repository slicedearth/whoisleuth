const CSV_FORMULA_TRIGGER_RE = /^(?:[\t\r\n ]*[=+\-@]|[\t\r\n])/u;

function csvText(value: unknown): string {
  const raw = Array.isArray(value)
    ? value.map((item) => item == null ? '' : String(item)).join(' | ')
    : value == null ? '' : String(value);
  return raw
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 32_768);
}

function cliCsvCell(value: unknown): string {
  const text = csvText(value);
  const safe = CSV_FORMULA_TRIGGER_RE.test(text) ? `'${text}` : text;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export { cliCsvCell };

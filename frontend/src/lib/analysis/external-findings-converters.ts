import {
  EXTERNAL_FINDINGS_SCHEMA,
  EXTERNAL_FINDINGS_VERSION,
  MAX_EXTERNAL_FINDINGS,
  parseExternalFindingsDocument,
  type ExternalFindingCategory,
  type ExternalFindingsDocument,
} from './external-findings-import.ts';

export const EXTERNAL_FINDING_ROWS_SCHEMA = 'whoisleuth.external-finding-rows';
export const EXTERNAL_FINDING_ROWS_VERSION = 1;
export const EXTERNAL_FINDING_CSV_COLUMNS = [
  'domain',
  'category',
  'summary',
  'observed_at',
  'completeness',
  'limitation',
  'reference',
] as const;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const MAX_CSV_COLUMNS = EXTERNAL_FINDING_CSV_COLUMNS.length;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sourceName(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' && !CONTROL_RE.test(value)
    ? value.replace(/\s+/g, ' ').trim().slice(0, 80)
    : '';
  return candidate || fallback.replace(/\s+/g, ' ').trim().slice(0, 80) || 'External findings';
}

function rowsDocument(rows: readonly unknown[], source: string): ExternalFindingsDocument {
  if (!rows.length || rows.length > MAX_EXTERNAL_FINDINGS) {
    throw new Error(`Converted findings must contain between 1 and ${MAX_EXTERNAL_FINDINGS} rows.`);
  }
  const findings = rows.map((raw, index) => {
    const item = record(raw);
    if (!item) throw new Error(`Converted finding row ${index + 1} must be an object.`);
    const limitation = typeof item.limitation === 'string' && item.limitation.trim()
      ? [item.limitation]
      : Array.isArray(item.limitations)
        ? item.limitations
        : [];
    return {
      domain: item.domain,
      category: item.category,
      summary: item.summary,
      observedAt: item.observed_at ?? item.observedAt,
      completeness: item.completeness ?? 'unknown',
      limitations: limitation,
      reference: item.reference ?? null,
    };
  });
  return parseExternalFindingsDocument({
    schema: EXTERNAL_FINDINGS_SCHEMA,
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: { name: source, reference: null, collectedAt: null },
    findings,
  });
}

export function convertExternalFindingRows(value: unknown, fallbackSource = 'External findings'): ExternalFindingsDocument {
  if (Array.isArray(value)) return rowsDocument(value, sourceName(null, fallbackSource));
  const root = record(value);
  if (
    !root
    || root.schema !== EXTERNAL_FINDING_ROWS_SCHEMA
    || root.schemaVersion !== EXTERNAL_FINDING_ROWS_VERSION
    || !Array.isArray(root.rows)
  ) {
    throw new Error(`Converted JSON must be an array or ${EXTERNAL_FINDING_ROWS_SCHEMA} schema version ${EXTERNAL_FINDING_ROWS_VERSION}.`);
  }
  const source = record(root.source);
  return rowsDocument(root.rows, sourceName(source?.name, fallbackSource));
}

function parseCsvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') {
      if (field) throw new Error('CSV quotes must begin at the start of a field.');
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
      if (row.length > MAX_CSV_COLUMNS) throw new Error('CSV rows have too many columns.');
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_EXTERNAL_FINDINGS + 1) throw new Error(`CSV imports are limited to ${MAX_EXTERNAL_FINDINGS} findings.`);
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((item) => item.trim()));
}

export function convertExternalFindingsCsv(value: string, fallbackSource = 'External CSV findings'): ExternalFindingsDocument {
  if (CONTROL_RE.test(value.replace(/[\r\n\t]/g, ''))) {
    throw new Error('CSV contains unsupported control characters.');
  }
  const rows = parseCsvRows(value);
  const headers = rows.shift()?.map((item) => item.trim().toLowerCase()) ?? [];
  if (
    headers.length !== EXTERNAL_FINDING_CSV_COLUMNS.length
    || headers.some((header, index) => header !== EXTERNAL_FINDING_CSV_COLUMNS[index])
  ) {
    throw new Error(`CSV header must be: ${EXTERNAL_FINDING_CSV_COLUMNS.join(',')}.`);
  }
  const objects = rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  return rowsDocument(objects, sourceName(null, fallbackSource));
}

export type { ExternalFindingCategory };

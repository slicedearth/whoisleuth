const MAX_TERMINAL_VALUE_LENGTH = 240;
const MAX_TLS_TERMINAL_ALT_NAMES = 10;
const MAX_TLS_TERMINAL_PURPOSES = 8;
// Archive values are attacker-controlled evidence. Remove the complete Unicode
// default-ignorable class so visually identical identifiers cannot differ only
// through soft hyphens, combining grapheme joiners, variation selectors, tag
// characters, bidi controls, or other zero-width formatting code points.
const TERMINAL_DEFAULT_IGNORABLE_RE = /\p{Default_Ignorable_Code_Point}/gu;

// Terminal documents have different versioned shapes. Every scalar crosses
// safeTerminalValue before display, while the runner supplies bounded arrays.
type TerminalRecord = Record<string, unknown>;
type MutationLabels = Record<string, string>;
type TerminalBulkItem = {
  ok: boolean;
  query: unknown;
  error?: unknown;
  result?: unknown;
};
type TerminalBulkMetadata = {
  collectedTotal?: number;
  duplicates?: number;
  filter?: 'all' | 'errors' | 'inconclusive' | 'registered';
};

function safeTerminalValue(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value)
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(TERMINAL_DEFAULT_IGNORABLE_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return fallback;
  return normalized.length > MAX_TERMINAL_VALUE_LENGTH
    ? `${normalized.slice(0, MAX_TERMINAL_VALUE_LENGTH - 1)}…`
    : normalized;
}

function boundedTerminalList(values: readonly string[], omitted: number): string {
  const suffix = omitted > 0 ? ` · +${omitted} more` : '';
  const maximumBodyLength = Math.max(1, MAX_TERMINAL_VALUE_LENGTH - suffix.length);
  const joined = values.join(', ');
  const body = joined.length > maximumBodyLength
    ? `${joined.slice(0, Math.max(0, maximumBodyLength - 1))}…`
    : joined;
  return `${body}${suffix}`;
}

function boundedTerminalComponent(value: unknown, maximum: number): string {
  const normalized = safeTerminalValue(value);
  return normalized.length > maximum ? `${normalized.slice(0, Math.max(0, maximum - 1))}…` : normalized;
}

function boundedTerminalWithSuffix(value: string, suffix: string): string {
  if (!suffix) return safeTerminalValue(value);
  const retainedSuffix = suffix.length >= MAX_TERMINAL_VALUE_LENGTH
    ? `${suffix.slice(0, MAX_TERMINAL_VALUE_LENGTH - 1)}…`
    : suffix;
  const maximumValueLength = Math.max(1, MAX_TERMINAL_VALUE_LENGTH - retainedSuffix.length);
  const retainedValue = value.length > maximumValueLength
    ? `${value.slice(0, Math.max(0, maximumValueLength - 1))}…`
    : value;
  return `${retainedValue}${retainedSuffix}`;
}

function titleCase(value: unknown): string {
  const text = safeTerminalValue(value, 'unknown').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function terminalRecord(value: unknown): TerminalRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as TerminalRecord
    : {};
}

function terminalCount(value: unknown): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 999) : 0;
}

function terminalDisplayCount(value: unknown): string {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? String(count) : '0';
}

function terminalCountSummary(
  value: unknown,
  labels: ReadonlyArray<readonly [string, string]>,
): string {
  const source = terminalRecord(value);
  return labels
    .map(([key, label]) => {
      const count = Number(source[key]);
      return [label, Number.isSafeInteger(count) && count >= 0 ? count : 0] as const;
    })
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${terminalDisplayCount(count)}`)
    .join(', ');
}

function appendSection(lines: string[], label: string, values: string[]): void {
  if (!values.length) return;
  if (lines.length) lines.push('');
  lines.push(`${label}:`, ...values);
}

export {
  MAX_TERMINAL_VALUE_LENGTH,
  MAX_TLS_TERMINAL_ALT_NAMES,
  MAX_TLS_TERMINAL_PURPOSES,
  appendSection,
  boundedTerminalComponent,
  boundedTerminalList,
  boundedTerminalWithSuffix,
  safeTerminalValue,
  terminalCount,
  terminalCountSummary,
  terminalDisplayCount,
  terminalRecord,
  titleCase,
};
export type { MutationLabels, TerminalBulkItem, TerminalBulkMetadata, TerminalRecord };

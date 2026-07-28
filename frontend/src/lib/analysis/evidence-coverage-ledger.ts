export type EvidenceCoverageCategory = 'analysis' | 'external' | 'network' | 'registry' | 'web';
export type EvidenceCoverageState =
  | 'complete'
  | 'not_found'
  | 'partial'
  | 'skipped'
  | 'unavailable'
  | 'unknown'
  | 'unsupported';

export type EvidenceCoverageInput = Readonly<{
  id: string;
  label: string;
  category: EvidenceCoverageCategory;
  status?: unknown;
  complete?: unknown;
  truncated?: unknown;
  limitations?: unknown;
}>;

export type EvidenceCoverageEntry = Readonly<{
  id: string;
  label: string;
  category: EvidenceCoverageCategory;
  state: EvidenceCoverageState;
  statusLabel: string;
  limitations: readonly string[];
  manualReviewSuggested: boolean;
}>;

export type EvidenceCoverageLedger = Readonly<{
  version: 1;
  entries: readonly EvidenceCoverageEntry[];
  counts: Readonly<Record<EvidenceCoverageState, number>>;
  completeCount: number;
  limitedCount: number;
}>;

const MAX_ENTRIES = 24;
const MAX_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 120;
const MAX_LIMITATIONS = 8;
const MAX_LIMITATION_LENGTH = 280;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;

const COMPLETE_STATES = new Set([
  'available',
  'complete',
  'completed',
  'observed',
  'success',
  'supported',
]);
const PARTIAL_STATES = new Set(['incomplete', 'limited', 'partial', 'truncated']);
const SKIPPED_STATES = new Set(['disabled', 'not_applicable', 'skipped']);
const UNAVAILABLE_STATES = new Set([
  'blocked',
  'error',
  'failed',
  'rate_limited',
  'timeout',
  'unavailable',
]);

function boundedText(value: unknown, maximum: number): string {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function normalizeStatus(value: unknown): string {
  return boundedText(value, 64)
    .toLowerCase()
    .replace(/[\s-]+/gu, '_');
}

function normalizeLimitations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = boundedText(item, MAX_LIMITATION_LENGTH);
    if (!text || seen.has(text)) continue;
    output.push(text);
    seen.add(text);
    if (output.length >= MAX_LIMITATIONS) break;
  }
  return output;
}

function coverageState(input: EvidenceCoverageInput): EvidenceCoverageState {
  const status = normalizeStatus(input.status);
  if (status === 'not_found') return 'not_found';
  if (SKIPPED_STATES.has(status)) return 'skipped';
  if (status === 'unsupported') return 'unsupported';
  if (UNAVAILABLE_STATES.has(status)) return 'unavailable';
  if (input.truncated === true || input.complete === false || PARTIAL_STATES.has(status)) return 'partial';
  if (COMPLETE_STATES.has(status) || (status === '' && input.complete === true)) return 'complete';
  return 'unknown';
}

function statusLabel(state: EvidenceCoverageState): string {
  return {
    complete: 'Complete',
    not_found: 'Not found',
    partial: 'Partial',
    skipped: 'Skipped',
    unavailable: 'Unavailable',
    unknown: 'Unknown',
    unsupported: 'Unsupported',
  }[state];
}

export function buildEvidenceCoverageLedger(
  inputs: readonly EvidenceCoverageInput[],
): EvidenceCoverageLedger {
  const entries: EvidenceCoverageEntry[] = [];
  const seen = new Set<string>();

  for (const input of inputs.slice(0, MAX_ENTRIES)) {
    const id = boundedText(input.id, MAX_ID_LENGTH).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-');
    const label = boundedText(input.label, MAX_LABEL_LENGTH);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const state = coverageState(input);
    entries.push({
      id,
      label,
      category: input.category,
      state,
      statusLabel: statusLabel(state),
      limitations: normalizeLimitations(input.limitations),
      manualReviewSuggested: state === 'partial' || state === 'unavailable' || state === 'unknown',
    });
  }

  const counts: Record<EvidenceCoverageState, number> = {
    complete: 0,
    not_found: 0,
    partial: 0,
    skipped: 0,
    unavailable: 0,
    unknown: 0,
    unsupported: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;

  return {
    version: 1,
    entries,
    counts,
    completeCount: counts.complete,
    limitedCount: counts.partial + counts.unavailable + counts.unknown,
  };
}

import { canonicalArtifactJsonV2 } from '../evidence/artifact-integrity.mts';
import {
  COMPARISON_LEDGER_MODES, COMPARISON_LEDGER_STATES,
  MAX_COMPARISON_LEDGER_DETAIL_ROWS, MAX_COMPARISON_LEDGER_LIMITATIONS,
  MAX_COMPARISON_LEDGER_STRING_LENGTH, validComparisonLedgerRequestId,
  type ComparisonLedgerDetails, type ComparisonLedgerIndexItem, type ComparisonLedgerIndexSide,
  type ComparisonLedgerRow, type ComparisonLedgerSide,
} from './comparison-ledger-contract.mts';

// A deliberate text download, not another portable comparison format. The row
// contract bounds preparation; this byte bound rejects an oversized final report.
export const MAX_COMPARISON_ROW_REPORT_BYTES = 2 * 1024 * 1024;
const COMPLETENESS = ['complete', 'partial', 'unavailable', 'not_reported'] as const;
const OWNER_TYPES = ['case', 'website_snapshot', 'watchlist', 'bulk_session_pair'] as const;
const OMISSION_LABELS: Readonly<Record<keyof ComparisonLedgerDetails['omissions'], string>> = {
  inputRecords: 'Over-limit input records', inputScanTruncations: 'Stopped input scans',
  invalidRecords: 'Invalid records', duplicateRecords: 'Duplicate records', indexItems: 'Over-limit index items',
  entityRequests: 'Over-limit comparison requests', duplicateEntityRequests: 'Duplicate comparison requests',
  invalidEntityRequests: 'Invalid comparison requests', missingEntities: 'Missing comparisons',
  duplicateDetailRows: 'Duplicate detail rows', detailRows: 'Omitted detail rows', sourceRows: 'Source-omitted rows',
  limitations: 'Omitted limitations', truncatedStrings: 'Truncated strings',
};

function invalid(): never { throw new TypeError('Choose valid rows from one current, bounded comparison.'); }
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_COMPARISON_LEDGER_STRING_LENGTH) invalid();
  return value;
}
function id(value: unknown): string { if (!validComparisonLedgerRequestId(value)) invalid(); return value as string; }
function count(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(); return value as number; }
function flag(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function member<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) invalid(); return value as T;
}
function limitations(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_COMPARISON_LEDGER_LIMITATIONS) invalid();
  return value.map(text);
}
function optionalText(value: unknown): string | null { return value === null ? null : text(value); }
function indexSide(side: ComparisonLedgerIndexSide): ComparisonLedgerIndexSide {
  return { source: text(side.source), sourceState: text(side.sourceState), observedAt: optionalText(side.observedAt),
    publishedAt: optionalText(side.publishedAt), retainedAt: optionalText(side.retainedAt) };
}
function rowSide(side: ComparisonLedgerSide): ComparisonLedgerSide { return { ...indexSide(side), value: optionalText(side.value) }; }
function comparison(item: ComparisonLedgerIndexItem) {
  if (!(OWNER_TYPES as readonly string[]).includes(item.ownerType)) {
    throw new TypeError('This comparison owner is not supported by the selected-row text report.');
  }
  return { id: id(item.id), ownerType: member(item.ownerType, OWNER_TYPES), ownerId: id(item.ownerId),
    entityId: id(item.entityId), label: text(item.label), mode: member(item.mode, COMPARISON_LEDGER_MODES),
    earlier: indexSide(item.earlier), later: indexSide(item.later), completeness: member(item.completeness, COMPLETENESS),
    truncated: flag(item.truncated), limitations: limitations(item.limitations),
    omittedLimitations: count(item.omittedLimitations), sourceOmittedRows: count(item.sourceOmittedRows) };
}
function row(item: ComparisonLedgerRow): ComparisonLedgerRow {
  return { id: id(item.id), ownerId: id(item.ownerId), entityId: id(item.entityId),
    mode: member(item.mode, COMPARISON_LEDGER_MODES), state: member(item.state, COMPARISON_LEDGER_STATES),
    field: text(item.field), family: text(item.family), earlier: rowSide(item.earlier), later: rowSide(item.later),
    completeness: member(item.completeness, COMPLETENESS), truncated: flag(item.truncated),
    limitations: limitations(item.limitations), omittedLimitations: count(item.omittedLimitations) };
}

function project(details: ComparisonLedgerDetails, rowIds: readonly string[]) {
  if (!Array.isArray(details.selectedItems) || details.selectedItems.length !== 1
    || !Array.isArray(details.rows) || details.rows.length > MAX_COMPARISON_LEDGER_DETAIL_ROWS
    || !Array.isArray(rowIds) || !rowIds.length || rowIds.length > MAX_COMPARISON_LEDGER_DETAIL_ROWS) invalid();
  const selected = new Set(rowIds.map(id));
  if (selected.size !== rowIds.length) invalid();
  const item = comparison(details.selectedItems[0]!);
  const seen = new Set<string>();
  const rows: ComparisonLedgerRow[] = [];
  for (const candidate of details.rows) {
    const candidateId = id(candidate.id);
    if (seen.has(candidateId) || candidate.ownerId !== item.ownerId) invalid();
    seen.add(candidateId);
    if (selected.has(candidateId)) rows.push(row(candidate));
  }
  if (rows.length !== selected.size || count(details.totalRows) < details.rows.length) invalid();
  rows.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const omissions = Object.fromEntries(Object.keys(OMISSION_LABELS).map(key => [
    key, count(details.omissions[key as keyof typeof OMISSION_LABELS]),
  ])) as ComparisonLedgerDetails['omissions'];
  return { comparison: item, rows, totalRows: details.totalRows, availableRows: details.rows.length,
    unselectedRows: details.rows.length - rows.length, truncated: flag(details.truncated),
    limitations: limitations(details.limitations), omissions };
}

type Projection = ReturnType<typeof project>;
export type ComparisonRowReportSelection = Readonly<{
  comparisonId: string;
  rowIds: readonly string[];
  render: (current: ComparisonLedgerDetails) => string;
}>;

/** An ephemeral exact-content selection; neither identifiers nor hashes attest it. */
export function selectComparisonReportRows(
  details: ComparisonLedgerDetails, rowIds: readonly string[],
): ComparisonRowReportSelection {
  const selected = project(details, rowIds);
  const requestedIds = Object.freeze(selected.rows.map(item => item.id));
  const reviewedContent = canonicalArtifactJsonV2(selected);
  return Object.freeze({ comparisonId: selected.comparison.id, rowIds: requestedIds,
    render(current: ComparisonLedgerDetails): string {
      const currentContent = project(current, requestedIds);
      if (canonicalArtifactJsonV2(currentContent) !== reviewedContent) {
        throw new Error('The selected comparison changed. Review and select its rows again.');
      }
      return render(currentContent);
    },
  });
}

function quote(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function render(projection: Projection): string {
  const lines: string[] = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  const add = (line = '') => {
    const length = encoder.encode(`${line}\n`).byteLength;
    if (length > MAX_COMPARISON_ROW_REPORT_BYTES - bytes) {
      throw new RangeError('The selected comparison report exceeds its UTF-8 byte bound. Select fewer rows. No report was prepared.');
    }
    bytes += length;
    lines.push(line);
  };
  const field = (label: string, value: string | null) => add(`${label}: ${value === null ? 'Not retained in this projection' : quote(value)}`);
  const notes = (label: string, values: readonly string[]) => {
    add(`${label}: ${values.length}`);
    for (const value of values) add(`  - ${quote(value)}`);
  };
  const side = (label: string, value: ComparisonLedgerIndexSide, content?: string | null) => {
    add(label);
    field('  Source', value.source); field('  Source state', value.sourceState);
    field('  Observed', value.observedAt); field('  Published', value.publishedAt); field('  Retained locally', value.retainedAt);
    if (content !== undefined) field('  Normalized value', content);
  };
  const item = projection.comparison;
  add('Selected comparison rows');
  add('Bounded normalized comparison values, not full original evidence or a self-contained re-verifiable package.');
  add('Only the explicitly selected rows are included. Selection is not an assessment of safety, ownership or resolution.');
  add('Local identifiers are navigation references, not cryptographic integrity or provenance proof.');
  add('Exact earlier/later artifact identifiers and comparison algorithm/version are not supplied by this projection.');
  add('Any model/version field selected below retains only its own stated scope; it is not a complete algorithm declaration.');
  add('Missing clocks or source context have not been reconstructed. Values are quoted; reading-direction controls are escaped.');
  add();
  field('Comparison label', item.label); field('Comparison reference', item.id); field('Owner kind', item.ownerType);
  field('Owner reference', item.ownerId); field('Comparison subject', item.entityId); field('Mode', item.mode);
  field('Comparison completeness', item.completeness); add(`Comparison truncation: ${item.truncated}`);
  side('Earlier comparison source', item.earlier); side('Later comparison source', item.later);
  notes('Comparison limitations', item.limitations);
  add(`Comparison omitted limitations: ${item.omittedLimitations}`); add(`Comparison source-omitted rows: ${item.sourceOmittedRows}`);
  add(`Selected rows: ${projection.rows.length}`); add(`Available normalized rows: ${projection.availableRows}`);
  add(`Available rows not selected: ${projection.unselectedRows}`); add(`Producer total rows: ${projection.totalRows}`);
  add(`Projection truncation: ${projection.truncated}`);
  notes('Projection limitations', projection.limitations);
  add('Projection omission counts (may overlap; do not add them):');
  for (const [key, label] of Object.entries(OMISSION_LABELS)) add(`  ${label}: ${projection.omissions[key as keyof typeof OMISSION_LABELS]}`);
  for (const [index, value] of projection.rows.entries()) {
    add(); add(`Row ${index + 1}`);
    field('Row reference', value.id); field('Subject', value.entityId); field('Family', value.family); field('Field', value.field);
    field('Mode', value.mode); field('Comparison state', value.state); field('Completeness', value.completeness);
    add(`Truncation: ${value.truncated}`);
    side('Earlier', value.earlier, value.earlier.value); side('Later', value.later, value.later.value);
    notes('Row limitations', value.limitations); add(`Row omitted limitations: ${value.omittedLimitations}`);
  }
  const report = `${lines.join('\n')}\n`;
  if (encoder.encode(report).byteLength > MAX_COMPARISON_ROW_REPORT_BYTES) throw new RangeError('Comparison report byte bound exceeded.');
  return report;
}

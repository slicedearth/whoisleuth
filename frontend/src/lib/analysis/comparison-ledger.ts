import { buildBulkComparisonCandidates } from './comparison-ledger-bulk.ts';
import { buildCaseComparisonCandidates } from './comparison-ledger-case.ts';
import {
  MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST,
  MAX_COMPARISON_LEDGER_INDEX_ITEMS,
  MAX_COMPARISON_LEDGER_DETAIL_ROWS,
  boundedComparisonLedgerId,
  boundedComparisonLedgerLimitations,
  freshComparisonLedgerCounters,
  normaliseComparisonLedgerRowWithCounters,
  validComparisonLedgerRequestId,
  type ComparisonLedgerCandidate,
  type ComparisonLedgerDetails,
  type ComparisonLedgerDetailsRequest,
  type ComparisonLedgerIndex,
  type ComparisonLedgerInput,
  type ComparisonLedgerRow,
} from './comparison-ledger-contract.ts';
import { buildWatchlistComparisonCandidates } from './comparison-ledger-watchlist.ts';
import { buildWebsiteComparisonCandidates } from './comparison-ledger-website.ts';

export {
  COMPARISON_LEDGER_MODES,
  COMPARISON_LEDGER_STATES,
  MAX_COMPARISON_LEDGER_BULK_PAIRS,
  MAX_COMPARISON_LEDGER_DETAIL_ROWS,
  MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST,
  MAX_COMPARISON_LEDGER_ID_LENGTH,
  MAX_COMPARISON_LEDGER_INDEX_ITEMS,
  MAX_COMPARISON_LEDGER_LIMITATIONS,
  MAX_COMPARISON_LEDGER_STRING_LENGTH,
  normaliseComparisonLedgerRow,
  safeComparisonLedgerHref,
  stableComparisonLedgerId,
  stableComparisonLedgerJson,
} from './comparison-ledger-contract.ts';
export type {
  ComparisonLedgerCompleteness,
  ComparisonLedgerDetails,
  ComparisonLedgerDetailsRequest,
  ComparisonLedgerIndex,
  ComparisonLedgerIndexItem,
  ComparisonLedgerIndexSide,
  ComparisonLedgerInput,
  ComparisonLedgerMode,
  ComparisonLedgerOwnerType,
  ComparisonLedgerRow,
  ComparisonLedgerSide,
  ComparisonLedgerState,
  ExplicitBulkSessionPair,
} from './comparison-ledger-contract.ts';
export { comparisonLedgerBulkPairIndexId } from './comparison-ledger-bulk.ts';

type CandidateBuild = Readonly<{
  candidates: readonly ComparisonLedgerCandidate[];
  counters: ReturnType<typeof freshComparisonLedgerCounters>;
}>;
const MAX_COMPARISON_LEDGER_REQUEST_SCAN = MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST * 4;

function candidateOrder(left: ComparisonLedgerCandidate, right: ComparisonLedgerCandidate): number {
  const leftTime = left.item.later.observedAt ?? left.item.later.retainedAt ?? '';
  const rightTime = right.item.later.observedAt ?? right.item.later.retainedAt ?? '';
  return rightTime.localeCompare(leftTime)
    || left.item.ownerType.localeCompare(right.item.ownerType)
    || left.item.label.localeCompare(right.item.label)
    || left.item.id.localeCompare(right.item.id);
}

function buildCandidates(input: ComparisonLedgerInput): CandidateBuild {
  const counters = freshComparisonLedgerCounters();
  const candidates = [
    ...buildCaseComparisonCandidates(input.cases, counters),
    ...buildWebsiteComparisonCandidates(input.websiteSnapshots, counters),
    ...buildWatchlistComparisonCandidates(input.watchlists, counters),
    ...buildBulkComparisonCandidates(input.bulkSessions, input.bulkPairs, counters),
  ].sort(candidateOrder);
  const unique: ComparisonLedgerCandidate[] = [];
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.item.id)) {
      counters.duplicateRecords += 1;
      continue;
    }
    ids.add(candidate.item.id);
    unique.push(candidate);
  }
  return { candidates: Object.freeze(unique), counters };
}

export function buildComparisonLedgerIndex(input: ComparisonLedgerInput): ComparisonLedgerIndex {
  const built = buildCandidates(input);
  const retained = built.candidates.slice(0, MAX_COMPARISON_LEDGER_INDEX_ITEMS);
  const omittedIndex = Math.max(0, built.candidates.length - retained.length);
  const omissions = Object.freeze({
    inputRecords: built.counters.inputRecords,
    inputScanTruncations: built.counters.inputScanTruncations,
    invalidRecords: built.counters.invalidRecords,
    duplicateRecords: built.counters.duplicateRecords,
    indexItems: omittedIndex,
    limitations: built.counters.limitations,
    truncatedStrings: built.counters.truncatedStrings,
  });
  return Object.freeze({
    items: Object.freeze(retained.map((candidate) => candidate.item)),
    counts: Object.freeze({ candidates: built.candidates.length, retained: retained.length }),
    omissions,
    truncated: Object.values(omissions).some((count) => count > 0),
  });
}

function requestIds(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

export function buildComparisonLedgerDetails(
  input: ComparisonLedgerInput,
  request: ComparisonLedgerDetailsRequest,
): ComparisonLedgerDetails {
  const built = buildCandidates(input);
  const retainedCandidates = built.candidates.slice(0, MAX_COMPARISON_LEDGER_INDEX_ITEMS);
  const rawRequests = requestIds(request.itemIds);
  const unscannedEntityRequests = Math.max(0, rawRequests.length - MAX_COMPARISON_LEDGER_REQUEST_SCAN);
  const selectedIds: string[] = [];
  const seen = new Set<string>();
  let invalidEntityRequests = 0;
  let duplicateEntityRequests = 0;
  for (const value of rawRequests.slice(0, MAX_COMPARISON_LEDGER_REQUEST_SCAN)) {
    const id = boundedComparisonLedgerId(value, built.counters);
    if (!id || !validComparisonLedgerRequestId(value)) {
      invalidEntityRequests += 1;
      continue;
    }
    if (seen.has(id)) {
      duplicateEntityRequests += 1;
      continue;
    }
    seen.add(id);
    selectedIds.push(id);
  }
  const entityRequests = unscannedEntityRequests
    + Math.max(0, selectedIds.length - MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST);
  const requested = new Set(selectedIds.slice(0, MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST));
  const selected = retainedCandidates.filter((candidate) => requested.has(candidate.item.id));
  const missingEntities = requested.size - selected.length;
  const projectedRows: ComparisonLedgerRow[] = [];
  const projectedRowIds = new Set<string>();
  let totalRows = 0;
  let sourceRows = 0;
  let invalidRows = 0;
  let duplicateDetailRows = 0;
  for (const candidate of selected) {
    const projection = candidate.buildDetails();
    totalRows += projection.totalRows;
    sourceRows += projection.sourceOmittedRows;
    for (const rawRow of projection.rows) {
      const row = normaliseComparisonLedgerRowWithCounters(rawRow, built.counters);
      if (!row) {
        invalidRows += 1;
        continue;
      }
      if (projectedRowIds.has(row.id)) {
        duplicateDetailRows += 1;
        continue;
      }
      projectedRowIds.add(row.id);
      if (projectedRows.length < MAX_COMPARISON_LEDGER_DETAIL_ROWS) projectedRows.push(row);
    }
  }
  projectedRows.sort((left, right) => (
    left.entityId.localeCompare(right.entityId)
    || left.family.localeCompare(right.family)
    || left.field.localeCompare(right.field)
    || left.id.localeCompare(right.id)
  ));
  totalRows = Math.max(0, totalRows - duplicateDetailRows);
  const detailRows = Math.max(0, totalRows - projectedRows.length);
  const allLimitations = selected.flatMap((candidate) => candidate.item.limitations);
  const projectedLimitations = boundedComparisonLedgerLimitations(allLimitations, built.counters);
  const indexItems = Math.max(0, built.candidates.length - retainedCandidates.length);
  const omissions = Object.freeze({
    inputRecords: built.counters.inputRecords,
    inputScanTruncations: built.counters.inputScanTruncations,
    invalidRecords: built.counters.invalidRecords + invalidRows,
    duplicateRecords: built.counters.duplicateRecords,
    indexItems,
    entityRequests,
    duplicateEntityRequests,
    invalidEntityRequests,
    missingEntities,
    duplicateDetailRows,
    detailRows,
    sourceRows,
    limitations: built.counters.limitations,
    truncatedStrings: built.counters.truncatedStrings,
  });
  return Object.freeze({
    selectedItems: Object.freeze(selected.map((candidate) => candidate.item)),
    rows: Object.freeze(projectedRows),
    totalRows,
    limitations: projectedLimitations.values,
    omissions,
    truncated: Object.values(omissions).some((count) => count > 0)
      || selected.some((candidate) => candidate.item.truncated),
  });
}

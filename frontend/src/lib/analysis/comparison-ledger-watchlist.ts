import {
  MAX_WATCHLIST_INPUTS,
  MAX_WATCHLISTS,
  normalizeWatchlistName,
} from './watchlist-store.ts';
import {
  normalizeWatchlistEntry,
  watchlistFieldLabel,
  watchlistHistoryCategory,
  type WatchlistChange,
  type WatchlistHistoryEvent,
} from './watchlist-history.ts';
import {
  comparisonLedgerCollector,
  comparisonLedgerRecord,
  comparisonLedgerValuePresent,
  makeComparisonLedgerCandidate,
  stableComparisonLedgerId,
  type ComparisonLedgerCandidate,
  type ComparisonLedgerCompleteness,
  type ComparisonLedgerState,
  type MutableComparisonLedgerCounters,
  type RawComparisonLedgerProjection,
} from './comparison-ledger-contract.ts';

function watchlistCompleteness(event: WatchlistHistoryEvent): ComparisonLedgerCompleteness {
  if (event.resultCount <= 0) return 'unavailable';
  return watchlistSourceOmittedRows(event) > 0 || event.conclusiveCount < event.resultCount ? 'partial' : 'complete';
}

function watchlistSourceOmittedRows(event: WatchlistHistoryEvent): number {
  return Math.max(event.omittedChanges, event.changeCount - event.changes.length, 0);
}

function emptyInitialWatchlistEvent(event: WatchlistHistoryEvent): boolean {
  return event.mode === 'saved'
    && event.changeCount === 0
    && event.omittedChanges === 0
    && event.changes.length === 0;
}

function watchlistChangeState(
  change: WatchlistChange,
): ComparisonLedgerState {
  if (!comparisonLedgerValuePresent(change.before) && comparisonLedgerValuePresent(change.after)) return 'added';
  if (comparisonLedgerValuePresent(change.before) && !comparisonLedgerValuePresent(change.after)) {
    return 'incomplete';
  }
  return 'different';
}

function buildWatchlistRows(
  ownerId: string,
  entityId: string,
  event: WatchlistHistoryEvent,
): RawComparisonLedgerProjection {
  const output = comparisonLedgerCollector();
  const sourceOmittedRows = watchlistSourceOmittedRows(event);
  for (const change of event.changes) {
    const state = watchlistChangeState(change);
    output.add({
      comparisonId: ownerId,
      ownerId,
      entityId: change.domain,
      mode: 'temporal',
      state,
      field: watchlistFieldLabel(change.field),
      family: watchlistHistoryCategory(change.field) ?? 'other',
      earlier: {
        source: `Watchlist ${entityId} · last comparable baseline`,
        sourceState: 'retained',
        value: change.before,
      },
      later: {
        source: `Watchlist ${entityId} · ${event.mode} check`,
        sourceState: watchlistCompleteness(event),
        value: change.after,
        observedAt: event.checkedAt,
        retainedAt: event.checkedAt,
      },
      completeness: state === 'incomplete' ? 'not_reported' : watchlistCompleteness(event),
      truncated: sourceOmittedRows > 0,
      limitations: [
        'The earlier value is the last comparable retained baseline and may predate the immediately preceding watchlist check.',
        ...(state === 'incomplete'
          ? ['Watchlist history does not retain field-level completeness, so a missing later field is not represented as removal or resolution.']
          : []),
        ...(sourceOmittedRows > 0
          ? [`This retained event does not include ${sourceOmittedRows} declared bounded change row${sourceOmittedRows === 1 ? '' : 's'}.`]
          : []),
      ],
    });
  }
  if (!output.totalRows && event.changeCount === 0) {
    const completeness = watchlistCompleteness(event);
    output.add({
      comparisonId: ownerId,
      ownerId,
      entityId,
      mode: 'temporal',
      state: completeness === 'complete' ? 'equivalent' : 'incomplete',
      field: 'Comparable watchlist fields',
      family: 'summary',
      earlier: { source: `Watchlist ${entityId} · retained baseline`, sourceState: 'retained', value: 'No bounded material change' },
      later: { source: `Watchlist ${entityId} · ${event.mode} check`, sourceState: watchlistCompleteness(event), value: 'No bounded material change', observedAt: event.checkedAt, retainedAt: event.checkedAt },
      completeness,
      limitations: [completeness === 'complete'
        ? 'Equivalence applies only to the comparable fields retained by this bounded watchlist check.'
        : 'The later watchlist check is incomplete, so the absence of a retained change row is not represented as equivalence or resolution.'],
    });
  }
  return { rows: output.rows, totalRows: output.totalRows, sourceOmittedRows };
}

function boundedWatchlistEntries(
  source: Record<string, unknown>,
  counters: MutableComparisonLedgerCounters,
): Array<readonly [string, unknown]> {
  const scanned: Array<readonly [string, unknown]> = [];
  for (const name in source) {
    if (!Object.hasOwn(source, name)) continue;
    if (scanned.length >= MAX_WATCHLIST_INPUTS) {
      counters.inputScanTruncations += 1;
      break;
    }
    scanned.push([name, source[name]]);
  }
  counters.inputRecords += Math.max(0, scanned.length - MAX_WATCHLISTS);
  return scanned.slice(0, MAX_WATCHLISTS).sort(([left], [right]) => left.localeCompare(right));
}

export function buildWatchlistComparisonCandidates(
  raw: unknown,
  counters: MutableComparisonLedgerCounters,
): ComparisonLedgerCandidate[] {
  const source = comparisonLedgerRecord(raw) ?? {};
  const entries = boundedWatchlistEntries(source, counters);
  const candidates: ComparisonLedgerCandidate[] = [];
  const seenNames = new Set<string>();
  const seenEvents = new Set<string>();
  for (const [rawName, rawEntry] of entries) {
    const name = normalizeWatchlistName(rawName);
    if (!name || !comparisonLedgerRecord(rawEntry)) {
      counters.invalidRecords += 1;
      continue;
    }
    if (seenNames.has(name.toLowerCase())) {
      counters.duplicateRecords += 1;
      continue;
    }
    seenNames.add(name.toLowerCase());
    const entry = normalizeWatchlistEntry(rawEntry);
    for (let index = 0; index < entry.history.length; index += 1) {
      const event = entry.history[index];
      if (!event || (index === 0 && emptyInitialWatchlistEvent(event))) continue;
      const eventIdentity = [name.toLowerCase(), event.checkedAt, event.mode] as const;
      const ownerId = stableComparisonLedgerId('watchlist-event', eventIdentity);
      if (seenEvents.has(ownerId)) {
        counters.duplicateRecords += 1;
        continue;
      }
      seenEvents.add(ownerId);
      const sourceOmittedRows = watchlistSourceOmittedRows(event);
      const candidate = makeComparisonLedgerCandidate({
        idParts: eventIdentity,
        ownerType: 'watchlist',
        ownerId,
        entityId: name,
        label: `${name} · retained watchlist check`,
        mode: 'temporal',
        earlier: { source: `Watchlist ${name} · last comparable baseline`, sourceState: 'retained' },
        later: { source: `Watchlist ${name} · ${event.mode} check`, sourceState: watchlistCompleteness(event), observedAt: event.checkedAt, retainedAt: event.checkedAt },
        completeness: watchlistCompleteness(event),
        truncated: sourceOmittedRows > 0,
        limitations: [
          'Watchlist history retains bounded material changes rather than a complete copy of each prior result set.',
          'A before value can be carried from the last comparable scan, so no earlier per-field observation time is claimed.',
        ],
        sourceOmittedRows,
        ownerHref: `/monitor?view=watchlists&watchlist=${encodeURIComponent(name)}`,
        buildDetails: () => buildWatchlistRows(ownerId, name, event),
      }, counters);
      if (candidate) candidates.push(candidate);
      else counters.invalidRecords += 1;
    }
  }
  return candidates;
}

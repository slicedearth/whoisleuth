import { parseBoundedJson } from '../packages/analysis/bounded-json.mts';
import {
  applyCandidateWatchHandoff,
  planCandidateWatchHandoff,
  type CandidateWatchInput,
} from '../packages/workspace/candidate-watch-handoff.mts';
import {
  buildWatchlistExport,
  mergeWatchlistStores,
} from '../packages/workspace/watchlist-store.mts';
import { MAX_WATCHLIST_IMPORT_BYTES } from '../packages/contracts/workspace-portability.mts';
import { ordinaryWorkspaceRecord } from '../packages/workspace/hostile-input.mts';
import {
  CANDIDATE_WATCH_INPUT_SCHEMA,
  CANDIDATE_WATCH_INPUT_VERSION,
} from '../packages/contracts/candidate-watch-review.mts';

export function parseCandidateWatchInput(input: unknown) {
  const value =
    typeof input === 'string'
      ? parseBoundedJson(input, {
          maximumBytes: MAX_WATCHLIST_IMPORT_BYTES,
          label: 'Candidate watch selection',
        })
      : input;
  const raw = ordinaryWorkspaceRecord(value, 'Candidate watch selection');
  if (
    !raw ||
    raw.schema !== CANDIDATE_WATCH_INPUT_SCHEMA ||
    raw.version !== CANDIDATE_WATCH_INPUT_VERSION ||
    Object.keys(raw).some((key) => !['schema', 'version', 'watchlists', 'selection'].includes(key))
  )
    throw new TypeError(
      'Use candidate-watch-input schema 1 with watchlists and an explicit selection.',
    );
  const selection = ordinaryWorkspaceRecord(raw.selection, 'Candidate watch selection');
  if (
    !selection ||
    Object.keys(selection).some(
      (key) =>
        ![
          'name',
          'candidates',
          'brandProfileId',
          'priority',
          'reason',
          'reviewDueAt',
          'replaceExistingContext',
        ].includes(key),
    )
  )
    throw new TypeError('The candidate selection contains undeclared fields.');
  const local = raw.watchlists === null ? {} : mergeWatchlistStores({}, raw.watchlists).watchlists;
  planCandidateWatchHandoff(local, selection as unknown as CandidateWatchInput);
  return raw;
}
export function reviewCandidateWatchInput(
  input: string,
  operation: 'plan' | 'export',
  now: string,
) {
  const raw = parseCandidateWatchInput(input),
    selection = raw.selection as CandidateWatchInput;
  const local = raw.watchlists === null ? {} : mergeWatchlistStores({}, raw.watchlists).watchlists;
  if (operation === 'plan')
    return planCandidateWatchHandoff(local, selection as unknown as CandidateWatchInput);
  const result = applyCandidateWatchHandoff(
    local,
    selection as unknown as CandidateWatchInput,
    now,
  );
  return buildWatchlistExport(result.watchlists, now);
}

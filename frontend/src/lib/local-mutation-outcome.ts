import { BrowserLocalDataError } from './browser-local-data.ts';

export type LocalMutationOutcome = 'committed' | 'rejected' | 'unknown' | 'stale';
export type LocalMutationFailureOutcome = Extract<LocalMutationOutcome, 'rejected' | 'unknown'>;

export type LocalMutationBatchSummary = Readonly<{
  committed: number;
  rejected: number;
  unknown: number;
  stale: number;
}>;

export function failedLocalMutationOutcome(cause: unknown): LocalMutationFailureOutcome {
  return cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_COMMIT_UNKNOWN'
    ? 'unknown'
    : 'rejected';
}

export function clearsLocalMutationDraft(outcome: LocalMutationOutcome): boolean {
  return outcome === 'committed';
}

export function summarizeLocalMutationOutcomes(
  outcomes: readonly LocalMutationOutcome[],
): LocalMutationBatchSummary {
  const summary = { committed: 0, rejected: 0, unknown: 0, stale: 0 };
  for (const outcome of outcomes) summary[outcome] += 1;
  return summary;
}

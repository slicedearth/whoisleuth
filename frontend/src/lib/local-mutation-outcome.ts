import { BrowserLocalDataError } from './browser-local-data.ts';

export class LocalRecordConflictError extends Error {
  constructor(label: string) {
    super(`The ${label} changed or was deleted after it was opened. Reopen it to review the current record. Nothing was overwritten.`);
    this.name = 'LocalRecordConflictError';
  }
}

/** Compare a submitted, normalised record inside its existing write transaction. */
export function assertLocalRecordCurrent<Record extends { id: string }>(
  current: Record | null | undefined,
  expected: Readonly<Record> | null,
  label: string,
  fields?: readonly (keyof Record)[],
): void {
  if (!expected) return;
  const keys = fields ?? Object.keys({ ...expected, ...current }) as (keyof Record)[];
  if (!current || current.id !== expected.id
    || keys.some((key) => JSON.stringify(current[key]) !== JSON.stringify(expected[key]))) {
    throw new LocalRecordConflictError(label);
  }
}

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

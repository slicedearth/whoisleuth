import {
  buildBulkSessionExport,
  compareBulkSessions,
  deleteBulkSession as removeBulkSession,
  enforceBulkSessionStoreBudget,
  mergeBulkSessions,
  normalizeBulkSession,
  prepareBulkSessionSave,
  bulkSessionSavePreviewIsCurrent,
  type BulkSessionSavePreview,
  type BulkSession,
  type BulkSessionComparison,
} from './analysis/bulk-session-model.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { serialiseWorkspacePortableJsonLine } from '../../../packages/contracts/workspace-portability.mts';
import { downloadLocalFile } from './download-local-file.ts';
import { assertLocalRecordCurrent, LocalRecordConflictError } from './local-mutation-outcome.ts';

export type { BulkSessionSavePreview } from './analysis/bulk-session-model.ts';

export class BulkSessionCapacityError extends Error {
  constructor(readonly preview: BulkSessionSavePreview) {
    super('Review the saved sessions that would be removed before saving. Nothing was changed.');
    this.name = 'BulkSessionCapacityError';
  }
}

export type {
  BulkSession,
  BulkSessionComparison,
  BulkSessionMode,
  BulkSessionResult,
  BulkSessionSourceCoverage,
  BulkSessionSourceState,
} from './analysis/bulk-session-model.ts';

export async function loadBulkSessions(): Promise<BulkSession[]> {
  return readBrowserLocalData('bulk_sessions');
}

function boundedSessions(value: unknown): BulkSession[] {
  return enforceBulkSessionStoreBudget(value).store.sessions;
}

export async function saveBulkSession(
  input: unknown,
  options: { expected?: BulkSession | null; retention?: BulkSessionSavePreview } = {},
): Promise<{ session: BulkSession; added: boolean; pruned: number }> {
  const session = normalizeBulkSession(input);
  if (!session) throw new Error('The Bulk session is incomplete or invalid.');
  return updateBrowserLocalData('bulk_sessions', (current) => {
    const existing = current.find((value) => value.id === session.id);
    if (!options.expected && existing) throw new LocalRecordConflictError('Bulk session');
    assertLocalRecordCurrent(existing, options.expected ?? null, 'Bulk session');
    const result = prepareBulkSessionSave(current, session);
    if (result.removed.length && (!options.retention
      || !bulkSessionSavePreviewIsCurrent(current, options.retention)
      || JSON.stringify(result.session) !== JSON.stringify(options.retention.session))) {
      throw new BulkSessionCapacityError(result);
    }
    return {
      document: boundedSessions(result.sessions),
      result: { session: result.session, added: result.added, pruned: result.pruned },
    };
  });
}

export async function deleteBulkSession(id: string): Promise<BulkSession[]> {
  return updateBrowserLocalData('bulk_sessions', (current) => {
    const sessions = boundedSessions(removeBulkSession(current, id));
    return { document: sessions, result: sessions };
  });
}

export async function importBulkSessions(value: unknown) {
  return updateBrowserLocalData('bulk_sessions', (current) => {
    const result = mergeBulkSessions(current, value);
    return {
      document: boundedSessions(result.sessions),
      result: {
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        pruned: result.pruned,
      },
    };
  });
}

export async function exportBulkSessions(generatedAt = new Date().toISOString()) {
  const archive = buildBulkSessionExport(await loadBulkSessions(), generatedAt);
  const blob = new Blob([serialiseWorkspacePortableJsonLine(archive)], { type: 'application/json;charset=utf-8' });
  downloadLocalFile(blob, `whoisleuth-bulk-sessions-${generatedAt.slice(0, 10)}.json`);
}

export function compareSavedBulkSessions(
  baseline: BulkSession,
  current: BulkSession,
): BulkSessionComparison | null {
  return compareBulkSessions(baseline, current);
}

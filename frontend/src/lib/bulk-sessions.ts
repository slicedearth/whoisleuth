import {
  buildBulkSessionExport,
  compareBulkSessions,
  deleteBulkSession as removeBulkSession,
  enforceBulkSessionStoreBudget,
  mergeBulkSessions,
  normalizeBulkSession,
  upsertBulkSession,
  type BulkSession,
  type BulkSessionComparison,
} from './analysis/bulk-session-model.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';

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
): Promise<{ session: BulkSession; added: boolean; pruned: number }> {
  const session = normalizeBulkSession(input);
  if (!session) throw new Error('The Bulk session is incomplete or invalid.');
  return updateBrowserLocalData('bulk_sessions', (current) => {
    const result = upsertBulkSession(current, session);
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
  const blob = new Blob([`${JSON.stringify(archive, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-bulk-sessions-${generatedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function compareSavedBulkSessions(
  baseline: BulkSession,
  current: BulkSession,
): BulkSessionComparison | null {
  return compareBulkSessions(baseline, current);
}

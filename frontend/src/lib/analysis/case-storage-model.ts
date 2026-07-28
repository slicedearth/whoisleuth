import {
  CASE_SCHEMA_VERSION,
  MAX_CASE_STORE_BYTES,
  normalizeCaseStore,
  type CaseEvidenceSnapshot,
  type CaseRecord,
} from './case-record-model.ts';

/** The exact versioned string persisted by the browser storage adapter. */
export function serializeCaseStore(cases: CaseRecord[]): string {
  return JSON.stringify({ version: CASE_SCHEMA_VERSION, cases });
}

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}

function collectPrunableSnapshots(
  cases: CaseRecord[],
  allowLast: boolean,
): Array<{ index: number; snapshot: CaseEvidenceSnapshot; key: string }> {
  const items: Array<{
    index: number;
    snapshot: CaseEvidenceSnapshot;
    key: string;
  }> = [];
  for (let index = 0; index < cases.length; index++) {
    const record = cases[index];
    if (!record) continue;
    const history = record.evidenceHistory;
    const limit = history.length - (allowLast ? 0 : 1);
    for (let position = 0; position < limit; position++) {
      const snapshot = history[position];
      if (!snapshot) continue;
      items.push({
        index,
        snapshot,
        key: `${snapshot.capturedAt}|${record.domain}|${snapshot.fingerprint}`,
      });
    }
  }
  items.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  return items;
}

function pruneOldestSnapshots(
  cases: CaseRecord[],
  allowLast: boolean,
): number {
  let total = byteLength(serializeCaseStore(cases));
  if (total <= MAX_CASE_STORE_BYTES) return 0;
  let removed = 0;
  for (const item of collectPrunableSnapshots(cases, allowLast)) {
    if (total <= MAX_CASE_STORE_BYTES) break;
    const record = cases[item.index];
    if (!record) continue;
    cases[item.index] = {
      ...record,
      evidenceHistory: record.evidenceHistory.filter(
        (snapshot) => snapshot !== item.snapshot,
      ),
    };
    total -= byteLength(JSON.stringify(item.snapshot)) + 1;
    removed += 1;
  }
  while (byteLength(serializeCaseStore(cases)) > MAX_CASE_STORE_BYTES) {
    const item = collectPrunableSnapshots(cases, allowLast)[0];
    if (!item) break;
    const record = cases[item.index];
    if (!record) continue;
    cases[item.index] = {
      ...record,
      evidenceHistory: record.evidenceHistory.filter(
        (snapshot) => snapshot !== item.snapshot,
      ),
    };
    removed += 1;
  }
  return removed;
}

/**
 * Normalize the store and prune only evidence history until its serialized
 * representation fits. Analyst-authored notes, tags, and decisions are never
 * discarded to satisfy the byte budget.
 */
export function enforceStoreBudget(
  cases: CaseRecord[],
): { cases: CaseRecord[]; pruned: number } {
  const working = normalizeCaseStore(cases).cases;
  if (byteLength(serializeCaseStore(working)) <= MAX_CASE_STORE_BYTES) {
    return { cases: working, pruned: 0 };
  }
  let pruned = pruneOldestSnapshots(working, false);
  if (byteLength(serializeCaseStore(working)) > MAX_CASE_STORE_BYTES) {
    pruned += pruneOldestSnapshots(working, true);
  }
  if (byteLength(serializeCaseStore(working)) > MAX_CASE_STORE_BYTES) {
    throw new Error(
      'Could not save cases: your notes and tags exceed the browser storage budget. Export and remove some cases to free space.',
    );
  }
  return { cases: working, pruned };
}

export function buildCaseExport(
  cases: CaseRecord[],
  nowIso?: string,
): {
  version: typeof CASE_SCHEMA_VERSION;
  exportedAt: string;
  cases: CaseRecord[];
} {
  return {
    version: CASE_SCHEMA_VERSION,
    exportedAt: nowIso || new Date().toISOString(),
    cases: normalizeCaseStore(cases).cases,
  };
}

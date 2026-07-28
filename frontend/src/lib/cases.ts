// Browser-local analyst case store. All validation, normalization, bounding,
// merge, byte-budget, and export shaping live in analysis/case-model.ts (pure +
// unit tested); this wrapper owns asynchronous provider access and downloads.
// Cases never leave the browser and hold no raw registry responses - only a
// bounded, chronological history of evidence snapshots.
import {
  buildCaseExport,
  enforceStoreBudget,
  mergeCases,
  normalizeDomain,
  openOrCreateCase,
  updateCase,
} from './analysis/case-model.ts';
import type {
  CaseInput,
  CasePatch,
  CaseRecord,
} from './analysis/case-model.ts';
import { browserLocalDataProvider } from './browser-local-data-service.ts';
import { CASES_COLLECTION, LEGACY_CASES_KEY } from './browser-local-data-definitions.ts';

export {
  CASE_DISPOSITIONS,
  CASE_STATUSES,
  compareCaseEvidence,
  dispositionLabel,
  latestCaseEvidence,
  MAX_CASE_IMPORT_BYTES,
  sourceLabel,
  statusLabel,
} from './analysis/case-model.ts';
export {
  CASE_ACTION_STATES,
  CASE_ACTION_TYPES,
  CASE_PIN_COMPLETENESS,
} from './analysis/case-response-model.ts';
export type {
  CaseActionRecord,
  CaseDecisionRecord,
  CaseEvidencePin,
} from './analysis/case-response-model.ts';
export type {
  CaseEvidenceSnapshot,
  CaseInput,
  CaseNote,
  CasePatch,
  CaseRecord,
  EvidenceFactor,
} from './analysis/case-model.ts';

export const CASES_KEY = LEGACY_CASES_KEY;

export async function loadCases(): Promise<CaseRecord[]> {
  return (await browserLocalDataProvider()).read(CASES_COLLECTION);
}

// Persists a clean, bounded, budget-checked store. Enforces the serialized-size
// budget before writing (pruning oldest evidence snapshots if needed), refuses
// to downgrade data from a newer schema version, and surfaces a friendly error
// when storage is full or unavailable. Returns the persisted cases plus how many
// evidence snapshots were pruned to fit.
function boundedCases(cases: CaseRecord[]): { cases: CaseRecord[]; pruned: number } {
  return enforceStoreBudget(cases);
}

export async function getCase(id: string): Promise<CaseRecord | null> {
  return (await loadCases()).find((item) => item.id === id) || null;
}

export async function getCaseByDomain(domain: string): Promise<CaseRecord | null> {
  const target = normalizeDomain(domain);
  if (!target) return null;
  return (await loadCases()).find((item) => item.domain === target) || null;
}

// Mutations return the record as it exists in the persisted, budget-bounded
// store (never a pre-persist copy that might still hold evidence pruned to fit),
// plus how many snapshots were pruned so the UI can warn.
export async function openCase(input: CaseInput): Promise<{ record: CaseRecord; created: boolean; pruned: number }> {
  return (await browserLocalDataProvider()).update(CASES_COLLECTION, (current) => {
    const result = openOrCreateCase(current, input);
    if (!result.created) return { document: current, result: { record: result.record, created: false as boolean, pruned: 0 } };
    const { cases, pruned } = boundedCases(result.cases);
    const record = cases.find((item) => item.id === result.record.id) ?? result.record;
    return { document: cases, result: { record, created: true as boolean, pruned } };
  });
}

export async function editCase(id: string, patch: CasePatch): Promise<{ record: CaseRecord; pruned: number }> {
  return (await browserLocalDataProvider()).update(CASES_COLLECTION, (current) => {
    const result = updateCase(current, id, patch);
    const { cases, pruned } = boundedCases(result.cases);
    const record = cases.find((item) => item.id === id) ?? result.record;
    return { document: cases, result: { record, pruned } };
  });
}

export async function addCaseNote(id: string, body: string): Promise<{ record: CaseRecord; pruned: number }> {
  return editCase(id, { note: body });
}

export async function deleteCase(id: string): Promise<void> {
  await (await browserLocalDataProvider()).update(CASES_COLLECTION, (current) => ({
    document: current.filter((item) => item.id !== id),
    result: undefined,
  }));
}

export async function importCases(value: unknown): Promise<{ added: number; updated: number; skipped: number; pruned: number }> {
  return (await browserLocalDataProvider()).update(CASES_COLLECTION, (current) => {
    const result = mergeCases(current, value);
    const { cases, pruned } = boundedCases(result.cases);
    return {
      document: cases,
      result: { added: result.added, updated: result.updated, skipped: result.skipped, pruned },
    };
  });
}

export async function exportCases(): Promise<void> {
  const payload = buildCaseExport(await loadCases());
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-cases-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

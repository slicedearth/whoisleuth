// Browser-local analyst case store. All validation, normalization, bounding,
// merge, and export shaping live in analysis/case-model.js (pure + unit tested);
// this wrapper only owns localStorage access and safe failure. Cases never
// leave the browser and hold no raw registry responses - only a bounded
// evidence snapshot.
import {
  buildCaseExport,
  CASE_SCHEMA_VERSION,
  mergeCases,
  normalizeCaseStore,
  normalizeDomain,
  openOrCreateCase,
  updateCase,
} from './analysis/case-model.js';

export {
  CASE_DISPOSITIONS,
  CASE_STATUSES,
  dispositionLabel,
  MAX_CASE_IMPORT_BYTES,
  sourceLabel,
  statusLabel,
} from './analysis/case-model.js';

export const CASES_KEY = 'whois-rdap-cases-v1';

export interface CaseNote { id: string; body: string; createdAt: string }
export interface CaseEvidence { availability: string | null; riskScore: number | null; registrar: string | null; activityStatus: string | null; capturedAt: string }
export interface CaseRecord { id: string; domain: string; status: string; disposition: string; tags: string[]; notes: CaseNote[]; source: string; evidence: CaseEvidence | null; createdAt: string; updatedAt: string }
export interface CaseInput { domain: string; status?: string; disposition?: string; source?: string; tags?: string[]; evidence?: Partial<CaseEvidence> | null; note?: string }
export interface CasePatch { status?: string; disposition?: string; tags?: string[]; source?: string; evidence?: Partial<CaseEvidence> | null; note?: string }

// Never throws: a missing, unavailable, or malformed store degrades to no
// cases rather than breaking the page.
export function loadCases(): CaseRecord[] {
  try {
    const raw = localStorage.getItem(CASES_KEY);
    if (!raw) return [];
    return normalizeCaseStore(JSON.parse(raw)).cases as CaseRecord[];
  } catch {
    return [];
  }
}

// Persists a clean, bounded store. Surfaces a friendly error when storage is
// full or unavailable so callers can announce it through a status region.
function persist(cases: CaseRecord[]): CaseRecord[] {
  const store = normalizeCaseStore(cases);
  try {
    localStorage.setItem(CASES_KEY, JSON.stringify({ version: CASE_SCHEMA_VERSION, cases: store.cases }));
  } catch {
    throw new Error('Could not save cases. Browser storage may be full or unavailable.');
  }
  return store.cases as CaseRecord[];
}

export function getCase(id: string): CaseRecord | null {
  return loadCases().find((item) => item.id === id) || null;
}

export function getCaseByDomain(domain: string): CaseRecord | null {
  const target = normalizeDomain(domain);
  if (!target) return null;
  return loadCases().find((item) => item.domain === target) || null;
}

export function openCase(input: CaseInput): { record: CaseRecord; created: boolean } {
  const result = openOrCreateCase(loadCases(), input as never);
  if (result.created) persist(result.cases as CaseRecord[]);
  return { record: result.record as CaseRecord, created: result.created };
}

export function editCase(id: string, patch: CasePatch): CaseRecord {
  const result = updateCase(loadCases(), id, patch as never);
  persist(result.cases as CaseRecord[]);
  return result.record as CaseRecord;
}

export function addCaseNote(id: string, body: string): CaseRecord {
  return editCase(id, { note: body });
}

export function deleteCase(id: string): void {
  persist(loadCases().filter((item) => item.id !== id));
}

export function importCases(value: unknown): { added: number; updated: number; skipped: number } {
  const result = mergeCases(loadCases(), value);
  persist(result.cases as CaseRecord[]);
  return { added: result.added, updated: result.updated, skipped: result.skipped };
}

export function exportCases(): void {
  const payload = buildCaseExport(loadCases());
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-cases-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

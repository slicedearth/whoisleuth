// Browser-local analyst case store. All validation, normalization, bounding,
// merge, byte-budget, and export shaping live in analysis/case-model.js (pure +
// unit tested); this wrapper only owns localStorage access and safe failure.
// Cases never leave the browser and hold no raw registry responses - only a
// bounded, chronological history of evidence snapshots.
import {
  buildCaseExport,
  CASE_SCHEMA_VERSION,
  enforceStoreBudget,
  mergeCases,
  normalizeCaseStore,
  normalizeDomain,
  openOrCreateCase,
  parseStoreVersion,
  serializeCaseStore,
  updateCase,
} from './analysis/case-model.js';

export {
  CASE_DISPOSITIONS,
  CASE_STATUSES,
  compareCaseEvidence,
  dispositionLabel,
  latestCaseEvidence,
  MAX_CASE_IMPORT_BYTES,
  sourceLabel,
  statusLabel,
} from './analysis/case-model.js';

export const CASES_KEY = 'whois-rdap-cases-v1';

export interface CaseNote { id: string; body: string; createdAt: string }
export interface EvidenceFactor { label: string; points: number }
export interface CaseEvidenceSnapshot {
  id: string; fingerprint: string; firstCapturedAt: string; capturedAt: string; source: string; scanDepth: string;
  availability: string | null; confidence: string | null;
  riskModelVersion: number | null; riskScore: number | null; opportunityScore: number | null;
  riskFactors: EvidenceFactor[]; opportunityFactors: EvidenceFactor[];
  registrar: string | null; createdDate: string | null; expiryDate: string | null; nameservers: string[];
  hasMx: boolean | null; hasSpf: boolean | null; hasDmarc: boolean | null;
  activityStatus: string | null; websiteProbeDetail: string | null; pageTitle: string | null;
  httpSummaryVersion: number | null; httpEvidenceStatus: string | null; httpFinalOrigin: string | null; httpResponseStatus: number | null;
  httpTransportSecurity: string | null; httpRedirectCount: number | null;
  httpCrossOriginRedirect: boolean | null; httpHttpsDowngrade: boolean | null; httpContentType: string | null;
  httpSecurityHeaders: string[] | null;
  faviconMatch: boolean | null; faviconNearMatch: boolean | null; reusesOfficialAssets: boolean | null; hasPasswordField: boolean | null;
  phishingLanguageMatch: string | null;
  mutationTypes: string[];
}
export interface CaseRecord { id: string; domain: string; status: string; disposition: string; tags: string[]; notes: CaseNote[]; source: string; evidenceHistory: CaseEvidenceSnapshot[]; createdAt: string; updatedAt: string }
// Evidence input from Lookup/Bulk is a loose bag of result fields; the model's
// snapshot normalizer keeps only the bounded, known ones.
export interface CaseInput { domain: string; status?: string; disposition?: string; source?: string; tags?: string[]; evidence?: Record<string, unknown> | null; note?: string }
export interface CasePatch { status?: string; disposition?: string; tags?: string[]; source?: string; evidence?: Record<string, unknown> | null; note?: string }

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

// The schema version currently on disk, or null. Used to refuse overwriting a
// store written by a newer, unsupported version of the app.
function storedVersion(): number | null {
  try {
    const raw = localStorage.getItem(CASES_KEY);
    return raw ? parseStoreVersion(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// Persists a clean, bounded, budget-checked store. Enforces the serialized-size
// budget before writing (pruning oldest evidence snapshots if needed), refuses
// to downgrade data from a newer schema version, and surfaces a friendly error
// when storage is full or unavailable. Returns the persisted cases plus how many
// evidence snapshots were pruned to fit.
function persist(cases: CaseRecord[]): { cases: CaseRecord[]; pruned: number } {
  const existing = storedVersion();
  if (existing !== null && existing > CASE_SCHEMA_VERSION) {
    throw new Error('These cases were created by a newer version of WHOISleuth. Update the app before saving so newer data is not overwritten.');
  }
  const { cases: bounded, pruned } = enforceStoreBudget(cases);
  try {
    localStorage.setItem(CASES_KEY, serializeCaseStore(bounded));
  } catch {
    throw new Error('Could not save cases. Browser storage may be full or unavailable.');
  }
  return { cases: bounded as CaseRecord[], pruned };
}

export function getCase(id: string): CaseRecord | null {
  return loadCases().find((item) => item.id === id) || null;
}

export function getCaseByDomain(domain: string): CaseRecord | null {
  const target = normalizeDomain(domain);
  if (!target) return null;
  return loadCases().find((item) => item.domain === target) || null;
}

// Mutations return the record as it exists in the persisted, budget-bounded
// store (never a pre-persist copy that might still hold evidence pruned to fit),
// plus how many snapshots were pruned so the UI can warn.
export function openCase(input: CaseInput): { record: CaseRecord; created: boolean; pruned: number } {
  const result = openOrCreateCase(loadCases(), input as never);
  if (!result.created) return { record: result.record as CaseRecord, created: false, pruned: 0 };
  const { cases, pruned } = persist(result.cases as CaseRecord[]);
  const record = cases.find((item) => item.id === (result.record as CaseRecord).id) ?? (result.record as CaseRecord);
  return { record, created: true, pruned };
}

export function editCase(id: string, patch: CasePatch): { record: CaseRecord; pruned: number } {
  const result = updateCase(loadCases(), id, patch as never);
  const { cases, pruned } = persist(result.cases as CaseRecord[]);
  const record = cases.find((item) => item.id === id) ?? (result.record as CaseRecord);
  return { record, pruned };
}

export function addCaseNote(id: string, body: string): { record: CaseRecord; pruned: number } {
  return editCase(id, { note: body });
}

export function deleteCase(id: string): void {
  persist(loadCases().filter((item) => item.id !== id));
}

export function importCases(value: unknown): { added: number; updated: number; skipped: number; pruned: number } {
  const result = mergeCases(loadCases(), value);
  const { pruned } = persist(result.cases as CaseRecord[]);
  return { added: result.added, updated: result.updated, skipped: result.skipped, pruned };
}

export function exportCases(): void {
  const existing = storedVersion();
  if (existing !== null && existing > CASE_SCHEMA_VERSION) {
    throw new Error('These cases were created by a newer version of WHOISleuth. Update the app before exporting so the backup is not a misleading downgrade.');
  }
  const payload = buildCaseExport(loadCases());
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-cases-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

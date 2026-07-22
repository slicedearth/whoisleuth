// Browser-local analyst case store. All validation, normalization, bounding,
// merge, byte-budget, and export shaping live in analysis/case-model.js (pure +
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
} from './analysis/case-model.js';
import { browserLocalDataProvider } from './browser-local-data-service.js';
import { CASES_COLLECTION, LEGACY_CASES_KEY } from './browser-local-data-definitions.js';

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

export const CASES_KEY = LEGACY_CASES_KEY;

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

export async function loadCases(): Promise<CaseRecord[]> {
  return (await browserLocalDataProvider()).read(CASES_COLLECTION) as Promise<CaseRecord[]>;
}

// Persists a clean, bounded, budget-checked store. Enforces the serialized-size
// budget before writing (pruning oldest evidence snapshots if needed), refuses
// to downgrade data from a newer schema version, and surfaces a friendly error
// when storage is full or unavailable. Returns the persisted cases plus how many
// evidence snapshots were pruned to fit.
function boundedCases(cases: CaseRecord[]): { cases: CaseRecord[]; pruned: number } {
  const { cases: bounded, pruned } = enforceStoreBudget(cases);
  return { cases: bounded as CaseRecord[], pruned };
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
    const result = openOrCreateCase(current, input as never);
    if (!result.created) return { document: current, result: { record: result.record as CaseRecord, created: false as boolean, pruned: 0 } };
    const { cases, pruned } = boundedCases(result.cases as CaseRecord[]);
    const record = cases.find((item) => item.id === (result.record as CaseRecord).id) ?? (result.record as CaseRecord);
    return { document: cases, result: { record, created: true as boolean, pruned } };
  });
}

export async function editCase(id: string, patch: CasePatch): Promise<{ record: CaseRecord; pruned: number }> {
  return (await browserLocalDataProvider()).update(CASES_COLLECTION, (current) => {
    const result = updateCase(current, id, patch as never);
    const { cases, pruned } = boundedCases(result.cases as CaseRecord[]);
    const record = cases.find((item) => item.id === id) ?? (result.record as CaseRecord);
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
    const { cases, pruned } = boundedCases(result.cases as CaseRecord[]);
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

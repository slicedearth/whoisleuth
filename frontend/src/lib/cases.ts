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
import {
  mergeExternalFindingsIntoCases,
  parseExternalFindingsDocument,
  type ExternalFindingsDocument,
} from './analysis/external-findings-import.ts';
import {
  mergeExternalIntelligenceIntoCase,
  type ExternalIntelligencePreview,
} from './analysis/external-intelligence-import.ts';
import { buildRiskCalibrationDatasetExport } from './analysis/risk-calibration-export.ts';

export type RiskCalibrationExportPreview = Readonly<{
  selected: number;
  included: number;
  excluded: number;
  records: readonly Readonly<{
    domain: string;
    analystDisposition: string;
  }>[];
}>;

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
  CASE_ASSERTION_KINDS,
  CASE_ASSERTION_STATES,
  CASE_MANUAL_TRAIL_KINDS,
  CASE_PIN_COMPLETENESS,
} from './analysis/case-response-model.ts';
export {
  EXTERNAL_FINDING_CATEGORIES,
  EXTERNAL_FINDINGS_SCHEMA,
  EXTERNAL_FINDINGS_VERSION,
  MAX_EXTERNAL_FINDINGS,
  MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
  parseExternalFindingsDocument,
} from './analysis/external-findings-import.ts';
export {
  MAX_EXTERNAL_INTELLIGENCE_IMPORT_BYTES,
  parseExternalIntelligenceDocument,
} from './analysis/external-intelligence-import.ts';
export type {
  CaseActionRecord,
  CaseAssertionExternalProvenance,
  CaseAssertionRecord,
  CaseDecisionRecord,
  CaseEvidencePin,
  CaseManualTrailEvent,
  CaseTransitionExpectation,
} from './analysis/case-response-model.ts';
export type {
  CaseEvidenceSnapshot,
  CaseInput,
  CaseNote,
  CasePatch,
  CaseRecord,
  EvidenceFactor,
} from './analysis/case-model.ts';
export type {
  ExternalFinding,
  ExternalFindingsDocument,
  ExternalFindingsMergeResult,
} from './analysis/external-findings-import.ts';
export type {
  ExternalIntelligenceItem,
  ExternalIntelligenceMergeResult,
  ExternalIntelligencePreview,
} from './analysis/external-intelligence-import.ts';

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

export async function importExternalFindings(
  value: unknown,
): Promise<{
  casesCreated: number;
  casesUpdated: number;
  findingsAdded: number;
  duplicatesSkipped: number;
  pruned: number;
}> {
  const document: ExternalFindingsDocument = parseExternalFindingsDocument(value);
  return (await browserLocalDataProvider()).update(CASES_COLLECTION, (current) => {
    const merged = mergeExternalFindingsIntoCases(current, document);
    const { cases, pruned } = boundedCases(merged.cases);
    return {
      document: cases,
      result: {
        casesCreated: merged.casesCreated,
        casesUpdated: merged.casesUpdated,
        findingsAdded: merged.findingsAdded,
        duplicatesSkipped: merged.duplicatesSkipped,
        pruned,
      },
    };
  });
}

export async function importExternalIntelligence(
  caseId: string,
  preview: ExternalIntelligencePreview,
): Promise<{
  record: CaseRecord;
  assertionsAdded: number;
  duplicatesSkipped: number;
  capacitySkipped: number;
  pruned: number;
}> {
  return (await browserLocalDataProvider()).update(CASES_COLLECTION, (current) => {
    const merged = mergeExternalIntelligenceIntoCase(current, caseId, preview);
    const { cases, pruned } = boundedCases(merged.cases);
    const record = cases.find((item) => item.id === merged.record.id) ?? merged.record;
    return {
      document: cases,
      result: {
        record,
        assertionsAdded: merged.assertionsAdded,
        duplicatesSkipped: merged.duplicatesSkipped,
        capacitySkipped: merged.capacitySkipped,
        pruned,
      },
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

export async function exportRiskCalibrationDataset(
  selectedCaseIds: readonly string[],
): Promise<{ included: number; excluded: number }> {
  if (!selectedCaseIds.length) throw new Error('Select at least one reviewed case for calibration export.');
  const payload = buildRiskCalibrationDatasetExport(await loadCases(), selectedCaseIds);
  if (!payload.records.length) {
    throw new Error('The selected cases do not contain reviewed dispositions with compatible retained evidence.');
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-risk-calibration-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  return { included: payload.records.length, excluded: payload.export.excluded };
}

export async function previewRiskCalibrationDataset(
  selectedCaseIds: readonly string[],
): Promise<RiskCalibrationExportPreview> {
  if (!selectedCaseIds.length) {
    throw new Error('Select at least one reviewed case for calibration export.');
  }
  const payload = buildRiskCalibrationDatasetExport(await loadCases(), selectedCaseIds);
  if (!payload.records.length) {
    throw new Error('The selected cases do not contain reviewed dispositions with compatible retained evidence.');
  }
  return Object.freeze({
    selected: payload.export.selected,
    included: payload.records.length,
    excluded: payload.export.excluded,
    records: Object.freeze(payload.records.map((record) => Object.freeze({
      domain: record.domain,
      analystDisposition: record.analystDisposition,
    }))),
  });
}

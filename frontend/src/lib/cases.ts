// Browser-local analyst case store. All validation, normalization, bounding,
// merge, byte-budget, and export shaping live in analysis/case-model.ts (pure +
// unit tested); this wrapper owns asynchronous provider access and downloads.
// Cases never leave the browser and hold no raw registry responses - only a
// bounded, chronological history of evidence snapshots.
import {
  buildCaseExport,
  addCaseBrandProfileId,
  enforceStoreBudget,
  mergeCases,
  normalizeDomain,
  openOrCreateCase,
  recordCaseConclusion as recordCaseConclusionModel,
  recordCaseInvestigationContext as recordCaseInvestigationContextModel,
  recordCaseRecheckOutcome as recordCaseRecheckOutcomeModel,
  removeCaseBrandProfileId,
  updateCase,
} from './analysis/case-model.ts';
import type {
  CaseInput,
  CaseConclusionInput,
  CasePatch,
  CaseRecord,
} from './analysis/case-model.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { LEGACY_CASES_KEY } from './browser-local-data-contract.ts';
import {
  mergeExternalFindingsIntoCase,
  mergeExternalFindingsIntoCases,
  parseExternalFindingsDocument,
  type ExternalFindingsDocument,
} from './analysis/external-findings-import.ts';
import {
  mergeExternalIntelligenceIntoCase,
  type ExternalIntelligencePreview,
} from './analysis/external-intelligence-import.ts';
import {
  buildRiskCalibrationDatasetExport,
  serializeRiskCalibrationDatasetExport,
} from './analysis/risk-calibration-export.ts';

export type RiskCalibrationExportPreview = Readonly<{
  selected: number;
  included: number;
  excluded: number;
  records: readonly Readonly<{
    domain: string;
    analystDisposition: string;
    reviewReasonCode: string | null;
  }>[];
}>;

export {
  CASE_DISPOSITIONS,
  CASE_REVIEW_REASONS,
  CASE_STATUSES,
  caseLookupTarget,
  compareCaseEvidence,
  dispositionLabel,
  latestCaseEvidence,
  MAX_CASE_IMPORT_BYTES,
  MAX_CASE_BRAND_PROFILE_IDS,
  caseInvestigationContext,
  parseIncidentUrlContext,
  sourceLabel,
  statusLabel,
} from './analysis/case-model.ts';
export {
  CASE_TYPES,
  caseFreeformTags,
  caseIncidentTargetAssertion,
  caseIncidentTargets,
  caseNumber,
  caseResponseIncidentUrls,
  caseTagsWithTypes,
  caseTypeIds,
  caseTypeRecords,
  caseTypeSummary,
  formattedCaseNumber,
  MAX_CASE_INCIDENT_TARGETS,
} from '../../../packages/cases/case-workflow-metadata.mts';
export {
  CASE_ACTION_STATES,
  CASE_ACTION_TYPES,
  CASE_ACTION_EVENT_SOURCE_CLASSES,
  CASE_ASSERTION_KINDS,
  CASE_ASSERTION_STATES,
  CASE_EVIDENCE_RELATION_STANCES,
  CASE_MANUAL_TRAIL_KINDS,
  CASE_CLOSURE_REASONS,
  CASE_OBSERVED_EFFECT_SOURCE_CLASSES,
  CASE_OBSERVED_EFFECT_STATES,
  CASE_PIN_COMPLETENESS,
  CASE_PROVIDER_OUTCOMES,
  CASE_SIGHTING_CATEGORIES,
  CASE_SIGHTING_STATES,
} from './analysis/case-response-model.ts';
export {
  CASE_INVESTIGATION_BRANCH_STATES,
  MAX_CASE_INVESTIGATION_BRANCHES,
} from './analysis/case-investigation-branch-model.ts';
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
  CaseActionState,
  CaseActionTransitionEvent,
  CaseAssertionExternalProvenance,
  CaseAssertionRecord,
  CaseEvidenceRelationStance,
  CaseDecisionRecord,
  CaseEvidencePin,
  CaseClosureHistory,
  CaseClosureRecord,
  CaseManualTrailEvent,
  CaseObservedEffectHistory,
  CaseObservedEffectReview,
  CaseSightingRecord,
  CaseTransitionExpectation,
} from './analysis/case-response-model.ts';
export type {
  CaseInvestigationBranch,
  CaseInvestigationBranchState,
} from './analysis/case-investigation-branch-model.ts';
export type {
  CaseConclusionEvidence,
  CaseConclusionInput,
  CaseInvestigationContext,
  CaseEvidenceSnapshot,
  CaseInput,
  CaseNote,
  CasePatch,
  CaseRecord,
  EvidenceChange,
  EvidenceFactor,
} from './analysis/case-model.ts';
export type {
  CaseIncidentTarget,
  CaseTypeId,
} from '../../../packages/cases/case-workflow-metadata.mts';
export type {
  ExternalFinding,
  ExternalFindingsCaseMergeResult,
  ExternalFindingsDocument,
  ExternalFindingsMergeResult,
} from './analysis/external-findings-import.ts';
export type {
  ExternalIntelligenceItem,
  ExternalIntelligenceMergeResult,
  ExternalIntelligencePreview,
} from './analysis/external-intelligence-import.ts';

export const CASES_KEY = LEGACY_CASES_KEY;
export const MAX_CASE_BATCH_MUTATIONS = 100;

export async function loadCases(): Promise<CaseRecord[]> {
  return readBrowserLocalData('cases');
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
export async function openCase(input: CaseInput): Promise<{ record: CaseRecord; cases: CaseRecord[]; created: boolean; pruned: number }> {
  return updateBrowserLocalData('cases', (current) => {
    const result = openOrCreateCase(current, input);
    if (!result.created) return {
      document: current,
      result: { record: result.record, cases: current, created: false as boolean, pruned: 0 },
    };
    const { cases, pruned } = boundedCases(result.cases);
    const record = cases.find((item) => item.id === result.record.id) ?? result.record;
    return { document: cases, result: { record, cases, created: true as boolean, pruned } };
  });
}

export async function editCase(id: string, patch: CasePatch): Promise<{ record: CaseRecord; cases: CaseRecord[]; pruned: number }> {
  return updateBrowserLocalData('cases', (current) => {
    const result = updateCase(current, id, patch);
    const { cases, pruned } = boundedCases(result.cases);
    const record = cases.find((item) => item.id === id) ?? result.record;
    return { document: cases, result: { record, cases, pruned } };
  });
}

export async function recordCaseConclusion(
  id: string,
  input: CaseConclusionInput,
): Promise<{ record: CaseRecord; cases: CaseRecord[]; pruned: number }> {
  return updateBrowserLocalData('cases', (current) => {
    const result = recordCaseConclusionModel(current, id, input);
    const { cases, pruned } = boundedCases(result.cases);
    const record = cases.find((item) => item.id === id) ?? result.record;
    return { document: cases, result: { record, cases, pruned } };
  });
}

export async function recordCaseInvestigationContext(
  id: string,
  input: Readonly<{ objective: string; incidentUrl: string; retainExactUrl: boolean }>,
): Promise<{ record: CaseRecord; cases: CaseRecord[]; pruned: number }> {
  return updateBrowserLocalData('cases', (current) => {
    const result = recordCaseInvestigationContextModel(current, id, input);
    const { cases, pruned } = boundedCases(result.cases);
    const record = cases.find((item) => item.id === id) ?? result.record;
    return { document: cases, result: { record, cases, pruned } };
  });
}

export async function recordCaseRecheckOutcome(
  id: string,
  input: Parameters<typeof recordCaseRecheckOutcomeModel>[2],
): Promise<{ record: CaseRecord; cases: CaseRecord[]; pruned: number }> {
  return updateBrowserLocalData('cases', (current) => {
    const result = recordCaseRecheckOutcomeModel(current, id, input);
    const { cases, pruned } = boundedCases(result.cases);
    const record = cases.find((item) => item.id === id) ?? result.record;
    return { document: cases, result: { record, cases, pruned } };
  });
}

export async function setCaseDispositions(
  ids: readonly string[],
  disposition: string,
): Promise<{ cases: CaseRecord[]; changed: number; pruned: number }> {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_CASE_BATCH_MUTATIONS) {
    throw new Error(`A Case disposition batch must contain between 1 and ${MAX_CASE_BATCH_MUTATIONS} records.`);
  }
  if (ids.some((id) => typeof id !== 'string' || !id || id.length > 160 || /[\u0000-\u001f\u007f]/u.test(id))) {
    throw new Error('A Case disposition batch contains an invalid record identifier.');
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('A Case disposition batch must use unique record identifiers.');
  }

  return updateBrowserLocalData('cases', (current) => {
    let next = current;
    for (const id of ids) next = updateCase(next, id, { disposition }).cases;
    const { cases, pruned } = boundedCases(next);
    return {
      document: cases,
      result: { cases, changed: ids.length, pruned },
    };
  });
}

async function updateCaseBrandProfileAssociation(
  id: string,
  profileId: string,
  operation: 'add' | 'remove',
): Promise<{ record: CaseRecord; cases: CaseRecord[]; pruned: number }> {
  return updateBrowserLocalData('cases', (current) => {
    const record = current.find((item) => item.id === id);
    if (!record) throw new Error('Case not found.');
    const brandProfileIds = operation === 'add'
      ? addCaseBrandProfileId(record.brandProfileIds, profileId)
      : removeCaseBrandProfileId(record.brandProfileIds, profileId);
    const unchanged = brandProfileIds.length === record.brandProfileIds.length
      && brandProfileIds.every((item, index) => item === record.brandProfileIds[index]);
    const result = unchanged
      ? { cases: current, record }
      : updateCase(current, id, { brandProfileIds });
    const { cases, pruned } = boundedCases(result.cases);
    const persisted = cases.find((item) => item.id === id) ?? result.record;
    return { document: cases, result: { record: persisted, cases, pruned } };
  });
}

/** Retry-safe browser-local association intent; each provider retry rereads the case. */
export function addCaseBrandProfileAssociation(
  id: string,
  profileId: string,
): Promise<{ record: CaseRecord; cases: CaseRecord[]; pruned: number }> {
  return updateCaseBrandProfileAssociation(id, profileId, 'add');
}

/** Retry-safe browser-local removal intent that preserves concurrent unrelated adds. */
export function removeCaseBrandProfileAssociation(
  id: string,
  profileId: string,
): Promise<{ record: CaseRecord; cases: CaseRecord[]; pruned: number }> {
  return updateCaseBrandProfileAssociation(id, profileId, 'remove');
}

export async function addCaseNote(id: string, body: string): Promise<{ record: CaseRecord; cases: CaseRecord[]; pruned: number }> {
  return editCase(id, { note: body });
}

export async function deleteCase(id: string): Promise<{ cases: CaseRecord[]; deleted: boolean }> {
  return updateBrowserLocalData('cases', (current) => {
    const cases = current.filter((item) => item.id !== id);
    return {
      document: cases,
      result: { cases, deleted: cases.length !== current.length },
    };
  });
}

export async function importCases(value: unknown): Promise<{ cases: CaseRecord[]; added: number; updated: number; skipped: number; brandProfileReferencesOmitted: number; pruned: number }> {
  return updateBrowserLocalData('cases', (current) => {
    const result = mergeCases(current, value);
    const { cases, pruned } = boundedCases(result.cases);
    return {
      document: cases,
      result: {
        cases,
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        brandProfileReferencesOmitted: result.brandProfileReferencesOmitted,
        pruned,
      },
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
  cases: CaseRecord[];
  pruned: number;
}> {
  const document: ExternalFindingsDocument = parseExternalFindingsDocument(value);
  return updateBrowserLocalData('cases', (current) => {
    const merged = mergeExternalFindingsIntoCases(current, document);
    const { cases, pruned } = boundedCases(merged.cases);
    return {
      document: cases,
      result: {
        cases,
        casesCreated: merged.casesCreated,
        casesUpdated: merged.casesUpdated,
        findingsAdded: merged.findingsAdded,
        duplicatesSkipped: merged.duplicatesSkipped,
        pruned,
      },
    };
  });
}

export async function importExternalFindingsIntoCase(
  caseId: string,
  document: ExternalFindingsDocument,
): Promise<{
  record: CaseRecord;
  findingsAdded: number;
  duplicatesSkipped: number;
  cases: CaseRecord[];
  pruned: number;
}> {
  return updateBrowserLocalData('cases', (current) => {
    const merged = mergeExternalFindingsIntoCase(current, caseId, document);
    const { cases, pruned } = boundedCases(merged.cases);
    const record = cases.find((item) => item.id === caseId) ?? merged.record;
    return {
      document: cases,
      result: {
        record,
        cases,
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
  cases: CaseRecord[];
  pruned: number;
}> {
  return updateBrowserLocalData('cases', (current) => {
    const merged = mergeExternalIntelligenceIntoCase(current, caseId, preview);
    const { cases, pruned } = boundedCases(merged.cases);
    const record = cases.find((item) => item.id === merged.record.id) ?? merged.record;
    return {
      document: cases,
      result: {
        record,
        cases,
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
  const blob = new Blob([serializeRiskCalibrationDatasetExport(payload)], {
    type: 'application/json;charset=utf-8',
  });
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
      reviewReasonCode: record.reviewReasonCode ?? null,
    }))),
  });
}

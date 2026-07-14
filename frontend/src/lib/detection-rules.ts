// Browser-only custom-rule persistence. The pure model owns every validation,
// evaluation, import/export, collection bound, and byte-budget decision.
import {
  buildDetectionRuleExport,
  createDetectionRule as createRule,
  DETECTION_RULE_SCHEMA_VERSION,
  detectionRuleStoreVersion,
  evaluateDetectionRules,
  evaluateRuleSet,
  mergeDetectionRules,
  normalizeDetectionRuleStore,
  RULE_FIELD_DEFINITIONS,
  serializeDetectionRuleStore,
  updateDetectionRule as updateRule,
} from './analysis/detection-rule-model.js';

export {
  MAX_RULE_IMPORT_BYTES,
  MAX_RULE_CONDITIONS,
  MAX_RULE_NAME_LENGTH,
  MAX_RULE_RISK_DELTA,
  MAX_RULE_TAG_LENGTH,
  operatorsForRuleField,
  RULE_FIELD_DEFINITIONS,
} from './analysis/detection-rule-model.js';

export const DETECTION_RULES_KEY = 'whoisleuth-detection-rules-v1';

export interface DetectionRuleCondition { field: string; operator: string; value: string | number | boolean }
export interface DetectionRule { id: string; name: string; enabled: boolean; match: 'all' | 'any'; conditions: DetectionRuleCondition[]; riskDelta: number; tag: string }
export interface DetectionRuleMatch { id: string; name: string; riskDelta: number; appliedDelta: number; tag: string }
export interface DetectionRuleEvaluation { caseId: string; domain: string; builtInRiskScore: number | null; customRiskDelta: number; contextualRiskScore: number | null; matchedRules: DetectionRuleMatch[]; suggestedTags: string[] }

function readRaw(): unknown {
  const raw = localStorage.getItem(DETECTION_RULES_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function loadDetectionRules(): DetectionRule[] {
  try { return normalizeDetectionRuleStore(readRaw()).rules as DetectionRule[]; }
  catch { return []; }
}

function persist(rules: DetectionRule[]): DetectionRule[] {
  let version: number | null = null;
  try { version = detectionRuleStoreVersion(readRaw()); } catch { /* corrupt data can be replaced */ }
  if (version !== null && version > DETECTION_RULE_SCHEMA_VERSION) {
    throw new Error('Custom rules were created by a newer app version. Update the app before saving.');
  }
  const serialized = serializeDetectionRuleStore(rules);
  try { localStorage.setItem(DETECTION_RULES_KEY, serialized); }
  catch { throw new Error('Could not save custom rules. Browser storage may be full or unavailable.'); }
  return normalizeDetectionRuleStore(rules).rules as DetectionRule[];
}

export function createDetectionRule(input: Omit<DetectionRule, 'id'>): DetectionRule[] {
  return persist(createRule(loadDetectionRules(), input).rules as DetectionRule[]);
}

export function editDetectionRule(id: string, patch: Partial<Omit<DetectionRule, 'id'>>): DetectionRule[] {
  return persist(updateRule(loadDetectionRules(), id, patch) as DetectionRule[]);
}

export function deleteDetectionRule(id: string): DetectionRule[] {
  return persist(loadDetectionRules().filter((rule) => rule.id !== id));
}

export function importDetectionRules(raw: unknown): { rules: DetectionRule[]; added: number; updated: number; skipped: number } {
  const result = mergeDetectionRules(loadDetectionRules(), raw);
  return { rules: persist(result.rules as DetectionRule[]), added: result.added, updated: result.updated, skipped: result.skipped };
}

export function exportDetectionRules(): void {
  let version: number | null = null;
  try { version = detectionRuleStoreVersion(readRaw()); } catch { /* export normalized recovery */ }
  if (version !== null && version > DETECTION_RULE_SCHEMA_VERSION) {
    throw new Error('Custom rules were created by a newer app version. Update the app before exporting.');
  }
  const blob = new Blob([JSON.stringify(buildDetectionRuleExport(loadDetectionRules()), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-custom-rules-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function evaluateCaseRules(record: unknown, rules = loadDetectionRules()): DetectionRuleEvaluation {
  return evaluateDetectionRules(record, rules) as DetectionRuleEvaluation;
}

export function evaluateCasesAgainstRules(records: unknown[], rules = loadDetectionRules()): DetectionRuleEvaluation[] {
  return evaluateRuleSet(records, rules) as DetectionRuleEvaluation[];
}

export function ruleFieldDefinition(field: string) {
  return RULE_FIELD_DEFINITIONS.find((item: { value: string }) => item.value === field) ?? null;
}

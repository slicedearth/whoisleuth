// Browser-only custom-rule persistence. The pure model owns every validation,
// evaluation, import/export, collection bound, and byte-budget decision.
import {
  buildDetectionRuleExport,
  createDetectionRule as createRule,
  evaluateDetectionRules,
  evaluateRuleSet,
  mergeDetectionRules,
  RULE_FIELD_DEFINITIONS,
  serializeDetectionRuleStore,
  updateDetectionRule as updateRule,
} from './analysis/detection-rule-model.js';
import { browserLocalDataProvider } from './browser-local-data-service.js';
import { DETECTION_RULES_COLLECTION, LEGACY_DETECTION_RULES_KEY } from './browser-local-data-definitions.js';

export {
  MAX_RULE_IMPORT_BYTES,
  MAX_RULE_CONDITIONS,
  MAX_RULE_NAME_LENGTH,
  MAX_RULE_RISK_DELTA,
  MAX_RULE_TAG_LENGTH,
  operatorsForRuleField,
  RULE_FIELD_DEFINITIONS,
} from './analysis/detection-rule-model.js';

export const DETECTION_RULES_KEY = LEGACY_DETECTION_RULES_KEY;

export interface DetectionRuleCondition { field: string; operator: string; value: string | number | boolean }
export interface DetectionRule { id: string; name: string; enabled: boolean; match: 'all' | 'any'; conditions: DetectionRuleCondition[]; riskDelta: number; tag: string }
export interface DetectionRuleMatch { id: string; name: string; riskDelta: number; appliedDelta: number; tag: string }
export interface DetectionRuleEvaluation { caseId: string; domain: string; builtInRiskScore: number | null; customRiskDelta: number; contextualRiskScore: number | null; matchedRules: DetectionRuleMatch[]; suggestedTags: string[] }

export async function loadDetectionRules(): Promise<DetectionRule[]> {
  return (await browserLocalDataProvider()).read(DETECTION_RULES_COLLECTION) as Promise<DetectionRule[]>;
}

function boundedRules(rules: DetectionRule[]): DetectionRule[] {
  return JSON.parse(serializeDetectionRuleStore(rules)).rules as DetectionRule[];
}

export async function createDetectionRule(input: Omit<DetectionRule, 'id'>): Promise<DetectionRule[]> {
  return (await browserLocalDataProvider()).update(DETECTION_RULES_COLLECTION, (current) => {
    const rules = boundedRules(createRule(current, input).rules as DetectionRule[]);
    return { document: rules, result: rules };
  });
}

export async function editDetectionRule(id: string, patch: Partial<Omit<DetectionRule, 'id'>>): Promise<DetectionRule[]> {
  return (await browserLocalDataProvider()).update(DETECTION_RULES_COLLECTION, (current) => {
    const rules = boundedRules(updateRule(current, id, patch) as DetectionRule[]);
    return { document: rules, result: rules };
  });
}

export async function deleteDetectionRule(id: string): Promise<DetectionRule[]> {
  return (await browserLocalDataProvider()).update(DETECTION_RULES_COLLECTION, (current) => {
    const rules = boundedRules((current as DetectionRule[]).filter((rule) => rule.id !== id));
    return { document: rules, result: rules };
  });
}

export async function importDetectionRules(raw: unknown): Promise<{ rules: DetectionRule[]; added: number; updated: number; skipped: number }> {
  return (await browserLocalDataProvider()).update(DETECTION_RULES_COLLECTION, (current) => {
    const result = mergeDetectionRules(current, raw);
    const rules = boundedRules(result.rules as DetectionRule[]);
    return { document: rules, result: { rules, added: result.added, updated: result.updated, skipped: result.skipped } };
  });
}

export async function exportDetectionRules(): Promise<void> {
  const blob = new Blob([JSON.stringify(buildDetectionRuleExport(await loadDetectionRules()), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-custom-rules-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function evaluateCaseRules(record: unknown, rules: DetectionRule[] = []): DetectionRuleEvaluation {
  return evaluateDetectionRules(record, rules) as DetectionRuleEvaluation;
}

export function evaluateCasesAgainstRules(records: unknown[], rules: DetectionRule[] = []): DetectionRuleEvaluation[] {
  return evaluateRuleSet(records, rules) as DetectionRuleEvaluation[];
}

export function ruleFieldDefinition(field: string) {
  return RULE_FIELD_DEFINITIONS.find((item: { value: string }) => item.value === field) ?? null;
}

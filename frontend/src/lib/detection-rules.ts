// Browser-only custom-rule persistence. The pure model owns every validation,
// evaluation, import/export, collection bound, and byte-budget decision.
import {
  buildDetectionRuleExport,
  createDetectionRule as createRule,
  evaluateDetectionRules,
  evaluateRuleSet,
  previewDetectionRule as previewRule,
  mergeDetectionRules,
  RULE_FIELD_DEFINITIONS,
  serializeDetectionRuleStore,
  updateDetectionRule as updateRule,
} from './analysis/detection-rule-model.ts';
import { browserLocalDataProvider } from './browser-local-data-service.ts';
import { DETECTION_RULES_COLLECTION, LEGACY_DETECTION_RULES_KEY } from './browser-local-data-definitions.ts';
import type { CaseRecord } from './cases.ts';
import type {
  DetectionRule,
  DetectionRuleEvaluation,
} from './analysis/detection-rule-model.ts';

export {
  MAX_RULE_IMPORT_BYTES,
  MAX_RULE_CONDITIONS,
  MAX_RULE_NAME_LENGTH,
  MAX_RULE_RISK_DELTA,
  MAX_RULE_TAG_LENGTH,
  operatorsForRuleField,
  RULE_FIELD_DEFINITIONS,
} from './analysis/detection-rule-model.ts';

export const DETECTION_RULES_KEY = LEGACY_DETECTION_RULES_KEY;

export type {
  DetectionRule,
  DetectionRuleEvaluation,
  DetectionRuleMatch,
  RuleCondition as DetectionRuleCondition,
  DetectionRulePreview,
} from './analysis/detection-rule-model.ts';

export async function loadDetectionRules(): Promise<DetectionRule[]> {
  return (await browserLocalDataProvider()).read(DETECTION_RULES_COLLECTION) as Promise<DetectionRule[]>;
}

function boundedRules(rules: DetectionRule[]): DetectionRule[] {
  return JSON.parse(serializeDetectionRuleStore(rules)).rules as DetectionRule[];
}

export async function createDetectionRule(input: Omit<DetectionRule, 'id'>): Promise<DetectionRule[]> {
  return (await browserLocalDataProvider()).update(DETECTION_RULES_COLLECTION, (current) => {
    const rules = boundedRules(createRule(current, input).rules);
    return { document: rules, result: rules };
  });
}

export async function editDetectionRule(id: string, patch: Partial<Omit<DetectionRule, 'id'>>): Promise<DetectionRule[]> {
  return (await browserLocalDataProvider()).update(DETECTION_RULES_COLLECTION, (current) => {
    const rules = boundedRules(updateRule(current, id, patch));
    return { document: rules, result: rules };
  });
}

export async function deleteDetectionRule(id: string): Promise<DetectionRule[]> {
  return (await browserLocalDataProvider()).update(DETECTION_RULES_COLLECTION, (current) => {
    const rules = boundedRules(current.filter((rule) => rule.id !== id));
    return { document: rules, result: rules };
  });
}

export async function importDetectionRules(raw: unknown): Promise<{ rules: DetectionRule[]; added: number; updated: number; skipped: number }> {
  return (await browserLocalDataProvider()).update(DETECTION_RULES_COLLECTION, (current) => {
    const result = mergeDetectionRules(current, raw);
    const rules = boundedRules(result.rules);
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

export function evaluateCaseRules(record: CaseRecord, rules: DetectionRule[] = []): DetectionRuleEvaluation {
  return evaluateDetectionRules(record, rules);
}

export function evaluateCasesAgainstRules(records: CaseRecord[], rules: DetectionRule[] = []): DetectionRuleEvaluation[] {
  return evaluateRuleSet(records, rules);
}

export function previewDetectionRule(records: CaseRecord[], rules: DetectionRule[], candidate: unknown) {
  return previewRule(records, rules, candidate);
}

export function ruleFieldDefinition(field: string) {
  return RULE_FIELD_DEFINITIONS.find((item: { value: string }) => item.value === field) ?? null;
}

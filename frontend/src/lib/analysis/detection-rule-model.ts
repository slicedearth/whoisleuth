// Pure browser-local custom detection-rule model. Rules are deliberately a
// small structured language: field names and operators come from allowlists,
// so imported rules cannot execute code or reach outside bounded case evidence.

import { latestCaseEvidence } from './case-model.js';

export const DETECTION_RULE_SCHEMA = 'whoisleuth.detection-rules';
export const DETECTION_RULE_SCHEMA_VERSION = 1;
export const MAX_DETECTION_RULES = 50;
export const MAX_RULE_CONDITIONS = 8;
export const MAX_RULE_INPUT_RECORDS = 250;
export const MAX_RULE_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_RULE_STORE_BYTES = 256 * 1024;
export const MAX_RULE_NAME_LENGTH = 100;
export const MAX_RULE_TAG_LENGTH = 40;
export const MAX_CONDITION_VALUE_LENGTH = 200;
export const MAX_RULE_RISK_DELTA = 25;
export const MAX_CUSTOM_RISK_TOTAL = 50;

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TEXT_CONTROL_RE = /[\x00-\x1f\x7f]/;

type RuleFieldKind = 'enum' | 'number' | 'text' | 'boolean' | 'list';
export type RuleOperator = 'equals' | 'at_least' | 'at_most' | 'contains' | 'present';
export type RuleCondition = {
  field: string;
  operator: RuleOperator;
  value: boolean | number | string;
};
export type DetectionRule = {
  id: string;
  name: string;
  enabled: boolean;
  match: 'all' | 'any';
  conditions: RuleCondition[];
  riskDelta: number;
  tag: string;
};
export type DetectionRuleStore = {
  version: typeof DETECTION_RULE_SCHEMA_VERSION;
  rules: DetectionRule[];
};
type RuleFieldDefinition = {
  value: string;
  label: string;
  kind: RuleFieldKind;
  values?: readonly string[];
  min?: number;
  max?: number;
};
type NormalizedDetectionRule = Omit<DetectionRule, 'id'> & { id: string | null };
type CaseRecordInput = Parameters<typeof latestCaseEvidence>[0];

export const RULE_FIELD_DEFINITIONS: readonly RuleFieldDefinition[] = Object.freeze([
  { value: 'availability', label: 'Availability state', kind: 'enum', values: ['registered', 'for_sale', 'expiring', 'available', 'unknown', 'error'] },
  { value: 'activityStatus', label: 'Website state', kind: 'enum', values: ['active', 'parked', 'unreachable', 'no_site'] },
  { value: 'riskScore', label: 'Built-in risk score', kind: 'number', min: 0, max: 100 },
  { value: 'registrar', label: 'Registrar', kind: 'text' },
  { value: 'pageTitle', label: 'Page title', kind: 'text' },
  { value: 'httpResponseStatus', label: 'HTTP response status', kind: 'number', min: 100, max: 599 },
  { value: 'httpTransportSecurity', label: 'HTTP transport', kind: 'enum', values: ['https', 'http'] },
  { value: 'hasMx', label: 'MX present', kind: 'boolean' },
  { value: 'hasDmarc', label: 'DMARC present', kind: 'boolean' },
  { value: 'hasPasswordField', label: 'Password field detected', kind: 'boolean' },
  { value: 'faviconMatch', label: 'Exact favicon match', kind: 'boolean' },
  { value: 'faviconNearMatch', label: 'Similar favicon', kind: 'boolean' },
  { value: 'reusesOfficialAssets', label: 'Official assets reused', kind: 'boolean' },
  { value: 'phishingLanguageMatch', label: 'Phishing-language signal', kind: 'text' },
  { value: 'mutationTypes', label: 'Mutation type', kind: 'list' },
  { value: 'nameservers', label: 'Nameserver', kind: 'list' },
  { value: 'httpSecurityHeaders', label: 'HTTP security header', kind: 'list' },
  { value: 'status', label: 'Case status', kind: 'enum', values: ['new', 'investigating', 'monitoring', 'escalated', 'closed'] },
  { value: 'disposition', label: 'Case disposition', kind: 'enum', values: ['unreviewed', 'benign', 'suspicious', 'confirmed_abuse', 'false_positive'] },
  { value: 'tags', label: 'Case tag', kind: 'list' },
]);

const FIELD_BY_VALUE = new Map<string, RuleFieldDefinition>(RULE_FIELD_DEFINITIONS.map((field) => [field.value, field]));

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function operatorsForRuleField(field: unknown): RuleOperator[] {
  const definition = typeof field === 'string' ? FIELD_BY_VALUE.get(field) : undefined;
  if (!definition) return [];
  if (definition.kind === 'number') return ['equals', 'at_least', 'at_most'];
  if (definition.kind === 'text') return ['contains', 'equals', 'present'];
  if (definition.kind === 'list') return ['contains', 'present'];
  return ['equals'];
}

function normalizedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || TEXT_CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : null;
}

function makeId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeInteger(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function normalizeRuleCondition(raw: unknown): RuleCondition | null {
  const condition = record(raw);
  const definition = typeof condition.field === 'string' ? FIELD_BY_VALUE.get(condition.field) : undefined;
  if (!definition) return null;
  const operator = typeof condition.operator === 'string'
    && operatorsForRuleField(definition.value).includes(condition.operator as RuleOperator)
    ? condition.operator as RuleOperator
    : null;
  if (!operator) return null;

  let value;
  if (operator === 'present') value = true;
  else if (definition.kind === 'number') {
    value = normalizeInteger(condition.value, definition.min ?? 0, definition.max ?? 100);
    if (value === null) return null;
  } else if (definition.kind === 'boolean') {
    if (condition.value !== true && condition.value !== false && condition.value !== 'true' && condition.value !== 'false') return null;
    value = condition.value === true || condition.value === 'true';
  } else {
    value = normalizedText(condition.value, MAX_CONDITION_VALUE_LENGTH).toLowerCase();
    if (!value) return null;
    if (definition.kind === 'enum' && (!Array.isArray(definition.values) || !definition.values.includes(value))) return null;
  }
  return { field: definition.value, operator, value };
}

export function normalizeDetectionRule(
  raw: unknown,
  { generateId = false }: { generateId?: boolean } = {},
): NormalizedDetectionRule | null {
  const item = record(raw);
  const name = normalizedText(item.name, MAX_RULE_NAME_LENGTH);
  if (!name) return null;
  const conditions: RuleCondition[] = [];
  const rawConditions = Array.isArray(item.conditions) ? item.conditions : [];
  for (const item of rawConditions.slice(0, MAX_RULE_CONDITIONS)) {
    const condition = normalizeRuleCondition(item);
    if (condition) conditions.push(condition);
  }
  if (!conditions.length) return null;
  const riskDelta = normalizeInteger(item.riskDelta, 0, MAX_RULE_RISK_DELTA);
  return {
    id: safeId(item.id) || (generateId ? makeId() : null),
    name,
    enabled: item.enabled !== false,
    match: item.match === 'any' ? 'any' : 'all',
    conditions,
    riskDelta: riskDelta ?? 0,
    tag: normalizedText(item.tag, MAX_RULE_TAG_LENGTH).toLowerCase(),
  };
}

function ruleList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const item = record(raw);
  if (Array.isArray(item.rules)) return item.rules;
  return [];
}

export function detectionRuleStoreVersion(raw: unknown): number | null {
  const item = record(raw);
  return typeof item.version === 'number' && Number.isFinite(item.version) ? item.version : null;
}

export function normalizeDetectionRuleStore(raw: unknown): DetectionRuleStore {
  const byId = new Map<string, DetectionRule>();
  for (const item of ruleList(raw).slice(0, MAX_RULE_INPUT_RECORDS)) {
    const rule = normalizeDetectionRule(item);
    if (!rule?.id || byId.has(rule.id)) continue;
    byId.set(rule.id, { ...rule, id: rule.id });
    if (byId.size >= MAX_DETECTION_RULES) break;
  }
  return { version: DETECTION_RULE_SCHEMA_VERSION, rules: [...byId.values()] };
}

export function createDetectionRule(rules: unknown, input: unknown): { rules: DetectionRule[]; record: DetectionRule } {
  const normalized = normalizeDetectionRule(input, { generateId: true });
  if (!normalized?.id) throw new Error('Enter a rule name and one valid condition.');
  const existing = normalizeDetectionRuleStore(rules).rules;
  if (existing.length >= MAX_DETECTION_RULES) throw new Error(`Custom rules are limited to ${MAX_DETECTION_RULES}. Delete or export one first.`);
  const created = { ...normalized, id: normalized.id };
  return { rules: [created, ...existing], record: created };
}

export function updateDetectionRule(rules: unknown, id: unknown, patch: unknown): DetectionRule[] {
  const normalizedRules = normalizeDetectionRuleStore(rules).rules;
  const current = normalizedRules.find((rule) => rule.id === id);
  if (!current) throw new Error('That custom rule no longer exists.');
  const updated = normalizeDetectionRule({ ...current, ...record(patch), id });
  if (!updated?.id) throw new Error('A custom rule needs a name and at least one valid condition.');
  return normalizeDetectionRuleStore(normalizedRules.map((rule) => rule.id === id ? updated : rule)).rules;
}

function comparableValue(caseRecord: unknown, snapshot: unknown, field: string): unknown {
  if (field === 'status' || field === 'disposition' || field === 'tags') return record(caseRecord)[field];
  return record(snapshot)[field];
}

export function conditionMatchesCase(conditionRaw: unknown, caseRecord: CaseRecordInput): boolean {
  const condition = normalizeRuleCondition(conditionRaw);
  if (!condition) return false;
  const snapshot = latestCaseEvidence(caseRecord);
  const actual = comparableValue(caseRecord, snapshot, condition.field);
  if (condition.operator === 'present') {
    return Array.isArray(actual) ? actual.length > 0 : actual !== null && actual !== undefined && actual !== '';
  }
  if (condition.operator === 'at_least') return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value;
  if (condition.operator === 'at_most') return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value;
  if (condition.operator === 'equals') {
    if (typeof condition.value === 'boolean' || typeof condition.value === 'number') return actual === condition.value;
    return typeof actual === 'string' && actual.toLowerCase() === condition.value;
  }
  if (condition.operator === 'contains') {
    if (typeof condition.value !== 'string') return false;
    const needle = condition.value;
    if (Array.isArray(actual)) return actual.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle));
    return typeof actual === 'string' && actual.toLowerCase().includes(needle);
  }
  return false;
}

export function evaluateDetectionRules(caseRecord: CaseRecordInput, rawRules: unknown) {
  const rules = normalizeDetectionRuleStore(rawRules).rules;
  const matchedRules: Array<{ id: string; name: string; riskDelta: number; appliedDelta: number; tag: string }> = [];
  let customRiskDelta = 0;
  const suggestedTags = new Set();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const results = rule.conditions.map((condition) => conditionMatchesCase(condition, caseRecord));
    const matched = rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    if (!matched) continue;
    const appliedDelta = Math.min(rule.riskDelta, Math.max(0, MAX_CUSTOM_RISK_TOTAL - customRiskDelta));
    customRiskDelta += appliedDelta;
    if (rule.tag) suggestedTags.add(rule.tag);
    matchedRules.push({ id: rule.id, name: rule.name, riskDelta: rule.riskDelta, appliedDelta, tag: rule.tag });
  }
  const snapshot = latestCaseEvidence(caseRecord);
  const builtInRiskScore = typeof snapshot?.riskScore === 'number' ? snapshot.riskScore : null;
  const item = record(caseRecord);
  return {
    caseId: typeof item.id === 'string' ? item.id : '',
    domain: typeof item.domain === 'string' ? item.domain : '',
    builtInRiskScore,
    customRiskDelta,
    contextualRiskScore: builtInRiskScore === null ? null : Math.min(100, builtInRiskScore + customRiskDelta),
    matchedRules,
    suggestedTags: [...suggestedTags].sort(),
  };
}

export function evaluateRuleSet(records: unknown, rawRules: unknown) {
  if (!Array.isArray(records)) return [];
  return records.slice(0, 500).map((record) => evaluateDetectionRules(record, rawRules));
}

export function mergeDetectionRules(localRaw: unknown, importedRaw: unknown) {
  const importedRecord = record(importedRaw);
  if (typeof importedRecord.schema === 'string' && importedRecord.schema !== DETECTION_RULE_SCHEMA) {
    throw new Error('This JSON file is not a WHOISleuth custom-rule export.');
  }
  const version = detectionRuleStoreVersion(importedRaw);
  if (version !== null && version > DETECTION_RULE_SCHEMA_VERSION) {
    throw new Error(`This custom-rule file uses newer schema ${version}. Update the app before importing it.`);
  }
  const local = normalizeDetectionRuleStore(localRaw).rules;
  const byId = new Map(local.map((rule) => [rule.id, rule]));
  const importedList = ruleList(importedRaw);
  let added = 0;
  let updated = 0;
  let skipped = Math.max(0, importedList.length - MAX_RULE_INPUT_RECORDS);
  for (const item of importedList.slice(0, MAX_RULE_INPUT_RECORDS)) {
    const rule = normalizeDetectionRule(item);
    if (!rule?.id) { skipped++; continue; }
    const storedRule = { ...rule, id: rule.id };
    if (byId.has(rule.id)) { byId.set(rule.id, storedRule); updated++; }
    else if (byId.size < MAX_DETECTION_RULES) { byId.set(rule.id, storedRule); added++; }
    else skipped++;
  }
  return { rules: [...byId.values()], added, updated, skipped };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function assertDetectionRuleStoreBudget(rules: unknown): DetectionRuleStore {
  const store = normalizeDetectionRuleStore(rules);
  if (byteLength(JSON.stringify(store)) > MAX_RULE_STORE_BYTES) {
    throw new Error('Custom-rule storage is full. Remove or export rules before saving more.');
  }
  return store;
}

export function serializeDetectionRuleStore(rules: unknown): string {
  return JSON.stringify(assertDetectionRuleStoreBudget(rules));
}

export function buildDetectionRuleExport(rules: unknown, nowIso: unknown = new Date().toISOString()) {
  const timestamp = typeof nowIso === 'string' ? nowIso : '';
  const parsed = Date.parse(timestamp);
  return {
    schema: DETECTION_RULE_SCHEMA,
    version: DETECTION_RULE_SCHEMA_VERSION,
    exportedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(),
    rules: normalizeDetectionRuleStore(rules).rules,
    limitations: 'Custom rules are browser-local analyst heuristics. Matches and score contributions are not proof of maliciousness and do not alter built-in risk scores.',
  };
}

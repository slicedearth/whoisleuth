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

export const RULE_FIELD_DEFINITIONS = Object.freeze([
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

const FIELD_BY_VALUE = new Map(RULE_FIELD_DEFINITIONS.map((field) => [field.value, field]));

export function operatorsForRuleField(field) {
  const definition = FIELD_BY_VALUE.get(field);
  if (!definition) return [];
  if (definition.kind === 'number') return ['equals', 'at_least', 'at_most'];
  if (definition.kind === 'text') return ['contains', 'equals', 'present'];
  if (definition.kind === 'list') return ['contains', 'present'];
  return ['equals'];
}

function normalizedText(value, maxLength) {
  if (typeof value !== 'string' || TEXT_CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : null;
}

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeInteger(value, min, max) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function normalizeRuleCondition(raw) {
  const condition = raw && typeof raw === 'object' ? raw : {};
  const definition = FIELD_BY_VALUE.get(condition.field);
  if (!definition) return null;
  const operator = operatorsForRuleField(definition.value).includes(condition.operator) ? condition.operator : null;
  if (!operator) return null;

  let value;
  if (operator === 'present') value = true;
  else if (definition.kind === 'number') {
    value = normalizeInteger(condition.value, definition.min, definition.max);
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

export function normalizeDetectionRule(raw, { generateId = false } = {}) {
  const record = raw && typeof raw === 'object' ? raw : {};
  const name = normalizedText(record.name, MAX_RULE_NAME_LENGTH);
  if (!name) return null;
  const conditions = [];
  const rawConditions = Array.isArray(record.conditions) ? record.conditions : [];
  for (const item of rawConditions.slice(0, MAX_RULE_CONDITIONS)) {
    const condition = normalizeRuleCondition(item);
    if (condition) conditions.push(condition);
  }
  if (!conditions.length) return null;
  const riskDelta = normalizeInteger(record.riskDelta, 0, MAX_RULE_RISK_DELTA);
  return {
    id: safeId(record.id) || (generateId ? makeId() : null),
    name,
    enabled: record.enabled !== false,
    match: record.match === 'any' ? 'any' : 'all',
    conditions,
    riskDelta: riskDelta ?? 0,
    tag: normalizedText(record.tag, MAX_RULE_TAG_LENGTH).toLowerCase(),
  };
}

function ruleList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.rules)) return raw.rules;
  return [];
}

export function detectionRuleStoreVersion(raw) {
  return raw && typeof raw === 'object' && Number.isFinite(raw.version) ? raw.version : null;
}

export function normalizeDetectionRuleStore(raw) {
  const byId = new Map();
  for (const item of ruleList(raw).slice(0, MAX_RULE_INPUT_RECORDS)) {
    const rule = normalizeDetectionRule(item);
    if (!rule?.id || byId.has(rule.id)) continue;
    byId.set(rule.id, rule);
    if (byId.size >= MAX_DETECTION_RULES) break;
  }
  return { version: DETECTION_RULE_SCHEMA_VERSION, rules: [...byId.values()] };
}

export function createDetectionRule(rules, input) {
  const normalized = normalizeDetectionRule(input, { generateId: true });
  if (!normalized) throw new Error('Enter a rule name and one valid condition.');
  if (rules.length >= MAX_DETECTION_RULES) throw new Error(`Custom rules are limited to ${MAX_DETECTION_RULES}. Delete or export one first.`);
  return { rules: [normalized, ...normalizeDetectionRuleStore(rules).rules], record: normalized };
}

export function updateDetectionRule(rules, id, patch) {
  const current = normalizeDetectionRuleStore(rules).rules.find((rule) => rule.id === id);
  if (!current) throw new Error('That custom rule no longer exists.');
  const updated = normalizeDetectionRule({ ...current, ...patch, id });
  if (!updated) throw new Error('A custom rule needs a name and at least one valid condition.');
  return normalizeDetectionRuleStore(rules.map((rule) => rule.id === id ? updated : rule)).rules;
}

function comparableValue(record, snapshot, field) {
  if (field === 'status' || field === 'disposition' || field === 'tags') return record?.[field];
  return snapshot?.[field];
}

export function conditionMatchesCase(conditionRaw, record) {
  const condition = normalizeRuleCondition(conditionRaw);
  if (!condition) return false;
  const snapshot = latestCaseEvidence(record);
  const actual = comparableValue(record, snapshot, condition.field);
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

export function evaluateDetectionRules(record, rawRules) {
  const rules = normalizeDetectionRuleStore(rawRules).rules;
  const matchedRules = [];
  let customRiskDelta = 0;
  const suggestedTags = new Set();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const results = rule.conditions.map((condition) => conditionMatchesCase(condition, record));
    const matched = rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    if (!matched) continue;
    const appliedDelta = Math.min(rule.riskDelta, Math.max(0, MAX_CUSTOM_RISK_TOTAL - customRiskDelta));
    customRiskDelta += appliedDelta;
    if (rule.tag) suggestedTags.add(rule.tag);
    matchedRules.push({ id: rule.id, name: rule.name, riskDelta: rule.riskDelta, appliedDelta, tag: rule.tag });
  }
  const snapshot = latestCaseEvidence(record);
  const builtInRiskScore = typeof snapshot?.riskScore === 'number' ? snapshot.riskScore : null;
  return {
    caseId: typeof record?.id === 'string' ? record.id : '',
    domain: typeof record?.domain === 'string' ? record.domain : '',
    builtInRiskScore,
    customRiskDelta,
    contextualRiskScore: builtInRiskScore === null ? null : Math.min(100, builtInRiskScore + customRiskDelta),
    matchedRules,
    suggestedTags: [...suggestedTags].sort(),
  };
}

export function evaluateRuleSet(records, rawRules) {
  if (!Array.isArray(records)) return [];
  return records.slice(0, 500).map((record) => evaluateDetectionRules(record, rawRules));
}

export function mergeDetectionRules(localRaw, importedRaw) {
  if (importedRaw && typeof importedRaw === 'object' && typeof importedRaw.schema === 'string' && importedRaw.schema !== DETECTION_RULE_SCHEMA) {
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
    if (byId.has(rule.id)) { byId.set(rule.id, rule); updated++; }
    else if (byId.size < MAX_DETECTION_RULES) { byId.set(rule.id, rule); added++; }
    else skipped++;
  }
  return { rules: [...byId.values()], added, updated, skipped };
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function assertDetectionRuleStoreBudget(rules) {
  const store = normalizeDetectionRuleStore(rules);
  if (byteLength(JSON.stringify(store)) > MAX_RULE_STORE_BYTES) {
    throw new Error('Custom-rule storage is full. Remove or export rules before saving more.');
  }
  return store;
}

export function serializeDetectionRuleStore(rules) {
  return JSON.stringify(assertDetectionRuleStoreBudget(rules));
}

export function buildDetectionRuleExport(rules, nowIso = new Date().toISOString()) {
  const parsed = Date.parse(nowIso);
  return {
    schema: DETECTION_RULE_SCHEMA,
    version: DETECTION_RULE_SCHEMA_VERSION,
    exportedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(),
    rules: normalizeDetectionRuleStore(rules).rules,
    limitations: 'Custom rules are browser-local analyst heuristics. Matches and score contributions are not proof of maliciousness and do not alter built-in risk scores.',
  };
}

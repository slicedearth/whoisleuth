import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDetectionRuleStoreBudget,
  buildDetectionRuleExport,
  conditionMatchesCase,
  createDetectionRule,
  DETECTION_RULE_SCHEMA_VERSION,
  detectionRuleStoreVersion,
  evaluateDetectionRules,
  evaluateRuleSet,
  MAX_CUSTOM_RISK_TOTAL,
  MAX_DETECTION_RULES,
  MAX_RULE_CONDITIONS,
  mergeDetectionRules,
  normalizeDetectionRule,
  normalizeDetectionRuleStore,
  normalizeRuleCondition,
  operatorsForRuleField,
  serializeDetectionRuleStore,
  updateDetectionRule,
} from '../frontend/src/lib/analysis/detection-rule-model.js';

function snapshot(overrides = {}) {
  return {
    id: 'evidence-1', fingerprint: 'fp-1', firstCapturedAt: '2026-07-14T00:00:00.000Z', capturedAt: '2026-07-14T00:00:00.000Z', source: 'lookup', scanDepth: 'deep',
    availability: 'registered', confidence: 'high', riskModelVersion: 4, riskScore: 65, opportunityScore: null, riskFactors: [], opportunityFactors: [], registrar: 'Example Registrar', createdDate: null, expiryDate: null, nameservers: ['ns1.host.invalid'], hasMx: true, hasSpf: null, hasDmarc: false, activityStatus: 'active', websiteProbeDetail: null, pageTitle: 'Secure account login', httpSummaryVersion: 1, httpEvidenceStatus: 'success', httpFinalOrigin: null, httpResponseStatus: 200, httpTransportSecurity: 'https', httpRedirectCount: 0, httpCrossOriginRedirect: false, httpHttpsDowngrade: false, httpContentType: 'text/html', httpSecurityHeaders: ['strict-transport-security'], faviconMatch: true, faviconNearMatch: false, reusesOfficialAssets: true, hasPasswordField: true, phishingLanguageMatch: 'verify account', mutationTypes: ['unicode_homoglyph'],
    ...overrides,
  };
}

function caseRecord(overrides = {}) {
  return { id: 'case-1', domain: 'example.invalid', status: 'investigating', disposition: 'suspicious', tags: ['priority'], notes: [], source: 'lookup', evidenceHistory: [snapshot()], createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z', ...overrides };
}

function rule(overrides = {}) {
  return { id: 'rule-1', name: 'Login impersonation', enabled: true, match: 'all', conditions: [{ field: 'hasPasswordField', operator: 'equals', value: true }], riskDelta: 15, tag: 'custom-match', ...overrides };
}

test('field operators are fixed by field kind and unknown fields expose none', () => {
  assert.deepEqual(operatorsForRuleField('riskScore'), ['equals', 'at_least', 'at_most']);
  assert.deepEqual(operatorsForRuleField('pageTitle'), ['contains', 'equals', 'present']);
  assert.deepEqual(operatorsForRuleField('hasMx'), ['equals']);
  assert.deepEqual(operatorsForRuleField('unknown'), []);
});

test('normalizes allowlisted conditions and rejects executable or malformed input', () => {
  assert.deepEqual(normalizeRuleCondition({ field: 'pageTitle', operator: 'contains', value: '  LOGIN  ' }), { field: 'pageTitle', operator: 'contains', value: 'login' });
  assert.deepEqual(normalizeRuleCondition({ field: 'hasMx', operator: 'equals', value: 'false' }), { field: 'hasMx', operator: 'equals', value: false });
  assert.equal(normalizeRuleCondition({ field: 'constructor', operator: 'equals', value: 'x' }), null);
  assert.equal(normalizeRuleCondition({ field: 'riskScore', operator: 'eval', value: 'process.exit()' }), null);
  assert.equal(normalizeRuleCondition({ field: 'pageTitle', operator: 'contains', value: 'bad\nvalue' }), null);
});

test('normalizes and bounds a complete rule', () => {
  const conditions = Array.from({ length: MAX_RULE_CONDITIONS + 3 }, () => ({ field: 'hasMx', operator: 'equals', value: true }));
  const result = normalizeDetectionRule(rule({ name: '  Match   mail  ', conditions, riskDelta: 999, tag: ' REVIEW ' }));
  assert.equal(result.name, 'Match mail');
  assert.equal(result.conditions.length, MAX_RULE_CONDITIONS);
  assert.equal(result.riskDelta, 0);
  assert.equal(result.tag, 'review');
});

test('rejects rules without names, ids, or valid conditions at the right boundaries', () => {
  assert.equal(normalizeDetectionRule(rule({ name: '' })), null);
  assert.equal(normalizeDetectionRule(rule({ conditions: [{ field: 'bad', operator: 'equals', value: 1 }] })), null);
  assert.equal(normalizeDetectionRule(rule({ id: '../bad' })).id, null);
  assert.match(normalizeDetectionRule(rule({ id: '../bad' }), { generateId: true }).id, /^[A-Za-z0-9_-]{1,64}$/);
});

test('evaluates boolean, numeric, enum, text, list and case-level conditions', () => {
  const record = caseRecord();
  assert.equal(conditionMatchesCase({ field: 'hasPasswordField', operator: 'equals', value: true }, record), true);
  assert.equal(conditionMatchesCase({ field: 'riskScore', operator: 'at_least', value: 60 }, record), true);
  assert.equal(conditionMatchesCase({ field: 'availability', operator: 'equals', value: 'registered' }, record), true);
  assert.equal(conditionMatchesCase({ field: 'pageTitle', operator: 'contains', value: 'account' }, record), true);
  assert.equal(conditionMatchesCase({ field: 'mutationTypes', operator: 'contains', value: 'unicode' }, record), true);
  assert.equal(conditionMatchesCase({ field: 'tags', operator: 'contains', value: 'priority' }, record), true);
  assert.equal(conditionMatchesCase({ field: 'hasDmarc', operator: 'equals', value: true }, record), false);
});

test('missing evidence fails safely instead of matching a negative finding', () => {
  const record = caseRecord({ evidenceHistory: [] });
  assert.equal(conditionMatchesCase({ field: 'hasMx', operator: 'equals', value: false }, record), false);
  assert.equal(conditionMatchesCase({ field: 'pageTitle', operator: 'present', value: true }, record), false);
});

test('all and any matching, disabled rules, tags and score separation are explicit', () => {
  const rules = [
    rule(),
    rule({ id: 'rule-2', name: 'Either', match: 'any', conditions: [{ field: 'hasDmarc', operator: 'equals', value: true }, { field: 'faviconMatch', operator: 'equals', value: true }], riskDelta: 10, tag: 'visual' }),
    rule({ id: 'rule-3', name: 'Disabled', enabled: false, riskDelta: 25 }),
  ];
  const result = evaluateDetectionRules(caseRecord(), rules);
  assert.equal(result.builtInRiskScore, 65);
  assert.equal(result.customRiskDelta, 25);
  assert.equal(result.contextualRiskScore, 90);
  assert.deepEqual(result.matchedRules.map((item) => item.id), ['rule-1', 'rule-2']);
  assert.deepEqual(result.suggestedTags, ['custom-match', 'visual']);
});

test('aggregate custom contribution is capped without changing built-in evidence', () => {
  const record = caseRecord();
  const before = structuredClone(record);
  const rules = Array.from({ length: 4 }, (_, index) => rule({ id: `rule-${index}`, riskDelta: 25 }));
  const result = evaluateDetectionRules(record, rules);
  assert.equal(result.customRiskDelta, MAX_CUSTOM_RISK_TOTAL);
  assert.equal(result.contextualRiskScore, 100);
  assert.equal(result.matchedRules.at(-1).appliedDelta, 0);
  assert.deepEqual(record, before);
});

test('rule-set evaluation is bounded, deterministic and does not mutate inputs', () => {
  const records = [caseRecord(), caseRecord({ id: 'case-2', domain: 'two.invalid' })];
  const before = structuredClone(records);
  const result = evaluateRuleSet(records, [rule()]);
  assert.deepEqual(result.map((item) => item.domain), ['example.invalid', 'two.invalid']);
  assert.deepEqual(records, before);
});

test('creates, updates, toggles and caps rules without source mutation', () => {
  const source = [rule()];
  const created = createDetectionRule(source, { name: 'New rule', conditions: [{ field: 'hasMx', operator: 'equals', value: true }], riskDelta: 5, tag: '' });
  assert.equal(source.length, 1);
  assert.equal(created.rules.length, 2);
  const updated = updateDetectionRule(created.rules, created.record.id, { enabled: false });
  assert.equal(updated.find((item) => item.id === created.record.id).enabled, false);
  assert.throws(() => createDetectionRule(Array.from({ length: MAX_DETECTION_RULES }, (_, index) => rule({ id: `r-${index}` })), rule()), /limited to/);
});

test('store recovery drops invalid, duplicate and excess records', () => {
  const input = [rule(), rule({ name: 'Duplicate' }), { name: 'Bad', conditions: [] }, ...Array.from({ length: MAX_DETECTION_RULES + 5 }, (_, index) => rule({ id: `extra-${index}` }))];
  const result = normalizeDetectionRuleStore({ version: 99, rules: input });
  assert.equal(result.version, DETECTION_RULE_SCHEMA_VERSION);
  assert.equal(result.rules.length, MAX_DETECTION_RULES);
  assert.equal(result.rules[0].name, 'Login impersonation');
});

test('import validates schema and version and merges by stable id', () => {
  assert.throws(() => mergeDetectionRules([], { schema: 'other', rules: [] }), /not a WHOISleuth/);
  assert.throws(() => mergeDetectionRules([], { version: 2, rules: [] }), /newer schema/);
  const result = mergeDetectionRules([rule()], { schema: 'whoisleuth.detection-rules', version: 1, rules: [rule({ name: 'Replacement' }), rule({ id: 'rule-2' }), { name: 'invalid' }] });
  assert.deepEqual({ added: result.added, updated: result.updated, skipped: result.skipped }, { added: 1, updated: 1, skipped: 1 });
  assert.equal(result.rules.find((item) => item.id === 'rule-1').name, 'Replacement');
});

test('serialization, budget and export expose only normalized portable data', () => {
  const parsed = JSON.parse(serializeDetectionRuleStore([{ ...rule(), secret: 'drop' }]));
  assert.equal(parsed.version, DETECTION_RULE_SCHEMA_VERSION);
  assert.equal(parsed.rules[0].secret, undefined);
  assert.doesNotThrow(() => assertDetectionRuleStoreBudget(parsed.rules));
  const exported = buildDetectionRuleExport(parsed.rules, '2026-07-14T12:00:00Z');
  assert.equal(exported.schema, 'whoisleuth.detection-rules');
  assert.equal(exported.exportedAt, '2026-07-14T12:00:00.000Z');
  assert.match(exported.limitations, /do not alter built-in risk scores/);
});

test('reports store versions without coercion', () => {
  assert.equal(detectionRuleStoreVersion({ version: 1 }), 1);
  assert.equal(detectionRuleStoreVersion({ version: '1' }), null);
  assert.equal(detectionRuleStoreVersion(null), null);
});

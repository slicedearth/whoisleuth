const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FEATURE_DISABLED_ERROR_CODE,
  NETWORK_FEATURE_DEFINITIONS,
  disabledValue,
  networkFeaturePolicy,
  featureDecision,
  featureDisabledError,
} = require('../lib/feature-policy.mts');

describe('network feature policy', () => {
  test('defaults every implemented network feature to enabled', () => {
    const policy = networkFeaturePolicy({});
    assert.deepEqual(Object.keys(policy).sort(), Object.keys(NETWORK_FEATURE_DEFINITIONS).sort());
    assert.ok(Object.values(policy).every((enabled) => enabled === true));
  });

  test('accepts only deliberate truthy disable values', () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) assert.equal(disabledValue(value), true);
    for (const value of [undefined, null, '', '0', 'false', 'enabled', true, 1]) assert.equal(disabledValue(value), false);
  });

  test('maps each switch independently without broad or fuzzy environment matching', () => {
    const policy = networkFeaturePolicy({
      WHOISLEUTH_DISABLE_RDAP: '1',
      WHOISLEUTH_DISABLE_WHOIS: 'false',
      DISABLE_LOOKUP: '1',
    });
    assert.equal(policy.rdap, false);
    assert.equal(policy.whois, true);
    assert.equal(policy.lookup, true);
  });

  test('disables a dependent posture audit when DNS intelligence is disabled', () => {
    const policy = networkFeaturePolicy({ WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: 'true' });
    const decision = featureDecision('domain_posture', policy);
    assert.equal(decision.enabled, false);
    assert.equal(decision.feature, 'domain_posture');
    assert.equal(decision.disabledBy, 'dns_intelligence');
    assert.match(decision.reason, /DNS intelligence is disabled/i);
  });

  test('returns a stable bounded disabled response without exposing environment names', () => {
    const policy = networkFeaturePolicy({ WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY: 'on' });
    const payload = featureDisabledError('certificate_transparency', policy);
    assert.equal(payload.errorCode, FEATURE_DISABLED_ERROR_CODE);
    assert.equal(payload.feature, 'certificate_transparency');
    assert.equal(payload.disabledBy, 'certificate_transparency');
    assert.equal(payload.error.includes('WHOISLEUTH_DISABLE'), false);
    assert.equal(featureDisabledError('lookup', policy), null);
  });

  test('rejects unknown feature identifiers instead of silently allowing them', () => {
    assert.throws(() => featureDecision('not_implemented', networkFeaturePolicy({})), /Unknown network feature/);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_DISABLED_ERROR_CODE,
  NETWORK_FEATURE_DEFINITIONS,
  disabledValue,
  networkFeaturePolicy,
  featureDecision,
  featureDisabledError,
} from '../lib/feature-policy.mts';
import { requiredValue } from './value-assertions.mts';

describe('network feature policy', () => {
  test('defaults every implemented network feature to enabled except explicit third-party opt-ins', () => {
    const policy = networkFeaturePolicy({});
    assert.deepEqual(Object.keys(policy).sort(), Object.keys(NETWORK_FEATURE_DEFINITIONS).sort());
    const optIns = Object.entries(NETWORK_FEATURE_DEFINITIONS).filter(([, definition]) => 'enableEnv' in definition).map(([id]) => id);
    assert.deepEqual(optIns, ['resolver_comparison']);
    for (const [id, enabled] of Object.entries(policy)) assert.equal(enabled, !optIns.includes(id), id);
  });

  test('resolver comparison needs an exact operator opt-in and its emergency switch still wins', () => {
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1']) {
      const decision = featureDecision('resolver_comparison', networkFeaturePolicy({ WHOISLEUTH_RESOLVER_COMPARISON_ENABLED: value }));
      assert.equal(decision.enabled, false, String(value));
      assert.equal(decision.disabledBy, 'resolver_comparison');
      assert.equal(decision.reason, 'Selected resolver comparison is not enabled for this deployment.');
    }
    assert.equal(featureDecision('resolver_comparison', networkFeaturePolicy({ WHOISLEUTH_RESOLVER_COMPARISON_ENABLED: '1' })).enabled, true);
    assert.equal(featureDecision('resolver_comparison', networkFeaturePolicy({
      WHOISLEUTH_RESOLVER_COMPARISON_ENABLED: '1', WHOISLEUTH_DISABLE_RESOLVER_COMPARISON: '1' })).enabled, false);
    const dependent = featureDecision('resolver_comparison', networkFeaturePolicy({
      WHOISLEUTH_RESOLVER_COMPARISON_ENABLED: '1', WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: '1' }));
    assert.equal(dependent.enabled, false); assert.equal(dependent.disabledBy, 'dns_intelligence');
    assert.equal(requiredValue(featureDisabledError('resolver_comparison', networkFeaturePolicy({}))).error.includes('WHOISLEUTH'), false);
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

  test('disables nameserver search when RDAP is disabled', () => {
    const policy = networkFeaturePolicy({ WHOISLEUTH_DISABLE_RDAP: 'true' });
    const decision = featureDecision('rdap_nameserver_search', policy);
    assert.equal(decision.enabled, false);
    assert.equal(decision.feature, 'rdap_nameserver_search');
    assert.equal(decision.disabledBy, 'rdap');
    assert.match(decision.reason, /RDAP is disabled/iu);
  });

  test('returns a stable bounded disabled response without exposing environment names', () => {
    const policy = networkFeaturePolicy({ WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY: 'on' });
    const payload = requiredValue(featureDisabledError('certificate_transparency', policy));
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

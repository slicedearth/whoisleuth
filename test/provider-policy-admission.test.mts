import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROVIDER_POLICY_MAX_FUTURE_SKEW_MS,
  providerPolicyAdmission,
} from '../lib/provider-policy-admission.mts';

const terms = {
  reviewedAt: '2026-07-15T00:00:00.000Z',
  termsUrl: 'https://provider.example/terms',
  privacyUrl: 'https://provider.example/privacy',
  commercialUse: 'restricted' as const,
  attribution: 'unknown' as const,
  caching: 'prohibited' as const,
  queryRetention: 'provider_defined' as const,
  redistribution: 'restricted' as const,
};
const now = Date.parse('2026-08-04T00:00:00.000Z');

test('provider policy admission requires a deliberate deployment purpose', () => {
  assert.deepEqual(providerPolicyAdmission(terms, {}, now), {
    allowed: false,
    purpose: null,
    reviewAgeDays: 20,
    reason: 'Optional intelligence requires WHOISLEUTH_DEPLOYMENT_PURPOSE=personal, internal, or commercial.',
  });
  assert.equal(providerPolicyAdmission(terms, { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal' }, now).allowed, true);
});

test('version-1 policy review dates assign UTC instead of using the host timezone', () => {
  const result = providerPolicyAdmission(
    { ...terms, reviewedAt: '2026-07-15T00:00:00.000' },
    { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal' },
    now,
  );
  assert.equal(result.allowed, true);
  assert.equal(result.reviewAgeDays, 20);
});

test('provider policy admission fails closed for stale and restricted use', () => {
  assert.match(providerPolicyAdmission(terms, { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'commercial' }, now).reason ?? '', /restricted/u);
  assert.match(providerPolicyAdmission(terms, { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'internal' }, now).reason ?? '', /restricted/u);
  assert.match(providerPolicyAdmission(terms, { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal' }, Date.parse('2027-02-01T00:00:00Z')).reason ?? '', /older than 180 days/u);
  assert.match(providerPolicyAdmission({ ...terms, commercialUse: 'unknown' }, { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal' }, now).reason ?? '', /unknown/u);
  const atSkewBoundary = providerPolicyAdmission(
    { ...terms, reviewedAt: new Date(now + PROVIDER_POLICY_MAX_FUTURE_SKEW_MS).toISOString() },
    { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal' },
    now,
  );
  assert.equal(atSkewBoundary.allowed, true);
  assert.equal(atSkewBoundary.reviewAgeDays, 0);
  const beyondSkew = providerPolicyAdmission(
    { ...terms, reviewedAt: new Date(now + PROVIDER_POLICY_MAX_FUTURE_SKEW_MS + 1).toISOString() },
    { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal' },
    now,
  );
  assert.equal(beyondSkew.allowed, false);
  assert.equal(beyondSkew.reviewAgeDays, null);
  assert.match(beyondSkew.reason ?? '', /invalid/u);
});

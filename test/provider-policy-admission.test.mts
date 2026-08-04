import assert from 'node:assert/strict';
import test from 'node:test';

import { providerPolicyAdmission } from '../lib/provider-policy-admission.mts';

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

test('provider policy admission fails closed for stale and restricted use', () => {
  assert.match(providerPolicyAdmission(terms, { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'commercial' }, now).reason ?? '', /restricted/u);
  assert.match(providerPolicyAdmission(terms, { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'internal' }, now).reason ?? '', /restricted/u);
  assert.match(providerPolicyAdmission(terms, { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal' }, Date.parse('2027-02-01T00:00:00Z')).reason ?? '', /older than 180 days/u);
  assert.match(providerPolicyAdmission({ ...terms, commercialUse: 'unknown' }, { WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal' }, now).reason ?? '', /unknown/u);
});

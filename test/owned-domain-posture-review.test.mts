import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildOwnedDomainPostureReview } from '../frontend/src/lib/analysis/owned-domain-posture-review.ts';
import type { BrandProfile } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import type { DomainPostureHttpResponse } from '../frontend/src/lib/analysis/client-response-contracts.ts';

const profile = {
  id: 'profile-1',
  name: 'Example',
  officialDomains: ['example.test'],
  productNames: [],
  tlds: [],
  approvedPartnerDomains: [],
  allowlistedDomains: [],
  allowlistedRegistrars: [],
  dkimSelectors: [],
  retiredDkimSelectors: [],
  mailProtectionProfile: 'standard',
  protectionAttestations: [
    { control: 'registrar_mfa', state: 'observed', assertedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', note: '' },
    { control: 'registry_lock', state: 'needs_confirmation', assertedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-02-01T00:00:00.000Z', note: '' },
  ],
  trademarkOwner: '',
  trademarkRegistration: '',
  officialFaviconHash: '',
  officialFaviconPHash: '',
  pageBaseline: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies BrandProfile;

const report = {
  domain: 'example.test',
  checkedAt: '2026-06-01T00:00:00.000Z',
  dkimSelectors: [],
  retiredDkimSelectors: [],
  mailProtectionProfile: 'standard',
  summary: { danger: 0, info: 1, pass: 2, warning: 1 },
  checks: [
    { id: 'registration_lock', label: 'Registration controls', status: 'pass', summary: 'Observed', detail: '', records: [], remediation: '' },
    { id: 'mx', label: 'Mail exchange', status: 'pass', summary: 'Observed', detail: '', records: [], remediation: '' },
    { id: 'spf', label: 'SPF', status: 'warning', summary: 'Review', detail: '', records: [], remediation: '' },
    { id: 'mta_sts', label: 'MTA-STS', status: 'info', summary: 'Unavailable', detail: '', records: [], remediation: '' },
  ],
  spfExpansion: { version: 1, state: 'complete', lookupLimit: 10, lookupsUsed: 0, voidLookupLimit: 2, voidLookups: 0, maxDepth: 5, dnsLookupTerms: 0, branches: [], issues: [] },
  dmarcAuthorizations: [],
  externalDependencies: [
    { kind: 'nameserver', target: 'ns.provider.test', source: 'NS', scope: 'external', state: 'observed', limitation: 'Review only.' },
    { kind: 'spf_include', target: 'mail.provider.test', source: 'SPF include', scope: 'external', state: 'unavailable', limitation: 'Could not resolve.' },
  ],
} satisfies DomainPostureHttpResponse;

describe('owned-domain posture review', () => {
  test('organizes desired state without upgrading limited evidence', () => {
    const review = buildOwnedDomainPostureReview(profile, report, '2026-06-01T00:00:00.000Z');
    assert.equal(review.profileLabel, 'Active mail domain');
    assert.equal(review.desiredGroups.find((item) => item.id === 'mail')?.state, 'review');
    assert.equal(review.desiredGroups.find((item) => item.id === 'transport')?.state, 'unavailable');
    assert.equal(review.attestationCounts.current, 1);
    assert.equal(review.attestationCounts.expired, 1);
  });

  test('labels unavailable dependencies as evidence gaps rather than dangling', () => {
    const review = buildOwnedDomainPostureReview(profile, report);
    assert.equal(review.dependencyCounts.external, 2);
    assert.equal(review.dependencyCounts.unavailable, 1);
    assert.equal(review.dependencies[1]?.review, 'needs_evidence');
    assert.doesNotMatch(JSON.stringify(review.dependencies), /dangling|claimable|abandoned/);
  });
});

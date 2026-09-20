import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildDesiredPostureHistory, buildOwnedDomainPostureReview, filterPostureComparisons, type DesiredPostureComparison } from '../frontend/src/lib/analysis/owned-domain-posture-review.ts';
import type { BrandProfile } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import type { DomainPostureHttpResponse } from '../frontend/src/lib/analysis/client-response-contracts.ts';
import { brandPostureObservationContext } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { postureObservation, postureSource } from './posture-observation-fixture.mts';

test('comparison filters keep unknowns distinct and preserve all source rows', () => {
  const states: DesiredPostureComparison['state'][] = ['aligned', 'approved_window', 'drift', 'not_configured', 'observed', 'review', 'suppressed', 'unavailable', 'unknown', 'unsupported'];
  const rows: DesiredPostureComparison[] = states.map(state => ({ field: 'nameservers', label: state, state,
    desired: state === 'aligned' || state === 'drift' ? ['ns1.example'] : [], observed: [], explanation: 'Fixture comparison', suppressionReason: '', approvedWindowSummary: '' }));
  const before = structuredClone(rows);
  const baseline = { nameservers: [], ds: [], mx: [], caa: [] };
  assert.deepEqual(filterPostureComparisons(rows, 'different', baseline).map(row => row.state), ['approved_window', 'drift', 'suppressed']);
  assert.deepEqual(filterPostureComparisons(rows, 'unknown', baseline).map(row => row.state), ['unavailable', 'unknown', 'unsupported']);
  assert.deepEqual(filterPostureComparisons(rows, 'all', baseline), before);
  assert.deepEqual(rows, before);
});

test('configured filtering includes expected absence but not observation-only or unconfigured fields', () => {
  const baseline = { nameservers: [], ds: [], mx: [], caa: ['0 issue "ca.example"'],
    recordModes: { nameservers: 'unconfigured', ds: 'observe_only', mx: 'expect_none', caa: 'expect_records' } as const };
  const rows: DesiredPostureComparison[] = (['nameservers', 'ds', 'mx', 'caa'] as const).map(field => ({ field, label: field,
    state: 'unknown', desired: baseline[field], observed: [], explanation: 'No current observation', suppressionReason: '', approvedWindowSummary: '' }));
  assert.deepEqual(filterPostureComparisons(rows, 'configured', baseline).map(row => row.field), ['mx', 'caa']);
  assert.deepEqual(filterPostureComparisons(rows, 'unknown', baseline), rows);
});

const profile = {
  id: 'profile-1',
  name: 'Example',
  officialDomains: ['example.test'],
  productNames: [],
  tlds: [],
  approvedPartnerDomains: [],
  allowlistedDomains: [],
  allowlistedRegistrars: [],
  officialChannels: [],
  rightsReferences: [],
  dkimSelectors: [],
  retiredDkimSelectors: [],
  mailProtectionProfile: 'standard',
  protectionAttestations: [
    { control: 'registrar_mfa', state: 'observed', assertedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', note: '' },
    { control: 'registry_lock', state: 'needs_confirmation', assertedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-02-01T00:00:00.000Z', note: '' },
  ],
  desiredPostureBaselines: [],
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
    { id: 'registration_lock', label: 'Registration controls', status: 'pass', summary: 'Observed', detail: '', records: ['client transfer prohibited'], remediation: '', sourceContext: postureSource('registry_rdap', '2026-06-01T00:00:00.000Z') },
    { id: 'mx', label: 'Mail exchange', status: 'pass', summary: 'Observed', detail: '', records: [], remediation: '', sourceContext: postureSource('dns_mx', '2026-06-01T00:00:00.000Z') },
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

  test('compares configured desired records without treating incomplete fields as aligned', () => {
    const configured = {
      ...profile,
      desiredPostureBaselines: [{
        version: 1 as const,
        domain: 'example.test',
        nameservers: ['ns1.example.test'],
        ds: ['12345 13 2 abcdef'],
        mx: ['10 mail.example.test'],
        caa: [],
        tlsIssuer: 'Example issuer',
        tlsSanPatterns: [],
        tlsSpkiSha256: '',
        registrarLock: 'required' as const,
        renewalReviewAt: '2027-01-01T00:00:00.000Z',
        zoneIntent: 'active_service' as const,
        lifecycle: 'active' as const,
        recoveryDependency: '',
        approvedChangeWindows: [],
        suppressions: [{ field: 'mx', reason: 'Reviewed mail transition.', expiresAt: null }],
        note: '',
        previousObservation: postureObservation(profile, 'example.test', {
          observedAt: '2026-05-01T00:00:00.000Z',
          checks: [{ id: 'registration_lock', status: 'warning' as const, records: ['ok'], sourceContext: postureSource('registry_rdap', '2026-05-01T00:00:00.000Z') }],
        }),
        updatedAt: '2026-05-01T00:00:00.000Z',
      }],
    } satisfies BrandProfile;
    const withRecords = {
      ...report,
      checks: [
        ...report.checks.map((check) => check.id === 'mx'
          ? { ...check, records: ['20 other-mail.example.test'] }
          : check),
        { id: 'nameservers', label: 'Nameservers', status: 'pass' as const, summary: 'Observed', detail: '', records: ['ns1.example.test'], remediation: '', sourceContext: postureSource('dns_ns', report.checkedAt) },
      ],
    } satisfies DomainPostureHttpResponse;
    const review = buildOwnedDomainPostureReview(configured, withRecords, '2026-06-01T00:00:00.000Z', brandPostureObservationContext(profile, report.domain));
    assert.equal(review.baselineComparisons.find((item) => item.field === 'nameservers')?.state, 'aligned');
    assert.equal(review.baselineComparisons.find((item) => item.field === 'mx')?.state, 'suppressed');
    assert.equal(review.baselineComparisons.find((item) => item.field === 'ds')?.state, 'unsupported');
    assert.equal(review.baselineComparisons.find((item) => item.field === 'registrarLock')?.state, 'aligned');
    assert.equal(review.previousChanges.find((item) => item.checkId === 'registration_lock')?.state, 'changed');
  });

  test('preserves unknown current evidence instead of reporting drift', () => {
    const configured = {
      ...profile,
      desiredPostureBaselines: [{
        version: 1 as const,
        domain: 'example.test',
        nameservers: [],
        ds: [],
        mx: ['10 mail.example.test'],
        caa: [],
        tlsIssuer: '',
        tlsSanPatterns: [],
        tlsSpkiSha256: '',
        registrarLock: 'unconfigured' as const,
        renewalReviewAt: null,
        zoneIntent: 'unconfigured' as const,
        lifecycle: 'active' as const,
        recoveryDependency: '',
        approvedChangeWindows: [],
        suppressions: [],
        note: '',
        previousObservation: null,
        updatedAt: '2026-05-01T00:00:00.000Z',
      }],
    } satisfies BrandProfile;
    const unavailable = {
      ...report,
      checks: report.checks.map((check) => check.id === 'mx'
        ? { ...check, status: 'info' as const, records: [], summary: 'Unavailable' }
        : check),
    } satisfies DomainPostureHttpResponse;
    const review = buildOwnedDomainPostureReview(configured, unavailable);
    assert.equal(review.baselineComparisons.find((item) => item.field === 'mx')?.state, 'unknown');
  });

  test('compares retained posture history only across checks present in both observations', () => {
    const history = buildDesiredPostureHistory([
      postureObservation(profile, report.domain, { observedAt: '2026-05-01T00:00:00.000Z', checks: [{ id: 'mx', status: 'pass', records: ['10 mail.example.test'], sourceContext: postureSource('dns_mx', '2026-05-01T00:00:00.000Z') }] }),
      postureObservation(profile, report.domain, { observedAt: '2026-06-01T00:00:00.000Z', checks: [
        { id: 'mx', status: 'warning', records: ['20 mail.example.test'], sourceContext: postureSource('dns_mx', '2026-06-01T00:00:00.000Z') },
        { id: 'dmarc', status: 'pass', records: ['v=DMARC1; p=reject'] },
      ] }),
    ]);

    assert.equal(history.length, 1);
    assert.equal(history[0]?.comparableChecks, 1);
    assert.deepEqual(history[0]?.changedChecks, ['mx']);
  });
});

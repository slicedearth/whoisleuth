import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDomainControlCentre } from '../frontend/src/lib/analysis/domain-control-centre.ts';
import type { BrandProfile, DesiredPostureBaseline } from '../frontend/src/lib/analysis/brand-profile-model.ts';

const NOW = '2026-08-05T10:00:00.000Z';

function baseline(domain: string, overrides: Partial<DesiredPostureBaseline> = {}): DesiredPostureBaseline {
  return {
    version: 1,
    domain,
    nameservers: ['ns1.example.invalid', 'ns2.example.invalid'],
    ds: [],
    mx: [],
    caa: [],
    tlsIssuer: '',
    tlsSanPatterns: [],
    tlsSpkiSha256: '',
    registrarLock: 'required',
    renewalReviewAt: null,
    zoneIntent: 'active_service',
    lifecycle: 'active',
    recoveryDependency: 'Reviewed registrar account',
    approvedChangeWindows: [],
    suppressions: [],
    note: '',
    previousObservation: null,
    observationHistory: [],
    updatedAt: NOW,
    ...overrides,
  };
}

function profile(baselines: DesiredPostureBaseline[]): BrandProfile {
  return {
    id: 'profile-1',
    name: 'Example',
    officialDomains: ['one.example.invalid', 'two.example.invalid', 'three.example.invalid'],
    productNames: [], tlds: [], approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [],
    dkimSelectors: [], retiredDkimSelectors: [], mailProtectionProfile: 'standard', protectionAttestations: [],
    desiredPostureBaselines: baselines,
    trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '', pageBaseline: null,
    createdAt: NOW, updatedAt: NOW,
  };
}

test('summarises baseline coverage, change windows, lifecycle and exact shared dependencies', () => {
  const observation = {
    observedAt: '2026-08-05T09:00:00.000Z',
    checks: [{ id: 'nameservers', status: 'pass' as const, records: ['ns2.example.invalid', 'ns1.example.invalid'] }],
  };
  const report = buildDomainControlCentre(profile([
    baseline('one.example.invalid', {
      previousObservation: observation,
      observationHistory: [observation],
      approvedChangeWindows: [{ id: 'change-window-1', startsAt: '2026-08-05T09:30:00.000Z', endsAt: '2026-08-05T10:30:00.000Z', summary: 'Reviewed migration' }],
    }),
    baseline('two.example.invalid', { lifecycle: 'retiring' }),
  ]), NOW);

  assert.deepEqual(report.counts, {
    domains: 3,
    baselines: 2,
    retainedObservations: 1,
    plannedOrActiveChanges: 1,
    retiringOrRetired: 1,
  });
  assert.equal(report.rows[0]?.nameserverPreflight, 'aligned');
  assert.equal(report.rows[0]?.activeWindow?.summary, 'Reviewed migration');
  assert.equal(report.rows[2]?.nameserverPreflight, 'not_configured');
  assert.deepEqual(report.concentrations.map((item) => [item.kind, item.domains.length]), [
    ['nameserver_set', 2],
    ['recovery_dependency', 2],
  ]);
});

test('does not treat incomplete retained nameserver evidence as drift', () => {
  const report = buildDomainControlCentre(profile([
    baseline('one.example.invalid', {
      previousObservation: {
        observedAt: NOW,
        checks: [{ id: 'nameservers', status: 'info', records: [] }],
      },
    }),
  ]), NOW);
  assert.equal(report.rows[0]?.nameserverPreflight, 'incomplete');
});

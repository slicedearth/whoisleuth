import assert from 'node:assert/strict';
import test from 'node:test';
import { createCase } from '../frontend/src/lib/analysis/case-model.ts';
import {
  buildBulkRiskComparison,
  buildBulkRiskPresentation,
  buildBulkResultDisplayRows,
  comparableBulkRiskScore,
  countBulkRouteFilters,
  matchesBulkRouteFilter,
  toBulkRouteTriageRow,
} from '../frontend/src/lib/analysis/bulk-route-model.ts';
import type { ScanResult } from '../frontend/src/lib/analysis/bulk-result-model.ts';

function result(overrides: Partial<ScanResult> = {}): ScanResult {
  const domain = overrides.domain ?? 'candidate.example';
  const base: ScanResult = {
    domain,
    status: 'complete',
    availability: 'registered',
    confidence: 'high',
    registrar: 'Example Registrar',
    activity: 'Active site',
    risk: 75,
    opportunity: 20,
    mutationTypes: ['dictionary'],
    trusted: null,
    error: '',
    saved: {
      domain,
      scanDepth: 'deep',
      availability: 'registered',
      registrarName: 'Example Registrar',
      nameservers: ['ns1.example'],
      faviconHash: null,
      faviconPHash: null,
      riskModelVersion: 8,
      riskScore: 75,
      riskFactors: [{ label: 'Observed review signal', points: 12 }],
      mutationTypes: ['dictionary'],
      profileContext: {
        sourceState: 'ready',
        activeProfileId: null,
        profileUpdatedAt: null,
        limitation: '',
      },
    },
    nameservers: ['ns1.example'],
    faviconHash: null,
    faviconPHash: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    hasPasswordField: false,
    hasExternalFormAction: null,
    phishingLanguageMatch: null,
    registrant: null,
    abuseEvidence: null,
    ct: null,
    idn: null,
    dns: null,
    dnssec: null,
    relationship: {
      version: 2,
      nameservers: [],
      ipAddresses: [],
      trackingIdentifiers: [],
      officialAssetHosts: [],
      faviconHash: null,
      faviconPHash: null,
      certificateFingerprint: null,
      truncated: false,
    },
    sourceCoverage: [{ source: 'lookup', state: 'complete' }],
  };
  return {
    ...base,
    ...overrides,
    saved: { ...base.saved, ...overrides.saved, domain },
  };
}

test('centralizes Bulk filter counts and trusted-domain risk semantics', () => {
  const rows = [
    result(),
    result({ domain: 'trusted.example', trusted: 'official', risk: 90 }),
    result({ domain: 'available.example', availability: 'available', risk: null }),
    result({ domain: 'failed.example', status: 'error', availability: 'error', risk: null }),
  ];
  assert.deepEqual(countBulkRouteFilters(rows), {
    all: 4,
    available: 1,
    registered: 2,
    high_risk: 1,
    trusted: 1,
    profile_unevaluated: 0,
    errors: 1,
  });
  assert.equal(matchesBulkRouteFilter(rows[0]!, {
    filter: 'high_risk',
    mutationFilter: 'dictionary',
    signalFilters: new Set(),
  }), true);
  assert.equal(matchesBulkRouteFilter(rows[1]!, {
    filter: 'high_risk',
    mutationFilter: '',
    signalFilters: new Set(),
  }), false);
});

test('distinguishes profile-unevaluated rows from false trust and high Risk', () => {
  const row = result({
    risk: 90,
    trusted: null,
    saved: {
      profileContext: {
        sourceState: 'unavailable',
        activeProfileId: null,
        profileUpdatedAt: null,
        limitation: 'Profile context unavailable.',
      },
    } as ScanResult['saved'],
  });
  assert.equal(countBulkRouteFilters([row]).high_risk, 0);
  assert.equal(countBulkRouteFilters([row]).trusted, 0);
  assert.equal(countBulkRouteFilters([row]).profile_unevaluated, 1);
  assert.equal(matchesBulkRouteFilter(row, {
    filter: 'profile_unevaluated',
    mutationFilter: '',
    signalFilters: new Set(),
  }), true);
});

test('derives one transient comparable cohort and keeps incompatible Risk evidence inconclusive', () => {
  const comparable = result({ domain: 'comparable.example', risk: 12 });
  const peer = result({ domain: 'peer.example', risk: 84 });
  const partial = result({
    domain: 'partial.example',
    risk: 4,
    sourceCoverage: [{ source: 'lookup', state: 'partial' }],
  });
  const legacy = result({
    domain: 'legacy.example',
    risk: 92,
    saved: { riskModelVersion: 7 } as ScanResult['saved'],
  });
  const comparison = buildBulkRiskComparison([comparable, peer, partial, legacy]);
  assert.equal(comparison.comparableCount, 2);
  assert.equal(comparison.inconclusiveCount, 2);
  assert.equal(comparableBulkRiskScore(comparable, comparison), 12);
  assert.equal(comparableBulkRiskScore(partial, comparison), null);
  assert.equal(buildBulkRiskPresentation(comparable, comparison).band, 'lower');
  assert.match(buildBulkRiskPresentation(comparable, comparison).summary, /does not establish safety/u);
  assert.equal(buildBulkRiskPresentation(partial, comparison).label, 'Inconclusive');
  assert.match(buildBulkRiskPresentation(partial, comparison).summary, /partial or unavailable/u);
  assert.equal(buildBulkRiskPresentation(legacy, comparison).exactScore, 92);
  assert.match(buildBulkRiskPresentation(legacy, comparison).summary, /model v7 is not comparable/u);
});

test('builds triage and table rows without route-owned transformation logic', () => {
  const row = result({
    faviconNearMatch: true,
    abuseEvidence: { abuseEmail: 'abuse@example.test' },
  });
  const caseRecord = createCase({ domain: row.domain, disposition: 'suspicious', source: 'bulk' });
  assert.equal(toBulkRouteTriageRow(row, caseRecord).caseDisposition, 'suspicious');
  assert.equal(matchesBulkRouteFilter(row, {
    filter: 'all',
    mutationFilter: '',
    signalFilters: new Set(['favicon']),
  }), true);

  const display = buildBulkResultDisplayRows({
    visibleResults: [row],
    allResults: [row],
    shortlistedDomains: new Set([row.domain]),
    caseByDomain: new Map([[row.domain, caseRecord]]),
    reviewStateByDomain: new Map([[row.domain, 'reviewing']]),
    mutationLabels: { dictionary: 'Dictionary term' },
  })[0]!;
  assert.equal(display.resultIndex, 0);
  assert.equal(display.shortlisted, true);
  assert.equal(display.mutationLabel, 'Dictionary term');
  assert.equal(display.reviewState, 'reviewing');
  assert.equal(display.risk.modelLabel, 'Risk model v8');
  assert.equal(display.risk.exactScore, 75);
  assert.match(display.risk.factors[0]?.label ?? '', /Observed review signal/u);
  assert.match(display.responseHref, /monitor\?case=/u);
});

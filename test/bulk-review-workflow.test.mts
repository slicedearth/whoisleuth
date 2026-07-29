import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildBulkDomainComparison,
  buildBulkDomainComparisonExport,
} from '../frontend/src/lib/analysis/bulk-domain-comparison.ts';
import { nextBulkReviewIndex, type BulkReviewCockpitRow } from '../frontend/src/lib/analysis/bulk-review-cockpit.ts';
import { buildBulkReviewManifest } from '../frontend/src/lib/analysis/bulk-review-export.ts';
import { buildBulkRetryPlan, preservePriorBulkResult } from '../frontend/src/lib/analysis/bulk-retry-plan.ts';
import type { BulkSessionResult } from '../frontend/src/lib/analysis/bulk-session-model.ts';

const OBSERVED_AT = '2026-07-20T00:00:00.000Z';
const GENERATED_AT = '2026-07-28T00:00:00.000Z';

function result(
  domain: string,
  overrides: Partial<BulkSessionResult> = {},
): BulkSessionResult {
  return {
    domain,
    status: 'complete',
    availability: 'registered',
    confidence: 'high',
    registrar: 'Example Registrar',
    activity: 'Active',
    risk: 60,
    opportunity: 10,
    mutationTypes: ['omission'],
    trusted: null,
    error: '',
    scanDepth: 'deep',
    createdDate: '2026-07-01T00:00:00.000Z',
    expiryDate: '2027-07-01T00:00:00.000Z',
    nameservers: ['ns1.example.test'],
    hasMx: true,
    hasNullMx: false,
    hasSpf: true,
    hasDmarc: false,
    activityStatus: 'active',
    pageTitle: 'Example service',
    faviconHash: null,
    faviconPHash: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    hasPasswordField: false,
    phishingLanguageMatch: null,
    riskModelVersion: 5,
    riskFactors: [],
    dns: null,
    dnssec: null,
    relationship: {
      version: 2,
      nameservers: ['ns1.example.test'],
      ipAddresses: ['192.0.2.10'],
      trackingIdentifiers: [],
      officialAssetHosts: [],
      faviconHash: null,
      faviconPHash: null,
      certificateFingerprint: null,
      truncated: false,
    },
    sourceCoverage: [
      { source: 'rdap', state: 'complete' },
      { source: 'whois', state: 'complete' },
    ],
    ...overrides,
  };
}

function cockpitRow(domain: string, reviewState: string): BulkReviewCockpitRow {
  return {
    resultIndex: 0,
    domain,
    availability: 'registered',
    confidence: 'high',
    risk: 60,
    opportunity: 10,
    activity: 'Active',
    registrar: 'Example Registrar',
    reviewState,
    shortlisted: false,
    trusted: false,
    sourceCoverage: [],
    error: '',
    caseRecord: null,
  };
}

describe('Bulk evidence review workflow', () => {
  test('compares two compact results without collapsing missing evidence into a difference', async () => {
    const comparison = buildBulkDomainComparison(
      result('left.example', { hasDmarc: null, pageTitle: null }),
      result('right.example', {
        registrar: 'Other Registrar',
        hasDmarc: true,
        pageTitle: null,
      }),
      OBSERVED_AT,
      {
        leftEvidenceHref: '#bulk-result-0',
        rightEvidenceHref: '#bulk-result-1',
        now: Date.parse(GENERATED_AT),
      },
    );
    assert.ok(comparison);
    assert.equal(comparison.version, 2);
    assert.equal(comparison.rows.find((row) => row.id === 'registrar')?.state, 'different');
    assert.equal(comparison.rows.find((row) => row.id === 'dmarc')?.state, 'not_recorded');
    assert.equal(comparison.rows.find((row) => row.id === 'page-title')?.state, 'not_recorded');
    assert.equal(comparison.rows.find((row) => row.id === 'technology')?.state, 'not_recorded');
    assert.equal(comparison.rows.find((row) => row.id === 'registrar')?.leftEvidenceHref, '#bulk-result-0');
    assert.equal(comparison.freshness.state, 'stale');
    assert.match(comparison.limitations.join(' '), /does not establish common ownership/i);

    const exported = await buildBulkDomainComparisonExport(comparison, GENERATED_AT);
    assert.match(exported.document.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    const repeated = await buildBulkDomainComparisonExport(comparison, GENERATED_AT);
    assert.equal(repeated.content, exported.content);
  });

  test('keeps conflicting, unavailable, and explicitly absent evidence distinct', () => {
    const comparison = buildBulkDomainComparison(
      result('left.example', {
        availability: 'conflict',
        hasMx: false,
        sourceCoverage: [
          { source: 'availability', state: 'complete' },
          { source: 'dns', state: 'complete' },
          { source: 'tls', state: 'unavailable' },
        ],
      }),
      result('right.example', {
        availability: 'registered',
        hasMx: true,
        sourceCoverage: [
          { source: 'availability', state: 'complete' },
          { source: 'dns', state: 'complete' },
          { source: 'tls', state: 'error' },
        ],
      }),
      OBSERVED_AT,
      { now: Date.parse(OBSERVED_AT) },
    );
    assert.ok(comparison);
    assert.equal(comparison.rows.find((row) => row.id === 'registration')?.state, 'conflicting');
    assert.equal(comparison.rows.find((row) => row.id === 'mail')?.state, 'different');
    assert.equal(comparison.rows.find((row) => row.id === 'certificate')?.state, 'unavailable');
    assert.equal(comparison.freshness.state, 'current');
  });

  test('moves only between unresolved review rows and leaves a settled queue stable', () => {
    const rows = [
      cockpitRow('first.example', 'reviewed'),
      cockpitRow('second.example', 'reviewing'),
      cockpitRow('third.example', 'deferred'),
      cockpitRow('fourth.example', 'unreviewed'),
    ];
    assert.equal(nextBulkReviewIndex(rows, 0, 1), 1);
    assert.equal(nextBulkReviewIndex(rows, 1, 1), 3);
    assert.equal(nextBulkReviewIndex(rows, 3, 1), 1);
    assert.equal(nextBulkReviewIndex(rows.slice(0, 1), 0, 1), 0);
  });

  test('previews source-aware and stale retries before collection', () => {
    const plan = buildBulkRetryPlan([
      result('limited.example', {
        sourceCoverage: [
          { source: 'rdap', state: 'partial' },
          { source: 'whois', state: 'unavailable' },
        ],
      }),
      result('complete.example'),
    ], 'deep', OBSERVED_AT, Date.parse(GENERATED_AT));
    assert.equal(plan.freshness.state, 'stale');
    assert.equal(plan.lookupRequests, 2);
    assert.deepEqual(plan.rows[0]?.reasons, ['limited_source', 'stale']);
    assert.deepEqual(plan.rows[1]?.reasons, ['stale']);
    assert.match(plan.destinations.join(' '), /target HTTP\(S\)/u);
  });

  test('retains stronger settled evidence when a retry fails or loses source coverage', () => {
    const previous = result('retain.example');
    assert.equal(
      preservePriorBulkResult(previous, result('retain.example', {
        status: 'error',
        availability: 'error',
        error: 'Temporary failure',
      })).preserve,
      true,
    );
    const regression = preservePriorBulkResult(previous, result('retain.example', {
      sourceCoverage: [
        { source: 'rdap', state: 'complete' },
        { source: 'whois', state: 'partial' },
      ],
    }));
    assert.equal(regression.preserve, true);
    assert.match(regression.reason, /whois/u);
    assert.equal(preservePriorBulkResult(previous, result('retain.example')).preserve, false);
  });

  test('exports selected review context without raw records or contact data', async () => {
    const manifest = await buildBulkReviewManifest({
      rows: [{
        ...result('review.example'),
        registrant: { email: 'private@example.test' },
        rawWhois: 'excluded raw record',
      }],
      reviewStates: [{ domain: 'review.example', state: 'reviewing' }],
      view: {
        primaryFilter: 'all',
        mutationFilter: '',
        signalFilters: [],
        sourceFilter: '',
        lifecycleFilter: '',
        ageFilter: '',
        mailFilter: '',
        registrarFilter: '',
        caseDispositionFilter: '',
        reviewStateFilter: '',
        groupBy: '',
        sortKey: 'risk',
        sortDirection: -1,
      },
      lookupProfile: 'deep',
      observedAt: OBSERVED_AT,
      generatedAt: GENERATED_AT,
    });
    assert.equal(manifest.document.rows[0]?.reviewState, 'reviewing');
    assert.match(manifest.document.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(manifest.content.includes('private@example.test'), false);
    assert.equal(manifest.content.includes('excluded raw record'), false);
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildBulkDomainComparison,
  buildBulkDomainComparisonExport,
} from '../frontend/src/lib/analysis/bulk-domain-comparison.ts';
import { nextBulkReviewIndex, type BulkReviewCockpitRow } from '../frontend/src/lib/analysis/bulk-review-cockpit.ts';
import { buildBulkReviewManifest } from '../frontend/src/lib/analysis/bulk-review-export.ts';
import { sha256ArtifactDigestV2 } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import { buildBulkRetryPlan, preservePriorBulkResult } from '../frontend/src/lib/analysis/bulk-retry-plan.ts';
import type { BulkSessionResult } from '../frontend/src/lib/analysis/bulk-session-model.ts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';

const OBSERVED_AT = '2026-07-20T00:00:00.000Z';
const GENERATED_AT = '2026-07-28T00:00:00.000Z';

async function redigest<T extends Record<string, unknown>>(value: T): Promise<T> {
  const { integrity, ...unsigned } = value;
  return {
    ...unsigned,
    integrity: { ...(integrity as Record<string, unknown>), digestSha256: await sha256ArtifactDigestV2(unsigned) },
  } as unknown as T;
}

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
    hasExternalFormAction: null,
    phishingLanguageMatch: null,
    riskModelVersion: 5,
    riskFactors: [],
    dns: null,
    dnssec: null,
    comparisonEvidence: null,
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
    profileContext: {
      sourceState: 'ready',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: '',
    },
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
    riskPresentation: {
      state: 'comparable',
      band: 'review',
      label: 'Review',
      summary: 'Review priority.',
      exactScore: 60,
      modelVersion: 8,
      modelLabel: 'Risk model v8',
      scanDepth: 'fast',
      coverageLabel: 'lookup complete',
      provenanceLabel: 'Ready Brand Profile provenance',
      factors: [],
      limitations: [],
    },
    opportunity: 10,
    activity: 'Active',
    registrar: 'Example Registrar',
    reviewState,
    shortlisted: false,
    trusted: false,
    profileContextReady: true,
    profileContextLimitation: '',
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
    assert.equal(comparison.version, 3);
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
    const verification = await verifyOfflineArtifact(exported.content);
    assert.equal(verification.artifact.schema, 'whoisleuth.domain-comparison');
    assert.equal(verification.state, 'verified');
  });

  test('compares bounded technology, issuer, and public-key evidence when retained', () => {
    const shared = {
      version: 1 as const,
      technology: { state: 'success' as const, ids: ['shop-platform'], truncated: false },
      tls: {
        state: 'success' as const,
        issuerLabel: 'Example Issuing CA',
        spkiSha256: 'a'.repeat(64),
      },
    };
    const comparison = buildBulkDomainComparison(
      result('left.example', { comparisonEvidence: shared }),
      result('right.example', {
        comparisonEvidence: {
          ...shared,
          technology: { ...shared.technology, ids: ['web-framework'] },
          tls: { ...shared.tls, spkiSha256: 'b'.repeat(64) },
        },
      }),
      OBSERVED_AT,
    );

    assert.equal(comparison?.rows.find((row) => row.id === 'technology')?.state, 'different');
    assert.equal(comparison?.rows.find((row) => row.id === 'tls-issuer')?.state, 'equal');
    assert.equal(comparison?.rows.find((row) => row.id === 'tls-spki')?.state, 'different');
  });

  test('rejects re-digested comparison row omissions, reordering, and observation-time divergence', async () => {
    const comparison = buildBulkDomainComparison(
      result('left.example'),
      result('right.example'),
      OBSERVED_AT,
      { now: Date.parse(GENERATED_AT) },
    );
    assert.ok(comparison);
    const exported = await buildBulkDomainComparisonExport(comparison, GENERATED_AT);

    const omitted = structuredClone(exported.document) as unknown as Record<string, unknown>;
    const omittedComparison = omitted.comparison as Record<string, unknown>;
    const omittedRows = omittedComparison.rows as Array<Record<string, unknown>>;
    const [removed] = omittedRows.splice(5, 1);
    assert.ok(removed);
    const omittedCounts = omittedComparison.counts as Record<string, number>;
    const removedState = String(removed.state);
    omittedCounts[removedState] = (omittedCounts[removedState] ?? 0) - 1;
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await redigest(omitted))),
      /domain comparison rows.*unsupported or malformed structure/iu,
    );

    const reordered = structuredClone(exported.document) as unknown as Record<string, unknown>;
    const reorderedRows = ((reordered.comparison as Record<string, unknown>).rows as unknown[]);
    [reorderedRows[0], reorderedRows[1]] = [reorderedRows[1], reorderedRows[0]];
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await redigest(reordered))),
      /domain comparison row order.*unsupported or malformed structure/iu,
    );

    const divergent = structuredClone(exported.document) as unknown as Record<string, unknown>;
    const firstRow = (((divergent.comparison as Record<string, unknown>).rows as Array<Record<string, unknown>>)[0]!);
    firstRow.observedAt = '2026-07-20T00:00:01.000Z';
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await redigest(divergent))),
      /domain comparison row observedAt.*unsupported or malformed structure/iu,
    );
  });

  test('withholds official-asset comparison when row profile provenance is not ready and identical', () => {
    const comparison = buildBulkDomainComparison(
      result('left.example', { reusesOfficialAssets: false }),
      result('right.example', {
        reusesOfficialAssets: true,
        profileContext: {
          sourceState: 'unavailable',
          activeProfileId: null,
          profileUpdatedAt: null,
          limitation: 'Imported profile-derived conclusions require a local rescan.',
        },
      }),
      OBSERVED_AT,
    );
    const officialAssets = comparison?.rows.find((row) => row.id === 'official-assets');
    assert.equal(officialAssets?.state, 'unavailable');
    assert.equal(officialAssets?.left, 'Not observed');
    assert.equal(officialAssets?.right, 'Not observed');
    assert.match(officialAssets?.limitations.join(' ') ?? '', /withheld unless both rows retain the same ready Brand Profile provenance/u);
    assert.match(comparison?.limitations.join(' ') ?? '', /Profile-derived identity comparison is unavailable/u);
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

  test('previews source-attributed and stale retries before collection', () => {
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

  test('does not retry a registry protocol that is authoritatively not published', () => {
    const plan = buildBulkRetryPlan([
      result('example.dev', {
        sourceCoverage: [
          { source: 'rdap', state: 'complete' },
          { source: 'whois', state: 'unsupported' },
        ],
      }),
      result('example.com', {
        sourceCoverage: [
          { source: 'rdap', state: 'complete' },
          { source: 'whois', state: 'unsupported' },
        ],
      }),
    ], 'deep', GENERATED_AT, Date.parse(GENERATED_AT));
    assert.equal(plan.lookupRequests, 1);
    assert.equal(plan.rows[0]?.domain, 'example.com');
    assert.deepEqual(plan.rows[0]?.limitedSources, ['whois']);
  });

  test('does not retry a row solely because a source was deliberately skipped', () => {
    const plan = buildBulkRetryPlan([
      result('fast.example', {
        scanDepth: 'fast',
        sourceCoverage: [
          { source: 'rdap', state: 'complete' },
          { source: 'whois', state: 'skipped' },
        ],
      }),
    ], 'fast', GENERATED_AT, Date.parse(GENERATED_AT));
    assert.equal(plan.lookupRequests, 0);
    assert.deepEqual(plan.rows, []);
    assert.match(plan.limitations.join(' '), /deliberately skipped/i);
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
    assert.deepEqual(manifest.document.rows[0]?.profileContext, {
      sourceState: 'ready',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: '',
    });
    assert.match(manifest.document.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(manifest.content.includes('private@example.test'), false);
    assert.equal(manifest.content.includes('excluded raw record'), false);
    const verification = await verifyOfflineArtifact(manifest.content);
    assert.equal(verification.artifact.schema, 'whoisleuth.bulk-review-manifest');
    assert.equal(verification.state, 'verified');
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildBulkMailExposureExport,
  buildBulkMailExposureReport,
} from '../frontend/src/lib/analysis/bulk-mail-exposure.ts';
import type { BulkSessionResult } from '../frontend/src/lib/analysis/bulk-session-model.ts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';

const OBSERVED_AT = '2026-07-29T01:00:00.000Z';

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
    risk: 20,
    opportunity: 10,
    mutationTypes: ['omission'],
    trusted: null,
    error: '',
    scanDepth: 'deep',
    createdDate: null,
    expiryDate: null,
    nameservers: ['ns1.example.test'],
    hasMx: true,
    hasNullMx: false,
    hasSpf: true,
    hasDmarc: true,
    activityStatus: 'active',
    pageTitle: null,
    faviconHash: null,
    faviconPHash: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    hasPasswordField: false,
    hasExternalFormAction: null,
    phishingLanguageMatch: null,
    riskModelVersion: 6,
    riskFactors: [],
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
    sourceCoverage: [{ source: 'dns', state: 'complete' }],
    profileContext: {
      sourceState: 'ready',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: '',
    },
    ...overrides,
  };
}

describe('Bulk lookalike mail exposure', () => {
  test('keeps receiving, null-MX, no-explicit-MX, gaps, and incomplete evidence separate', () => {
    const report = buildBulkMailExposureReport([
      result('authenticated.example'),
      result('gap.example', { hasDmarc: false }),
      result('partial-auth.example', { hasDmarc: null }),
      result('null-mx.example', { hasMx: false, hasNullMx: true, hasSpf: true, hasDmarc: true }),
      result('no-mx.example', { hasMx: false, hasNullMx: false, hasSpf: false, hasDmarc: false }),
      result('incomplete.example', {
        hasMx: null,
        hasNullMx: null,
        hasSpf: null,
        hasDmarc: null,
        sourceCoverage: [{ source: 'dns', state: 'unavailable' }],
      }),
    ], {
      generatedAt: OBSERVED_AT,
      observedAt: OBSERVED_AT,
      officialDomains: ['official.example'],
      profile: 'standard',
    });

    assert.equal(report.counts.authenticated_mail, 1);
    assert.equal(report.counts.mail_auth_gap, 1);
    assert.equal(report.counts.mail_auth_incomplete, 1);
    assert.equal(report.counts.null_mx, 1);
    assert.equal(report.counts.no_explicit_mx, 1);
    assert.equal(report.counts.evidence_incomplete, 1);
    assert.equal(
      report.rows.find((row) => row.domain === 'authenticated.example')?.baselineRelation,
      'aligned',
    );
    assert.equal(
      report.rows.find((row) => row.domain === 'null-mx.example')?.baselineRelation,
      'review',
    );
    assert.match(
      report.rows.find((row) => row.domain === 'no-mx.example')?.limitations.join(' ') ?? '',
      /not equivalent to a null MX/u,
    );
  });

  test('uses configured no-mail context without treating it as a live observation', () => {
    const report = buildBulkMailExposureReport([
      result('null-mx.example', { hasMx: false, hasNullMx: true }),
      result('receiving.example'),
      result('official.example', {
        trusted: 'official',
        profileContext: {
          sourceState: 'ready',
          activeProfileId: 'profile-one',
          profileUpdatedAt: OBSERVED_AT,
          limitation: '',
        },
      }),
    ], {
      generatedAt: OBSERVED_AT,
      officialDomains: ['OFFICIAL.EXAMPLE.'],
      profile: 'defensive_no_mail',
    });
    assert.equal(report.rows.length, 2);
    assert.deepEqual(report.baseline.officialDomains, ['official.example']);
    assert.equal(report.rows[0]?.baselineRelation, 'aligned');
    assert.equal(report.rows[1]?.baselineRelation, 'review');
    assert.match(report.baseline.limitations.join(' '), /analyst-configured/u);
  });

  test('treats fast or unrecorded DNS collection as incomplete', () => {
    const report = buildBulkMailExposureReport([
      result('fast.example', {
        scanDepth: 'fast',
        hasMx: false,
        hasNullMx: false,
        hasSpf: false,
        hasDmarc: false,
        sourceCoverage: [],
      }),
    ], { generatedAt: OBSERVED_AT });
    assert.equal(report.rows[0]?.state, 'evidence_incomplete');
    assert.match(report.rows[0]?.limitations.join(' ') ?? '', /Fast mode/u);
  });

  test('keeps loading and unavailable Brand Profile mail context inconclusive', () => {
    for (const profileSourceState of ['loading', 'unavailable'] as const) {
      const report = buildBulkMailExposureReport([result('candidate.example')], {
        generatedAt: OBSERVED_AT,
        officialDomains: ['official.example'],
        profile: 'standard',
        profileSourceState,
      });
      assert.equal(report.baseline.profile, null);
      assert.deepEqual(report.baseline.officialDomains, []);
      assert.match(report.baseline.label, new RegExp(profileSourceState, 'iu'));
      assert.equal(report.rows[0]?.baselineRelation, 'inconclusive');
      assert.match(report.rows[0]?.baselineDetail ?? '', /context/u);
      assert.match(report.rows[0]?.limitations.join(' ') ?? '', /not evaluated/u);
    }
  });

  test('retains DNS posture but makes mismatched row baselines inconclusive and export-visible', async () => {
    const report = buildBulkMailExposureReport([
      result('mismatched.example', {
        hasMx: true,
        hasNullMx: false,
        hasSpf: false,
        hasDmarc: false,
        profileContext: {
          sourceState: 'unavailable',
          activeProfileId: null,
          profileUpdatedAt: null,
          limitation: 'Imported profile-derived conclusions require a local rescan.',
        },
      }),
    ], {
      generatedAt: OBSERVED_AT,
      officialDomains: ['official.example'],
      profile: 'standard',
      profileSourceState: 'ready',
      currentProfileContext: {
        sourceState: 'ready',
        activeProfileId: 'profile-one',
        profileUpdatedAt: OBSERVED_AT,
        limitation: '',
      },
    });
    const row = report.rows[0];
    assert.equal(row?.state, 'mail_auth_gap');
    assert.equal(row?.baselineRelation, 'inconclusive');
    assert.equal(row?.profileContextState, 'unavailable');
    assert.match(row?.profileContextLimitation ?? '', /local rescan/u);
    assert.equal(report.profileContextUnevaluatedCount, 1);
    const exported = await buildBulkMailExposureExport(report);
    assert.equal(exported.document.report.rows[0]?.profileContextState, 'unavailable');
    assert.match(exported.document.report.rows[0]?.profileContextLimitation ?? '', /local rescan/u);
    assert.equal(exported.document.report.profileContextUnevaluatedCount, 1);
  });

  test('exports a deterministic bounded review without raw records', async () => {
    const report = buildBulkMailExposureReport([{
      ...result('export.example'),
      rawWhois: 'excluded',
      registrant: { email: 'private@example.test' },
    }], {
      generatedAt: OBSERVED_AT,
      observedAt: OBSERVED_AT,
    });
    const first = await buildBulkMailExposureExport(report);
    const second = await buildBulkMailExposureExport(report);
    assert.equal(first.content, second.content);
    assert.match(first.document.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(first.content.includes('private@example.test'), false);
    assert.equal(first.content.includes('excluded'), false);
    const verification = await verifyOfflineArtifact(first.content);
    assert.equal(verification.artifact.schema, 'whoisleuth.bulk-mail-exposure');
    assert.equal(verification.state, 'verified');
  });
});

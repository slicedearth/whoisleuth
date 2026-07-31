import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildStaticPagePatternPackDocument,
  lintStaticPagePatternPacks,
  REVIEWED_STATIC_PAGE_PATTERN_PACKS,
  reviewedStaticPagePatternPackExport,
  validateStaticPagePatternPack,
} from '../frontend/src/lib/analysis/static-page-pattern-packs.ts';
import {
  evaluateDetectionRules,
  mergeDetectionRules,
} from '../frontend/src/lib/analysis/detection-rule-model.ts';
import type { CaseRecord } from '../frontend/src/lib/analysis/case-model.ts';

function fixtureCase(overrides: Record<string, unknown> = {}): CaseRecord {
  return {
    id: 'fixture-case',
    domain: 'fixture.invalid',
    status: 'reviewing',
    disposition: 'unreviewed',
    tags: [],
    notes: [],
    source: 'lookup',
    evidenceHistory: [{
      id: 'fixture-evidence',
      fingerprint: 'fixture-fingerprint',
      firstCapturedAt: '2026-07-30T00:00:00.000Z',
      capturedAt: '2026-07-30T00:00:00.000Z',
      source: 'lookup',
      scanDepth: 'deep',
      availability: 'registered',
      confidence: 'high',
      riskModelVersion: null,
      riskScore: null,
      opportunityScore: null,
      riskFactors: [],
      opportunityFactors: [],
      registrar: null,
      createdDate: null,
      expiryDate: null,
      nameservers: [],
      hasMx: false,
      hasSpf: false,
      hasDmarc: false,
      activityStatus: 'active',
      websiteProbeDetail: null,
      pageTitle: null,
      httpSummaryVersion: null,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: null,
      httpResponseStatus: 200,
      httpTransportSecurity: 'https',
      httpRedirectCount: 0,
      httpCrossOriginRedirect: false,
      httpHttpsDowngrade: false,
      httpContentType: 'text/html',
      httpSecurityHeaders: [],
      faviconMatch: false,
      faviconNearMatch: false,
      reusesOfficialAssets: false,
      hasPasswordField: false,
      hasExternalFormAction: false,
      phishingLanguageMatch: null,
      mutationTypes: [],
      ...overrides,
    }],
    evidencePins: [],
    decisions: [],
    actions: [],
    assertions: [],
    manualTrail: [],
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
}

describe('reviewed static page-pattern packs', () => {
  test('contain fixed non-scoring rules using only supported conditions', () => {
    assert.equal(REVIEWED_STATIC_PAGE_PATTERN_PACKS.length, 6);
    for (const pack of REVIEWED_STATIC_PAGE_PATTERN_PACKS) {
      const exported = reviewedStaticPagePatternPackExport(pack.id);
      const merged = mergeDetectionRules([], exported);
      assert.equal(merged.skipped, 0);
      assert.equal(merged.added, pack.rules.length);
      assert.ok(merged.rules.every((rule) => rule.riskDelta === 0));
      assert.equal(pack.confidence, 'review_required');
    }
  });

  test('passes collision lint and separates generic from brand-relative patterns', () => {
    assert.deepEqual(lintStaticPagePatternPacks(REVIEWED_STATIC_PAGE_PATTERN_PACKS), {
      errors: [],
      warnings: [],
    });
    assert.ok(REVIEWED_STATIC_PAGE_PATTERN_PACKS.some((pack) => pack.relationship === 'generic'));
    assert.ok(REVIEWED_STATIC_PAGE_PATTERN_PACKS.some((pack) => pack.relationship === 'brand_relative'));
  });

  test('validates bounded local packs through the same non-scoring rule contract', () => {
    const source = REVIEWED_STATIC_PAGE_PATTERN_PACKS[0]!;
    const validated = validateStaticPagePatternPack(buildStaticPagePatternPackDocument(source));
    assert.equal(validated.id, source.id);
    assert.equal(validated.confidence, 'review_required');
    assert.throws(() => validateStaticPagePatternPack({
      ...buildStaticPagePatternPackDocument(source),
      rules: [{ ...source.rules[0], riskDelta: 4 }],
    }), /cannot contribute to Risk/u);
    assert.throws(() => validateStaticPagePatternPack({
      ...buildStaticPagePatternPackDocument(source),
      rules: [{ ...source.rules[0], conditions: [{ field: 'unknown', operator: 'execute', value: 'code' }] }],
    }), /invalid/u);
  });

  test('holds generic benign fixtures apart from brand-relative and external-form cues', () => {
    const credentialRules = reviewedStaticPagePatternPackExport('credential-overlap');
    const externalFormRules = reviewedStaticPagePatternPackExport('external-form-destination');
    const benign = fixtureCase({
      hasPasswordField: true,
      hasExternalFormAction: false,
      faviconMatch: false,
      reusesOfficialAssets: false,
    });
    assert.equal(evaluateDetectionRules(benign, credentialRules).matchedRules.length, 0);
    assert.equal(evaluateDetectionRules(benign, externalFormRules).matchedRules.length, 0);
  });

  test('matches held-out urgent, wallet, copied-identity, and external-form fixtures explicitly', () => {
    const urgent = evaluateDetectionRules(fixtureCase({
      hasPasswordField: true,
      phishingLanguageMatch: 'immediate action required',
    }), reviewedStaticPagePatternPackExport('urgent-account-language'));
    const wallet = evaluateDetectionRules(fixtureCase({
      phishingLanguageMatch: 'enter your recovery phrase',
    }), reviewedStaticPagePatternPackExport('wallet-prompt-cues'));
    const copiedIdentity = evaluateDetectionRules(fixtureCase({
      hasPasswordField: true,
      reusesOfficialAssets: true,
    }), reviewedStaticPagePatternPackExport('credential-overlap'));
    const externalForm = evaluateDetectionRules(fixtureCase({
      hasPasswordField: true,
      hasExternalFormAction: true,
    }), reviewedStaticPagePatternPackExport('external-form-destination'));
    assert.equal(urgent.matchedRules.map((item) => item.id).includes('pack-urgent-account-language-v1'), true);
    assert.equal(wallet.matchedRules.map((item) => item.id).includes('pack-wallet-recovery-v1'), true);
    assert.equal(copiedIdentity.matchedRules.map((item) => item.id).includes('pack-credential-assets-v1'), true);
    assert.equal(externalForm.matchedRules.map((item) => item.id).includes('pack-password-external-form-v1'), true);
    assert.equal([...urgent.matchedRules, ...wallet.matchedRules, ...copiedIdentity.matchedRules, ...externalForm.matchedRules]
      .every((item) => item.riskDelta === 0), true);
  });

  test('returns defensive copies and rejects unknown packs', () => {
    const first = reviewedStaticPagePatternPackExport('credential-overlap');
    const second = reviewedStaticPagePatternPackExport('credential-overlap');
    assert.notEqual(first.rules, second.rules);
    assert.notEqual(first.rules[0]?.conditions, second.rules[0]?.conditions);
    assert.throws(() => reviewedStaticPagePatternPackExport('missing'), /unavailable/);
  });
});

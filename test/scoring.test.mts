// Covers the frontend's framework-neutral opportunity/risk score formulas
// and supporting formatters.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as scoring from '../frontend/src/lib/analysis/scoring.ts';
import { requiredValue } from './value-assertions.mts';
import {
  THREAT_INTELLIGENCE_CONTRACT_VERSION,
  THREAT_INTELLIGENCE_ENVELOPE_VERSION,
  THREAT_INTELLIGENCE_SCHEMA,
} from '../lib/threat-intelligence-types.mts';

const SCORING_DOMAIN = 'example.test';

function threatProvider(id: string, overrides: Record<string, unknown> = {}) {
  return {
    schema: THREAT_INTELLIGENCE_SCHEMA,
    version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
    provider: { id },
    target: { type: 'domain', value: SCORING_DOMAIN, exposure: 'registrable_domain' },
    state: 'success',
    findings: [{ category: 'malware', lastObservedAt: '2026-07-12T00:00:00.000Z' }],
    observation: { observedAt: '2026-07-15T00:00:00.000Z' },
    ...overrides,
  };
}

function threatEnvelope(providers: unknown[]) {
  return { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION, providers };
}

function opportunityExplanation(value: unknown): scoring.OpportunityExplanation {
  return requiredValue(scoring.explainOpportunityScore(value));
}

function riskExplanation(value: scoring.RiskInput): scoring.RiskExplanation {
  return requiredValue(scoring.explainRiskScore(value));
}

describe('fmtAge', () => {
  test('null/undefined pass through as null', () => {
    assert.equal(scoring.fmtAge(null), null);
    assert.equal(scoring.fmtAge(undefined), null);
    assert.equal(scoring.fmtAge(-1), null);
  });

  test('under 60 days is shown in days', () => {
    assert.equal(scoring.fmtAge(0), '0d old');
    assert.equal(scoring.fmtAge(59), '59d old');
    assert.equal(scoring.fmtAge(29.6), '30d old');
  });

  test('under a year is shown in months', () => {
    assert.equal(scoring.fmtAge(60), '2mo old');
  });

  test('a year or more is shown in years to one decimal', () => {
    assert.equal(scoring.fmtAge(400), '1.1y old');
  });
});

describe('fmtExpiresIn', () => {
  test('null/undefined pass through as null', () => {
    assert.equal(scoring.fmtExpiresIn(null), null);
    assert.equal(scoring.fmtExpiresIn(undefined), null);
  });

  test('zero or positive days is "expires in"', () => {
    assert.equal(scoring.fmtExpiresIn(0), 'expires in 0d');
    assert.equal(scoring.fmtExpiresIn(10), 'expires in 10d');
    assert.equal(scoring.fmtExpiresIn(2.6), 'expires in 3d');
  });

  test('negative days is "expired ... ago"', () => {
    assert.equal(scoring.fmtExpiresIn(-1), 'expired 1d ago');
  });
});

describe('formatPrivacyCell', () => {
  test('maps true/false/null to Protected/Public/em-dash', () => {
    assert.equal(scoring.formatPrivacyCell(true), 'Privacy protected');
    assert.equal(scoring.formatPrivacyCell(false), 'Public registrant data');
    assert.equal(scoring.formatPrivacyCell(null), '—');
    assert.equal(scoring.formatPrivacyCell(undefined), '—');
  });
});

describe('formatActivityCell', () => {
  test('combines the activity label with configured mail records', () => {
    assert.equal(scoring.formatActivityCell('active', true, true, true), 'Active site · MX+SPF+DMARC');
  });

  test('omits the mail suffix when nothing is configured', () => {
    assert.equal(scoring.formatActivityCell('active', false, false, false), 'Active site');
    assert.equal(scoring.formatActivityCell('unreachable', false, false, false), 'Website check inconclusive');
    assert.equal(scoring.formatActivityCell('active', 'false', 1, {}), 'Active site');
  });

  test('falls back to an em-dash for an unrecognized/missing status', () => {
    assert.equal(scoring.formatActivityCell(undefined, true, false, false), '— · MX');
  });
});

describe('explainOpportunityScore / computeOpportunityScore', () => {
  test('returns null for states with no base score (unknown, error)', () => {
    assert.equal(scoring.explainOpportunityScore({ availability: 'unknown' }), null);
    assert.equal(scoring.explainOpportunityScore({ availability: 'error' }), null);
    assert.equal(scoring.computeOpportunityScore({ availability: 'unknown' }), null);
  });

  test('reads the state from r.state when r.availability is absent', () => {
    assert.equal(scoring.computeOpportunityScore({ state: 'available' }), 82);
  });

  test('uses versioned readiness bases rather than estimating domain value', () => {
    assert.equal(scoring.OPPORTUNITY_MODEL_VERSION, 2);
    assert.equal(scoring.computeOpportunityScore({ availability: 'for_sale' }), 76);
    assert.equal(scoring.computeOpportunityScore({ availability: 'expiring' }), 52);
    assert.equal(scoring.computeOpportunityScore({ availability: 'available' }), 82);
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered' }), 22);
  });

  test('confidence and explicit contactability have bounded visible dimensions', () => {
    const explained = opportunityExplanation({
      availability: 'registered',
      confidence: 'high',
      hasPublicRegistrantContact: true,
    });
    assert.equal(explained.modelVersion, 2);
    assert.equal(explained.score, 40);
    assert.deepEqual(explained.dimensions.map((item) => item.id), ['registration', 'contactability']);
  });

  test('active and parked pages qualify readiness without treating failed probes as no site', () => {
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', activityStatus: 'parked' }), 25);
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', activityStatus: 'active' }), 10);
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', activityStatus: 'unreachable' }), 22);
  });

  test('registration privacy and age remain zero-point context', () => {
    const publicRegistration = opportunityExplanation({ availability: 'registered', privacyProtected: false, domainAgeDays: 730 });
    const privateRegistration = opportunityExplanation({ availability: 'registered', privacyProtected: true, domainAgeDays: 730 });
    assert.equal(publicRegistration.score, 22);
    assert.equal(privateRegistration.score, 22);
    assert.ok(privateRegistration.factors.every((factor) => !factor.label.includes('Privacy protected')));
  });

  test('a domain age of exactly zero is retained as neutral context', () => {
    const explained = opportunityExplanation({ availability: 'registered', domainAgeDays: 0 });
    assert.equal(explained.factors.at(-1)?.delta, 0);
    assert.equal(explained.score, 22);
  });

  test('imminent expiry is a small lifecycle cue and explicitly does not imply release', () => {
    const explained = opportunityExplanation({ availability: 'registered', expiresInDays: 15 });
    assert.equal(explained.score, 26);
    assert.ok(explained.factors.some((factor) => factor.label.includes('release is not implied')));
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', expiresInDays: 30 }), 22);
  });

  test('the total is clamped and evidence quality is reported separately', () => {
    const explained = opportunityExplanation({
      availability: 'for_sale',
      confidence: 'high',
      hasPublicRegistrantContact: true,
      scanDepth: 'fast',
      observedAt: '2026-08-01T00:00:00.000Z',
      sourceCoverage: [{ source: 'rdap', state: 'complete' }],
    });
    assert.equal(explained.score, 94);
    assert.equal(explained.evidenceQuality.state, 'complete');
    assert.equal(explained.evidenceQuality.freshness, 'observed');
  });

  test('incomplete sources qualify Opportunity without lowering readiness', () => {
    const complete = opportunityExplanation({
      availability: 'available', scanDepth: 'fast', observedAt: '2026-08-01T00:00:00.000Z',
      sourceCoverage: [{ source: 'rdap', state: 'complete' }],
    });
    const partial = opportunityExplanation({
      availability: 'available', scanDepth: 'fast', observedAt: 'not-a-time',
      sourceCoverage: [{ source: 'rdap', state: 'unavailable' }],
    });
    assert.equal(complete.score, partial.score);
    assert.equal(partial.evidenceQuality.state, 'partial');
    assert.equal(partial.evidenceQuality.freshness, 'unknown');
  });

  test('reports skipped sources without changing score or hiding the invariant limitation', () => {
    const complete = opportunityExplanation({
      availability: 'available', scanDepth: 'fast',
      sourceCoverage: [{ source: 'rdap', state: 'complete' }],
    });
    const skipped = opportunityExplanation({
      availability: 'available', scanDepth: 'fast',
      sourceCoverage: [
        { source: 'rdap', state: 'complete' },
        { source: 'whois', state: 'unsupported' },
      ],
    });
    assert.equal(skipped.score, complete.score);
    assert.equal(skipped.evidenceQuality.skippedSources, 1);
    assert.match(skipped.evidenceQuality.limitations.join(' '), /skipped or unsupported/u);
    assert.match(skipped.evidenceQuality.limitations.at(-1) ?? '', /never adds points/u);
  });
});

describe('scoreTone', () => {
  test('buckets the opportunity score into a tone', () => {
    assert.equal(scoring.scoreTone(null), 'neutral');
    assert.equal(scoring.scoreTone(100), 'good');
    assert.equal(scoring.scoreTone(70), 'good');
    assert.equal(scoring.scoreTone(69), 'neutral');
    assert.equal(scoring.scoreTone(40), 'neutral');
    assert.equal(scoring.scoreTone(39), 'warn');
    assert.equal(scoring.scoreTone(0), 'warn');
  });
});

describe('explainRiskScore / computeRiskScore', () => {
  test('returns null for states that are not a risk-relevant registration', () => {
    assert.equal(scoring.explainRiskScore({ availability: 'available' }), null);
    assert.equal(scoring.explainRiskScore({ availability: 'unknown' }), null);
    assert.equal(scoring.explainRiskScore({ availability: 'error' }), null);
    assert.equal(scoring.computeRiskScore({ availability: 'available' }), null);
  });

  test('stamps the explicit model version and gives ordinary states a low base score', () => {
    assert.equal(scoring.RISK_MODEL_VERSION, 7);
    assert.equal(riskExplanation({ availability: 'registered' }).modelVersion, 7);
    assert.equal(scoring.computeRiskScore({ availability: 'registered' }), 6);
    assert.equal(scoring.computeRiskScore({ availability: 'for_sale' }), 4);
    assert.equal(scoring.computeRiskScore({ availability: 'expiring' }), 5);
  });

  test('generic activity, mail, age, and privacy cues are neutral without independent context', () => {
    const explained = riskExplanation({
      availability: 'registered', activityStatus: 'active', hasMx: true,
      hasSpf: true, hasDmarc: true, privacyProtected: true, domainAgeDays: 10,
    });
    assert.equal(explained.score, 6);
    assert.ok(explained.factors.filter((factor) => factor.family === 'operational-support').every((factor) => factor.delta === 0));
    assert.equal(explained.factors.find((factor) => factor.label.includes('privacy'))?.delta, 0);
  });

  test('whole-label provenance does not add a second Unicode Risk contribution', () => {
    const existing = scoring.explainRiskScore({
      availability: 'registered',
      mutationTypes: ['unicode_homoglyph'],
    });
    const wholeLabel = scoring.explainRiskScore({
      availability: 'registered',
      mutationTypes: ['unicode_homoglyph', 'unicode_whole_label'],
    });
    assert.deepEqual(wholeLabel, existing);
  });

  test('advanced Unicode provenance uses the existing high-context contribution', () => {
    assert.equal(scoring.computeRiskScore({
      availability: 'registered',
      mutationTypes: ['unicode_homoglyph_depth_2'],
    }), 24);
  });

  test('brand observations share one capped family and do not self-corroborate', () => {
    const brand = riskExplanation({
      availability: 'registered',
      faviconMatch: true,
      reusesOfficialAssets: true,
      pageBaselineMatch: true,
    });
    assert.equal(brand.score, 30);
    assert.equal(brand.families.find((family) => family.id === 'brand-presentation')?.contribution, 24);
    assert.equal(brand.factors.some((factor) => factor.label.includes('Corroborating')), false);
  });

  test('external password destinations strengthen credential evidence without double counting', () => {
    const explained = riskExplanation({
      availability: 'registered', phishingLanguageMatch: 'verify your account',
      hasPasswordField: true, hasExternalFormAction: true,
    });
    assert.equal(explained.score, 24);
    assert.equal(explained.families.find((family) => family.id === 'credential-lure')?.contribution, 18);
  });

  test('IDN reference matching and mutation provenance share one capped resemblance family', () => {
    const explained = riskExplanation({
      availability: 'registered', mutationTypes: ['dictionary'], idnReferenceMatch: true,
    });
    assert.equal(explained.score, 26);
    assert.equal(explained.families.find((family) => family.id === 'domain-resemblance')?.contribution, 20);
  });

  test('two independent contextual families receive a visible bounded bonus', () => {
    const explained = riskExplanation({
      availability: 'registered',
      mutationTypes: ['dictionary'],
      faviconMatch: true,
    });
    assert.equal(explained.score, 52);
    assert.equal(explained.factors.find((factor) => factor.family === 'corroboration')?.delta, 10);
  });

  test('strong evidence across three primary families reaches review with bounded support', () => {
    const explained = riskExplanation({
      availability: 'registered',
      mutationTypes: ['dictionary'],
      faviconMatch: true,
      reusesOfficialAssets: true,
      phishingLanguageMatch: 'verify your account',
      hasPasswordField: true,
      activityStatus: 'active', hasMx: true, domainAgeDays: 10,
    });
    assert.equal(explained.score, 91);
    assert.equal(scoring.riskTone(explained.score), 'danger');
    assert.equal(explained.families.find((family) => family.id === 'operational-support')?.contribution, 12);
  });

  test('a single contextual family stays below review even with capped operational support', () => {
    const score = scoring.computeRiskScore({
      availability: 'registered',
      faviconMatch: true,
      reusesOfficialAssets: true,
      activityStatus: 'active',
      hasMx: true,
      hasSpf: true,
      hasDmarc: true,
      privacyProtected: true,
      domainAgeDays: 10,
    });
    assert.equal(score, 42);
    assert.equal(scoring.riskTone(score), 'warn');
  });

  test('a lone external publisher and two same-publisher datasets add no Risk points', () => {
    assert.equal(scoring.computeRiskScore({
      domain: SCORING_DOMAIN,
      availability: 'registered',
      threatIntelligence: threatEnvelope([threatProvider('urlscan_search')]),
    }), 6);
    assert.equal(scoring.computeRiskScore({
      domain: SCORING_DOMAIN,
      availability: 'registered',
      threatIntelligence: threatEnvelope([threatProvider('urlhaus_host'), threatProvider('threatfox_domain_ioc')]),
    }), 6);
  });

  test('two independent recent publisher families add one explainable bounded factor', () => {
    const explained = riskExplanation({
      domain: SCORING_DOMAIN,
      availability: 'registered',
      threatIntelligence: threatEnvelope([threatProvider('urlscan_search'), threatProvider('urlhaus_host')]),
    });
    assert.equal(explained.score, 24);
    assert.equal(explained.factors.find((factor) => factor.family === 'external-intelligence')?.delta, 18);
  });

  test('unknown providers and malformed external records cannot affect Risk', () => {
    const explained = riskExplanation({
      domain: SCORING_DOMAIN,
      availability: 'registered',
      threatIntelligence: {
        version: THREAT_INTELLIGENCE_ENVELOPE_VERSION,
        providers: [
          { provider: { id: 'invented' }, state: 'success', findings: [{ category: 'malware' }] },
          { provider: { id: 'urlscan_search' }, state: 'not_found', findings: [{ category: 'malware' }] },
          { provider: { id: 'urlhaus_host' }, state: 'success', findings: [{ category: 'safe' }] },
        ],
      },
    });
    assert.equal(explained.score, 6);
    assert.equal(explained.factors.length, 1);
  });

  test('only allowlisted mutation provenance contributes bounded context', () => {
    assert.equal(scoring.computeRiskScore({ availability: 'registered', mutationTypes: ['dictionary'] }), 24);
    assert.equal(scoring.computeRiskScore({ availability: 'registered', mutationTypes: ['bitsquatting'] }), 18);
    assert.equal(scoring.computeRiskScore({ availability: 'registered', mutationTypes: ['character_addition'] }), 14);
    assert.equal(scoring.computeRiskScore({ availability: 'registered', mutationTypes: ['invented_high_risk'] }), 6);
  });

  test('malformed truthy values cannot create impersonation or operational factors', () => {
    const explained = riskExplanation({
      domain: SCORING_DOMAIN,
      availability: 'registered',
      faviconMatch: 'true',
      faviconNearMatch: 1,
      reusesOfficialAssets: {},
      phishingLanguageMatch: true,
      hasPasswordField: 'yes',
      hasMx: 'yes',
      hasSpf: 1,
      hasDmarc: {},
    });
    assert.equal(explained.score, 6);
    assert.deepEqual(explained.factors, [{ family: 'registration', label: 'Base context for “registered”', delta: 6 }]);
  });

  test('risk model versions are strictly bounded positive integers', () => {
    assert.equal(scoring.normalizeRiskModelVersion(1), 1);
    for (const value of [0, -1, 1.5, 1001, '1', null, undefined]) {
      assert.equal(scoring.normalizeRiskModelVersion(value), null);
    }
  });

  test('the total is clamped to 100 and missing evidence cannot add points', () => {
    const explained = riskExplanation({
      domain: SCORING_DOMAIN,
      availability: 'registered',
      mutationTypes: ['dictionary'],
      idnReferenceMatch: true,
      faviconMatch: true,
      reusesOfficialAssets: true,
      pageBaselineMatch: true,
      phishingLanguageMatch: 'verify your account',
      hasPasswordField: true,
      hasExternalFormAction: true,
      threatIntelligence: threatEnvelope([
        threatProvider('urlscan_search', { findings: [{ category: 'phishing', lastObservedAt: '2026-07-12T00:00:00.000Z' }] }),
        threatProvider('urlhaus_host'),
      ]),
      activityStatus: 'active',
      hasMx: true,
      hasSpf: true,
      hasDmarc: true,
      domainAgeDays: 10,
      scanDepth: 'deep',
      sourceCoverage: [{ source: 'rdap', state: 'partial' }],
    });
    assert.equal(explained.score, 100);
    assert.equal(explained.capped, true);
    assert.ok(explained.rawScore > 100);
    assert.equal(explained.evidenceQuality.state, 'partial');
  });

  test('missing profile comparison evidence qualifies Risk without subtracting points', () => {
    const explained = riskExplanation({
      availability: 'registered',
      hasActiveBrandProfile: true,
      scanDepth: 'deep',
      sourceCoverage: [{ source: 'rdap', state: 'complete' }],
    });
    assert.equal(explained.score, 6);
    assert.deepEqual(explained.evidenceQuality.missingFamilies, [
      'brand-presentation',
      'credential-lure',
      'domain-resemblance',
      'operational-support',
    ]);
    assert.equal(explained.evidenceQuality.state, 'limited');
  });

  test('missing source coverage remains unknown and never contributes score', () => {
    const withoutCoverage = riskExplanation({
      availability: 'registered',
      scanDepth: 'deep',
    });
    const unknownDepth = riskExplanation({
      availability: 'registered',
      scanDepth: 'unknown',
    });
    assert.equal(withoutCoverage.evidenceQuality.state, 'unknown');
    assert.match(withoutCoverage.evidenceQuality.limitations.join(' '), /Source-level coverage was not supplied/u);
    assert.equal(withoutCoverage.score, unknownDepth.score);
  });
});

describe('risk score sensitivity', () => {
  test('recalculates caps and corroboration after removing each contributing family', () => {
    const sensitivity = requiredValue(scoring.buildRiskScoreSensitivity({
      availability: 'registered',
      mutationTypes: ['unicode_homoglyph'],
      faviconMatch: true,
      hasPasswordField: true,
      hasExternalFormAction: true,
      activityStatus: 'active',
      hasMx: true,
      domainAgeDays: 20,
    }));
    assert.equal(sensitivity.baselineScore, 82);
    assert.equal(sensitivity.minimumScenarioScore, 56);
    assert.equal(sensitivity.thresholdState, 'crosses');
    assert.deepEqual(sensitivity.scenarios.map((scenario) => scenario.excludedFamily), [
      'brand-presentation',
      'domain-resemblance',
      'credential-lure',
      'operational-support',
    ]);
    assert.match(sensitivity.limitations[0] ?? '', /does not predict missing evidence/iu);
  });

  test('keeps non-applicable and below-threshold states explicit', () => {
    assert.equal(scoring.buildRiskScoreSensitivity({ availability: 'available' }), null);
    const sensitivity = requiredValue(scoring.buildRiskScoreSensitivity({ availability: 'registered' }));
    assert.equal(sensitivity.thresholdState, 'below');
    assert.deepEqual(sensitivity.scenarios, []);
  });
});

describe('riskTone', () => {
  test('buckets the risk score into a tone', () => {
    assert.equal(scoring.riskTone(null), 'neutral');
    assert.equal(scoring.riskTone(100), 'danger');
    assert.equal(scoring.riskTone(70), 'danger');
    assert.equal(scoring.riskTone(69), 'warn');
    assert.equal(scoring.riskTone(40), 'warn');
    assert.equal(scoring.riskTone(39), 'neutral');
    assert.equal(scoring.riskTone(0), 'neutral');
  });
});

describe('formatScoreBreakdown', () => {
  test('returns an empty string for a null explanation (non-applicable state)', () => {
    assert.equal(scoring.formatScoreBreakdown(null), '');
  });

  test('joins each factor and the total with the given separator, defaulting to newlines', () => {
    const explained: scoring.RiskExplanation = {
      modelVersion: scoring.RISK_MODEL_VERSION,
      score: 45,
      rawScore: 45,
      capped: false,
      factors: [
        { family: 'registration', label: 'A', delta: 40 },
        { family: 'registration', label: 'B', delta: -5 },
        { family: 'registration', label: 'C', delta: 10 },
      ],
      families: [],
      evidenceQuality: {
        version: 1,
        state: 'complete',
        scanDepth: 'deep',
        freshness: 'observed',
        completeSources: 1,
        limitedSources: 0,
        unavailableSources: 0,
        skippedSources: 0,
        observedFamilies: [],
        missingFamilies: [],
        limitations: [],
      },
    };
    assert.equal(scoring.formatScoreBreakdown(explained), `A +40\nB -5\nC +10\nTotal 45 · Risk model v${scoring.RISK_MODEL_VERSION} · evidence complete`);
    assert.equal(scoring.formatScoreBreakdown(explained, '; '), `A +40; B -5; C +10; Total 45 · Risk model v${scoring.RISK_MODEL_VERSION} · evidence complete`);
  });
});

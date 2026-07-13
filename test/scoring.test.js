// Covers the frontend's framework-neutral opportunity/risk score formulas
// and supporting formatters. The analysis modules are ESM through the
// frontend workspace, so tests load them with dynamic import().

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let scoring;
before(async () => {
  scoring = await import('../frontend/src/lib/analysis/scoring.js');
});

describe('fmtAge', () => {
  test('null/undefined pass through as null', () => {
    assert.equal(scoring.fmtAge(null), null);
    assert.equal(scoring.fmtAge(undefined), null);
  });

  test('under 60 days is shown in days', () => {
    assert.equal(scoring.fmtAge(0), '0d old');
    assert.equal(scoring.fmtAge(59), '59d old');
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
    assert.equal(scoring.computeOpportunityScore({ state: 'available' }), 90);
  });

  test('uses each state\'s base score with no other signals', () => {
    assert.equal(scoring.computeOpportunityScore({ availability: 'for_sale' }), 95);
    assert.equal(scoring.computeOpportunityScore({ availability: 'expiring' }), 85);
    assert.equal(scoring.computeOpportunityScore({ availability: 'available' }), 90);
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered' }), 40);
  });

  test('activity status shifts the score in the acquisition-friendly direction', () => {
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', activityStatus: 'parked' }), 55);
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', activityStatus: 'no_site' }), 45);
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', activityStatus: 'unreachable' }), 40);
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', activityStatus: 'active' }), 20);
  });

  test('public contact info scores higher than privacy-protected', () => {
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', privacyProtected: false }), 50);
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', privacyProtected: true }), 30);
  });

  test('age bonus scales with domain age and is capped at 20', () => {
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', domainAgeDays: 730 }), 44); // (730/365)*2 = 4
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', domainAgeDays: 10000 }), 60); // capped: 40 + 20
  });

  test('a domain age of exactly zero contributes no factor', () => {
    const explained = scoring.explainOpportunityScore({ availability: 'registered', domainAgeDays: 0 });
    assert.equal(explained.factors.length, 1); // base only
    assert.equal(explained.score, 40);
  });

  test('an imminent expiry only counts for a registered domain, under 30 days', () => {
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', expiresInDays: 15 }), 50);
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', expiresInDays: 30 }), 40); // not < 30
    assert.equal(scoring.computeOpportunityScore({ availability: 'registered', expiresInDays: -1 }), 40); // already expired, not counted
    assert.equal(scoring.computeOpportunityScore({ availability: 'available', expiresInDays: 15 }), 90); // only applies to 'registered'
  });

  test('the total is clamped to 100', () => {
    const score = scoring.computeOpportunityScore({
      availability: 'for_sale',
      activityStatus: 'parked',
      privacyProtected: false,
      domainAgeDays: 10000,
    });
    assert.equal(score, 100); // 95 + 15 + 10 + 20 = 140, clamped
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

  test('scores 40 for a bare registered domain with no other signals', () => {
    assert.equal(scoring.computeRiskScore({ availability: 'registered' }), 40);
  });

  test('a favicon match contributes a large, dedicated bonus', () => {
    assert.equal(scoring.computeRiskScore({ availability: 'registered', faviconMatch: true }), 70);
  });

  test('a perceptual favicon near-match scores slightly below an exact match', () => {
    assert.equal(scoring.computeRiskScore({ availability: 'registered', faviconNearMatch: true }), 62); // 40 base + 22
  });

  test('an exact favicon match takes precedence over a near-match (not double-counted)', () => {
    assert.equal(scoring.computeRiskScore({ availability: 'registered', faviconMatch: true, faviconNearMatch: true }), 70);
  });

  test('an active site scores higher risk than a merely parked one', () => {
    assert.equal(scoring.computeRiskScore({ availability: 'registered', activityStatus: 'active' }), 65);
    assert.equal(scoring.computeRiskScore({ availability: 'registered', activityStatus: 'parked' }), 45);
  });

  test('a configured mail server adds risk', () => {
    assert.equal(scoring.computeRiskScore({ availability: 'registered', hasMx: true }), 60);
  });

  test('SPF+DMARC together score higher than either alone', () => {
    assert.equal(scoring.computeRiskScore({ availability: 'registered', hasSpf: true, hasDmarc: true }), 55);
    assert.equal(scoring.computeRiskScore({ availability: 'registered', hasSpf: true, hasDmarc: false }), 45);
    assert.equal(scoring.computeRiskScore({ availability: 'registered', hasSpf: false, hasDmarc: true }), 45);
    assert.equal(scoring.computeRiskScore({ availability: 'registered', hasSpf: false, hasDmarc: false }), 40);
  });

  test('hidden ownership (WHOIS privacy) adds risk', () => {
    assert.equal(scoring.computeRiskScore({ availability: 'registered', privacyProtected: true }), 50);
  });

  test('a more recently registered domain scores higher risk', () => {
    assert.equal(scoring.computeRiskScore({ availability: 'registered', domainAgeDays: 30 }), 55); // < 90
    assert.equal(scoring.computeRiskScore({ availability: 'registered', domainAgeDays: 200 }), 45); // 90-364
    assert.equal(scoring.computeRiskScore({ availability: 'registered', domainAgeDays: 365 }), 40); // >= 365, no bonus
  });

  test('the total is clamped to 100', () => {
    const score = scoring.computeRiskScore({
      availability: 'registered',
      faviconMatch: true,
      activityStatus: 'active',
      hasMx: true,
      hasSpf: true,
      hasDmarc: true,
      privacyProtected: true,
      domainAgeDays: 10,
    });
    assert.equal(score, 100); // 40+30+25+20+15+10+15 = 155, clamped
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
    const explained = { score: 45, factors: [{ label: 'A', delta: 40 }, { label: 'B', delta: -5 }, { label: 'C', delta: 10 }] };
    assert.equal(scoring.formatScoreBreakdown(explained), 'A +40\nB -5\nC +10\nTotal 45');
    assert.equal(scoring.formatScoreBreakdown(explained, '; '), 'A +40; B -5; C +10; Total 45');
  });
});

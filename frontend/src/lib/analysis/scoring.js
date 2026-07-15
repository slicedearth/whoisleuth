import { calibrateExternalIntelligenceRisk } from './external-intelligence-risk.js';

// Acquisition/sourcing signals (domain age, expiry proximity, WHOIS privacy,
// site activity) and the opportunity score that combines them into one
// sortable number. Shared by the single-lookup availability card, the bulk
// results table, and the shortlist panel.

export function fmtAge(days) {
  if (days === null || days === undefined) return null;
  if (days < 60) return `${days}d old`;
  const years = days / 365.25;
  return years < 1 ? `${Math.round(days / 30)}mo old` : `${years.toFixed(1)}y old`;
}

export function fmtExpiresIn(days) {
  if (days === null || days === undefined) return null;
  return days < 0 ? `expired ${Math.abs(days)}d ago` : `expires in ${days}d`;
}

export const ACTIVITY_LABELS = {
  active: 'Active site',
  parked: 'Parked / for-sale page',
  unreachable: 'Website check inconclusive',
  // Kept only so older saved watchlist snapshots remain readable. New scans
  // use `unreachable`, because a fetch failure never proves that no site exists.
  no_site: 'No site reported (legacy)',
};

export function formatPrivacyCell(v) {
  if (v === true) return 'Privacy protected';
  if (v === false) return 'Public registrant data';
  return '—';
}

export function formatActivityCell(v, hasMx, hasSpf, hasDmarc) {
  const label = ACTIVITY_LABELS[v] || '—';
  const mailParts = [];
  if (hasMx) mailParts.push('MX');
  if (hasSpf) mailParts.push('SPF');
  if (hasDmarc) mailParts.push('DMARC');
  return mailParts.length ? `${label} · ${mailParts.join('+')}` : label;
}

// ---------------------------------------------------------------------------
// Opportunity score: combines the signals above into one 0-100 number so a
// large fast-scan result set can be sorted instead of manually scanned.
// Higher = more actionable (cheap/easy to get), not "more valuable" in an
// appraisal sense - a parked, aged, publicly-contactable domain scores high
// because it's an easy approach; an actively-used one scores low because
// the owner is unlikely to be interested regardless of the domain's worth.
// ---------------------------------------------------------------------------

const STATE_BASE_SCORE = {
  for_sale: 95,
  expiring: 85,
  available: 90,
  registered: 40,
  unknown: null,
  error: null,
};

const STATE_LABELS = {
  for_sale: 'for sale',
  expiring: 'expiring/pending delete',
  available: 'available',
  registered: 'registered',
};

// Builds the opportunity score alongside a factor-by-factor breakdown (base
// state score, then each signal's contribution) - the single source of
// truth computeOpportunityScore() below reads its final number from, and
// what the score chips' tooltips and the CSV export both render from, so
// the displayed reasoning can never drift from the actual number.
export function explainOpportunityScore(r) {
  const state = r.availability ?? r.state;
  const base = STATE_BASE_SCORE[state];
  if (base === null || base === undefined) return null;

  const factors = [{ label: `Base score for "${STATE_LABELS[state] || state}"`, delta: base }];
  let score = base;

  if (r.activityStatus === 'parked') {
    factors.push({ label: 'Parked/for-sale page', delta: 15 });
    score += 15;
  } else if (r.activityStatus === 'no_site') {
    factors.push({ label: 'No site running', delta: 5 });
    score += 5;
  } else if (r.activityStatus === 'active') {
    factors.push({ label: 'Active site in use', delta: -20 });
    score -= 20;
  }

  if (r.privacyProtected === false) {
    factors.push({ label: 'Contact info public', delta: 10 });
    score += 10;
  } else if (r.privacyProtected === true) {
    factors.push({ label: 'WHOIS privacy protected', delta: -10 });
    score -= 10;
  }

  if (typeof r.domainAgeDays === 'number') {
    const ageBonus = Math.min(20, (r.domainAgeDays / 365) * 2);
    if (ageBonus !== 0) {
      factors.push({ label: `Domain age (${fmtAge(r.domainAgeDays)})`, delta: ageBonus });
      score += ageBonus;
    }
  }

  if (state === 'registered' && typeof r.expiresInDays === 'number' && r.expiresInDays >= 0 && r.expiresInDays < 30) {
    factors.push({ label: 'Expires within 30 days', delta: 10 }); // might lapse soon even though not yet flagged "expiring"
    score += 10;
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), factors };
}

export function computeOpportunityScore(r) {
  const explained = explainOpportunityScore(r);
  return explained ? explained.score : null;
}

export function scoreTone(score) {
  if (score === null) return 'neutral';
  if (score >= 70) return 'good';
  if (score >= 40) return 'neutral';
  return 'warn';
}

// ---------------------------------------------------------------------------
// Risk score: prioritizes a *registered* lookalike/typosquat domain for analyst
// review. Strong page/brand-impersonation evidence dominates; ordinary signs
// of an operational domain add context but cannot reach the danger threshold
// on their own. This is deliberately distinct from the opportunity score
// above and remains a heuristic indicator, never a maliciousness verdict.
// ---------------------------------------------------------------------------

const RISK_STATES = new Set(['registered', 'for_sale', 'expiring']);

// Version 5 retains the grouped contextual evidence model and adds a bounded
// external-evidence factor. A lone provider never contributes, two datasets
// from the same publisher remain one source, and only allowlisted phishing or
// malware observations from two independent publisher families can add points.
// Older scores remain readable, while case and watchlist comparisons gate
// numeric changes on matching model versions so formula changes are not
// mistaken for changes in the observed domain.
export const RISK_MODEL_VERSION = 5;

const RISK_STATE_BASE = {
  registered: 10,
  for_sale: 5,
  expiring: 8,
};

const HIGH_CONTEXT_MUTATIONS = new Set(['unicode_homoglyph', 'dictionary']);
const MEDIUM_CONTEXT_MUTATIONS = new Set(['ascii_homoglyph', 'bitsquatting', 'tld_typo', 'tld_substitution']);
const LOW_CONTEXT_MUTATIONS = new Set([
  'character_omission',
  'character_duplication',
  'character_transposition',
  'hyphenation',
  'separator_omission',
  'word_reordering',
  'keyboard_substitution',
  'keyboard_insertion',
  'vowel_swap',
]);

export function normalizeRiskModelVersion(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 1000 ? value : null;
}

function mutationContext(mutationTypes) {
  if (!Array.isArray(mutationTypes)) return null;
  const bounded = mutationTypes.slice(0, 30);
  if (bounded.some((value) => typeof value === 'string' && HIGH_CONTEXT_MUTATIONS.has(value))) {
    return { label: 'High-similarity or phishing-term candidate context', delta: 18 };
  }
  if (bounded.some((value) => typeof value === 'string' && MEDIUM_CONTEXT_MUTATIONS.has(value))) {
    return { label: 'Lookalike candidate context', delta: 12 };
  }
  if (bounded.some((value) => typeof value === 'string' && LOW_CONTEXT_MUTATIONS.has(value))) {
    return { label: 'Generated variation candidate context', delta: 8 };
  }
  return null;
}

// Same breakdown-plus-final-number pattern as explainOpportunityScore()
// above - computeRiskScore() reads its number from this, and it's what the
// risk chips' tooltips and the CSV export render from.
export function explainRiskScore(r) {
  const state = r.availability ?? r.state;
  if (!RISK_STATES.has(state)) return null;

  const base = RISK_STATE_BASE[state];
  const factors = [{ label: `Base score for "${STATE_LABELS[state] || state}"`, delta: base }];
  let score = base;
  const contextualFamilies = new Set();

  const addContextualFactor = (family, label, delta) => {
    contextualFamilies.add(family);
    factors.push({ label, delta });
    score += delta;
  };

  // Mutation provenance establishes why this domain is being reviewed, but it
  // is never sufficient by itself to declare the domain dangerous. Only
  // generator-owned, allowlisted machine values contribute; arbitrary imported
  // strings cannot increase the score.
  const context = mutationContext(r.mutationTypes);
  if (context) {
    addContextualFactor('domain-resemblance', context.label, context.delta);
  }

  // Brand-presentation observations are deliberately modest and share one
  // family. A favicon and official asset host can both come from an authorized
  // campaign, shared platform, CDN, SSO flow, or agency template; observing
  // both must not manufacture a second independent source of corroboration.
  if (r.faviconMatch === true) {
    addContextualFactor('brand-presentation', 'Favicon matches your Brand Profile official site', 18);
  } else if (r.faviconNearMatch === true) {
    addContextualFactor('brand-presentation', 'Favicon resembles your official site (perceptual match)', 14);
  }
  if (r.reusesOfficialAssets === true) {
    addContextualFactor('brand-presentation', 'Official asset host relationship observed', 6);
  }

  // Text and form observations also share one family: legitimate account,
  // payment, and identity-provider pages commonly contain both. The match
  // string must be a real non-empty bounded backend observation; arbitrary
  // truthy imported values do not contribute.
  if (typeof r.phishingLanguageMatch === 'string' && r.phishingLanguageMatch.trim()) {
    addContextualFactor('credential-lure', 'Suspicious urgency language observed', 8);
  }
  if (r.hasPasswordField === true) {
    addContextualFactor('credential-lure', 'Login/password form present', 5);
  }

  // The three families cover domain resemblance, brand presentation, and
  // credential-lure behavior. This explicit factor makes the cross-family
  // reasoning visible in Lookup, Bulk tooltips, CSV, cases, and reports.
  if (contextualFamilies.size >= 2) {
    const bonus = contextualFamilies.size >= 3 ? 20 : 10;
    factors.push({ label: `Corroborating context across ${contextualFamilies.size} distinct evidence families`, delta: bonus });
    score += bonus;
  }

  const externalEvidence = calibrateExternalIntelligenceRisk(r.threatIntelligence);
  if (externalEvidence.factor) {
    factors.push(externalEvidence.factor);
    score += externalEvidence.contribution;
  }

  if (r.activityStatus === 'active') {
    factors.push({ label: 'Active site in use', delta: 8 });
    score += 8;
  }

  if (r.hasMx === true) {
    factors.push({ label: 'Mail server configured', delta: 8 });
    score += 8;
  }
  // Presence of these records isn't proof of a working, permissive outbound
  // policy (SPF can end in ~all/-all, DMARC can be p=none) - the label only
  // claims what's actually verified (the record exists), not how it's
  // configured.
  if (r.hasSpf === true && r.hasDmarc === true) {
    factors.push({ label: 'SPF + DMARC records present', delta: 3 });
    score += 3;
  } else if (r.hasSpf === true || r.hasDmarc === true) {
    factors.push({ label: 'SPF or DMARC record present', delta: 1 });
    score += 1;
  }
  if (r.privacyProtected === true) {
    factors.push({ label: 'WHOIS privacy protected', delta: 3 });
    score += 3;
  }

  if (typeof r.domainAgeDays === 'number' && Number.isFinite(r.domainAgeDays) && r.domainAgeDays >= 0) {
    if (r.domainAgeDays < 90) {
      factors.push({ label: `Recently registered (${fmtAge(r.domainAgeDays)})`, delta: 10 });
      score += 10;
    } else if (r.domainAgeDays < 365) {
      factors.push({ label: `Registered under a year ago (${fmtAge(r.domainAgeDays)})`, delta: 4 });
      score += 4;
    }
  }

  return { modelVersion: RISK_MODEL_VERSION, score: Math.max(0, Math.min(100, Math.round(score))), factors };
}

export function computeRiskScore(r) {
  const explained = explainRiskScore(r);
  return explained ? explained.score : null;
}

export function riskTone(score) {
  if (score === null) return 'neutral';
  if (score >= 70) return 'danger';
  if (score >= 40) return 'warn';
  return 'neutral';
}

// Renders an explain*Score() result as plain text - `separator` is '\n' for
// a hover tooltip (title attribute) and '; ' for a single CSV cell.
export function formatScoreBreakdown(explained, separator = '\n') {
  if (!explained) return '';
  const parts = explained.factors.map((f) => `${f.label} ${f.delta >= 0 ? '+' : ''}${Math.round(f.delta)}`);
  parts.push(`Total ${explained.score}`);
  return parts.join(separator);
}

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

// The first explicitly stamped risk model. Older saved scores are intentionally
// left unversioned: they remain readable, but are not compared with scores from
// this recalibrated model because a numeric delta would describe a formula
// change rather than a change in the observed domain.
export const RISK_MODEL_VERSION = 1;

const RISK_STATE_BASE = {
  registered: 10,
  for_sale: 5,
  expiring: 8,
};

const HIGH_CONTEXT_MUTATIONS = new Set(['unicode_homoglyph', 'dictionary']);
const MEDIUM_CONTEXT_MUTATIONS = new Set(['ascii_homoglyph', 'bitsquatting', 'tld_typo']);
const LOW_CONTEXT_MUTATIONS = new Set([
  'character_omission',
  'character_duplication',
  'character_transposition',
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

  // Mutation provenance establishes why this domain is being reviewed, but it
  // is never sufficient by itself to declare the domain dangerous. Only
  // generator-owned, allowlisted machine values contribute; arbitrary imported
  // strings cannot increase the score.
  const context = mutationContext(r.mutationTypes);
  if (context) {
    factors.push(context);
    score += context.delta;
  }

  // Set by bulk.js/render.js from a brand profile's official-site favicon
  // hash (see lib/favicon.js) - a much stronger phishing signal than any of
  // the activity/mail signals below, since it means this domain is serving
  // a byte-identical copy of the brand's own favicon, not just "some site."
  if (r.faviconMatch) {
    factors.push({ label: 'Favicon matches your brand profile\'s official site', delta: 35 });
    score += 35;
  } else if (r.faviconNearMatch) {
    // Perceptual (fuzzy) match: not byte-identical, but visually the same
    // favicon resized/recompressed (see lib/perceptual-hash.js). Slightly
    // weaker than an exact match since it's a similarity threshold rather
    // than an equality, but still a strong copied-kit tell. Mutually
    // exclusive with faviconMatch - the exact match already scored above.
    factors.push({ label: 'Favicon closely resembles your official site (perceptual match)', delta: 28 });
    score += 28;
  }

  // Cheap signals pulled from the homepage HTML already fetched for the
  // for-sale check above (see lib/html-signals.js) - a login form and/or
  // urgency-driven copy are the actual mechanics of a credential-harvesting
  // page, not just circumstantial activity.
  if (r.reusesOfficialAssets) {
    factors.push({ label: 'Reuses assets from your official site', delta: 30 });
    score += 30;
  }
  if (r.phishingLanguageMatch) {
    factors.push({ label: 'Phishing/urgency language detected', delta: 20 });
    score += 20;
  }
  if (r.hasPasswordField) {
    factors.push({ label: 'Login/password form present', delta: 15 });
    score += 15;
  }

  if (r.activityStatus === 'active') {
    factors.push({ label: 'Active site in use', delta: 8 });
    score += 8;
  }

  if (r.hasMx) {
    factors.push({ label: 'Mail server configured', delta: 8 });
    score += 8;
  }
  // Presence of these records isn't proof of a working, permissive outbound
  // policy (SPF can end in ~all/-all, DMARC can be p=none) - the label only
  // claims what's actually verified (the record exists), not how it's
  // configured.
  if (r.hasSpf && r.hasDmarc) {
    factors.push({ label: 'SPF + DMARC records present', delta: 3 });
    score += 3;
  } else if (r.hasSpf || r.hasDmarc) {
    factors.push({ label: 'SPF or DMARC record present', delta: 1 });
    score += 1;
  }
  if (r.privacyProtected === true) {
    factors.push({ label: 'WHOIS privacy protected', delta: 3 });
    score += 3;
  }

  if (typeof r.domainAgeDays === 'number') {
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

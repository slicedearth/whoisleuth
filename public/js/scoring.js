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
  no_site: 'No site (inactive)',
};

export function formatPrivacyCell(v) {
  if (v === true) return 'Protected';
  if (v === false) return 'Public';
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
// Risk score: flags a *registered* lookalike/typosquat domain as likely
// phishing infrastructure rather than harmless coincidence or idle parking.
// Deliberately the inverse of the opportunity score above - an actively-used
// domain with a mail server and hidden ownership is a bad acquisition target
// but exactly the profile of a live phishing setup, so those signals score
// opposite ways depending on which question is being asked.
// ---------------------------------------------------------------------------

const RISK_STATES = new Set(['registered', 'for_sale', 'expiring']);

// Same breakdown-plus-final-number pattern as explainOpportunityScore()
// above - computeRiskScore() reads its number from this, and it's what the
// risk chips' tooltips and the CSV export render from.
export function explainRiskScore(r) {
  const state = r.availability ?? r.state;
  if (!RISK_STATES.has(state)) return null;

  const factors = [{ label: 'Base score (registered/for-sale/expiring)', delta: 40 }];
  let score = 40;

  // Set by bulk.js/render.js from a brand profile's official-site favicon
  // hash (see lib/favicon.js) - a much stronger phishing signal than any of
  // the activity/mail signals below, since it means this domain is serving
  // a byte-identical copy of the brand's own favicon, not just "some site."
  if (r.faviconMatch) {
    factors.push({ label: 'Favicon matches your brand profile\'s official site', delta: 30 });
    score += 30;
  }

  if (r.activityStatus === 'active') {
    factors.push({ label: 'Active site in use', delta: 25 });
    score += 25;
  } else if (r.activityStatus === 'parked') {
    factors.push({ label: 'Parked page', delta: 5 });
    score += 5;
  }

  if (r.hasMx) {
    factors.push({ label: 'Mail server configured', delta: 20 });
    score += 20;
  }
  // Presence of these records isn't proof of a working, permissive outbound
  // policy (SPF can end in ~all/-all, DMARC can be p=none) - the label only
  // claims what's actually verified (the record exists), not how it's
  // configured.
  if (r.hasSpf && r.hasDmarc) {
    factors.push({ label: 'SPF + DMARC records present', delta: 15 });
    score += 15;
  } else if (r.hasSpf || r.hasDmarc) {
    factors.push({ label: 'SPF or DMARC record present', delta: 5 });
    score += 5;
  }
  if (r.privacyProtected === true) {
    factors.push({ label: 'WHOIS privacy protected', delta: 10 });
    score += 10;
  }

  if (typeof r.domainAgeDays === 'number') {
    if (r.domainAgeDays < 90) {
      factors.push({ label: `Recently registered (${fmtAge(r.domainAgeDays)})`, delta: 15 });
      score += 15;
    } else if (r.domainAgeDays < 365) {
      factors.push({ label: `Registered under a year ago (${fmtAge(r.domainAgeDays)})`, delta: 5 });
      score += 5;
    }
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), factors };
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

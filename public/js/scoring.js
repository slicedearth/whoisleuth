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

export function formatActivityCell(v) {
  return ACTIVITY_LABELS[v] || '—';
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

export function computeOpportunityScore(r) {
  const base = STATE_BASE_SCORE[r.availability ?? r.state];
  if (base === null || base === undefined) return null;

  let score = base;

  if (r.activityStatus === 'parked') score += 15;
  else if (r.activityStatus === 'no_site') score += 5;
  else if (r.activityStatus === 'active') score -= 20;

  if (r.privacyProtected === false) score += 10;
  else if (r.privacyProtected === true) score -= 10;

  if (typeof r.domainAgeDays === 'number') {
    score += Math.min(20, (r.domainAgeDays / 365) * 2);
  }

  const state = r.availability ?? r.state;
  if (state === 'registered' && typeof r.expiresInDays === 'number' && r.expiresInDays >= 0 && r.expiresInDays < 30) {
    score += 10; // might lapse soon even though not yet flagged "expiring"
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreTone(score) {
  if (score === null) return 'neutral';
  if (score >= 70) return 'good';
  if (score >= 40) return 'neutral';
  return 'warn';
}

export {
  RISK_MODEL_VERSION,
  RISK_REVIEW_THRESHOLD,
  computeRiskScore,
  explainRiskScore,
  formatScoreBreakdown,
  normalizeRiskModelVersion,
  riskTone,
} from '../../../../lib/risk-scoring.mts';
export type {
  RiskExplanation,
  RiskFactor,
  RiskInput,
} from '../../../../lib/risk-scoring.mts';

// Acquisition/sourcing signals (domain age, expiry proximity, WHOIS privacy,
// site activity) and the opportunity score that combines them into one
// sortable number. Shared by the single-lookup availability card, the bulk
// results table, and the shortlist panel.

export type ActivityStatus = 'active' | 'parked' | 'unreachable' | 'no_site';

export type OpportunityScoreInput = {
  availability?: string | null;
  state?: string | null;
  activityStatus?: string | null;
  privacyProtected?: boolean | null;
  domainAgeDays?: number | null;
  expiresInDays?: number | null;
};

export type OpportunityFactor = {
  label: string;
  delta: number;
};

export type OpportunityExplanation = {
  score: number;
  factors: OpportunityFactor[];
};

export type ScoreTone = 'neutral' | 'good' | 'warn';

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function fmtAge(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const days = value;
  if (days < 60) return `${days}d old`;
  const years = days / 365.25;
  return years < 1 ? `${Math.round(days / 30)}mo old` : `${years.toFixed(1)}y old`;
}

export function fmtExpiresIn(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const days = value;
  return days < 0 ? `expired ${Math.abs(days)}d ago` : `expires in ${days}d`;
}

export const ACTIVITY_LABELS: Readonly<Record<ActivityStatus, string>> = {
  active: 'Active site',
  parked: 'Parked / for-sale page',
  unreachable: 'Website check inconclusive',
  // Kept only so older saved watchlist snapshots remain readable. New scans
  // use `unreachable`, because a fetch failure never proves that no site exists.
  no_site: 'No site reported (legacy)',
};

export function formatPrivacyCell(v: unknown): string {
  if (v === true) return 'Privacy protected';
  if (v === false) return 'Public registrant data';
  return '—';
}

export function formatActivityCell(
  v: unknown,
  hasMx: unknown,
  hasSpf: unknown,
  hasDmarc: unknown,
): string {
  const label = typeof v === 'string' && v in ACTIVITY_LABELS
    ? ACTIVITY_LABELS[v as ActivityStatus]
    : '—';
  const mailParts: string[] = [];
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

const STATE_BASE_SCORE: Readonly<Record<string, number | null>> = {
  for_sale: 95,
  expiring: 85,
  available: 90,
  registered: 40,
  unknown: null,
  error: null,
};

const STATE_LABELS: Readonly<Record<string, string>> = {
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
export function explainOpportunityScore(value: unknown): OpportunityExplanation | null {
  const r = plainRecord(value);
  if (!r) return null;
  const rawState = r.availability ?? r.state;
  if (typeof rawState !== 'string') return null;
  const state = rawState;
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

export function computeOpportunityScore(value: unknown): number | null {
  const explained = explainOpportunityScore(value);
  return explained ? explained.score : null;
}

export function scoreTone(score: number | null): ScoreTone {
  if (score === null) return 'neutral';
  if (score >= 70) return 'good';
  if (score >= 40) return 'neutral';
  return 'warn';
}

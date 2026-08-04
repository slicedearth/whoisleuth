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
export {
  OPPORTUNITY_MODEL_VERSION,
  OPPORTUNITY_REVIEW_THRESHOLD,
  computeOpportunityScore,
  explainOpportunityScore,
  normalizeOpportunityModelVersion,
  opportunityTone,
} from '../../../../lib/opportunity-scoring.mts';
export type {
  OpportunityDimension,
  OpportunityDimensionId,
  OpportunityExplanation,
  OpportunityFactor,
  OpportunityScoreInput,
} from '../../../../lib/opportunity-scoring.mts';

// Acquisition/sourcing signals (domain age, expiry proximity, WHOIS privacy,
// site activity) and the opportunity score that combines them into one
// sortable number. Shared by the single-lookup availability card, the bulk
// results table, and the shortlist panel.

export type ActivityStatus = 'active' | 'parked' | 'unreachable' | 'no_site';

export type ScoreTone = 'neutral' | 'good' | 'warn';

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

export function scoreTone(score: number | null): ScoreTone {
  // Kept as a compatibility name for existing UI callers.
  if (score === null) return 'neutral';
  if (score >= 70) return 'good';
  if (score >= 40) return 'neutral';
  return 'warn';
}

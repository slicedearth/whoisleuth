import {
  buildScoreEvidenceQuality,
  type ScoreEvidenceQuality,
  type ScoreEvidenceQualityInput,
} from './scoring-evidence-quality.mts';

export const OPPORTUNITY_MODEL_VERSION = 2;
export const OPPORTUNITY_REVIEW_THRESHOLD = 70;

type OpportunityFactor = { family: OpportunityDimensionId; label: string; delta: number };
type OpportunityDimensionId = 'contactability' | 'lifecycle' | 'listing' | 'registration';
type OpportunityDimension = {
  id: OpportunityDimensionId;
  label: string;
  contribution: number;
};
type OpportunityExplanation = {
  modelVersion: number;
  score: number;
  rawScore: number;
  capped: boolean;
  factors: OpportunityFactor[];
  dimensions: OpportunityDimension[];
  evidenceQuality: ScoreEvidenceQuality;
};
type OpportunityScoreInput = ScoreEvidenceQualityInput & {
  availability?: unknown;
  state?: unknown;
  confidence?: unknown;
  activityStatus?: unknown;
  privacyProtected?: unknown;
  domainAgeDays?: unknown;
  expiresInDays?: unknown;
  hasPublicRegistrantContact?: unknown;
};

const STATE_BASE: Readonly<Record<string, number>> = Object.freeze({
  available: 82,
  for_sale: 70,
  expiring: 52,
  registered: 22,
});
const STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  available: 'available',
  for_sale: 'registered with a sale signal',
  expiring: 'registered in a lifecycle transition',
  registered: 'registered',
});

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatAge(days: number): string {
  if (days < 60) return `${Math.max(0, Math.round(days))}d old`;
  const years = days / 365.25;
  return years < 1 ? `${Math.round(days / 30)}mo old` : `${years.toFixed(1)}y old`;
}

function addFactor(
  factors: OpportunityFactor[],
  dimensions: Map<OpportunityDimensionId, number>,
  family: OpportunityDimensionId,
  label: string,
  delta: number,
): void {
  factors.push({ family, label, delta });
  dimensions.set(family, (dimensions.get(family) ?? 0) + delta);
}

export function normalizeOpportunityModelVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1000 ? value : null;
}

// Opportunity is acquisition readiness, not price, value, eligibility, or a
// prediction that a registration will lapse. It uses only bounded evidence
// already collected for the current lookup.
export function explainOpportunityScore(value: unknown): OpportunityExplanation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as OpportunityScoreInput;
  const state = input.availability ?? input.state;
  if (typeof state !== 'string' || !Object.hasOwn(STATE_BASE, state)) return null;

  const factors: OpportunityFactor[] = [];
  const dimensions = new Map<OpportunityDimensionId, number>();
  addFactor(factors, dimensions, 'registration', `Base readiness for “${STATE_LABELS[state] ?? state}”`, STATE_BASE[state] ?? 0);

  if (input.confidence === 'high') addFactor(factors, dimensions, 'registration', 'High-confidence registration decision', 8);
  else if (input.confidence === 'medium') addFactor(factors, dimensions, 'registration', 'Medium-confidence registration decision', 3);
  else if (input.confidence === 'low') addFactor(factors, dimensions, 'registration', 'Low-confidence registration decision', -8);

  if (state === 'for_sale') addFactor(factors, dimensions, 'listing', 'Bounded sale signal observed; listing remains unverified', 6);
  else if (input.activityStatus === 'parked') addFactor(factors, dimensions, 'listing', 'Parked page observed without a verified sale offer', 3);
  else if (state === 'registered' && input.activityStatus === 'active') {
    addFactor(factors, dimensions, 'listing', 'Active website suggests an in-use registration', -12);
  }

  if (input.hasPublicRegistrantContact === true) {
    addFactor(factors, dimensions, 'contactability', 'Public registrant contact route observed; acquisition suitability is not established', 10);
  }

  const expiresInDays = finite(input.expiresInDays);
  if (state === 'registered' && expiresInDays !== null && expiresInDays >= 0 && expiresInDays < 30) {
    addFactor(factors, dimensions, 'lifecycle', 'Published expiry is within 30 days; release is not implied', 4);
  }

  if (typeof input.privacyProtected === 'boolean') {
    addFactor(factors, dimensions, 'contactability', 'Registration privacy is neutral; it does not establish contactability', 0);
  }
  const ageDays = finite(input.domainAgeDays);
  if (ageDays !== null && ageDays >= 0) {
    addFactor(factors, dimensions, 'registration', `Domain age (${formatAge(ageDays)}) is context only`, 0);
  }

  const rawScore = Math.round(factors.reduce((total, factor) => total + factor.delta, 0));
  const score = Math.max(0, Math.min(100, rawScore));
  const dimensionLabels: Readonly<Record<OpportunityDimensionId, string>> = {
    registration: 'Registration certainty',
    listing: 'Listing readiness',
    contactability: 'Contactability',
    lifecycle: 'Lifecycle timing',
  };
  const observedFamilies = [...dimensions.keys()];
  const evidenceQuality = buildScoreEvidenceQuality(input, {
    expectedDepth: 'fast',
    observedFamilies,
    expectedFamilies: ['registration'],
  });

  return {
    modelVersion: OPPORTUNITY_MODEL_VERSION,
    score,
    rawScore,
    capped: score !== rawScore,
    factors,
    dimensions: [...dimensions.entries()].map(([id, contribution]) => ({ id, label: dimensionLabels[id], contribution })),
    evidenceQuality,
  };
}

export function computeOpportunityScore(value: unknown): number | null {
  return explainOpportunityScore(value)?.score ?? null;
}

export function opportunityTone(score: number | null): 'neutral' | 'good' | 'warn' {
  if (score === null) return 'neutral';
  if (score >= OPPORTUNITY_REVIEW_THRESHOLD) return 'good';
  if (score >= 40) return 'neutral';
  return 'warn';
}

export type {
  OpportunityDimension,
  OpportunityDimensionId,
  OpportunityExplanation,
  OpportunityFactor,
  OpportunityScoreInput,
};

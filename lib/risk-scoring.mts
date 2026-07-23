import { calibrateExternalIntelligenceRisk } from './external-intelligence-risk.mts';

type RiskFactor = { label: string; delta: number };
type RiskExplanation = { modelVersion: number; score: number; factors: RiskFactor[] };
type RiskInput = Record<string, any>;

const RISK_STATES = new Set(['registered', 'for_sale', 'expiring']);
const STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  for_sale: 'for sale',
  expiring: 'expiring/pending delete',
  registered: 'registered',
});

// Version 6 preserves the grouped external-evidence factor and recognizes the
// newly generated addition, plural, embedded-TLD, and analyst-directed token
// replacement families conservatively. Older scores remain readable, while
// case and watchlist comparisons gate numeric changes on matching model
// versions so formula changes are not mistaken for changes in the observed
// domain.
export const RISK_MODEL_VERSION = 6;
export const RISK_REVIEW_THRESHOLD = 70;

const RISK_STATE_BASE: Readonly<Record<string, number>> = Object.freeze({
  registered: 10,
  for_sale: 5,
  expiring: 8,
});

const HIGH_CONTEXT_MUTATIONS = new Set(['unicode_homoglyph', 'dictionary', 'dictionary_token_replacement']);
const MEDIUM_CONTEXT_MUTATIONS = new Set(['ascii_homoglyph', 'bitsquatting', 'tld_embedding', 'tld_typo', 'tld_substitution']);
const LOW_CONTEXT_MUTATIONS = new Set([
  'character_addition',
  'character_omission',
  'character_duplication',
  'character_transposition',
  'pluralization',
  'www_prefix',
  'hyphenation',
  'separator_omission',
  'word_reordering',
  'keyboard_substitution',
  'keyboard_insertion',
  'vowel_swap',
]);

export const RISK_MUTATION_TYPES = Object.freeze([
  ...HIGH_CONTEXT_MUTATIONS,
  ...MEDIUM_CONTEXT_MUTATIONS,
  ...LOW_CONTEXT_MUTATIONS,
]);

export function normalizeRiskModelVersion(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 1000 ? value as number : null;
}

function formatAge(days: number): string {
  if (days < 60) return `${days}d old`;
  const years = days / 365.25;
  return years < 1 ? `${Math.round(days / 30)}mo old` : `${years.toFixed(1)}y old`;
}

function mutationContext(mutationTypes: unknown): RiskFactor | null {
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

// Risk prioritizes a registered lookalike/typosquat domain for analyst review.
// It is a heuristic indicator, never a maliciousness or safety verdict.
export function explainRiskScore(r: RiskInput): RiskExplanation | null {
  const state = r.availability ?? r.state;
  if (!RISK_STATES.has(state)) return null;

  const base = RISK_STATE_BASE[state];
  const factors: RiskFactor[] = [{ label: `Base score for "${STATE_LABELS[state] || state}"`, delta: base }];
  let score = base;
  const contextualFamilies = new Set<string>();

  const addContextualFactor = (family: string, label: string, delta: number): void => {
    contextualFamilies.add(family);
    factors.push({ label, delta });
    score += delta;
  };

  const context = mutationContext(r.mutationTypes);
  if (context) addContextualFactor('domain-resemblance', context.label, context.delta);

  if (r.faviconMatch === true) {
    addContextualFactor('brand-presentation', 'Favicon matches your Brand Profile official site', 18);
  } else if (r.faviconNearMatch === true) {
    addContextualFactor('brand-presentation', 'Favicon resembles your official site (perceptual match)', 14);
  }
  if (r.reusesOfficialAssets === true) {
    addContextualFactor('brand-presentation', 'Official asset host relationship observed', 6);
  }

  if (typeof r.phishingLanguageMatch === 'string' && r.phishingLanguageMatch.trim()) {
    addContextualFactor('credential-lure', 'Suspicious urgency language observed', 8);
  }
  if (r.hasPasswordField === true) {
    addContextualFactor('credential-lure', 'Login/password form present', 5);
  }

  if (contextualFamilies.size >= 2) {
    const bonus = contextualFamilies.size >= 3 ? 20 : 10;
    factors.push({ label: `Corroborating context across ${contextualFamilies.size} distinct evidence families`, delta: bonus });
    score += bonus;
  }

  const externalEvidence = calibrateExternalIntelligenceRisk(r.threatIntelligence);
  if (externalEvidence.factor) {
    factors.push(externalEvidence.factor as RiskFactor);
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
      factors.push({ label: `Recently registered (${formatAge(r.domainAgeDays)})`, delta: 10 });
      score += 10;
    } else if (r.domainAgeDays < 365) {
      factors.push({ label: `Registered under a year ago (${formatAge(r.domainAgeDays)})`, delta: 4 });
      score += 4;
    }
  }

  return { modelVersion: RISK_MODEL_VERSION, score: Math.max(0, Math.min(100, Math.round(score))), factors };
}

export function computeRiskScore(r: RiskInput): number | null {
  return explainRiskScore(r)?.score ?? null;
}

export function riskTone(score: number | null): 'neutral' | 'warn' | 'danger' {
  if (score === null) return 'neutral';
  if (score >= RISK_REVIEW_THRESHOLD) return 'danger';
  if (score >= 40) return 'warn';
  return 'neutral';
}

export function formatScoreBreakdown(explained: RiskExplanation | null, separator = '\n'): string {
  if (!explained) return '';
  const parts = explained.factors.map((factor) => `${factor.label} ${factor.delta >= 0 ? '+' : ''}${Math.round(factor.delta)}`);
  parts.push(`Total ${explained.score}`);
  return parts.join(separator);
}

export type { RiskExplanation, RiskFactor, RiskInput };

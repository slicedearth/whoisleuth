import { calibrateExternalIntelligenceRisk } from './external-intelligence-risk.mts';
import {
  buildScoreEvidenceQuality,
  type ScoreEvidenceQuality,
  type ScoreEvidenceQualityInput,
} from './scoring-evidence-quality.mts';

type RiskFamily =
  | 'brand-presentation'
  | 'corroboration'
  | 'credential-lure'
  | 'domain-resemblance'
  | 'external-intelligence'
  | 'operational-support'
  | 'registration';
type RiskFactor = { family: RiskFamily; label: string; delta: number };
type RiskExplanation = {
  modelVersion: number;
  score: number;
  rawScore: number;
  capped: boolean;
  factors: RiskFactor[];
  families: Array<{ id: RiskFamily; contribution: number; cap: number | null }>;
  evidenceQuality: ScoreEvidenceQuality;
};
type RiskSensitivityScenario = Readonly<{
  excludedFamily: RemovableRiskFamily;
  score: number;
  difference: number;
}>;
type RiskScoreSensitivity = Readonly<{
  version: 1;
  baselineScore: number;
  reviewThreshold: number;
  minimumScenarioScore: number;
  thresholdState: 'below' | 'stable_above' | 'crosses';
  scenarios: readonly RiskSensitivityScenario[];
  limitations: readonly string[];
}>;
type RiskInput = ScoreEvidenceQualityInput & {
  domain?: unknown;
  availability?: unknown;
  state?: unknown;
  mutationTypes?: unknown;
  faviconMatch?: unknown;
  faviconNearMatch?: unknown;
  reusesOfficialAssets?: unknown;
  pageBaselineMatch?: unknown;
  hasActiveBrandProfile?: unknown;
  idnReferenceMatch?: unknown;
  phishingLanguageMatch?: unknown;
  hasPasswordField?: unknown;
  hasExternalFormAction?: unknown;
  threatIntelligence?: unknown;
  activityStatus?: unknown;
  hasMx?: unknown;
  hasSpf?: unknown;
  hasDmarc?: unknown;
  privacyProtected?: unknown;
  domainAgeDays?: unknown;
};
type RemovableRiskFamily = Exclude<RiskFamily, 'registration' | 'corroboration'>;

const RISK_STATES = new Set(['registered', 'for_sale', 'expiring']);
const STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  for_sale: 'for sale',
  expiring: 'expiring/pending delete',
  registered: 'registered',
});

// Version 7 caps each independent evidence family, treats generic operational
// properties as supporting context, and reports collection quality separately
// from the heuristic score. Missing evidence never contributes points.
export const RISK_MODEL_VERSION = 7;
export const RISK_REVIEW_THRESHOLD = 70;

const RISK_STATE_BASE: Readonly<Record<string, number>> = Object.freeze({
  registered: 6,
  for_sale: 4,
  expiring: 5,
});
const FAMILY_CAPS: Readonly<Partial<Record<RiskFamily, number>>> = Object.freeze({
  'domain-resemblance': 20,
  'brand-presentation': 24,
  'credential-lure': 18,
  'external-intelligence': 18,
  'operational-support': 12,
});
const REMOVABLE_RISK_FAMILY_MAP: Readonly<Record<RemovableRiskFamily, true>> = Object.freeze({
  'brand-presentation': true,
  'credential-lure': true,
  'domain-resemblance': true,
  'external-intelligence': true,
  'operational-support': true,
});
const REMOVABLE_RISK_FAMILIES = Object.freeze(Object.keys(REMOVABLE_RISK_FAMILY_MAP) as RemovableRiskFamily[]);

const HIGH_CONTEXT_MUTATIONS = new Set([
  'unicode_homoglyph',
  'unicode_homoglyph_depth_2',
  'dictionary',
  'dictionary_token_replacement',
]);
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
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1000 ? value : null;
}

function formatAge(days: number): string {
  if (days < 60) return `${Math.round(days)}d old`;
  const years = days / 365.25;
  return years < 1 ? `${Math.round(days / 30)}mo old` : `${years.toFixed(1)}y old`;
}

function mutationContext(mutationTypes: unknown): { label: string; delta: number } | null {
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

function hasBoolean(value: unknown): boolean {
  return typeof value === 'boolean';
}

function scoreQuality(input: RiskInput): ScoreEvidenceQuality {
  const observedFamilies = ['registration'];
  const expectedFamilies = ['registration', 'operational-support'];
  if (Array.isArray(input.mutationTypes) || hasBoolean(input.idnReferenceMatch)) observedFamilies.push('domain-resemblance');
  if (input.hasActiveBrandProfile === true) expectedFamilies.push('domain-resemblance', 'brand-presentation');
  if ([input.faviconMatch, input.faviconNearMatch, input.reusesOfficialAssets, input.pageBaselineMatch].some(hasBoolean)) {
    observedFamilies.push('brand-presentation');
  }
  if ([input.hasPasswordField, input.hasExternalFormAction].some(hasBoolean) || typeof input.phishingLanguageMatch === 'string') {
    observedFamilies.push('credential-lure');
  }
  if (calibrateExternalIntelligenceRisk(input.threatIntelligence, input.domain).eligibleProviderCount > 0) {
    observedFamilies.push('external-intelligence');
  }
  if ([input.hasMx, input.hasSpf, input.hasDmarc].some(hasBoolean)
    || typeof input.activityStatus === 'string'
    || typeof input.domainAgeDays === 'number') observedFamilies.push('operational-support');
  if (input.scanDepth === 'deep') expectedFamilies.push('credential-lure');
  return buildScoreEvidenceQuality(input, {
    expectedDepth: 'deep',
    observedFamilies,
    expectedFamilies,
  });
}

// Risk prioritizes a registered lookalike/typosquat domain for analyst review.
// It is a heuristic indicator, never a maliciousness or safety verdict.
function explainRiskScoreInternal(input: RiskInput, excludedFamily: RiskFamily | null): RiskExplanation | null {
  const state = input.availability ?? input.state;
  if (typeof state !== 'string' || !RISK_STATES.has(state)) return null;

  const factors: RiskFactor[] = [];
  const familyTotals = new Map<RiskFamily, number>();
  const add = (family: RiskFamily, label: string, requestedDelta: number): number => {
    if (family === excludedFamily) return 0;
    const current = familyTotals.get(family) ?? 0;
    const cap = FAMILY_CAPS[family] ?? Number.POSITIVE_INFINITY;
    const delta = Math.max(0, Math.min(requestedDelta, Math.max(0, cap - current)));
    const capped = delta !== requestedDelta;
    factors.push({ family, label: capped ? `${label} (family cap reached)` : label, delta });
    familyTotals.set(family, current + delta);
    return delta;
  };

  add('registration', `Base context for “${STATE_LABELS[state] ?? state}”`, RISK_STATE_BASE[state] ?? 0);
  const mutation = mutationContext(input.mutationTypes);
  if (mutation) add('domain-resemblance', mutation.label, mutation.delta);
  if (input.idnReferenceMatch === true) add('domain-resemblance', 'IDN skeleton matches an official Brand Profile domain', 20);

  if (input.faviconMatch === true) add('brand-presentation', 'Favicon matches an official Brand Profile site', 18);
  else if (input.faviconNearMatch === true) add('brand-presentation', 'Favicon resembles an official Brand Profile site', 14);
  if (input.reusesOfficialAssets === true) add('brand-presentation', 'Official asset-host relationship observed', 6);
  if (input.pageBaselineMatch === true) add('brand-presentation', 'Multiple independently compared page-identity components match the official baseline', 14);

  if (typeof input.phishingLanguageMatch === 'string' && input.phishingLanguageMatch.trim()) {
    add('credential-lure', 'Suspicious urgency language observed', 8);
  }
  if (input.hasPasswordField === true && input.hasExternalFormAction === true) {
    add('credential-lure', 'Password form submits to an external origin', 10);
  } else if (input.hasPasswordField === true) {
    add('credential-lure', 'Login/password form present', 5);
  } else if (input.hasExternalFormAction === true) {
    add('credential-lure', 'External form destination observed without a password field', 0);
  }

  const external = calibrateExternalIntelligenceRisk(input.threatIntelligence, input.domain);
  if (external.factor) add('external-intelligence', external.factor.label, external.contribution);

  const primaryFamilies = (['domain-resemblance', 'brand-presentation', 'credential-lure', 'external-intelligence'] as const)
    .filter((family) => (familyTotals.get(family) ?? 0) > 0);
  if (primaryFamilies.length >= 2) {
    add('corroboration', `Corroborating context across ${primaryFamilies.length} independent evidence families`, primaryFamilies.length >= 3 ? 18 : 10);
  }

  const hasIndependentContext = primaryFamilies.length > 0;
  const supporting = (label: string, delta: number): void => {
    add('operational-support', hasIndependentContext ? label : `${label}; neutral without independent suspicious context`, hasIndependentContext ? delta : 0);
  };
  if (input.activityStatus === 'active') supporting('Active website observed', 4);
  if (input.hasMx === true) supporting('Mail server configured', 4);
  if (input.hasSpf === true && input.hasDmarc === true) supporting('SPF and DMARC records present', 1);
  else if (input.hasSpf === true || input.hasDmarc === true) supporting('SPF or DMARC record present', 0);
  if (typeof input.domainAgeDays === 'number' && Number.isFinite(input.domainAgeDays) && input.domainAgeDays >= 0) {
    if (input.domainAgeDays < 90) supporting(`Recently registered (${formatAge(input.domainAgeDays)})`, 6);
    else if (input.domainAgeDays < 365) supporting(`Registered under a year ago (${formatAge(input.domainAgeDays)})`, 2);
  }
  if (typeof input.privacyProtected === 'boolean') {
    add('registration', 'Registration privacy is neutral context', 0);
  }

  const rawScore = Math.round(factors.reduce((total, factor) => total + factor.delta, 0));
  const score = Math.max(0, Math.min(100, rawScore));
  const familyOrder: RiskFamily[] = [
    'registration', 'domain-resemblance', 'brand-presentation', 'credential-lure',
    'external-intelligence', 'corroboration', 'operational-support',
  ];
  return {
    modelVersion: RISK_MODEL_VERSION,
    score,
    rawScore,
    capped: score !== rawScore,
    factors,
    families: familyOrder
      .filter((id) => familyTotals.has(id))
      .map((id) => ({ id, contribution: familyTotals.get(id) ?? 0, cap: FAMILY_CAPS[id] ?? null })),
    evidenceQuality: scoreQuality(input),
  };
}

export function explainRiskScore(input: RiskInput): RiskExplanation | null {
  return explainRiskScoreInternal(input, null);
}

export function buildRiskScoreSensitivity(input: RiskInput): RiskScoreSensitivity | null {
  const baseline = explainRiskScoreInternal(input, null);
  if (!baseline) return null;
  const removableFamilies = REMOVABLE_RISK_FAMILIES
    .filter((family) => baseline.families.some((item) => item.id === family && item.contribution > 0));
  const scenarios = removableFamilies.map((excludedFamily) => {
    const result = explainRiskScoreInternal(input, excludedFamily);
    const score = result?.score ?? baseline.score;
    return Object.freeze({ excludedFamily, score, difference: score - baseline.score });
  }).sort((left, right) => left.score - right.score || left.excludedFamily.localeCompare(right.excludedFamily));
  const minimumScenarioScore = scenarios[0]?.score ?? baseline.score;
  const thresholdState = baseline.score < RISK_REVIEW_THRESHOLD
    ? 'below' as const
    : minimumScenarioScore < RISK_REVIEW_THRESHOLD ? 'crosses' as const : 'stable_above' as const;
  return Object.freeze({
    version: 1 as const,
    baselineScore: baseline.score,
    reviewThreshold: RISK_REVIEW_THRESHOLD,
    minimumScenarioScore,
    thresholdState,
    scenarios: Object.freeze(scenarios),
    limitations: Object.freeze([
      'Each scenario removes one observed evidence family and recalculates family caps and corroboration; it does not predict missing evidence.',
      'The sensitivity review qualifies prioritisation only and does not determine maliciousness, safety, ownership, or intent.',
    ]),
  });
}

export function computeRiskScore(input: RiskInput): number | null {
  return explainRiskScore(input)?.score ?? null;
}

// Retained only for deterministic offline comparison of reviewed calibration
// datasets. Runtime lookups always use the current model above.
export function explainRiskScoreV6(input: RiskInput): RiskExplanation | null {
  const state = input.availability ?? input.state;
  if (typeof state !== 'string' || !RISK_STATES.has(state)) return null;
  const legacyBase: Readonly<Record<string, number>> = { registered: 10, for_sale: 5, expiring: 8 };
  const factors: RiskFactor[] = [];
  const totals = new Map<RiskFamily, number>();
  const add = (family: RiskFamily, label: string, delta: number): void => {
    factors.push({ family, label, delta });
    totals.set(family, (totals.get(family) ?? 0) + delta);
  };
  add('registration', `Base score for “${STATE_LABELS[state] ?? state}”`, legacyBase[state] ?? 0);
  const contextual = new Set<RiskFamily>();
  const context = mutationContext(input.mutationTypes);
  if (context) { add('domain-resemblance', context.label, context.delta); contextual.add('domain-resemblance'); }
  if (input.faviconMatch === true) { add('brand-presentation', 'Favicon matches an official Brand Profile site', 18); contextual.add('brand-presentation'); }
  else if (input.faviconNearMatch === true) { add('brand-presentation', 'Favicon resembles an official Brand Profile site', 14); contextual.add('brand-presentation'); }
  if (input.reusesOfficialAssets === true) { add('brand-presentation', 'Official asset-host relationship observed', 6); contextual.add('brand-presentation'); }
  if (typeof input.phishingLanguageMatch === 'string' && input.phishingLanguageMatch.trim()) { add('credential-lure', 'Suspicious urgency language observed', 8); contextual.add('credential-lure'); }
  if (input.hasPasswordField === true) { add('credential-lure', 'Login/password form present', 5); contextual.add('credential-lure'); }
  if (contextual.size >= 2) add('corroboration', `Corroborating context across ${contextual.size} distinct evidence families`, contextual.size >= 3 ? 20 : 10);
  const external = calibrateExternalIntelligenceRisk(input.threatIntelligence, input.domain);
  if (external.factor) add('external-intelligence', external.factor.label, external.contribution);
  if (input.activityStatus === 'active') add('operational-support', 'Active site in use', 8);
  if (input.hasMx === true) add('operational-support', 'Mail server configured', 8);
  if (input.hasSpf === true && input.hasDmarc === true) add('operational-support', 'SPF and DMARC records present', 3);
  else if (input.hasSpf === true || input.hasDmarc === true) add('operational-support', 'SPF or DMARC record present', 1);
  if (input.privacyProtected === true) add('registration', 'WHOIS privacy protected', 3);
  if (typeof input.domainAgeDays === 'number' && Number.isFinite(input.domainAgeDays) && input.domainAgeDays >= 0) {
    if (input.domainAgeDays < 90) add('operational-support', `Recently registered (${formatAge(input.domainAgeDays)})`, 10);
    else if (input.domainAgeDays < 365) add('operational-support', `Registered under a year ago (${formatAge(input.domainAgeDays)})`, 4);
  }
  const rawScore = Math.round(factors.reduce((total, factor) => total + factor.delta, 0));
  const score = Math.max(0, Math.min(100, rawScore));
  return {
    modelVersion: 6,
    score,
    rawScore,
    capped: score !== rawScore,
    factors,
    families: [...totals].map(([id, contribution]) => ({ id, contribution, cap: null })),
    evidenceQuality: scoreQuality(input),
  };
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
  parts.push(`Total ${explained.score} · Risk model v${explained.modelVersion} · evidence ${explained.evidenceQuality.state}`);
  return parts.join(separator);
}

export type { RiskExplanation, RiskFactor, RiskFamily, RiskInput, RiskScoreSensitivity, RiskSensitivityScenario };

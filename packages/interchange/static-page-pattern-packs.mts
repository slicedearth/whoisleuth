import {
  DETECTION_RULE_SCHEMA,
  DETECTION_RULE_SCHEMA_VERSION,
  mergeDetectionRules,
  type DetectionRule,
} from '../workspace/detection-rule-model.mts';
import {
  MAX_STATIC_PAGE_PATTERN_PACK_BYTES,
  STATIC_PAGE_PATTERN_PACK_SCHEMA,
  STATIC_PAGE_PATTERN_PACK_VERSION,
} from '../contracts/analyst-interchange.mts';

export {
  MAX_STATIC_PAGE_PATTERN_PACK_BYTES,
  STATIC_PAGE_PATTERN_PACK_SCHEMA,
  STATIC_PAGE_PATTERN_PACK_VERSION,
} from '../contracts/analyst-interchange.mts';

export const MAX_STATIC_PAGE_PATTERN_PACK_RULES = 16;
const SAFE_PACK_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

export type StaticPagePatternPack = Readonly<{
  id: string;
  label: string;
  description: string;
  evidenceBoundary: string;
  relationship: 'generic' | 'brand_relative';
  confidence: 'review_required';
  rules: readonly DetectionRule[];
}>;

export const REVIEWED_STATIC_PAGE_PATTERN_PACKS: readonly StaticPagePatternPack[] = Object.freeze([
  {
    id: 'credential-overlap',
    label: 'Credential and identity overlap',
    description: 'Queues reviewed pages that combine a password field with an exact official favicon or retained official asset reuse.',
    evidenceBoundary: 'Requires compact case evidence already retained from a reviewed scan. A match is a triage prompt, not a phishing finding.',
    relationship: 'brand_relative',
    confidence: 'review_required',
    rules: [
      {
        id: 'pack-credential-favicon-v1',
        name: 'Reviewed pattern: password field and official favicon',
        enabled: true,
        match: 'all',
        conditions: [
          { field: 'hasPasswordField', operator: 'equals', value: true },
          { field: 'faviconMatch', operator: 'equals', value: true },
        ],
        riskDelta: 0,
        tag: 'review-page-overlap',
      },
      {
        id: 'pack-credential-assets-v1',
        name: 'Reviewed pattern: password field and official assets',
        enabled: true,
        match: 'all',
        conditions: [
          { field: 'hasPasswordField', operator: 'equals', value: true },
          { field: 'reusesOfficialAssets', operator: 'equals', value: true },
        ],
        riskDelta: 0,
        tag: 'review-page-overlap',
      },
    ],
  },
  {
    id: 'lookalike-page-cues',
    label: 'Lookalike page cues',
    description: 'Queues pages with a password field and a similar favicon, or a retained phishing-language cue and exact favicon match.',
    evidenceBoundary: 'The rules use separately retained visual and text cues. Similarity, copied assets, and language do not establish intent or control.',
    relationship: 'brand_relative',
    confidence: 'review_required',
    rules: [
      {
        id: 'pack-credential-near-favicon-v1',
        name: 'Reviewed pattern: password field and similar favicon',
        enabled: true,
        match: 'all',
        conditions: [
          { field: 'hasPasswordField', operator: 'equals', value: true },
          { field: 'faviconNearMatch', operator: 'equals', value: true },
        ],
        riskDelta: 0,
        tag: 'review-lookalike-page',
      },
      {
        id: 'pack-language-favicon-v1',
        name: 'Reviewed pattern: language cue and official favicon',
        enabled: true,
        match: 'all',
        conditions: [
          { field: 'phishingLanguageMatch', operator: 'present', value: true },
          { field: 'faviconMatch', operator: 'equals', value: true },
        ],
        riskDelta: 0,
        tag: 'review-lookalike-page',
      },
    ],
  },
  {
    id: 'mail-and-login-cues',
    label: 'Mail and login exposure',
    description: 'Queues registered domains where mail publication and a password field are both present.',
    evidenceBoundary: 'Mail and login capability are common legitimate features. This pattern exists only to focus manual review.',
    relationship: 'generic',
    confidence: 'review_required',
    rules: [
      {
        id: 'pack-mail-login-v1',
        name: 'Reviewed pattern: registered mail-enabled login page',
        enabled: true,
        match: 'all',
        conditions: [
          { field: 'availability', operator: 'equals', value: 'registered' },
          { field: 'hasMx', operator: 'equals', value: true },
          { field: 'hasPasswordField', operator: 'equals', value: true },
        ],
        riskDelta: 0,
        tag: 'review-mail-login',
      },
    ],
  },
  {
    id: 'urgent-account-language',
    label: 'Urgent account language',
    description: 'Queues credential pages where the bounded static-language matcher observed a reviewed urgency or account-warning phrase.',
    evidenceBoundary: 'Legitimate support and identity pages can use similar wording. The retained phrase is a review cue, not a deception finding.',
    relationship: 'generic',
    confidence: 'review_required',
    rules: [
      {
        id: 'pack-urgent-account-language-v1',
        name: 'Reviewed pattern: credential form and urgent account language',
        enabled: true,
        match: 'all',
        conditions: [
          { field: 'hasPasswordField', operator: 'equals', value: true },
          { field: 'phishingLanguageMatch', operator: 'present', value: true },
        ],
        riskDelta: 0,
        tag: 'review-urgent-language',
      },
    ],
  },
  {
    id: 'wallet-prompt-cues',
    label: 'Wallet prompt cues',
    description: 'Queues the fixed recovery-secret category emitted for reviewed wallet, recovery phrase, seed phrase, or private-key prompts.',
    evidenceBoundary: 'The retained value is a fixed category label, not matched page text. It may describe legitimate wallet software, support content, or a warning and does not establish credential collection or intent.',
    relationship: 'generic',
    confidence: 'review_required',
    rules: [
      {
        id: 'pack-wallet-recovery-secret-v1',
        name: 'Reviewed pattern: wallet or recovery-secret prompt',
        enabled: true,
        match: 'all',
        conditions: [{ field: 'phishingLanguageMatch', operator: 'contains', value: 'wallet or recovery-secret' }],
        riskDelta: 0,
        tag: 'review-wallet-prompt',
      },
    ],
  },
  {
    id: 'external-form-destination',
    label: 'External form destination',
    description: 'Queues password forms whose already-observed static action points to a different origin.',
    evidenceBoundary: 'External form providers and federated identity flows are common. Only a compact boolean is retained, and a match is not a vulnerability or phishing finding.',
    relationship: 'generic',
    confidence: 'review_required',
    rules: [
      {
        id: 'pack-password-external-form-v1',
        name: 'Reviewed pattern: password field and external form destination',
        enabled: true,
        match: 'all',
        conditions: [
          { field: 'hasPasswordField', operator: 'equals', value: true },
          { field: 'hasExternalFormAction', operator: 'equals', value: true },
        ],
        riskDelta: 0,
        tag: 'review-external-form',
      },
    ],
  },
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/gu, ' ').trim();
}

export function validateStaticPagePatternPack(raw: unknown): StaticPagePatternPack {
  const item = record(raw);
  if (item.schema !== STATIC_PAGE_PATTERN_PACK_SCHEMA) {
    throw new Error('This JSON file is not a WHOISleuth static page-pattern pack.');
  }
  if (item.version !== STATIC_PAGE_PATTERN_PACK_VERSION) {
    throw new Error(`This page-pattern pack requires schema ${STATIC_PAGE_PATTERN_PACK_VERSION}.`);
  }
  const id = text(item.id, 64);
  const label = text(item.label, 100);
  const description = text(item.description, 500);
  const evidenceBoundary = text(item.evidenceBoundary, 800);
  const relationship = item.relationship === 'brand_relative' ? 'brand_relative' : item.relationship === 'generic' ? 'generic' : null;
  const confidence = item.confidence === 'review_required' ? 'review_required' : null;
  if (!SAFE_PACK_ID_RE.test(id) || !label || !description || !evidenceBoundary || !relationship || !confidence) {
    throw new Error('The page-pattern pack metadata is incomplete or invalid.');
  }
  if (!Array.isArray(item.rules) || !item.rules.length || item.rules.length > MAX_STATIC_PAGE_PATTERN_PACK_RULES) {
    throw new Error(`Page-pattern packs require 1 to ${MAX_STATIC_PAGE_PATTERN_PACK_RULES} bounded rules.`);
  }
  const merged = mergeDetectionRules([], {
    schema: DETECTION_RULE_SCHEMA,
    version: DETECTION_RULE_SCHEMA_VERSION,
    rules: item.rules,
  });
  if (merged.skipped || merged.added !== item.rules.length) {
    throw new Error('The page-pattern pack contains an invalid or duplicate rule.');
  }
  if (merged.rules.some((rule) => rule.riskDelta !== 0)) {
    throw new Error('Page-pattern pack rules cannot contribute to Risk until separately calibrated.');
  }
  return {
    id,
    label,
    description,
    evidenceBoundary,
    relationship,
    confidence,
    rules: merged.rules,
  };
}

function conditionSignature(rule: DetectionRule): string {
  return JSON.stringify({
    match: rule.match,
    conditions: [...rule.conditions]
      .map((condition) => `${condition.field}:${condition.operator}:${String(condition.value)}`)
      .sort(),
  });
}

export function lintStaticPagePatternPacks(packs: readonly StaticPagePatternPack[]): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const packIds = new Set<string>();
  const ruleIds = new Map<string, string>();
  const signatures = new Map<string, string>();
  for (const pack of packs.slice(0, 100)) {
    if (packIds.has(pack.id)) errors.push(`Duplicate pack id: ${pack.id}`);
    packIds.add(pack.id);
    for (const rule of pack.rules.slice(0, MAX_STATIC_PAGE_PATTERN_PACK_RULES)) {
      const priorRulePack = ruleIds.get(rule.id);
      if (priorRulePack) errors.push(`Rule id ${rule.id} appears in ${priorRulePack} and ${pack.id}.`);
      else ruleIds.set(rule.id, pack.id);
      const signature = conditionSignature(rule);
      const priorSignature = signatures.get(signature);
      if (priorSignature) warnings.push(`Equivalent rule logic appears in ${priorSignature} and ${pack.id}.`);
      else signatures.set(signature, pack.id);
    }
  }
  return { errors, warnings };
}

export function buildStaticPagePatternPackDocument(pack: StaticPagePatternPack): {
  schema: typeof STATIC_PAGE_PATTERN_PACK_SCHEMA;
  version: typeof STATIC_PAGE_PATTERN_PACK_VERSION;
  id: string;
  label: string;
  description: string;
  evidenceBoundary: string;
  relationship: StaticPagePatternPack['relationship'];
  confidence: StaticPagePatternPack['confidence'];
  rules: DetectionRule[];
} {
  return {
    schema: STATIC_PAGE_PATTERN_PACK_SCHEMA,
    version: STATIC_PAGE_PATTERN_PACK_VERSION,
    id: pack.id,
    label: pack.label,
    description: pack.description,
    evidenceBoundary: pack.evidenceBoundary,
    relationship: pack.relationship,
    confidence: pack.confidence,
    rules: pack.rules.map((rule) => ({
      ...rule,
      conditions: rule.conditions.map((condition) => ({ ...condition })),
    })),
  };
}

export function reviewedStaticPagePatternPackExport(packId: unknown): {
  schema: typeof DETECTION_RULE_SCHEMA;
  version: typeof DETECTION_RULE_SCHEMA_VERSION;
  rules: DetectionRule[];
} {
  const pack = REVIEWED_STATIC_PAGE_PATTERN_PACKS.find((item) => item.id === packId);
  if (!pack) throw new Error('That reviewed static page-pattern pack is unavailable.');
  return staticPagePatternPackRuleExport(pack);
}

export function staticPagePatternPackRuleExport(pack: StaticPagePatternPack): {
  schema: typeof DETECTION_RULE_SCHEMA;
  version: typeof DETECTION_RULE_SCHEMA_VERSION;
  rules: DetectionRule[];
} {
  const validated = validateStaticPagePatternPack(buildStaticPagePatternPackDocument(pack));
  return {
    schema: DETECTION_RULE_SCHEMA,
    version: DETECTION_RULE_SCHEMA_VERSION,
    rules: validated.rules.map((rule) => ({
      ...rule,
      conditions: rule.conditions.map((condition) => ({ ...condition })),
    })),
  };
}

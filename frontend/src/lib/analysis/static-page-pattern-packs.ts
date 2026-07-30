import {
  DETECTION_RULE_SCHEMA,
  DETECTION_RULE_SCHEMA_VERSION,
  type DetectionRule,
} from './detection-rule-model.ts';

export const STATIC_PAGE_PATTERN_PACK_VERSION = 1;

export type StaticPagePatternPack = Readonly<{
  id: string;
  label: string;
  description: string;
  evidenceBoundary: string;
  rules: readonly DetectionRule[];
}>;

export const REVIEWED_STATIC_PAGE_PATTERN_PACKS: readonly StaticPagePatternPack[] = Object.freeze([
  {
    id: 'credential-overlap',
    label: 'Credential and identity overlap',
    description: 'Queues reviewed pages that combine a password field with an exact official favicon or retained official asset reuse.',
    evidenceBoundary: 'Requires compact case evidence already retained from a reviewed scan. A match is a triage prompt, not a phishing finding.',
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
]);

export function reviewedStaticPagePatternPackExport(packId: unknown): {
  schema: typeof DETECTION_RULE_SCHEMA;
  version: typeof DETECTION_RULE_SCHEMA_VERSION;
  rules: DetectionRule[];
} {
  const pack = REVIEWED_STATIC_PAGE_PATTERN_PACKS.find((item) => item.id === packId);
  if (!pack) throw new Error('That reviewed static page-pattern pack is unavailable.');
  return {
    schema: DETECTION_RULE_SCHEMA,
    version: DETECTION_RULE_SCHEMA_VERSION,
    rules: pack.rules.map((rule) => ({
      ...rule,
      conditions: rule.conditions.map((condition) => ({ ...condition })),
    })),
  };
}

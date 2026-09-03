import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const RISK_CALIBRATION_DATASET_SCHEMA = 'whoisleuth.risk-calibration-dataset';
export const RISK_CALIBRATION_DATASET_VERSION = 2;
export const SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS = Object.freeze([RISK_CALIBRATION_DATASET_VERSION] as const);
export const RISK_CALIBRATION_REPORT_SCHEMA = 'whoisleuth.cli.risk-calibration';
export const RISK_CALIBRATION_REPORT_VERSION = 3;
export const SUPPORTED_RISK_CALIBRATION_REPORT_VERSIONS = Object.freeze([RISK_CALIBRATION_REPORT_VERSION] as const);
export const MAX_RISK_CALIBRATION_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_RISK_CALIBRATION_RECORDS = 500;
export const MAX_RISK_CALIBRATION_STRING_LENGTH = 256;
export const MAX_RISK_CALIBRATION_SUMMARY_BYTES = 512 * 1024;
export const MAX_RISK_CALIBRATION_DETAILED_REPORT_BYTES = 32 * 1024 * 1024;
export const MAX_RISK_CALIBRATION_JSON_DEPTH = 48;
export const MAX_RISK_CALIBRATION_JSON_KEYS = 50_000;
export const MAX_RISK_CALIBRATION_JSON_VALUES = 100_000;
export const MAX_RISK_CALIBRATION_JSON_CONTAINER_ITEMS = 10_000;
export const MAX_RISK_CALIBRATION_MUTATIONS = 30;
export const MAX_RISK_CALIBRATION_PROVIDERS = 10;
export const MAX_RISK_CALIBRATION_FINDINGS_PER_PROVIDER = 100;
export const MAX_RISK_CALIBRATION_TIMESTAMP_LENGTH = 64;
export const MAX_RISK_CALIBRATION_RECORD_ID_LENGTH = 128;
export const MAX_RISK_CALIBRATION_DOMAIN_LENGTH = 253;
export const MAX_RISK_CALIBRATION_DISPOSITION_LENGTH = 32;
export const MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH = 64;
export const MAX_RISK_CALIBRATION_PROVIDER_ID_LENGTH = 64;
export const MAX_RISK_CALIBRATION_PROVIDER_STATE_LENGTH = 32;
export const MAX_RISK_CALIBRATION_FINDING_CATEGORY_LENGTH = 64;
export const MAX_RISK_CALIBRATION_AVAILABILITY_LENGTH = 32;
export const MAX_RISK_CALIBRATION_ACTIVITY_LENGTH = 32;
export const MAX_RISK_CALIBRATION_SCAN_DEPTH_LENGTH = 16;
export const MAX_RISK_CALIBRATION_DOMAIN_AGE_DAYS = 100_000;
export const MAX_RISK_CALIBRATION_SUMMARY_STRATA = 32;
export const MAX_RISK_CALIBRATION_MODEL_VERSION = 100;
export const RISK_CALIBRATION_REVIEW_REASON_VALUES = Object.freeze([
  'authorized_or_owned',
  'shared_infrastructure',
  'generic_platform_or_template',
  'parked_or_reseller',
  'insufficient_evidence',
  'legitimate_third_party',
  'confirmed_credential_abuse',
  'confirmed_malware',
  'other_reviewed',
] as const);
export const RISK_CALIBRATION_MUTATION_TYPES = Object.freeze([
  'unicode_homoglyph',
  'unicode_homoglyph_depth_2',
  'dictionary',
  'dictionary_token_replacement',
  'ascii_homoglyph',
  'bitsquatting',
  'tld_embedding',
  'tld_typo',
  'tld_substitution',
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
] as const);

export const RISK_CALIBRATION_DATASET_ROOT_KEYS = Object.freeze([
  'schema', 'version', 'records',
] as const);
export const RISK_CALIBRATION_DATASET_OPTIONAL_ROOT_KEYS = Object.freeze([
  'export', 'limitations',
] as const);
export const RISK_CALIBRATION_DATASET_RECORD_KEYS = Object.freeze([
  'id', 'domain', 'analystDisposition', 'evidence',
] as const);
export const RISK_CALIBRATION_DATASET_OPTIONAL_RECORD_KEYS = Object.freeze([
  'reviewReasonCode',
] as const);
export const RISK_CALIBRATION_EVIDENCE_OPTIONAL_KEYS = Object.freeze([
  'activityStatus', 'mutationTypes', 'domainAgeDays', 'faviconMatch',
  'faviconNearMatch', 'reusesOfficialAssets', 'hasPasswordField', 'hasMx',
  'hasSpf', 'hasDmarc', 'privacyProtected', 'phishingLanguageMatch',
  'hasExternalFormAction', 'idnReferenceMatch', 'pageBaselineMatch',
  'hasActiveBrandProfile', 'scanDepth', 'observedAt', 'threatIntelligence',
] as const);
export const RISK_CALIBRATION_THREAT_INTELLIGENCE_KEYS = Object.freeze([
  'providers',
] as const);
export const RISK_CALIBRATION_PROVIDER_KEYS = Object.freeze([
  'provider', 'state', 'findings',
] as const);
export const RISK_CALIBRATION_PROVIDER_OPTIONAL_KEYS = Object.freeze([
  'observation',
] as const);
export const RISK_CALIBRATION_PROVIDER_IDENTITY_KEYS = Object.freeze(['id'] as const);
export const RISK_CALIBRATION_OBSERVATION_OPTIONAL_KEYS = Object.freeze(['observedAt'] as const);
export const RISK_CALIBRATION_FINDING_KEYS = Object.freeze(['category'] as const);
export const RISK_CALIBRATION_FINDING_OPTIONAL_KEYS = Object.freeze([
  'firstObservedAt', 'lastObservedAt',
] as const);
export const RISK_CALIBRATION_EXPORT_KEYS = Object.freeze([
  'selected', 'included', 'excluded', 'exclusions',
] as const);
export const RISK_CALIBRATION_EXPORT_EXCLUSION_KEYS = Object.freeze([
  'caseId', 'domain', 'reason',
] as const);
export const RISK_CALIBRATION_EXPORT_LIMITATIONS = Object.freeze([
  'This file contains analyst-selected case domains, reviewed dispositions, and a bounded subset of normalised scoring inputs.',
  'It excludes notes, tags, assertions, actions, contacts, raw source data, provider payloads, and stored Risk scores.',
  'The CLI revalidates every record and does not tune the Risk model automatically. Analyst dispositions do not prove maliciousness or safety.',
] as const);

export const RISK_CALIBRATION_REPORT_V3_DETAILED_ROOT_KEYS = Object.freeze([
  'schema', 'version', 'mode', 'generatedAt', 'dataset', 'riskModelVersion',
  'currentReviewThreshold', 'summary', 'thresholds', 'strata',
  'modelComparison', 'records', 'interpretation',
] as const);
export const RISK_CALIBRATION_REPORT_V3_SUMMARY_ROOT_KEYS = Object.freeze([
  'schema', 'version', 'mode', 'generatedAt', 'dataset', 'riskModelVersion',
  'currentReviewThreshold', 'summary', 'thresholds', 'strata',
  'modelComparison', 'privacy', 'interpretation',
] as const);
export const RISK_CALIBRATION_REPORT_DATASET_KEYS = Object.freeze([
  'schema', 'version', 'recordCount',
] as const);
export const RISK_CALIBRATION_REPORT_SUMMARY_KEYS = Object.freeze([
  'total', 'positive', 'negative', 'excluded', 'scoreBands',
] as const);
export const RISK_CALIBRATION_REPORT_SCORE_BAND_KEYS = Object.freeze([
  'not_scored', '0_39', '40_69', '70_100',
] as const);
export const RISK_CALIBRATION_REPORT_METRIC_KEYS = Object.freeze([
  'threshold', 'truePositive', 'falsePositive', 'trueNegative', 'falseNegative',
  'precision', 'recall', 'specificity', 'falsePositiveRate',
  'f1', 'balancedAccuracy', 'confidence95',
] as const);
export const RISK_CALIBRATION_REPORT_CONFIDENCE_KEYS = Object.freeze([
  'precision', 'recall', 'specificity',
] as const);
export const RISK_CALIBRATION_REPORT_INTERVAL_KEYS = Object.freeze(['lower', 'upper'] as const);
export const RISK_CALIBRATION_REPORT_STRATUM_KEYS = Object.freeze([
  'dimension', 'value', 'sampleCount', 'insufficientSample', 'metrics',
] as const);
export const RISK_CALIBRATION_REPORT_MODEL_COMPARISON_KEYS = Object.freeze([
  'available', 'previousModelVersion', 'currentModelVersion', 'scoresChanged',
  'bandsChanged', 'thresholdClassificationsChanged',
] as const);
export const RISK_CALIBRATION_REPORT_RECORD_KEYS = Object.freeze([
  'id', 'domain', 'analystDisposition', 'reviewReasonCode',
  'interoperabilityTags', 'metricClass', 'includedInMetrics',
  'exclusionReason', 'modelVersion', 'score', 'band', 'factors',
] as const);
export const RISK_CALIBRATION_REPORT_FACTOR_KEYS = Object.freeze(['family', 'label', 'delta'] as const);
export const RISK_CALIBRATION_REPORT_PRIVACY_KEYS = Object.freeze([
  'targetsRetained', 'identifiersRetained', 'rawEvidenceRetained',
] as const);
export const RISK_CALIBRATION_REPORT_INTERPRETATION_KEYS = Object.freeze([
  'authority', 'statement', 'automaticTuning', 'networkRequests', 'persisted',
] as const);

export type RiskCalibrationDatasetVersion = typeof SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS[number];
export type RiskCalibrationDisposition =
  | 'unreviewed'
  | 'suspicious'
  | 'confirmed_abuse'
  | 'false_positive'
  | 'expected'
  | 'closed_no_action';

export type RiskCalibrationThreatIntelligence = Readonly<{
  providers: readonly Readonly<{
    provider: Readonly<{ id: string }>;
    state: string;
    observation?: Readonly<{ observedAt?: string }>;
    findings: readonly Readonly<{
      category: string;
      firstObservedAt?: string;
      lastObservedAt?: string;
    }>[];
  }>[];
}>;

export type RiskCalibrationEvidence = Readonly<{
  availability: 'registered' | 'for_sale' | 'expiring' | 'available' | 'unknown' | 'error';
  activityStatus?: 'active' | 'parked' | 'unreachable' | 'no_site';
  mutationTypes?: readonly string[];
  domainAgeDays?: number;
  faviconMatch?: boolean;
  faviconNearMatch?: boolean;
  reusesOfficialAssets?: boolean;
  hasPasswordField?: boolean;
  hasMx?: boolean;
  hasSpf?: boolean;
  hasDmarc?: boolean;
  privacyProtected?: boolean;
  phishingLanguageMatch?: string;
  hasExternalFormAction?: boolean;
  idnReferenceMatch?: boolean;
  pageBaselineMatch?: boolean;
  hasActiveBrandProfile?: boolean;
  scanDepth?: 'fast' | 'deep';
  observedAt?: string;
  threatIntelligence?: RiskCalibrationThreatIntelligence;
}>;

export type RiskCalibrationRecord = Readonly<{
  id: string;
  domain: string;
  analystDisposition: RiskCalibrationDisposition;
  reviewReasonCode?: string;
  evidence: RiskCalibrationEvidence;
}>;

export type RiskCalibrationDataset = Readonly<{
  schema: typeof RISK_CALIBRATION_DATASET_SCHEMA;
  version: RiskCalibrationDatasetVersion;
  records: readonly RiskCalibrationRecord[];
}>;

export const RISK_CALIBRATION_DATASET_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.risk-calibration-dataset',
  kind: 'cli_document',
  schema: RISK_CALIBRATION_DATASET_SCHEMA,
  currentVersion: RISK_CALIBRATION_DATASET_VERSION,
  supportedVersions: SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: MAX_RISK_CALIBRATION_INPUT_BYTES,
  owner: 'packages/contracts/risk-calibration.mts',
  note: 'Offline labelled fixture input; version 2 adds bounded review context without live collection.',
});

export const RISK_CALIBRATION_REPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.risk-calibration-report',
  kind: 'cli_document',
  schema: RISK_CALIBRATION_REPORT_SCHEMA,
  currentVersion: RISK_CALIBRATION_REPORT_VERSION,
  supportedVersions: SUPPORTED_RISK_CALIBRATION_REPORT_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: null,
  owner: 'packages/contracts/risk-calibration.mts',
  note: 'Offline calibration output; version 3 distinguishes the bounded detailed report from a target-free aggregate summary for tab-local review.',
});

function exactReportObject(path: string, requiredKeys: readonly string[]) {
  return {
    path,
    requiredKeys,
    alternativeRequiredKeys: [],
    optionalKeys: [],
    unknownKeys: 'reject' as const,
  };
}

function metricObjects(path: string) {
  return [
    exactReportObject(path, RISK_CALIBRATION_REPORT_METRIC_KEYS),
    exactReportObject(`${path}.confidence95`, RISK_CALIBRATION_REPORT_CONFIDENCE_KEYS),
    ...RISK_CALIBRATION_REPORT_CONFIDENCE_KEYS.map((field) => (
      exactReportObject(`${path}.confidence95.${field}`, RISK_CALIBRATION_REPORT_INTERVAL_KEYS)
    )),
  ];
}

const DATASET_SHAPE_OBJECTS = [
  {
    path: '$',
    requiredKeys: RISK_CALIBRATION_DATASET_ROOT_KEYS,
    alternativeRequiredKeys: [],
    optionalKeys: [],
    unknownKeys: 'discard_bounded' as const,
  },
  {
    path: '$.records[]',
    requiredKeys: RISK_CALIBRATION_DATASET_RECORD_KEYS,
    alternativeRequiredKeys: [],
    optionalKeys: RISK_CALIBRATION_DATASET_OPTIONAL_RECORD_KEYS,
    unknownKeys: 'discard_bounded' as const,
  },
  {
    path: '$.records[].evidence',
    requiredKeys: [],
    alternativeRequiredKeys: [{ keys: ['availability', 'state'], resolution: 'first_present' as const }],
    optionalKeys: RISK_CALIBRATION_EVIDENCE_OPTIONAL_KEYS,
    unknownKeys: 'discard_bounded' as const,
  },
  {
    path: '$.records[].evidence.threatIntelligence',
    requiredKeys: RISK_CALIBRATION_THREAT_INTELLIGENCE_KEYS,
    alternativeRequiredKeys: [],
    optionalKeys: [],
    unknownKeys: 'discard_bounded' as const,
  },
  {
    path: '$.records[].evidence.threatIntelligence.providers[]',
    requiredKeys: RISK_CALIBRATION_PROVIDER_KEYS,
    alternativeRequiredKeys: [],
    optionalKeys: RISK_CALIBRATION_PROVIDER_OPTIONAL_KEYS,
    unknownKeys: 'discard_bounded' as const,
  },
  {
    path: '$.records[].evidence.threatIntelligence.providers[].provider',
    requiredKeys: RISK_CALIBRATION_PROVIDER_IDENTITY_KEYS,
    alternativeRequiredKeys: [],
    optionalKeys: [],
    unknownKeys: 'discard_bounded' as const,
  },
  {
    path: '$.records[].evidence.threatIntelligence.providers[].observation',
    requiredKeys: [],
    alternativeRequiredKeys: [],
    optionalKeys: RISK_CALIBRATION_OBSERVATION_OPTIONAL_KEYS,
    unknownKeys: 'discard_bounded' as const,
  },
  {
    path: '$.records[].evidence.threatIntelligence.providers[].findings[]',
    requiredKeys: RISK_CALIBRATION_FINDING_KEYS,
    alternativeRequiredKeys: [],
    optionalKeys: RISK_CALIBRATION_FINDING_OPTIONAL_KEYS,
    unknownKeys: 'discard_bounded' as const,
  },
] as const;

const REPORT_COMMON_OBJECTS = [
  exactReportObject('$.dataset', RISK_CALIBRATION_REPORT_DATASET_KEYS),
  exactReportObject('$.summary', RISK_CALIBRATION_REPORT_SUMMARY_KEYS),
  exactReportObject('$.summary.scoreBands', RISK_CALIBRATION_REPORT_SCORE_BAND_KEYS),
  ...metricObjects('$.thresholds[]'),
  exactReportObject('$.strata[]', RISK_CALIBRATION_REPORT_STRATUM_KEYS),
  ...metricObjects('$.strata[].metrics'),
  exactReportObject('$.modelComparison', RISK_CALIBRATION_REPORT_MODEL_COMPARISON_KEYS),
  exactReportObject('$.interpretation', RISK_CALIBRATION_REPORT_INTERPRETATION_KEYS),
] as const;

const REPORT_RECORD_OBJECTS = [
  exactReportObject('$.records[]', RISK_CALIBRATION_REPORT_RECORD_KEYS),
  exactReportObject('$.records[].factors[]', RISK_CALIBRATION_REPORT_FACTOR_KEYS),
] as const;

export const RISK_CALIBRATION_SCHEMA_LIFECYCLE = defineSchemaLifecycleFamily({
  id: 'risk-calibration',
  owner: 'packages/contracts/risk-calibration.mts',
  privacy: 'analyst_authored_sensitive',
  compatibility: [
    RISK_CALIBRATION_DATASET_COMPATIBILITY,
    RISK_CALIBRATION_REPORT_COMPATIBILITY,
  ],
  contracts: [
    {
      compatibilityId: RISK_CALIBRATION_DATASET_COMPATIBILITY.id,
      schema: RISK_CALIBRATION_DATASET_SCHEMA,
      version: RISK_CALIBRATION_DATASET_VERSION,
      role: 'document',
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: false,
      extensionPolicy: 'discard_bounded',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: MAX_RISK_CALIBRATION_INPUT_BYTES,
      fixtureIds: ['risk-calibration-dataset-v2'],
    },
    {
      compatibilityId: RISK_CALIBRATION_REPORT_COMPATIBILITY.id,
      schema: RISK_CALIBRATION_REPORT_SCHEMA,
      version: RISK_CALIBRATION_REPORT_VERSION,
      role: 'document',
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: null,
      fixtureIds: [
        'risk-calibration-report-v3-detailed',
        'risk-calibration-report-v3-summary',
      ],
    },
  ],
  fixtures: [
    {
      id: 'risk-calibration-dataset-v2',
      path: 'test/fixtures/risk-calibration-dataset-v2.json',
      bytes: 1_154,
      sha256: 'bd650fe84923c61658d451c25d928bd5ff8e54ff585f4f059e6798c681f9a401',
      contentDigestSha256: null,
      schema: RISK_CALIBRATION_DATASET_SCHEMA,
      version: RISK_CALIBRATION_DATASET_VERSION,
      role: 'current',
      expectation: 'accepted_exact',
      expectedOutputFixtureId: null,
      scope: 'repository',
      shapeId: 'risk-calibration.dataset.v2',
    },
    {
      id: 'risk-calibration-report-v3-detailed',
      path: 'test/fixtures/risk-calibration-report-v3-detailed.json',
      bytes: 7_026,
      sha256: '5c0c435e81478e90bc0b64aa7c20fd82d131b5261a57d9550df3f03334bc20e1',
      contentDigestSha256: null,
      schema: RISK_CALIBRATION_REPORT_SCHEMA,
      version: RISK_CALIBRATION_REPORT_VERSION,
      role: 'current',
      expectation: 'accepted_exact',
      expectedOutputFixtureId: null,
      scope: 'repository',
      shapeId: 'risk-calibration.report.v3-detailed',
    },
    {
      id: 'risk-calibration-report-v3-summary',
      path: 'test/fixtures/risk-calibration-report-v3-summary.json',
      bytes: 5_486,
      sha256: 'b06c312eed14680ce30fd58a84a93908d29ea9e71bfee8174b90df286b730549',
      contentDigestSha256: null,
      schema: RISK_CALIBRATION_REPORT_SCHEMA,
      version: RISK_CALIBRATION_REPORT_VERSION,
      role: 'current',
      expectation: 'accepted_exact',
      expectedOutputFixtureId: null,
      scope: 'repository',
      shapeId: 'risk-calibration.report.v3-summary',
    },
  ],
  metadata: {
    metadataVersion: 4,
    enforcement: 'declarative_only',
    shapes: [
      ...[RISK_CALIBRATION_DATASET_VERSION].map((version) => ({
        id: `risk-calibration.dataset.v${version}`,
        schema: RISK_CALIBRATION_DATASET_SCHEMA,
        versions: [version],
        objects: DATASET_SHAPE_OBJECTS,
        fixedArrays: [],
        normalisation: 'project_known_fields' as const,
        target: null,
        discriminator: null,
      })),
      {
        id: 'risk-calibration.report.v3-detailed',
        schema: RISK_CALIBRATION_REPORT_SCHEMA,
        versions: [RISK_CALIBRATION_REPORT_VERSION],
        objects: [
          exactReportObject('$', RISK_CALIBRATION_REPORT_V3_DETAILED_ROOT_KEYS),
          ...REPORT_COMMON_OBJECTS,
          ...REPORT_RECORD_OBJECTS,
        ],
        fixedArrays: [],
        normalisation: 'preserve_document',
        target: null,
        discriminator: { path: '$.mode', value: 'detailed' },
      },
      {
        id: 'risk-calibration.report.v3-summary',
        schema: RISK_CALIBRATION_REPORT_SCHEMA,
        versions: [RISK_CALIBRATION_REPORT_VERSION],
        objects: [
          exactReportObject('$', RISK_CALIBRATION_REPORT_V3_SUMMARY_ROOT_KEYS),
          ...REPORT_COMMON_OBJECTS,
          exactReportObject('$.privacy', RISK_CALIBRATION_REPORT_PRIVACY_KEYS),
        ],
        fixedArrays: [],
        normalisation: 'preserve_document',
        target: null,
        discriminator: { path: '$.mode', value: 'summary' },
      },
    ],
    boundProfiles: [
      {
        id: 'risk-calibration.dataset-bounds.v2',
        bounds: [
          { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_RISK_CALIBRATION_INPUT_BYTES, handling: 'reject' },
          { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_RISK_CALIBRATION_INPUT_BYTES, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_RISK_CALIBRATION_JSON_DEPTH, handling: 'reject' },
          { id: 'json-keys', path: '$', phase: 'pre_accumulation', unit: 'keys', minimum: 1, maximum: MAX_RISK_CALIBRATION_JSON_KEYS, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_RISK_CALIBRATION_JSON_VALUES, handling: 'reject' },
          { id: 'json-container-items', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 1, maximum: MAX_RISK_CALIBRATION_JSON_CONTAINER_ITEMS, handling: 'reject' },
          { id: 'records', path: '$.records', phase: 'pre_accumulation', unit: 'entries', minimum: 1, maximum: MAX_RISK_CALIBRATION_RECORDS, handling: 'reject' },
          { id: 'record-id', path: '$.records[].id', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_RECORD_ID_LENGTH, handling: 'reject' },
          { id: 'domain', path: '$.records[].domain', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_DOMAIN_LENGTH, handling: 'reject' },
          { id: 'disposition', path: '$.records[].analystDisposition', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_DISPOSITION_LENGTH, handling: 'reject' },
          { id: 'review-reason', path: '$.records[].reviewReasonCode', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH, handling: 'reject' },
          { id: 'availability', path: '$.records[].evidence.availability', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_AVAILABILITY_LENGTH, handling: 'reject' },
          { id: 'activity', path: '$.records[].evidence.activityStatus', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_ACTIVITY_LENGTH, handling: 'reject' },
          { id: 'scan-depth', path: '$.records[].evidence.scanDepth', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_SCAN_DEPTH_LENGTH, handling: 'reject' },
          { id: 'general-text', path: '$.records[].evidence.phishingLanguageMatch', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_STRING_LENGTH, handling: 'reject' },
          { id: 'timestamp', path: '$.records[].evidence.observedAt', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_TIMESTAMP_LENGTH, handling: 'reject' },
          { id: 'domain-age', path: '$.records[].evidence.domainAgeDays', phase: 'normalised', unit: 'finite_number', minimum: 0, maximum: MAX_RISK_CALIBRATION_DOMAIN_AGE_DAYS, handling: 'reject' },
          { id: 'mutation-types', path: '$.records[].evidence.mutationTypes', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_RISK_CALIBRATION_MUTATIONS, handling: 'reject' },
          { id: 'providers', path: '$.records[].evidence.threatIntelligence.providers', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_RISK_CALIBRATION_PROVIDERS, handling: 'reject' },
          { id: 'provider-id', path: '$.records[].evidence.threatIntelligence.providers[].provider.id', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_PROVIDER_ID_LENGTH, handling: 'reject' },
          { id: 'provider-state', path: '$.records[].evidence.threatIntelligence.providers[].state', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_PROVIDER_STATE_LENGTH, handling: 'reject' },
          { id: 'provider-findings', path: '$.records[].evidence.threatIntelligence.providers[].findings', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_RISK_CALIBRATION_FINDINGS_PER_PROVIDER, handling: 'reject' },
          { id: 'finding-category', path: '$.records[].evidence.threatIntelligence.providers[].findings[].category', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_RISK_CALIBRATION_FINDING_CATEGORY_LENGTH, handling: 'reject' },
        ],
      },
      {
        id: 'risk-calibration.report-detailed.v3',
        bounds: [
          { id: 'records', path: '$.records', phase: 'normalised', unit: 'entries', minimum: 1, maximum: MAX_RISK_CALIBRATION_RECORDS, handling: 'reject' },
        ],
      },
      {
        id: 'risk-calibration.report-detailed-json-output.v3',
        bounds: [
          { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_RISK_CALIBRATION_DETAILED_REPORT_BYTES, handling: 'reject' },
        ],
      },
      {
        id: 'risk-calibration.report-summary-output.v3',
        bounds: [
          { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_RISK_CALIBRATION_SUMMARY_BYTES, handling: 'reject' },
          { id: 'dataset-records', path: '$.dataset.recordCount', phase: 'normalised', unit: 'integer', minimum: 1, maximum: MAX_RISK_CALIBRATION_RECORDS, handling: 'reject' },
          { id: 'strata', path: '$.strata', phase: 'normalised', unit: 'entries', minimum: 0, maximum: MAX_RISK_CALIBRATION_SUMMARY_STRATA, handling: 'reject' },
          { id: 'model-version', path: '$.riskModelVersion', phase: 'normalised', unit: 'integer', minimum: 1, maximum: MAX_RISK_CALIBRATION_MODEL_VERSION, handling: 'reject' },
        ],
      },
      {
        id: 'risk-calibration.report-summary-input.v3',
        bounds: [
          { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_RISK_CALIBRATION_SUMMARY_BYTES, handling: 'reject' },
          { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_RISK_CALIBRATION_SUMMARY_BYTES, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_RISK_CALIBRATION_JSON_DEPTH, handling: 'reject' },
          { id: 'json-keys', path: '$', phase: 'pre_accumulation', unit: 'keys', minimum: 1, maximum: MAX_RISK_CALIBRATION_JSON_KEYS, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_RISK_CALIBRATION_JSON_VALUES, handling: 'reject' },
          { id: 'json-container-items', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 1, maximum: MAX_RISK_CALIBRATION_JSON_CONTAINER_ITEMS, handling: 'reject' },
        ],
      },
      {
        id: 'risk-calibration.cli-private-output.v1',
        bounds: [
          { id: 'output-file-bytes', path: '$.output', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_RISK_CALIBRATION_DETAILED_REPORT_BYTES, handling: 'reject' },
        ],
      },
    ],
    hooks: [
      { id: 'risk-calibration.browser.build-dataset', role: 'builder', runtime: 'browser', module: 'packages/investigation/risk-calibration-export.mts', exportName: 'buildRiskCalibrationDatasetExport' },
      { id: 'risk-calibration.browser.serialise-dataset', role: 'serialiser', runtime: 'browser', module: 'packages/investigation/risk-calibration-export.mts', exportName: 'serializeRiskCalibrationDatasetExport' },
      { id: 'risk-calibration.cli.parse-dataset', role: 'normaliser', runtime: 'cli', module: 'cli/risk-calibration.mts', exportName: 'parseRiskCalibrationDataset' },
      { id: 'risk-calibration.cli.build-detailed', role: 'builder', runtime: 'cli', module: 'cli/risk-calibration.mts', exportName: 'buildRiskCalibrationReport' },
      { id: 'risk-calibration.shared.build-summary', role: 'builder', runtime: 'shared', module: 'lib/risk-calibration-summary.mts', exportName: 'buildRiskCalibrationSummaryReport' },
      { id: 'risk-calibration.shared.parse-summary', role: 'normaliser', runtime: 'shared', module: 'lib/risk-calibration-summary.mts', exportName: 'parseRiskCalibrationSummaryReport' },
      { id: 'risk-calibration.cli.serialise-report', role: 'serialiser', runtime: 'cli', module: 'cli/risk-calibration.mts', exportName: 'serializeRiskCalibrationReport' },
      { id: 'risk-calibration.cli.format-terminal', role: 'serialiser', runtime: 'cli', module: 'cli/formatters/terminal.mts', exportName: 'formatTerminalRiskCalibration' },
      { id: 'risk-calibration.cli.write-private-file', role: 'private_file_writer', runtime: 'cli', module: 'cli/output-file.mts', exportName: 'writePrivateFile' },
      { id: 'risk-calibration.browser.read-summary', role: 'reviewer', runtime: 'browser', module: 'packages/investigation/risk-calibration-dashboard.mts', exportName: 'parseRiskCalibrationDashboard' },
    ],
    serialisationProfiles: [
      {
        id: 'risk-calibration.dataset-json.v2',
        schema: RISK_CALIBRATION_DATASET_SCHEMA,
        versions: [RISK_CALIBRATION_DATASET_VERSION],
        mediaType: 'application/json',
        encoding: 'utf-8',
        bom: false,
        indentSpaces: 2,
        terminalLf: true,
        propertyOrder: 'normalised_fixed',
        canonicalisation: null,
        integrity: 'none',
        serializerHookId: 'risk-calibration.browser.serialise-dataset',
        verifierHookIds: [],
      },
      {
        id: 'risk-calibration.report-json.v3',
        schema: RISK_CALIBRATION_REPORT_SCHEMA,
        versions: [RISK_CALIBRATION_REPORT_VERSION],
        mediaType: 'application/json',
        encoding: 'utf-8',
        bom: false,
        indentSpaces: 2,
        terminalLf: true,
        propertyOrder: 'normalised_fixed',
        canonicalisation: null,
        integrity: 'none',
        serializerHookId: 'risk-calibration.cli.serialise-report',
        verifierHookIds: [],
      },
    ],
    privacyProfiles: [
      {
        id: 'risk-calibration.dataset-export.v2',
        classification: 'analyst_authored_sensitive',
        projection: 'browser_export',
        includedCategories: ['selected-case-identifiers', 'target-identifiers', 'reviewed-dispositions', 'review-reasons', 'bounded-scoring-evidence'],
        excludedCategories: ['analyst-notes', 'tags', 'assertions', 'actions', 'contacts', 'raw-source-payloads', 'provider-payloads', 'stored-risk-scores'],
        notePolicy: 'discarded',
        retention: 'deliberate_local_file',
        network: 'none',
        sharingReview: 'required',
      },
      {
        id: 'risk-calibration.dataset-input.v2',
        classification: 'analyst_authored_sensitive',
        projection: 'full_manifest',
        includedCategories: ['target-identifiers', 'reviewed-dispositions', 'review-reasons', 'bounded-scoring-evidence', 'bounded-provider-findings'],
        excludedCategories: ['analyst-notes', 'raw-source-payloads', 'provider-payloads', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'discarded',
        retention: 'deliberate_local_file',
        network: 'none',
        sharingReview: 'required',
      },
      {
        id: 'risk-calibration.detailed-output.v3',
        classification: 'analyst_authored_sensitive',
        projection: 'review_output',
        includedCategories: ['target-identifiers', 'reviewed-dispositions', 'review-reasons', 'interoperability-tags', 'scores', 'bands', 'factors', 'aggregate-metrics'],
        excludedCategories: ['analyst-notes', 'raw-source-payloads', 'provider-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'discarded',
        retention: 'transient_report',
        network: 'none',
        sharingReview: 'required',
      },
      {
        id: 'risk-calibration.summary-output.v3',
        classification: 'metadata_only',
        projection: 'metadata_only',
        includedCategories: ['dataset-and-model-versions', 'aggregate-counts', 'fixed-threshold-metrics', 'confidence-intervals', 'bounded-strata', 'model-comparison-counts', 'zero-retention-declaration'],
        excludedCategories: ['target-identifiers', 'record-identifiers', 'reviewed-dispositions', 'review-reasons', 'records', 'evidence', 'factors'],
        notePolicy: 'not_applicable',
        retention: 'transient_report',
        network: 'none',
        sharingReview: 'not_applicable',
      },
      {
        id: 'risk-calibration.detailed-private-file.v3',
        classification: 'analyst_authored_sensitive',
        projection: 'review_output',
        includedCategories: ['target-identifiers', 'reviewed-dispositions', 'review-reasons', 'interoperability-tags', 'scores', 'bands', 'factors', 'aggregate-metrics'],
        excludedCategories: ['analyst-notes', 'raw-source-payloads', 'provider-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'discarded',
        retention: 'operator_controlled_output',
        network: 'none',
        sharingReview: 'required',
      },
      {
        id: 'risk-calibration.summary-private-file.v3',
        classification: 'metadata_only',
        projection: 'metadata_only',
        includedCategories: ['dataset-and-model-versions', 'aggregate-counts', 'fixed-threshold-metrics', 'confidence-intervals', 'bounded-strata', 'model-comparison-counts', 'zero-retention-declaration'],
        excludedCategories: ['target-identifiers', 'record-identifiers', 'reviewed-dispositions', 'review-reasons', 'records', 'evidence', 'factors'],
        notePolicy: 'not_applicable',
        retention: 'operator_controlled_output',
        network: 'none',
        sharingReview: 'not_applicable',
      },
    ],
    expiryProfiles: [{
      id: 'risk-calibration.expiry.not-applicable.v1',
      field: null,
      anchor: null,
      handling: 'not_applicable',
      phase: 'not_applicable',
      maximumLifetimeDays: null,
    }],
    consumerEdges: [
      {
        id: 'risk-calibration.browser-dataset-export',
        plane: 'browser',
        operation: 'build-dataset-download',
        acceptedContracts: [],
        emittedContract: { schema: RISK_CALIBRATION_DATASET_SCHEMA, version: RISK_CALIBRATION_DATASET_VERSION, discriminator: null },
        shapeIds: ['risk-calibration.dataset.v2'],
        boundProfileIds: ['risk-calibration.dataset-bounds.v2'],
        hookIds: ['risk-calibration.browser.build-dataset', 'risk-calibration.browser.serialise-dataset'],
        serialisationProfileId: 'risk-calibration.dataset-json.v2',
        privacyProfileId: 'risk-calibration.dataset-export.v2',
        expiryPolicyId: 'risk-calibration.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'deliberate_local_file',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'risk-calibration.cli-detailed-json-stdout',
        plane: 'cli',
        operation: 'build-detailed-json-stdout',
        acceptedContracts: [{ schema: RISK_CALIBRATION_DATASET_SCHEMA, versions: [RISK_CALIBRATION_DATASET_VERSION], mode: 'direct', discriminator: null }],
        emittedContract: { schema: RISK_CALIBRATION_REPORT_SCHEMA, version: RISK_CALIBRATION_REPORT_VERSION, discriminator: { path: '$.mode', value: 'detailed' } },
        shapeIds: ['risk-calibration.dataset.v2', 'risk-calibration.report.v3-detailed'],
        boundProfileIds: ['risk-calibration.dataset-bounds.v2', 'risk-calibration.report-detailed.v3', 'risk-calibration.report-detailed-json-output.v3'],
        hookIds: ['risk-calibration.cli.parse-dataset', 'risk-calibration.cli.build-detailed', 'risk-calibration.cli.serialise-report'],
        serialisationProfileId: 'risk-calibration.report-json.v3',
        privacyProfileId: 'risk-calibration.detailed-output.v3',
        expiryPolicyId: 'risk-calibration.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'risk-calibration.cli-dataset-read',
        plane: 'cli',
        operation: 'read-dataset',
        acceptedContracts: [{ schema: RISK_CALIBRATION_DATASET_SCHEMA, versions: [RISK_CALIBRATION_DATASET_VERSION], mode: 'direct', discriminator: null }],
        emittedContract: null,
        shapeIds: ['risk-calibration.dataset.v2'],
        boundProfileIds: ['risk-calibration.dataset-bounds.v2'],
        hookIds: ['risk-calibration.cli.parse-dataset'],
        serialisationProfileId: null,
        privacyProfileId: 'risk-calibration.dataset-input.v2',
        expiryPolicyId: 'risk-calibration.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'deliberate_local_file',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'risk-calibration.cli-detailed-terminal-stdout',
        plane: 'cli',
        operation: 'build-detailed-terminal-stdout',
        acceptedContracts: [{ schema: RISK_CALIBRATION_DATASET_SCHEMA, versions: [RISK_CALIBRATION_DATASET_VERSION], mode: 'direct', discriminator: null }],
        emittedContract: { schema: RISK_CALIBRATION_REPORT_SCHEMA, version: RISK_CALIBRATION_REPORT_VERSION, discriminator: { path: '$.mode', value: 'detailed' } },
        shapeIds: ['risk-calibration.dataset.v2', 'risk-calibration.report.v3-detailed'],
        boundProfileIds: ['risk-calibration.dataset-bounds.v2', 'risk-calibration.report-detailed.v3'],
        hookIds: ['risk-calibration.cli.parse-dataset', 'risk-calibration.cli.build-detailed', 'risk-calibration.cli.format-terminal'],
        serialisationProfileId: null,
        privacyProfileId: 'risk-calibration.detailed-output.v3',
        expiryPolicyId: 'risk-calibration.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'risk-calibration.cli-summary-json-stdout',
        plane: 'cli',
        operation: 'build-summary-json-stdout',
        acceptedContracts: [{ schema: RISK_CALIBRATION_DATASET_SCHEMA, versions: [RISK_CALIBRATION_DATASET_VERSION], mode: 'direct', discriminator: null }],
        emittedContract: { schema: RISK_CALIBRATION_REPORT_SCHEMA, version: RISK_CALIBRATION_REPORT_VERSION, discriminator: { path: '$.mode', value: 'summary' } },
        shapeIds: ['risk-calibration.dataset.v2', 'risk-calibration.report.v3-summary'],
        boundProfileIds: ['risk-calibration.dataset-bounds.v2', 'risk-calibration.report-summary-output.v3'],
        hookIds: ['risk-calibration.cli.parse-dataset', 'risk-calibration.cli.build-detailed', 'risk-calibration.shared.build-summary', 'risk-calibration.cli.serialise-report'],
        serialisationProfileId: 'risk-calibration.report-json.v3',
        privacyProfileId: 'risk-calibration.summary-output.v3',
        expiryPolicyId: 'risk-calibration.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'risk-calibration.cli-detailed-json-file',
        plane: 'cli',
        operation: 'build-detailed-json-file',
        acceptedContracts: [{ schema: RISK_CALIBRATION_DATASET_SCHEMA, versions: [RISK_CALIBRATION_DATASET_VERSION], mode: 'direct', discriminator: null }],
        emittedContract: { schema: RISK_CALIBRATION_REPORT_SCHEMA, version: RISK_CALIBRATION_REPORT_VERSION, discriminator: { path: '$.mode', value: 'detailed' } },
        shapeIds: ['risk-calibration.dataset.v2', 'risk-calibration.report.v3-detailed'],
        boundProfileIds: ['risk-calibration.dataset-bounds.v2', 'risk-calibration.report-detailed.v3', 'risk-calibration.report-detailed-json-output.v3', 'risk-calibration.cli-private-output.v1'],
        hookIds: ['risk-calibration.cli.parse-dataset', 'risk-calibration.cli.build-detailed', 'risk-calibration.cli.serialise-report', 'risk-calibration.cli.write-private-file'],
        serialisationProfileId: 'risk-calibration.report-json.v3',
        privacyProfileId: 'risk-calibration.detailed-private-file.v3',
        expiryPolicyId: 'risk-calibration.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'risk-calibration.cli-detailed-terminal-file',
        plane: 'cli',
        operation: 'build-detailed-terminal-file',
        acceptedContracts: [{ schema: RISK_CALIBRATION_DATASET_SCHEMA, versions: [RISK_CALIBRATION_DATASET_VERSION], mode: 'direct', discriminator: null }],
        emittedContract: { schema: RISK_CALIBRATION_REPORT_SCHEMA, version: RISK_CALIBRATION_REPORT_VERSION, discriminator: { path: '$.mode', value: 'detailed' } },
        shapeIds: ['risk-calibration.dataset.v2', 'risk-calibration.report.v3-detailed'],
        boundProfileIds: ['risk-calibration.dataset-bounds.v2', 'risk-calibration.report-detailed.v3', 'risk-calibration.cli-private-output.v1'],
        hookIds: ['risk-calibration.cli.parse-dataset', 'risk-calibration.cli.build-detailed', 'risk-calibration.cli.format-terminal', 'risk-calibration.cli.write-private-file'],
        serialisationProfileId: null,
        privacyProfileId: 'risk-calibration.detailed-private-file.v3',
        expiryPolicyId: 'risk-calibration.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'risk-calibration.cli-summary-json-file',
        plane: 'cli',
        operation: 'build-summary-json-file',
        acceptedContracts: [{ schema: RISK_CALIBRATION_DATASET_SCHEMA, versions: [RISK_CALIBRATION_DATASET_VERSION], mode: 'direct', discriminator: null }],
        emittedContract: { schema: RISK_CALIBRATION_REPORT_SCHEMA, version: RISK_CALIBRATION_REPORT_VERSION, discriminator: { path: '$.mode', value: 'summary' } },
        shapeIds: ['risk-calibration.dataset.v2', 'risk-calibration.report.v3-summary'],
        boundProfileIds: ['risk-calibration.dataset-bounds.v2', 'risk-calibration.report-summary-output.v3', 'risk-calibration.cli-private-output.v1'],
        hookIds: ['risk-calibration.cli.parse-dataset', 'risk-calibration.cli.build-detailed', 'risk-calibration.shared.build-summary', 'risk-calibration.cli.serialise-report', 'risk-calibration.cli.write-private-file'],
        serialisationProfileId: 'risk-calibration.report-json.v3',
        privacyProfileId: 'risk-calibration.summary-private-file.v3',
        expiryPolicyId: 'risk-calibration.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'risk-calibration.browser-summary-review',
        plane: 'browser',
        operation: 'review-summary',
        acceptedContracts: [{
          schema: RISK_CALIBRATION_REPORT_SCHEMA,
          versions: [RISK_CALIBRATION_REPORT_VERSION],
          mode: 'direct',
          discriminator: { path: '$.mode', values: ['summary'] },
        }],
        emittedContract: null,
        shapeIds: ['risk-calibration.report.v3-summary'],
        boundProfileIds: ['risk-calibration.report-summary-input.v3'],
        hookIds: ['risk-calibration.shared.parse-summary', 'risk-calibration.browser.read-summary'],
        serialisationProfileId: null,
        privacyProfileId: 'risk-calibration.summary-output.v3',
        expiryPolicyId: 'risk-calibration.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
    ],
    consumerRelationships: [],
  },
});

type RiskCalibrationJsonScalar = string | number | boolean | null;
type RiskCalibrationJsonSpec =
  | Readonly<{ kind: 'literal'; value: RiskCalibrationJsonScalar }>
  | Readonly<{
    kind: 'string';
    minimum: number;
    maximum: number;
    values: readonly string[] | null;
    controlFree: boolean;
    nonBlank: boolean;
    validate: ((value: string) => boolean) | null;
  }>
  | Readonly<{
    kind: 'number';
    minimum: number;
    maximum: number;
    integer: boolean;
    values: readonly number[] | null;
  }>
  | Readonly<{ kind: 'boolean' }>
  | Readonly<{ kind: 'nullable'; value: RiskCalibrationJsonSpec }>
  | Readonly<{
    kind: 'array';
    item: RiskCalibrationJsonSpec;
    minimum: number;
    maximum: number;
  }>
  | Readonly<{ kind: 'tuple'; items: readonly RiskCalibrationJsonSpec[] }>
  | Readonly<{ kind: 'object'; fields: readonly RiskCalibrationJsonFieldSpec[] }>;

type RiskCalibrationJsonFieldSpec = Readonly<{
  key: string;
  value: RiskCalibrationJsonSpec;
  optional?: true;
}>;

type RiskCalibrationJsonBudget = {
  bytes: number;
  maximum: number;
};

export type RiskCalibrationDatasetSerialisationSnapshot = Readonly<{
  document: Readonly<Record<string, unknown>>;
  bytes: number;
}>;

export type RiskCalibrationReportSerialisationSnapshot = RiskCalibrationDatasetSerialisationSnapshot & Readonly<{
  mode: 'detailed' | 'summary';
}>;

class RiskCalibrationJsonBudgetError extends RangeError {}
class RiskCalibrationJsonShapeError extends TypeError {}

const RISK_CALIBRATION_CONTROL_RE = /[\u0000-\u001f\u007f]/u;

function literal(value: RiskCalibrationJsonScalar): RiskCalibrationJsonSpec {
  return { kind: 'literal', value };
}

function boundedText(
  maximum: number,
  values: readonly string[] | null = null,
  minimum = 1,
  validate: ((value: string) => boolean) | null = null,
): RiskCalibrationJsonSpec {
  return { kind: 'string', minimum, maximum, values, controlFree: true, nonBlank: true, validate };
}

const RISK_CALIBRATION_ASCII_LABEL_RE = /^[a-z0-9-]+$/iu;

function validRiskCalibrationDomain(value: string): boolean {
  const normalised = value.trim().toLowerCase().replace(/\.$/u, '');
  if (!normalised || normalised.length > MAX_RISK_CALIBRATION_DOMAIN_LENGTH) return false;
  const labels = normalised.split('.');
  if (labels.length < 2 || labels.some((label) => (
    !label
    || label.length > 63
    || label.startsWith('-')
    || label.endsWith('-')
    || !RISK_CALIBRATION_ASCII_LABEL_RE.test(label)
  ))) return false;
  const ipv4Parts = normalised.split('.');
  return ipv4Parts.length !== 4 || !ipv4Parts.every((part) => (
    /^(?:0|[1-9]\d{0,2})$/u.test(part) && Number(part) <= 255
  ));
}

function canonicalRiskCalibrationIdentifier(value: string): boolean {
  return value === value.trim();
}

function boundedNumber(
  minimum: number,
  maximum: number,
  integer = false,
  values: readonly number[] | null = null,
): RiskCalibrationJsonSpec {
  return { kind: 'number', minimum, maximum, integer, values };
}

function nullable(value: RiskCalibrationJsonSpec): RiskCalibrationJsonSpec {
  return { kind: 'nullable', value };
}

function arrayOf(
  item: RiskCalibrationJsonSpec,
  minimum: number,
  maximum: number,
): RiskCalibrationJsonSpec {
  return { kind: 'array', item, minimum, maximum };
}

function tupleOf(items: readonly RiskCalibrationJsonSpec[]): RiskCalibrationJsonSpec {
  return { kind: 'tuple', items };
}

function objectOf(fields: readonly RiskCalibrationJsonFieldSpec[]): RiskCalibrationJsonSpec {
  return { kind: 'object', fields };
}

function consumeRiskCalibrationJsonBytes(budget: RiskCalibrationJsonBudget, addition: number): void {
  if (!Number.isSafeInteger(addition)
    || addition < 0
    || budget.bytes > budget.maximum - addition) {
    throw new RiskCalibrationJsonBudgetError();
  }
  budget.bytes += addition;
}

function consumeRiskCalibrationJsonString(
  budget: RiskCalibrationJsonBudget,
  value: string,
): void {
  consumeRiskCalibrationJsonBytes(budget, 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let addition = 0;
    if (code === 0x22 || code === 0x5c) addition = 2;
    else if (code <= 0x1f) {
      addition = code === 0x08
        || code === 0x09
        || code === 0x0a
        || code === 0x0c
        || code === 0x0d
        ? 2
        : 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addition = 4;
        index += 1;
      } else addition = 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) addition = 6;
    else if (code <= 0x7f) addition = 1;
    else if (code <= 0x7ff) addition = 2;
    else addition = 3;
    consumeRiskCalibrationJsonBytes(budget, addition);
  }
}

function reflected<T>(label: string, operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new RiskCalibrationJsonShapeError(`${label} must use stable ordinary data fields.`);
  }
}

function sameOwnKeys(left: readonly PropertyKey[], right: readonly PropertyKey[]): boolean {
  return left.length === right.length && left.every((key, index) => Object.is(key, right[index]));
}

function sameDataDescriptor(
  left: PropertyDescriptor,
  right: PropertyDescriptor | undefined,
): boolean {
  return Boolean(right
    && 'value' in left
    && 'value' in right
    && left.enumerable === right.enumerable
    && left.configurable === right.configurable
    && left.writable === right.writable
    && Object.is(left.value, right.value));
}

function copyRiskCalibrationDataProperty(
  source: object,
  key: string,
  spec: RiskCalibrationJsonSpec,
  label: string,
  budget: RiskCalibrationJsonBudget,
  depth: number,
): unknown {
  const descriptor = reflected(label, () => Object.getOwnPropertyDescriptor(source, key));
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    throw new RiskCalibrationJsonShapeError(`${label} must be an ordinary enumerable data field.`);
  }
  const result = copyRiskCalibrationJsonValue(descriptor.value, spec, label, budget, depth);
  const repeated = reflected(label, () => Object.getOwnPropertyDescriptor(source, key));
  if (!sameDataDescriptor(descriptor, repeated)) {
    throw new RiskCalibrationJsonShapeError(`${label} changed while it was being snapshotted.`);
  }
  return result;
}

function copyRiskCalibrationJsonObject(
  value: unknown,
  spec: Extract<RiskCalibrationJsonSpec, { kind: 'object' }>,
  label: string,
  budget: RiskCalibrationJsonBudget,
  depth: number,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || reflected(label, () => Array.isArray(value))) {
    throw new RiskCalibrationJsonShapeError(`${label} must be an ordinary object.`);
  }
  const source = value as object;
  const prototype = reflected(label, () => Object.getPrototypeOf(source));
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RiskCalibrationJsonShapeError(`${label} must be an ordinary object.`);
  }
  const ownKeys = reflected(label, () => Reflect.ownKeys(source));
  const allowed = new Map(spec.fields.map((field) => [field.key, field]));
  if (ownKeys.some((key) => typeof key !== 'string' || !allowed.has(key))) {
    throw new RiskCalibrationJsonShapeError(`${label} contains unsupported fields.`);
  }
  const present = new Set(ownKeys as string[]);
  if (spec.fields.some((field) => !field.optional && !present.has(field.key))) {
    throw new RiskCalibrationJsonShapeError(`${label} is missing required fields.`);
  }

  const selected = spec.fields.filter((field) => present.has(field.key));
  consumeRiskCalibrationJsonBytes(budget, 1);
  const result: Record<string, unknown> = {};
  for (let index = 0; index < selected.length; index += 1) {
    const field = selected[index]!;
    if (index > 0) consumeRiskCalibrationJsonBytes(budget, 1);
    consumeRiskCalibrationJsonBytes(budget, 1 + ((depth + 1) * 2));
    consumeRiskCalibrationJsonString(budget, field.key);
    consumeRiskCalibrationJsonBytes(budget, 2);
    result[field.key] = copyRiskCalibrationDataProperty(
      source,
      field.key,
      field.value,
      `${label}.${field.key}`,
      budget,
      depth + 1,
    );
  }
  if (selected.length) consumeRiskCalibrationJsonBytes(budget, 1 + (depth * 2) + 1);
  else consumeRiskCalibrationJsonBytes(budget, 1);

  const repeatedPrototype = reflected(label, () => Object.getPrototypeOf(source));
  const repeatedKeys = reflected(label, () => Reflect.ownKeys(source));
  if (repeatedPrototype !== prototype || !sameOwnKeys(ownKeys, repeatedKeys)) {
    throw new RiskCalibrationJsonShapeError(`${label} changed while it was being snapshotted.`);
  }
  return Object.freeze(result);
}

function copyRiskCalibrationJsonArray(
  value: unknown,
  label: string,
  budget: RiskCalibrationJsonBudget,
  depth: number,
  minimum: number,
  maximum: number,
  specAt: (index: number) => RiskCalibrationJsonSpec,
): readonly unknown[] {
  if (!reflected(label, () => Array.isArray(value))) {
    throw new RiskCalibrationJsonShapeError(`${label} must be a bounded ordinary array.`);
  }
  const source = value as object;
  const prototype = reflected(label, () => Object.getPrototypeOf(source));
  if (prototype !== Array.prototype) {
    throw new RiskCalibrationJsonShapeError(`${label} must be a bounded ordinary array.`);
  }
  const lengthDescriptor = reflected(label, () => Object.getOwnPropertyDescriptor(source, 'length'));
  const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
  if (!lengthDescriptor
    || lengthDescriptor.enumerable
    || !Number.isSafeInteger(length)
    || Number(length) < minimum
    || Number(length) > maximum) {
    throw new RiskCalibrationJsonShapeError(`${label} must contain between ${minimum} and ${maximum} entries.`);
  }
  const boundedLength = Number(length);
  const ownKeys = reflected(label, () => Reflect.ownKeys(source));
  if (ownKeys.length !== boundedLength + 1
    || ownKeys.at(-1) !== 'length'
    || ownKeys.slice(0, -1).some((key, index) => key !== String(index))) {
    throw new RiskCalibrationJsonShapeError(`${label} must be a dense ordinary array without extra fields.`);
  }

  consumeRiskCalibrationJsonBytes(budget, 1);
  const result: unknown[] = [];
  for (let index = 0; index < boundedLength; index += 1) {
    if (index > 0) consumeRiskCalibrationJsonBytes(budget, 1);
    consumeRiskCalibrationJsonBytes(budget, 1 + ((depth + 1) * 2));
    result.push(copyRiskCalibrationDataProperty(
      source,
      String(index),
      specAt(index),
      `${label}[${index}]`,
      budget,
      depth + 1,
    ));
  }
  if (boundedLength) consumeRiskCalibrationJsonBytes(budget, 1 + (depth * 2) + 1);
  else consumeRiskCalibrationJsonBytes(budget, 1);

  const repeatedPrototype = reflected(label, () => Object.getPrototypeOf(source));
  const repeatedLength = reflected(label, () => Object.getOwnPropertyDescriptor(source, 'length'));
  const repeatedKeys = reflected(label, () => Reflect.ownKeys(source));
  if (repeatedPrototype !== prototype
    || !sameDataDescriptor(lengthDescriptor, repeatedLength)
    || !sameOwnKeys(ownKeys, repeatedKeys)) {
    throw new RiskCalibrationJsonShapeError(`${label} changed while it was being snapshotted.`);
  }
  return Object.freeze(result);
}

function copyRiskCalibrationJsonValue(
  value: unknown,
  spec: RiskCalibrationJsonSpec,
  label: string,
  budget: RiskCalibrationJsonBudget,
  depth: number,
): unknown {
  if (spec.kind === 'literal') {
    if (!Object.is(value, spec.value)) {
      throw new RiskCalibrationJsonShapeError(`${label} has an unsupported value.`);
    }
    if (typeof value === 'string') consumeRiskCalibrationJsonString(budget, value);
    else if (value === null) consumeRiskCalibrationJsonBytes(budget, 4);
    else if (typeof value === 'boolean') consumeRiskCalibrationJsonBytes(budget, value ? 4 : 5);
    else consumeRiskCalibrationJsonBytes(budget, String(value).length);
    return value;
  }
  if (spec.kind === 'string') {
    if (typeof value !== 'string'
      || value.length < spec.minimum
      || value.length > spec.maximum
      || (spec.nonBlank && !value.trim())
      || (spec.controlFree && RISK_CALIBRATION_CONTROL_RE.test(value))
      || (spec.values && !spec.values.includes(value))
      || (spec.validate && !spec.validate(value))) {
      throw new RiskCalibrationJsonShapeError(`${label} must be bounded supported text.`);
    }
    consumeRiskCalibrationJsonString(budget, value);
    return value;
  }
  if (spec.kind === 'number') {
    if (typeof value !== 'number'
      || !Number.isFinite(value)
      || value < spec.minimum
      || value > spec.maximum
      || (spec.integer && !Number.isSafeInteger(value))
      || (spec.values && !spec.values.includes(value))) {
      throw new RiskCalibrationJsonShapeError(`${label} must be a bounded finite number.`);
    }
    const normalised = Object.is(value, -0) ? 0 : value;
    consumeRiskCalibrationJsonBytes(budget, JSON.stringify(normalised).length);
    return normalised;
  }
  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new RiskCalibrationJsonShapeError(`${label} must be true or false.`);
    }
    consumeRiskCalibrationJsonBytes(budget, value ? 4 : 5);
    return value;
  }
  if (spec.kind === 'nullable') {
    if (value === null) {
      consumeRiskCalibrationJsonBytes(budget, 4);
      return null;
    }
    return copyRiskCalibrationJsonValue(value, spec.value, label, budget, depth);
  }
  if (spec.kind === 'array') {
    return copyRiskCalibrationJsonArray(
      value,
      label,
      budget,
      depth,
      spec.minimum,
      spec.maximum,
      () => spec.item,
    );
  }
  if (spec.kind === 'tuple') {
    return copyRiskCalibrationJsonArray(
      value,
      label,
      budget,
      depth,
      spec.items.length,
      spec.items.length,
      (index) => spec.items[index]!,
    );
  }
  return copyRiskCalibrationJsonObject(value, spec, label, budget, depth);
}

const BOOLEAN_SPEC: RiskCalibrationJsonSpec = { kind: 'boolean' };
const COUNT_SPEC = boundedNumber(0, MAX_RISK_CALIBRATION_RECORDS, true);
const RATIO_SPEC = nullable(boundedNumber(0, 1));
const INTERVAL_SPEC = nullable(objectOf([
  { key: 'lower', value: boundedNumber(0, 1) },
  { key: 'upper', value: boundedNumber(0, 1) },
]));
const CONFIDENCE_SPEC = objectOf([
  { key: 'precision', value: INTERVAL_SPEC },
  { key: 'recall', value: INTERVAL_SPEC },
  { key: 'specificity', value: INTERVAL_SPEC },
]);
const METRIC_SPEC = objectOf([
  { key: 'threshold', value: boundedNumber(0, 100, true, [40, 50, 60, 70, 80, 90]) },
  { key: 'truePositive', value: COUNT_SPEC },
  { key: 'falsePositive', value: COUNT_SPEC },
  { key: 'trueNegative', value: COUNT_SPEC },
  { key: 'falseNegative', value: COUNT_SPEC },
  { key: 'precision', value: RATIO_SPEC },
  { key: 'recall', value: RATIO_SPEC },
  { key: 'specificity', value: RATIO_SPEC },
  { key: 'falsePositiveRate', value: RATIO_SPEC },
  { key: 'f1', value: RATIO_SPEC },
  { key: 'balancedAccuracy', value: RATIO_SPEC },
  { key: 'confidence95', value: CONFIDENCE_SPEC },
]);
const SCORE_BANDS_SPEC = objectOf([
  { key: 'not_scored', value: COUNT_SPEC },
  { key: '0_39', value: COUNT_SPEC },
  { key: '40_69', value: COUNT_SPEC },
  { key: '70_100', value: COUNT_SPEC },
]);
const REPORT_SUMMARY_SPEC = objectOf([
  { key: 'total', value: COUNT_SPEC },
  { key: 'positive', value: COUNT_SPEC },
  { key: 'negative', value: COUNT_SPEC },
  { key: 'excluded', value: COUNT_SPEC },
  { key: 'scoreBands', value: SCORE_BANDS_SPEC },
]);
const REPORT_DATASET_SPEC = objectOf([
  { key: 'schema', value: literal(RISK_CALIBRATION_DATASET_SCHEMA) },
  { key: 'version', value: boundedNumber(1, RISK_CALIBRATION_DATASET_VERSION, true, SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS) },
  { key: 'recordCount', value: boundedNumber(1, MAX_RISK_CALIBRATION_RECORDS, true) },
]);
const STRATUM_SPEC = objectOf([
  { key: 'dimension', value: boundedText(MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH, ['review_reason', 'scan_depth']) },
  { key: 'value', value: boundedText(MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH) },
  { key: 'sampleCount', value: COUNT_SPEC },
  { key: 'insufficientSample', value: BOOLEAN_SPEC },
  { key: 'metrics', value: METRIC_SPEC },
]);
const MODEL_COMPARISON_SPEC = objectOf([
  { key: 'available', value: BOOLEAN_SPEC },
  { key: 'previousModelVersion', value: nullable(boundedNumber(1, MAX_RISK_CALIBRATION_MODEL_VERSION, true)) },
  { key: 'currentModelVersion', value: boundedNumber(1, MAX_RISK_CALIBRATION_MODEL_VERSION, true) },
  { key: 'scoresChanged', value: COUNT_SPEC },
  { key: 'bandsChanged', value: COUNT_SPEC },
  { key: 'thresholdClassificationsChanged', value: COUNT_SPEC },
]);
const INTERPRETATION_SPEC = objectOf([
  { key: 'authority', value: literal('analyst_context_only') },
  { key: 'statement', value: boundedText(1_024) },
  { key: 'automaticTuning', value: literal(false) },
  { key: 'networkRequests', value: literal(false) },
  { key: 'persisted', value: literal(false) },
]);
const FACTOR_SPEC = objectOf([
  { key: 'family', value: boundedText(MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH, [
    'brand-presentation',
    'corroboration',
    'credential-lure',
    'domain-resemblance',
    'external-intelligence',
    'operational-support',
    'registration',
  ]) },
  { key: 'label', value: boundedText(MAX_RISK_CALIBRATION_STRING_LENGTH) },
  { key: 'delta', value: boundedNumber(-100, 100) },
]);
const REPORT_RECORD_SPEC = objectOf([
  { key: 'id', value: boundedText(MAX_RISK_CALIBRATION_RECORD_ID_LENGTH) },
  { key: 'domain', value: boundedText(MAX_RISK_CALIBRATION_DOMAIN_LENGTH) },
  { key: 'analystDisposition', value: boundedText(MAX_RISK_CALIBRATION_DISPOSITION_LENGTH, [
    'unreviewed', 'suspicious', 'confirmed_abuse', 'false_positive', 'expected', 'closed_no_action',
  ]) },
  { key: 'reviewReasonCode', value: nullable(boundedText(MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH)) },
  { key: 'interoperabilityTags', value: arrayOf(boundedText(MAX_RISK_CALIBRATION_STRING_LENGTH), 0, 32) },
  { key: 'metricClass', value: boundedText(16, ['positive', 'negative', 'excluded']) },
  { key: 'includedInMetrics', value: BOOLEAN_SPEC },
  { key: 'exclusionReason', value: nullable(boundedText(32, ['not_scored', 'contextual_disposition'])) },
  { key: 'modelVersion', value: boundedNumber(1, MAX_RISK_CALIBRATION_MODEL_VERSION, true) },
  { key: 'score', value: nullable(boundedNumber(0, 100, true)) },
  { key: 'band', value: boundedText(16, ['not_scored', '0_39', '40_69', '70_100']) },
  { key: 'factors', value: arrayOf(FACTOR_SPEC, 0, 32) },
]);
const REPORT_COMMON_FIELDS: readonly RiskCalibrationJsonFieldSpec[] = [
  { key: 'generatedAt', value: boundedText(MAX_RISK_CALIBRATION_TIMESTAMP_LENGTH) },
  { key: 'dataset', value: REPORT_DATASET_SPEC },
  { key: 'riskModelVersion', value: boundedNumber(1, MAX_RISK_CALIBRATION_MODEL_VERSION, true) },
  { key: 'currentReviewThreshold', value: boundedNumber(0, 100, true, [40, 50, 60, 70, 80, 90]) },
  { key: 'summary', value: REPORT_SUMMARY_SPEC },
  { key: 'thresholds', value: arrayOf(METRIC_SPEC, 6, 6) },
  { key: 'strata', value: arrayOf(STRATUM_SPEC, 0, MAX_RISK_CALIBRATION_SUMMARY_STRATA) },
  { key: 'modelComparison', value: MODEL_COMPARISON_SPEC },
];
const DETAILED_REPORT_SPEC = objectOf([
  { key: 'schema', value: literal(RISK_CALIBRATION_REPORT_SCHEMA) },
  { key: 'version', value: literal(RISK_CALIBRATION_REPORT_VERSION) },
  { key: 'mode', value: literal('detailed') },
  ...REPORT_COMMON_FIELDS,
  { key: 'records', value: arrayOf(REPORT_RECORD_SPEC, 1, MAX_RISK_CALIBRATION_RECORDS) },
  { key: 'interpretation', value: INTERPRETATION_SPEC },
]);
const SUMMARY_REPORT_SPEC = objectOf([
  { key: 'schema', value: literal(RISK_CALIBRATION_REPORT_SCHEMA) },
  { key: 'version', value: literal(RISK_CALIBRATION_REPORT_VERSION) },
  { key: 'mode', value: literal('summary') },
  ...REPORT_COMMON_FIELDS,
  { key: 'privacy', value: objectOf([
    { key: 'targetsRetained', value: literal(0) },
    { key: 'identifiersRetained', value: literal(0) },
    { key: 'rawEvidenceRetained', value: literal(0) },
  ]) },
  { key: 'interpretation', value: INTERPRETATION_SPEC },
]);

const DATASET_EVIDENCE_SPEC = objectOf([
  { key: 'availability', value: boundedText(MAX_RISK_CALIBRATION_AVAILABILITY_LENGTH, [
    'registered', 'for_sale', 'expiring', 'available', 'unknown', 'error',
  ]) },
  { key: 'activityStatus', value: boundedText(MAX_RISK_CALIBRATION_ACTIVITY_LENGTH, ['active', 'parked', 'unreachable', 'no_site']), optional: true },
  { key: 'mutationTypes', value: arrayOf(boundedText(MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH, RISK_CALIBRATION_MUTATION_TYPES), 0, MAX_RISK_CALIBRATION_MUTATIONS), optional: true },
  { key: 'domainAgeDays', value: boundedNumber(0, MAX_RISK_CALIBRATION_DOMAIN_AGE_DAYS), optional: true },
  { key: 'faviconMatch', value: BOOLEAN_SPEC, optional: true },
  { key: 'faviconNearMatch', value: BOOLEAN_SPEC, optional: true },
  { key: 'reusesOfficialAssets', value: BOOLEAN_SPEC, optional: true },
  { key: 'hasPasswordField', value: BOOLEAN_SPEC, optional: true },
  { key: 'hasMx', value: BOOLEAN_SPEC, optional: true },
  { key: 'hasSpf', value: BOOLEAN_SPEC, optional: true },
  { key: 'hasDmarc', value: BOOLEAN_SPEC, optional: true },
  { key: 'privacyProtected', value: BOOLEAN_SPEC, optional: true },
  { key: 'phishingLanguageMatch', value: boundedText(MAX_RISK_CALIBRATION_STRING_LENGTH), optional: true },
  { key: 'hasExternalFormAction', value: BOOLEAN_SPEC, optional: true },
  { key: 'idnReferenceMatch', value: BOOLEAN_SPEC, optional: true },
  { key: 'pageBaselineMatch', value: BOOLEAN_SPEC, optional: true },
  { key: 'hasActiveBrandProfile', value: BOOLEAN_SPEC, optional: true },
  { key: 'scanDepth', value: boundedText(MAX_RISK_CALIBRATION_SCAN_DEPTH_LENGTH, ['fast', 'deep']), optional: true },
  { key: 'observedAt', value: boundedText(MAX_RISK_CALIBRATION_TIMESTAMP_LENGTH), optional: true },
]);
const DATASET_RECORD_SPEC = objectOf([
  { key: 'id', value: boundedText(MAX_RISK_CALIBRATION_RECORD_ID_LENGTH, null, 1, canonicalRiskCalibrationIdentifier) },
  { key: 'domain', value: boundedText(MAX_RISK_CALIBRATION_DOMAIN_LENGTH, null, 1, validRiskCalibrationDomain) },
  { key: 'analystDisposition', value: boundedText(MAX_RISK_CALIBRATION_DISPOSITION_LENGTH, [
    'unreviewed', 'suspicious', 'confirmed_abuse', 'false_positive', 'expected', 'closed_no_action',
  ]) },
  { key: 'reviewReasonCode', value: boundedText(MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH, RISK_CALIBRATION_REVIEW_REASON_VALUES), optional: true },
  { key: 'evidence', value: DATASET_EVIDENCE_SPEC },
]);
const DATASET_EXCLUSION_SPEC = objectOf([
  { key: 'caseId', value: boundedText(MAX_RISK_CALIBRATION_RECORD_ID_LENGTH, null, 1, canonicalRiskCalibrationIdentifier) },
  { key: 'domain', value: boundedText(MAX_RISK_CALIBRATION_DOMAIN_LENGTH, null, 1, validRiskCalibrationDomain) },
  { key: 'reason', value: boundedText(32, [
    'duplicate_selection', 'record_limit', 'unreviewed', 'missing_evidence', 'unsupported_availability',
  ]) },
]);
const DATASET_EXPORT_SPEC = objectOf([
  { key: 'selected', value: COUNT_SPEC },
  { key: 'included', value: COUNT_SPEC },
  { key: 'excluded', value: COUNT_SPEC },
  { key: 'exclusions', value: arrayOf(DATASET_EXCLUSION_SPEC, 0, MAX_RISK_CALIBRATION_RECORDS) },
]);
const DATASET_EXPORT_DOCUMENT_SPEC = objectOf([
  { key: 'schema', value: literal(RISK_CALIBRATION_DATASET_SCHEMA) },
  { key: 'version', value: literal(RISK_CALIBRATION_DATASET_VERSION) },
  { key: 'records', value: arrayOf(DATASET_RECORD_SPEC, 1, MAX_RISK_CALIBRATION_RECORDS) },
  { key: 'export', value: DATASET_EXPORT_SPEC },
  { key: 'limitations', value: tupleOf(RISK_CALIBRATION_EXPORT_LIMITATIONS.map((value) => literal(value))) },
]);

function serialisationBudget(maximum: number, label: string): RiskCalibrationJsonBudget {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new RiskCalibrationJsonShapeError(`${label} byte limit must be a positive safe integer.`);
  }
  return { bytes: 0, maximum };
}

function copySerialisationRoot(
  value: unknown,
  spec: RiskCalibrationJsonSpec,
  label: string,
  maximumBytes: number,
): RiskCalibrationDatasetSerialisationSnapshot {
  const budget = serialisationBudget(maximumBytes, label);
  const document = copyRiskCalibrationJsonValue(value, spec, label, budget, 0);
  consumeRiskCalibrationJsonBytes(budget, 1);
  return Object.freeze({
    document: document as Readonly<Record<string, unknown>>,
    bytes: budget.bytes,
  });
}

export function snapshotRiskCalibrationDatasetExportForSerialization(
  value: unknown,
  maximumBytes = MAX_RISK_CALIBRATION_INPUT_BYTES,
): RiskCalibrationDatasetSerialisationSnapshot {
  try {
    const snapshot = copySerialisationRoot(
      value,
      DATASET_EXPORT_DOCUMENT_SPEC,
      'Risk calibration export',
      maximumBytes,
    );
    const document = snapshot.document;
    const records = document.records as readonly unknown[];
    const exportSummary = document.export as Readonly<Record<string, unknown>>;
    const exclusions = exportSummary.exclusions as readonly unknown[];
    if (exportSummary.included !== records.length
      || exportSummary.excluded !== exclusions.length
      || Number(exportSummary.selected) < records.length + exclusions.length) {
      throw new RiskCalibrationJsonShapeError('Risk calibration export counts must match the snapshotted records and exclusions.');
    }
    if (new Set(records.map((record) => (record as Readonly<Record<string, unknown>>).id)).size !== records.length) {
      throw new RiskCalibrationJsonShapeError('Risk calibration export record identifiers must be unique.');
    }
    return snapshot;
  } catch (cause) {
    if (cause instanceof RiskCalibrationJsonBudgetError) {
      throw new RangeError(`Risk calibration export is limited to ${maximumBytes} bytes.`);
    }
    if (cause instanceof RiskCalibrationJsonShapeError) throw cause;
    throw new RiskCalibrationJsonShapeError('Risk calibration export must be a stable exact current dataset document.');
  }
}

function riskCalibrationReportMode(value: unknown): 'detailed' | 'summary' {
  if (!value || typeof value !== 'object' || reflected('Risk calibration report', () => Array.isArray(value))) {
    throw new RiskCalibrationJsonShapeError('Risk calibration report must be an ordinary object.');
  }
  const descriptor = reflected(
    'Risk calibration report mode',
    () => Object.getOwnPropertyDescriptor(value, 'mode'),
  );
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
    || (descriptor.value !== 'detailed' && descriptor.value !== 'summary')) {
    throw new RiskCalibrationJsonShapeError('Risk calibration report must use the current detailed or summary discriminator.');
  }
  return descriptor.value;
}

export function snapshotRiskCalibrationReportForSerialization(
  value: unknown,
  limits: Readonly<{
    detailedMaximumBytes?: number;
    summaryMaximumBytes?: number;
  }> = {},
): RiskCalibrationReportSerialisationSnapshot {
  const mode = riskCalibrationReportMode(value);
  const maximumBytes = mode === 'summary'
    ? limits.summaryMaximumBytes ?? MAX_RISK_CALIBRATION_SUMMARY_BYTES
    : limits.detailedMaximumBytes ?? MAX_RISK_CALIBRATION_DETAILED_REPORT_BYTES;
  try {
    const snapshot = copySerialisationRoot(
      value,
      mode === 'summary' ? SUMMARY_REPORT_SPEC : DETAILED_REPORT_SPEC,
      `Risk calibration ${mode} report`,
      maximumBytes,
    );
    if (mode === 'detailed') {
      const dataset = snapshot.document.dataset as Readonly<Record<string, unknown>>;
      const records = snapshot.document.records as readonly Readonly<Record<string, unknown>>[];
      if (dataset.recordCount !== records.length
        || new Set(records.map((record) => record.id)).size !== records.length) {
        throw new RiskCalibrationJsonShapeError('Risk calibration detailed records must match the dataset metadata and use unique identifiers.');
      }
    }
    return Object.freeze({ ...snapshot, mode });
  } catch (cause) {
    if (cause instanceof RiskCalibrationJsonBudgetError) {
      throw new RangeError(`Risk calibration ${mode} output is limited to ${maximumBytes} bytes.`);
    }
    if (cause instanceof RiskCalibrationJsonShapeError) throw cause;
    throw new RiskCalibrationJsonShapeError(`Risk calibration ${mode} output must be a stable exact current report document.`);
  }
}

export function serializeRiskCalibrationSnapshot(
  snapshot: RiskCalibrationDatasetSerialisationSnapshot,
): string {
  return `${JSON.stringify(snapshot.document, null, 2)}\n`;
}

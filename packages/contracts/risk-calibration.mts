import { defineSchemaCompatibility } from './schema-compatibility.mts';

export const RISK_CALIBRATION_DATASET_SCHEMA = 'whoisleuth.risk-calibration-dataset';
export const RISK_CALIBRATION_DATASET_VERSION = 2;
export const SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS = Object.freeze([1, RISK_CALIBRATION_DATASET_VERSION] as const);
export const RISK_CALIBRATION_REPORT_SCHEMA = 'whoisleuth.cli.risk-calibration';
export const RISK_CALIBRATION_REPORT_VERSION = 3;
export const SUPPORTED_RISK_CALIBRATION_REPORT_VERSIONS = Object.freeze([1, 2, RISK_CALIBRATION_REPORT_VERSION] as const);
export const MAX_RISK_CALIBRATION_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_RISK_CALIBRATION_RECORDS = 500;
export const MAX_RISK_CALIBRATION_STRING_LENGTH = 256;
export const MAX_RISK_CALIBRATION_SUMMARY_BYTES = 512 * 1024;

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
  migration: 'normalize_to_current',
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
  futureVersionBehavior: 'not_applicable',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: null,
  owner: 'packages/contracts/risk-calibration.mts',
  note: 'Offline calibration output; version 3 distinguishes the bounded detailed report from a target-free aggregate summary for tab-local review.',
});

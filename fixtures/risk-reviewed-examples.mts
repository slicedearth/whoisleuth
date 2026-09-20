import {
  RISK_CALIBRATION_DATASET_SCHEMA, RISK_CALIBRATION_DATASET_VERSION,
  type RiskCalibrationEvidence, type RiskCalibrationRecord,
} from '../packages/contracts/risk-calibration.mts';

// These are stipulated synthetic reviews, not observed incidents or an accuracy
// benchmark. Labels describe independent review facts, never a score or band.
// Paired records deliberately have indistinguishable collected inputs.
const login: RiskCalibrationEvidence = {
  availability: 'registered', scanDepth: 'deep', activityStatus: 'active',
  mutationTypes: ['dictionary'], faviconMatch: true, reusesOfficialAssets: true,
  hasPasswordField: true, hasExternalFormAction: true, phishingLanguageMatch: 'verify account',
};
const registration: RiskCalibrationEvidence = { availability: 'registered', scanDepth: 'fast' };
const unreachable: RiskCalibrationEvidence = { availability: 'registered', scanDepth: 'deep', activityStatus: 'unreachable' };

export const REVIEWED_RISK_EXAMPLES: readonly Readonly<{ record: RiskCalibrationRecord; reviewBasis: string }>[] = [
  {
    record: { id: 'credential-abuse', domain: 'credential-abuse.example.test', analystDisposition: 'confirmed_abuse', reviewReasonCode: 'confirmed_credential_abuse', evidence: login },
    reviewBasis: 'The scenario stipulates a separately confirmed credential-collection incident; appearance alone is not the confirmation.',
  },
  {
    record: { id: 'authorised-training', domain: 'authorised-training.example.test', analystDisposition: 'expected', reviewReasonCode: 'authorized_or_owned', evidence: login },
    reviewBasis: 'The scenario stipulates verified authorisation for a training page with the same collected appearance as the abuse example.',
  },
  {
    record: { id: 'compromised-site', domain: 'compromised-site.example.test', analystDisposition: 'confirmed_abuse', reviewReasonCode: 'confirmed_malware', evidence: registration },
    reviewBasis: 'Independent incident review confirmed compromise, but Fast registration data contains none of the incident evidence.',
  },
  {
    record: { id: 'ordinary-registration', domain: 'ordinary-registration.example.test', analystDisposition: 'expected', reviewReasonCode: 'authorized_or_owned', evidence: registration },
    reviewBasis: 'The scenario stipulates an authorised ordinary domain; its limited collected inputs match the compromised example.',
  },
  {
    record: { id: 'intermittent-abuse', domain: 'intermittent-abuse.example.test', analystDisposition: 'confirmed_abuse', reviewReasonCode: 'confirmed_credential_abuse', evidence: unreachable },
    reviewBasis: 'An independently confirmed incident predates a failed web request. Unreachability does not retract the incident or prove removal.',
  },
  {
    record: { id: 'owned-offline-site', domain: 'owned-offline-site.example.test', analystDisposition: 'expected', reviewReasonCode: 'authorized_or_owned', evidence: unreachable },
    reviewBasis: 'The scenario stipulates planned downtime of an authorised site with the same unreachable observation.',
  },
  {
    record: { id: 'shared-template', domain: 'shared-template.example.test', analystDisposition: 'false_positive', reviewReasonCode: 'generic_platform_or_template', evidence: { availability: 'registered', scanDepth: 'deep', faviconNearMatch: true, hasPasswordField: true } },
    reviewBasis: 'Independent review establishes use of a generic template rather than an impersonated brand; resemblance alone was misleading.',
  },
  {
    record: { id: 'missing-authority', domain: 'missing-authority.example.test', analystDisposition: 'confirmed_abuse', reviewReasonCode: 'confirmed_credential_abuse', evidence: { availability: 'unknown', scanDepth: 'deep' } },
    reviewBasis: 'Independent incident confirmation remains recorded, but missing authoritative registration evidence prevents this model scoring the input.',
  },
  {
    record: { id: 'failed-authority', domain: 'failed-authority.example.test', analystDisposition: 'expected', reviewReasonCode: 'authorized_or_owned', evidence: { availability: 'error', scanDepth: 'fast' } },
    reviewBasis: 'Known authorisation is separate from a failed registration lookup. A failed lookup is not a zero score or a true negative.',
  },
  {
    record: { id: 'unresolved-suspicion', domain: 'unresolved-suspicion.example.test', analystDisposition: 'suspicious', reviewReasonCode: 'insufficient_evidence', evidence: login },
    reviewBasis: 'The reviewer has no independent confirmation despite suggestive page features; suspicion is excluded from binary metrics.',
  },
  {
    record: { id: 'unreviewed', domain: 'unreviewed.example.test', analystDisposition: 'unreviewed', evidence: registration },
    reviewBasis: 'No analyst review has taken place. The absence of a decision is not a negative label.',
  },
  {
    record: { id: 'closed-without-decision', domain: 'closed-without-decision.example.test', analystDisposition: 'closed_no_action', reviewReasonCode: 'insufficient_evidence', evidence: login },
    reviewBasis: 'Work stopped without resolving the allegation. Administrative closure is not evidence of safety.',
  },
];

export const REVIEWED_RISK_DATASET = {
  schema: RISK_CALIBRATION_DATASET_SCHEMA,
  version: RISK_CALIBRATION_DATASET_VERSION,
  records: REVIEWED_RISK_EXAMPLES.map(example => example.record),
};

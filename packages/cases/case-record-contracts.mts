import type {
  CaseActionRecord,
  CaseAssertionRecord,
  CaseDecisionRecord,
  CaseEvidencePin,
  CaseClosureHistory,
  CaseManualTrailEvent,
  CaseObservedEffectHistory,
  CaseSightingRecord,
} from './case-response-model.mts';
import { ANALYST_REVIEW_REASONS } from '../../lib/analyst-taxonomy.mts';
import {
  CASE_IMPORT_VERSIONS,
  CASE_SCHEMA_VERSION,
  PUBLIC_CASE_SCHEMA_VERSION,
  MAX_CASE_BRAND_PROFILE_ID_CANDIDATES,
  MAX_CASE_BRAND_PROFILE_IDS,
  MAX_CASE_IMPORT_BYTES,
  MAX_CASE_STORE_BYTES,
  MAX_CASES,
  MAX_DOMAIN_LENGTH,
  MAX_EVIDENCE_CHANGES,
  MAX_EVIDENCE_DETAIL_LENGTH,
  MAX_EVIDENCE_FACTORS,
  MAX_EVIDENCE_MUTATIONS,
  MAX_EVIDENCE_NAMESERVERS,
  MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
  MAX_EVIDENCE_STRING_LENGTH,
  MAX_EVIDENCE_TITLE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_NOTES_PER_CASE,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CASE,
} from '../contracts/case-portability.mts';
import type { CaseInvestigationBranch } from './case-investigation-branch-model.mts';

export {
  CASE_IMPORT_VERSIONS,
  CASE_SCHEMA_VERSION,
  PUBLIC_CASE_SCHEMA_VERSION,
  MAX_CASE_BRAND_PROFILE_ID_CANDIDATES,
  MAX_CASE_BRAND_PROFILE_IDS,
  MAX_CASE_IMPORT_BYTES,
  MAX_CASE_STORE_BYTES,
  MAX_CASES,
  MAX_DOMAIN_LENGTH,
  MAX_EVIDENCE_CHANGES,
  MAX_EVIDENCE_DETAIL_LENGTH,
  MAX_EVIDENCE_FACTORS,
  MAX_EVIDENCE_MUTATIONS,
  MAX_EVIDENCE_NAMESERVERS,
  MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
  MAX_EVIDENCE_STRING_LENGTH,
  MAX_EVIDENCE_TITLE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_NOTES_PER_CASE,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CASE,
};

export const CASE_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
];

export const CASE_DISPOSITIONS: Array<{ value: string; label: string }> = [
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'suspicious', label: 'Suspicious' },
  { value: 'confirmed_abuse', label: 'Confirmed abuse' },
  { value: 'false_positive', label: 'False positive' },
  { value: 'expected', label: 'Expected' },
  { value: 'closed_no_action', label: 'Closed without action' },
];

export const CASE_REVIEW_REASONS: Array<{ value: string; label: string }> = ANALYST_REVIEW_REASONS.map((item) => ({ ...item }));

export const CASE_SOURCES: Array<{ value: string; label: string }> = [
  { value: 'lookup', label: 'Lookup' },
  { value: 'bulk', label: 'Bulk' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'manual', label: 'Manual' },
  { value: 'unknown', label: 'Unknown' },
];

export const EVIDENCE_SOURCES = ['lookup', 'bulk', 'monitor', 'import', 'unknown'];
export const DEFAULT_STATUS = 'new';
export const DEFAULT_DISPOSITION = 'unreviewed';
export const DEFAULT_SOURCE = 'unknown';

export type CaseNote = { id: string; body: string; createdAt: string };
export type EvidenceFactor = { label: string; points: number };
export type CaseEvidenceSnapshot = {
  id: string;
  fingerprint: string;
  firstCapturedAt: string;
  capturedAt: string;
  source: string;
  inputHostname: string | null;
  scanDepth: string;
  availability: string | null;
  confidence: string | null;
  riskModelVersion: number | null;
  riskScore: number | null;
  opportunityModelVersion?: number | null;
  opportunityScore: number | null;
  riskFactors: EvidenceFactor[];
  opportunityFactors: EvidenceFactor[];
  registrar: string | null;
  createdDate: string | null;
  expiryDate: string | null;
  nameservers: string[];
  hasMx: boolean | null;
  hasSpf: boolean | null;
  hasDmarc: boolean | null;
  activityStatus: string | null;
  websiteProbeDetail: string | null;
  pageTitle: string | null;
  httpSummaryVersion: number | null;
  httpEvidenceStatus: string | null;
  httpFinalOrigin: string | null;
  httpResponseStatus: number | null;
  httpTransportSecurity: string | null;
  httpRedirectCount: number | null;
  httpCrossOriginRedirect: boolean | null;
  httpHttpsDowngrade: boolean | null;
  httpContentType: string | null;
  httpSecurityHeaders: string[] | null;
  faviconMatch: boolean | null;
  faviconNearMatch: boolean | null;
  reusesOfficialAssets: boolean | null;
  hasPasswordField: boolean | null;
  hasExternalFormAction: boolean | null;
  phishingLanguageMatch: string | null;
  privacyProtected?: boolean | null;
  idnReferenceMatch?: boolean | null;
  pageBaselineMatch?: boolean | null;
  hasActiveBrandProfile?: boolean | null;
  profileContextState?: 'loading' | 'ready' | 'unavailable' | null;
  profileContextLimitation?: string | null;
  mutationTypes: string[];
};

export type CaseEvidenceMaterial = Omit<
  CaseEvidenceSnapshot,
  'id' | 'fingerprint' | 'firstCapturedAt' | 'capturedAt' | 'source'
>;

export type CaseRecord = {
  id: string;
  domain: string;
  status: string;
  disposition: string;
  reviewReasonCode?: string | null;
  brandProfileIds: string[];
  tags: string[];
  notes: CaseNote[];
  source: string;
  evidenceHistory: CaseEvidenceSnapshot[];
  evidencePins: CaseEvidencePin[];
  decisions: CaseDecisionRecord[];
  actions: CaseActionRecord[];
  assertions: CaseAssertionRecord[];
  manualTrail: CaseManualTrailEvent[];
  sightings: CaseSightingRecord[];
  observedEffects: CaseObservedEffectHistory;
  closures: CaseClosureHistory;
  branches?: CaseInvestigationBranch[];
  createdAt: string;
  updatedAt: string;
};

export type CaseStore = { version: typeof CASE_SCHEMA_VERSION; cases: CaseRecord[] };
export type CaseInput = {
  domain: unknown;
  status?: unknown;
  disposition?: unknown;
  reviewReasonCode?: unknown;
  brandProfileIds?: unknown;
  source?: unknown;
  tags?: unknown;
  evidence?: unknown;
  evidencePin?: unknown;
  evidencePins?: unknown;
  decision?: unknown;
  action?: unknown;
  actionUpdate?: unknown;
  assertion?: unknown;
  assertionUpdate?: unknown;
  trailEvent?: unknown;
  sighting?: unknown;
  observedEffectReview?: unknown;
  closure?: unknown;
  branch?: unknown;
  branchUpdate?: unknown;
  note?: unknown;
};
export type CasePatch = Omit<Partial<CaseInput>, 'domain'>;
export type SnapshotOptions = {
  source?: string;
  fallback?: string | null;
  sourceVersion?: number | null;
  caseDomain?: string | null;
};
export type EvidenceChange = { field: string; label: string; before: unknown; after: unknown; tone: string };
export type CompareFieldSpec = {
  field: keyof CaseEvidenceSnapshot;
  label: string;
  type: string;
  depthGate?: 'both-deep' | 'comparable';
  modelGate?: 'opportunity' | 'risk';
  direction?: 'risk';
  emptyGuard?: boolean;
};

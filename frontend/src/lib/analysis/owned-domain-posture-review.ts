import type {
  BrandProfile,
  DesiredPostureBaseline,
  DesiredPostureObservation,
  MailProtectionProfile,
} from './brand-profile-model.ts';
import type {
  DomainPostureCheck,
  DomainPostureExternalDependency,
  DomainPostureHttpResponse,
} from './client-response-contracts.ts';
import { brandPostureObservationContext, currentDesiredPostureObservation, MAX_DESIRED_POSTURE_OBSERVATIONS } from './brand-profile-model.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import { DOMAIN_CONTROL_RECORD_LIST_FIELDS } from '../../../../packages/contracts/domain-control-manifest.mts';
import { canonicalPostureRecords, domainControlRecordMode, domainControlEvidenceAdmission } from '../../../../packages/evidence/domain-control-runtime.mts';
import { DOMAIN_POSTURE_COMPARISON_VERSION, MAX_POSTURE_CHECKS, MAX_POSTURE_CHECK_RECORDS, postureSourceAdmission, postureTransferRestriction, type DomainPostureProfileContext } from '../../../../packages/evidence/domain-posture-context.mts';

export type DomainPostureAuditResult = { domain: string; report: DomainPostureHttpResponse | null; error: string; context?: DomainPostureProfileContext };

export type DesiredPostureGroup = Readonly<{
  id: string;
  label: string;
  purpose: string;
  checks: readonly DomainPostureCheck[];
  state: 'action' | 'aligned' | 'review' | 'unavailable';
}>;

export type DependencyReviewItem = Readonly<{
  kind: DomainPostureExternalDependency['kind'];
  target: string;
  source: string;
  scope: DomainPostureExternalDependency['scope'];
  state: 'observed' | 'unavailable';
  review: 'recorded' | 'needs_evidence';
  limitation: string;
}>;

export type OwnedDomainPostureReview = Readonly<{
  domain: string;
  checkedAt: string;
  profile: MailProtectionProfile;
  profileLabel: string;
  desiredGroups: readonly DesiredPostureGroup[];
  dependencies: readonly DependencyReviewItem[];
  dependencyCounts: Readonly<{ all: number; external: number; unavailable: number }>;
  attestationCounts: Readonly<{ current: number; expired: number; unresolved: number }>;
  baseline: DesiredPostureBaseline | null;
  baselineComparisons: readonly DesiredPostureComparison[];
  previousChanges: readonly DesiredPosturePreviousChange[];
  limitations: readonly Readonly<{
    id: 'configuration' | 'external_dependency' | 'attestation' | 'retained_evidence';
    text: string;
  }>[];
}>;

export type DesiredPostureComparison = Readonly<{
  field: DesiredPostureComparisonField;
  label: string;
  state: 'aligned' | 'approved_window' | 'drift' | 'not_configured' | 'observed' | 'review' | 'suppressed' | 'unavailable' | 'unknown' | 'unsupported';
  desired: readonly string[];
  observed: readonly string[];
  explanation: string;
  suppressionReason: string;
  approvedWindowSummary: string;
}>;

export type DesiredPostureComparisonField = keyof Pick<
  DesiredPostureBaseline,
  'nameservers' | 'ds' | 'mx' | 'caa' | 'tlsIssuer' | 'tlsSpkiSha256' | 'registrarLock' | 'renewalReviewAt'
>;

export type DesiredPosturePreviousChange = Readonly<{
  checkId: string;
  state: 'changed' | 'unchanged' | 'unknown';
  previous: readonly string[];
  current: readonly string[];
  limitation?: string;
}>;

export const POSTURE_COMPARISON_FILTERS = {
  all: 'All fields', configured: 'Configured expectations', different: 'Different from expected', unknown: 'Unknown or unavailable',
} as const;
export type PostureComparisonFilter = keyof typeof POSTURE_COMPARISON_FILTERS;

/** View-only filtering never changes the stored observation or its comparison state. */
export function filterPostureComparisons(rows: readonly DesiredPostureComparison[], filter: PostureComparisonFilter, baseline: Parameters<typeof domainControlRecordMode>[0]) {
  const configured = (row: DesiredPostureComparison) => {
    const field = DOMAIN_CONTROL_RECORD_LIST_FIELDS.find(field => field === row.field);
    if (!field) return row.desired.length > 0;
    const mode = domainControlRecordMode(baseline, field);
    return mode === 'expect_none' || mode === 'expect_records';
  };
  return rows.filter(row => filter === 'all'
    || filter === 'configured' && configured(row)
    || filter === 'different' && ['drift', 'approved_window', 'suppressed'].includes(row.state)
    || filter === 'unknown' && ['unknown', 'unavailable', 'unsupported'].includes(row.state));
}

const PROFILE_LABELS: Record<MailProtectionProfile, string> = {
  standard: 'Active mail domain',
  defensive_no_mail: 'Defensive no-mail domain',
  parked: 'Parked domain',
};

const GROUPS: ReadonlyArray<Readonly<{
  id: string;
  label: string;
  purpose: string;
  standard: readonly string[];
  defensive_no_mail: readonly string[];
  parked: readonly string[];
}>> = [
  {
    id: 'registration',
    label: 'Registration and delegation',
    purpose: 'Review transfer restrictions, nameserver publication, and DNSSEC evidence.',
    standard: ['registration_lock', 'nameservers', 'dnssec', 'dnssec_delegation_consistency'],
    defensive_no_mail: ['registration_lock', 'nameservers', 'dnssec', 'dnssec_delegation_consistency'],
    parked: ['registration_lock', 'nameservers', 'dnssec', 'dnssec_delegation_consistency'],
  },
  {
    id: 'mail',
    label: 'Mail intent and authentication',
    purpose: 'Compare the selected profile with MX, SPF, DMARC, and reviewed DKIM evidence.',
    standard: ['mx', 'spf', 'dmarc', 'dkim', 'dkim_retired'],
    defensive_no_mail: ['defensive_mail_profile', 'mx', 'spf', 'dmarc', 'dkim_retired'],
    parked: ['defensive_mail_profile', 'mx', 'spf', 'dmarc', 'dkim_retired'],
  },
  {
    id: 'transport',
    label: 'Mail transport and reporting',
    purpose: 'Review MTA-STS and TLS reporting without treating optional controls as universal requirements.',
    standard: ['mta_sts', 'tls_rpt'],
    defensive_no_mail: ['mta_sts', 'tls_rpt'],
    parked: ['mta_sts', 'tls_rpt'],
  },
  {
    id: 'issuance',
    label: 'Certificate issuance policy',
    purpose: 'Review the domain-level CAA publication observed during this audit.',
    standard: ['caa'],
    defensive_no_mail: ['caa'],
    parked: ['caa'],
  },
];

function groupState(checks: readonly DomainPostureCheck[]): DesiredPostureGroup['state'] {
  if (!checks.length || checks.every((check) => check.status === 'info')) return 'unavailable';
  if (checks.some((check) => check.status === 'danger')) return 'action';
  if (checks.some((check) => check.status === 'warning' || check.status === 'info')) return 'review';
  return 'aligned';
}

export const DESIRED_POSTURE_COMPARISON_FIELDS: readonly DesiredPostureComparisonField[] = Object.freeze([
  'nameservers',
  'ds',
  'mx',
  'caa',
  'tlsIssuer',
  'tlsSpkiSha256',
  'registrarLock',
  'renewalReviewAt',
]);

export const DESIRED_POSTURE_FIELD_LABELS: Readonly<Record<DesiredPostureComparisonField, string>> = Object.freeze({
  nameservers: 'Nameservers',
  ds: 'DS records',
  mx: 'Mail exchangers',
  caa: 'CAA policy',
  tlsIssuer: 'TLS issuer',
  tlsSpkiSha256: 'TLS public key',
  registrarLock: 'Registrar transfer lock',
  renewalReviewAt: 'Renewal review',
});

function comparableRecords(check: Pick<DomainPostureCheck, 'id' | 'records'> | undefined): string[] | null {
  return check ? canonicalPostureRecords(check.id, check.records) : null;
}

function profileAdmission(observation: DesiredPostureObservation | null, expected: DomainPostureProfileContext | undefined): string | null {
  if (!observation) return 'No retained posture observation is available.';
  const context = observation.context;
  if (!context || !expected) return 'The retained observation has no verified target and profile collection context.';
  if (context.version !== DOMAIN_POSTURE_COMPARISON_VERSION || expected.version !== DOMAIN_POSTURE_COMPARISON_VERSION
    || context.domain !== expected.domain || context.profileId !== expected.profileId || context.profileFingerprint !== expected.profileFingerprint) return 'The observation belongs to a different target, profile or collection configuration.';
  if (observation.omittedChecks) return 'The retained check inventory is incomplete.';
  return null;
}

function sameRecords(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function activeSuppression(
  baseline: DesiredPostureBaseline,
  field: DesiredPostureComparison['field'],
  nowMs: number,
): string {
  const normalizedField = field === 'tlsIssuer'
    ? 'tls_issuer'
    : field === 'tlsSpkiSha256'
      ? 'tls_spki'
      : field === 'registrarLock'
        ? 'registrar_lock'
        : field === 'renewalReviewAt'
          ? 'renewal_review'
          : field;
  const suppression = baseline.suppressions.find((item) => (
    Number.isFinite(nowMs) && item.field === normalizedField
    && (item.expiresAt === null || Date.parse(item.expiresAt) > nowMs)
  ));
  return suppression?.reason || '';
}

function withSuppression(
  comparison: Omit<DesiredPostureComparison, 'suppressionReason' | 'approvedWindowSummary'>,
  baseline: DesiredPostureBaseline,
  nowMs: number,
  observationAt: string | null = null,
): DesiredPostureComparison {
  const suppressionReason = activeSuppression(baseline, comparison.field, nowMs);
  const observationMs = observationAt ? Date.parse(observationAt) : Number.NaN;
  const approvedWindow = Number.isFinite(observationMs)
    ? baseline.approvedChangeWindows.find((window) => (
      Date.parse(window.startsAt) <= observationMs && observationMs <= Date.parse(window.endsAt)
    ))
    : undefined;
  const state = comparison.state === 'drift' && suppressionReason
    ? 'suppressed'
    : comparison.state === 'drift' && approvedWindow
      ? 'approved_window'
      : comparison.state;
  return {
    ...comparison,
    state,
    suppressionReason,
    approvedWindowSummary: approvedWindow?.summary ?? '',
  };
}

function recordComparison(
  baseline: DesiredPostureBaseline,
  field: 'nameservers' | 'mx' | 'caa',
  check: DesiredPostureObservation['checks'][number] | undefined,
  nowMs: number,
  observationAt: string | null,
  observationAvailable: boolean,
  contextLimitation: string | null,
): DesiredPostureComparison {
  const desired = canonicalPostureRecords(field, baseline[field]);
  const mode = domainControlRecordMode(baseline, field);
  if (desired === null) return withSuppression({ field, label: DESIRED_POSTURE_FIELD_LABELS[field], state: 'unknown', desired: baseline[field], observed: [], explanation: 'The desired record set contains invalid or unsupported values; review the baseline.' }, baseline, nowMs);
  if (mode === 'unconfigured') {
    return withSuppression({
      field,
      label: DESIRED_POSTURE_FIELD_LABELS[field],
      state: 'not_configured',
      desired,
      observed: [],
      explanation: 'No analyst-authored desired value is configured.',
    }, baseline, nowMs, observationAt);
  }
  const observed = comparableRecords(check);
  const reviewedAt = Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : null;
  const limitation = contextLimitation ?? postureSourceAdmission(check, observationAt, reviewedAt)
    ?? domainControlEvidenceAdmission(check?.sourceContext?.observedAt, reviewedAt);
  if (observed === null || limitation) {
    return withSuppression({
      field,
      label: DESIRED_POSTURE_FIELD_LABELS[field],
      state: observationAvailable ? 'unknown' : 'unavailable',
      desired,
      observed: check?.records ?? [],
      explanation: limitation ?? 'The retained values include invalid or unsupported records.',
    }, baseline, nowMs, observationAt);
  }
  if (mode === 'observe_only') return withSuppression({
    field, label: DESIRED_POSTURE_FIELD_LABELS[field], state: 'observed', desired: [], observed,
    explanation: 'Observation only: no required record set is compared.',
  }, baseline, nowMs, check?.sourceContext?.observedAt ?? null);
  const aligned = sameRecords(desired, observed);
  const needsReview = aligned && mode !== 'expect_none' && (check?.status === 'warning' || check?.status === 'danger');
  return withSuppression({
    field,
    label: DESIRED_POSTURE_FIELD_LABELS[field],
    state: needsReview ? 'review' : aligned ? 'aligned' : 'drift',
    desired,
    observed,
    explanation: needsReview
      ? 'The retained values match the desired set, but the source-qualified posture check still needs review.'
      : mode === 'expect_none'
        ? aligned ? 'The complete source observation contains no records, as expected.' : 'The complete source observation contains records where none are expected.'
      : aligned
        ? 'The retained source records match the analyst-authored desired set.'
      : 'The retained source records differ from the analyst-authored desired set.',
  }, baseline, nowMs, check?.sourceContext?.observedAt ?? null);
}

function unsupportedComparison(
  baseline: DesiredPostureBaseline,
  field: 'ds' | 'tlsIssuer' | 'tlsSpkiSha256',
  desired: readonly string[],
  nowMs: number,
): DesiredPostureComparison {
  const configured = field === 'ds' ? domainControlRecordMode(baseline, 'ds') !== 'unconfigured' : desired.length > 0;
  return withSuppression({
    field,
    label: DESIRED_POSTURE_FIELD_LABELS[field],
    state: configured ? 'unsupported' : 'not_configured',
    desired,
    observed: [],
    explanation: configured
      ? 'This audit does not return a complete comparable value for this field.'
      : 'No analyst-authored desired value is configured.',
  }, baseline, nowMs);
}

function lockComparison(
  baseline: DesiredPostureBaseline,
  check: DesiredPostureObservation['checks'][number] | undefined,
  nowMs: number,
  observationAt: string | null,
  observationAvailable: boolean,
  contextLimitation: string | null,
): DesiredPostureComparison {
  const desired = baseline.registrarLock === 'unconfigured' ? [] : [baseline.registrarLock];
  if (!desired.length) {
    return withSuppression({
      field: 'registrarLock',
      label: DESIRED_POSTURE_FIELD_LABELS.registrarLock,
      state: 'not_configured',
      desired,
      observed: [],
      explanation: 'No analyst-authored transfer-lock expectation is configured.',
    }, baseline, nowMs, observationAt);
  }
  const records = comparableRecords(check);
  const observedLock = records && postureTransferRestriction(records);
  const reviewedAt = Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : null;
  const limitation = contextLimitation ?? postureSourceAdmission(check, observationAt, reviewedAt)
    ?? domainControlEvidenceAdmission(check?.sourceContext?.observedAt, reviewedAt);
  if (!observedLock || limitation) {
    return withSuppression({
      field: 'registrarLock',
      label: DESIRED_POSTURE_FIELD_LABELS.registrarLock,
      state: observationAvailable ? 'unknown' : 'unavailable',
      desired,
      observed: check?.records ?? [],
      explanation: limitation ?? 'No complete comparable registry status inventory is retained.',
    }, baseline, nowMs, observationAt);
  }
  const aligned = observedLock === baseline.registrarLock;
  const needsReview = aligned && (check?.status === 'warning' || check?.status === 'danger');
  return withSuppression({
    field: 'registrarLock',
    label: DESIRED_POSTURE_FIELD_LABELS.registrarLock,
    state: needsReview ? 'review' : aligned ? 'aligned' : 'drift',
    desired,
    observed: [observedLock],
    explanation: needsReview
      ? 'The retained transfer-lock value matches the expectation, but the source-qualified check still needs review.'
      : aligned
        ? 'The retained registry status matches the analyst-authored transfer-lock expectation.'
      : 'The retained registry status differs from the analyst-authored transfer-lock expectation.',
  }, baseline, nowMs, check?.sourceContext?.observedAt ?? null);
}

function renewalComparison(
  baseline: DesiredPostureBaseline,
  nowMs: number,
): DesiredPostureComparison {
  const desired = baseline.renewalReviewAt ? [baseline.renewalReviewAt] : [];
  if (!baseline.renewalReviewAt) {
    return withSuppression({
      field: 'renewalReviewAt',
      label: DESIRED_POSTURE_FIELD_LABELS.renewalReviewAt,
      state: 'not_configured',
      desired,
      observed: [],
      explanation: 'No analyst-authored renewal review date is configured.',
    }, baseline, nowMs);
  }
  const due = Date.parse(baseline.renewalReviewAt) <= nowMs;
  return withSuppression({
    field: 'renewalReviewAt',
    label: DESIRED_POSTURE_FIELD_LABELS.renewalReviewAt,
    state: !Number.isFinite(nowMs) ? 'unknown' : due ? 'drift' : 'aligned',
    desired,
    observed: [],
    explanation: !Number.isFinite(nowMs) ? 'The renewal review clock is unavailable.' : due ? 'The planned renewal review date is due.' : 'The planned renewal review date is still in the future.',
  }, baseline, nowMs);
}

export function buildDesiredPostureObservation(report: DomainPostureHttpResponse, context?: DomainPostureProfileContext): DesiredPostureObservation {
  return {
    observedAt: report.checkedAt,
    ...(context ? { context } : {}),
    ...(report.checks.length > MAX_POSTURE_CHECKS ? { omittedChecks: report.checks.length - MAX_POSTURE_CHECKS } : {}),
    checks: report.checks.slice(0, MAX_POSTURE_CHECKS).map((check) => ({
      id: check.id,
      status: check.status,
      records: check.records.slice(0, MAX_POSTURE_CHECK_RECORDS),
      ...(check.sourceContext ? { sourceContext: {
        ...check.sourceContext,
        ...(check.records.length > MAX_POSTURE_CHECK_RECORDS ? {
          state: check.sourceContext.state === 'unavailable' ? 'unavailable' as const : 'partial' as const,
          omittedRecords: check.sourceContext.omittedRecords === null ? null : check.sourceContext.omittedRecords + check.records.length - MAX_POSTURE_CHECK_RECORDS,
        } : {}),
      } } : {}),
    })),
  };
}

function observationChanges(
  previous: DesiredPostureObservation,
  current: DesiredPostureObservation,
  now: unknown,
  cohortLimitation: string | null = null,
): DesiredPosturePreviousChange[] {
  const previousById = new Map(previous.checks.map((check) => [check.id, check]));
  const currentById = new Map(current.checks.map((check) => [check.id, check]));
  const previousTime = normalizeExplicitIsoTimestamp(previous.observedAt);
  const currentTime = normalizeExplicitIsoTimestamp(current.observedAt);
  const contextLimitation = cohortLimitation ?? profileAdmission(previous, current.context) ?? profileAdmission(current, current.context)
    ?? (!previousTime || !currentTime || Date.parse(previousTime) >= Date.parse(currentTime) ? 'Capture times do not establish a unique before-and-after order.' : null)
    ?? (previousById.size !== previous.checks.length || currentById.size !== current.checks.length ? 'Duplicate check identities prevent a unique comparison.' : null);
  return [...new Set([...previousById.keys(), ...currentById.keys()])].sort().map((checkId) => {
    const prior = previousById.get(checkId);
    const next = currentById.get(checkId);
    const before = comparableRecords(prior);
    const after = comparableRecords(next);
    const limitation = contextLimitation ?? postureSourceAdmission(prior, previous.observedAt, now)
      ?? postureSourceAdmission(next, current.observedAt, now)
      ?? (Date.parse(prior!.sourceContext!.observedAt!) >= Date.parse(next!.sourceContext!.observedAt!) ? 'Source times do not establish a later observation.' : null)
      ?? (before === null || after === null ? 'Comparable source records are unavailable for this check.' : null);
    return {
      checkId,
      state: limitation ? 'unknown' : sameRecords(before!, after!) ? 'unchanged' : 'changed',
      previous: before ?? prior?.records ?? [],
      current: after ?? next?.records ?? [],
      ...(limitation ? { limitation } : {}),
    };
  });
}

export function buildDesiredPostureHistory(
  observations: readonly DesiredPostureObservation[],
  now: unknown = new Date().toISOString(),
): ReadonlyArray<Readonly<{
  observedAt: string;
  previousObservedAt: string;
  changedChecks: readonly string[];
  comparableChecks: number;
  unknownChecks: number;
  limitation: string | null;
}>> {
  const ordered = [...observations]
    .sort((left, right) => {
      const a = normalizeExplicitIsoTimestamp(left.observedAt);
      const b = normalizeExplicitIsoTimestamp(right.observedAt);
      return a === b ? 0 : a === null ? 1 : b === null ? -1 : Date.parse(a) - Date.parse(b);
    })
    .slice(-MAX_DESIRED_POSTURE_OBSERVATIONS);
  return ordered.slice(1).map((current, index) => {
    const previous = ordered[index]!;
    const ambiguous = ordered.some((item) => !normalizeExplicitIsoTimestamp(item.observedAt))
      || ordered.filter((item) => Date.parse(item.observedAt) === Date.parse(previous.observedAt)).length !== 1
      || ordered.filter((item) => Date.parse(item.observedAt) === Date.parse(current.observedAt)).length !== 1;
    const limitation = ambiguous ? 'Unknown or equal capture times prevent a unique before-and-after comparison.' : null;
    const changes = observationChanges(previous, current, now, limitation);
    return Object.freeze({
      observedAt: current.observedAt,
      previousObservedAt: previous.observedAt,
      changedChecks: Object.freeze(changes.filter((check) => check.state === 'changed').map((check) => check.checkId)),
      comparableChecks: changes.filter((check) => check.state !== 'unknown').length,
      unknownChecks: changes.filter((check) => check.state === 'unknown').length,
      limitation,
    });
  });
}

export function buildDesiredPostureComparisonsFromObservation(
  baseline: DesiredPostureBaseline,
  observation: DesiredPostureObservation | null,
  now: unknown = new Date().toISOString(),
  options: { context?: DomainPostureProfileContext; limitation?: string | null } = {},
): DesiredPostureComparison[] {
  const nowMs = Date.parse(normalizeExplicitIsoTimestamp(now) ?? '');
  const checks = new Map((observation?.checks ?? []).map((check) => [check.id, check]));
  const observationAt = observation?.observedAt ?? null;
  const observationAvailable = Boolean(observation || options.limitation);
  const limitation = options.limitation ?? profileAdmission(observation, options.context)
    ?? (checks.size !== observation?.checks.length ? 'Duplicate check identities prevent a unique comparison.' : null);
  return [
    recordComparison(baseline, 'nameservers', checks.get('nameservers'), nowMs, observationAt, observationAvailable, limitation),
    unsupportedComparison(baseline, 'ds', baseline.ds, nowMs),
    recordComparison(baseline, 'mx', checks.get('mx'), nowMs, observationAt, observationAvailable, limitation),
    recordComparison(baseline, 'caa', checks.get('caa'), nowMs, observationAt, observationAvailable, limitation),
    unsupportedComparison(baseline, 'tlsIssuer', baseline.tlsIssuer ? [baseline.tlsIssuer] : [], nowMs),
    unsupportedComparison(baseline, 'tlsSpkiSha256', baseline.tlsSpkiSha256 ? [baseline.tlsSpkiSha256] : [], nowMs),
    lockComparison(baseline, checks.get('registration_lock'), nowMs, observationAt, observationAvailable, limitation),
    renewalComparison(baseline, nowMs),
  ];
}

export function buildOwnedDomainPostureReview(
  profile: BrandProfile,
  report: DomainPostureHttpResponse,
  now: unknown = new Date().toISOString(),
  context?: DomainPostureProfileContext,
): OwnedDomainPostureReview {
  const profileName = report.mailProtectionProfile;
  const checkById = new Map(report.checks.map((check) => [check.id, check]));
  const desiredGroups = GROUPS.map((group) => {
    const checks = group[profileName]
      .map((id) => checkById.get(id))
      .filter((check): check is DomainPostureCheck => Boolean(check));
    return {
      id: group.id,
      label: group.label,
      purpose: group.purpose,
      checks,
      state: groupState(checks),
    };
  });
  const dependencies = report.externalDependencies.slice(0, 64).map((dependency) => ({
    ...dependency,
    review: dependency.state === 'unavailable' ? 'needs_evidence' as const : 'recorded' as const,
  }));
  const nowMs = Date.parse(normalizeExplicitIsoTimestamp(now) ?? '');
  const currentAttestations = profile.protectionAttestations.filter((item) => (
    item.expiresAt === null || Date.parse(item.expiresAt) > nowMs
  ));
  const baseline = profile.desiredPostureBaselines.find((item) => item.domain === report.domain) || null;
  const current = buildDesiredPostureObservation(report, context);
  const retained = baseline ? currentDesiredPostureObservation(baseline) : null;
  const expected = profile.officialDomains.includes(report.domain) ? brandPostureObservationContext(profile, report.domain) : undefined;
  return {
    domain: report.domain,
    checkedAt: report.checkedAt,
    profile: profileName,
    profileLabel: PROFILE_LABELS[profileName],
    desiredGroups,
    dependencies,
    dependencyCounts: {
      all: dependencies.length,
      external: dependencies.filter((item) => item.scope === 'external').length,
      unavailable: dependencies.filter((item) => item.state === 'unavailable').length,
    },
    attestationCounts: {
      current: currentAttestations.filter((item) => item.state === 'observed' || item.state === 'not_applicable').length,
      expired: profile.protectionAttestations.length - currentAttestations.length,
      unresolved: currentAttestations.filter((item) => item.state === 'needs_confirmation' || item.state === 'unavailable').length,
    },
    baseline,
    baselineComparisons: baseline ? buildDesiredPostureComparisonsFromObservation(baseline, current, now, expected ? { context: expected } : {}) : [],
    previousChanges: retained?.observation ? observationChanges(retained.observation, current, now, profileAdmission(current, expected)) : [],
    limitations: [
      { id: 'configuration', text: 'Expected settings do not change DNS, registrar, mail or provider configuration.' },
      ...(dependencies.length ? [{ id: 'external_dependency' as const, text: 'An external dependency is a review lead. Unavailable evidence does not establish that it is dangling, claimable or controlled by another party.' }] : []),
      { id: 'attestation', text: 'Account controls remain analyst attestations with their own review and expiry dates.' },
      ...(retained?.limitation ? [{ id: 'retained_evidence' as const, text: retained.limitation }] : []),
    ],
  };
}

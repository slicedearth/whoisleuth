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
  limitations: readonly string[];
}>;

export type DesiredPostureComparison = Readonly<{
  field: keyof Pick<
    DesiredPostureBaseline,
    'nameservers' | 'ds' | 'mx' | 'caa' | 'tlsIssuer' | 'tlsSpkiSha256' | 'registrarLock' | 'renewalReviewAt'
  >;
  label: string;
  state: 'aligned' | 'drift' | 'not_configured' | 'suppressed' | 'unknown' | 'unsupported';
  desired: readonly string[];
  observed: readonly string[];
  explanation: string;
  suppressionReason: string;
}>;

export type DesiredPosturePreviousChange = Readonly<{
  checkId: string;
  state: 'changed' | 'unchanged' | 'unknown';
  previous: readonly string[];
  current: readonly string[];
}>;

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

const FIELD_LABELS: Record<DesiredPostureComparison['field'], string> = {
  nameservers: 'Nameservers',
  ds: 'DS records',
  mx: 'Mail exchangers',
  caa: 'CAA policy',
  tlsIssuer: 'TLS issuer',
  tlsSpkiSha256: 'TLS public key',
  registrarLock: 'Registrar transfer lock',
  renewalReviewAt: 'Renewal review',
};

function comparableRecords(check: DomainPostureCheck | undefined): string[] | null {
  if (!check || check.status === 'info') return null;
  return [...new Set(check.records.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
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
    item.field === normalizedField
    && (item.expiresAt === null || Date.parse(item.expiresAt) > nowMs)
  ));
  return suppression?.reason || '';
}

function withSuppression(
  comparison: Omit<DesiredPostureComparison, 'suppressionReason'>,
  baseline: DesiredPostureBaseline,
  nowMs: number,
): DesiredPostureComparison {
  const suppressionReason = activeSuppression(baseline, comparison.field, nowMs);
  return {
    ...comparison,
    state: suppressionReason && comparison.state === 'drift' ? 'suppressed' : comparison.state,
    suppressionReason,
  };
}

function recordComparison(
  baseline: DesiredPostureBaseline,
  field: 'nameservers' | 'mx' | 'caa',
  check: DomainPostureCheck | undefined,
  nowMs: number,
): DesiredPostureComparison {
  const desired = baseline[field].map((value) => value.toLowerCase()).sort();
  if (!desired.length) {
    return withSuppression({
      field,
      label: FIELD_LABELS[field],
      state: 'not_configured',
      desired,
      observed: [],
      explanation: 'No analyst-authored desired value is configured.',
    }, baseline, nowMs);
  }
  const observed = comparableRecords(check);
  if (observed === null) {
    return withSuppression({
      field,
      label: FIELD_LABELS[field],
      state: 'unknown',
      desired,
      observed: [],
      explanation: 'The current audit did not return complete comparable evidence.',
    }, baseline, nowMs);
  }
  const aligned = sameRecords(desired, observed);
  return withSuppression({
    field,
    label: FIELD_LABELS[field],
    state: aligned ? 'aligned' : 'drift',
    desired,
    observed,
    explanation: aligned
      ? 'The current observed records match the analyst-authored desired set.'
      : 'The current observed records differ from the analyst-authored desired set.',
  }, baseline, nowMs);
}

function unsupportedComparison(
  baseline: DesiredPostureBaseline,
  field: 'ds' | 'tlsIssuer' | 'tlsSpkiSha256',
  desired: readonly string[],
  nowMs: number,
): DesiredPostureComparison {
  return withSuppression({
    field,
    label: FIELD_LABELS[field],
    state: desired.length ? 'unsupported' : 'not_configured',
    desired,
    observed: [],
    explanation: desired.length
      ? 'This audit does not return a complete comparable value for this field.'
      : 'No analyst-authored desired value is configured.',
  }, baseline, nowMs);
}

function lockComparison(
  baseline: DesiredPostureBaseline,
  check: DomainPostureCheck | undefined,
  nowMs: number,
): DesiredPostureComparison {
  const desired = baseline.registrarLock === 'unconfigured' ? [] : [baseline.registrarLock];
  if (!desired.length) {
    return withSuppression({
      field: 'registrarLock',
      label: FIELD_LABELS.registrarLock,
      state: 'not_configured',
      desired,
      observed: [],
      explanation: 'No analyst-authored transfer-lock expectation is configured.',
    }, baseline, nowMs);
  }
  if (!check || check.status === 'info') {
    return withSuppression({
      field: 'registrarLock',
      label: FIELD_LABELS.registrarLock,
      state: 'unknown',
      desired,
      observed: [],
      explanation: 'Registry transfer-lock evidence is unavailable or inconclusive.',
    }, baseline, nowMs);
  }
  const observedLock = check.status === 'pass' ? 'required' : 'not_required';
  const aligned = observedLock === baseline.registrarLock;
  return withSuppression({
    field: 'registrarLock',
    label: FIELD_LABELS.registrarLock,
    state: aligned ? 'aligned' : 'drift',
    desired,
    observed: [observedLock],
    explanation: aligned
      ? 'The current registry status matches the analyst-authored transfer-lock expectation.'
      : 'The current registry status differs from the analyst-authored transfer-lock expectation.',
  }, baseline, nowMs);
}

function renewalComparison(
  baseline: DesiredPostureBaseline,
  nowMs: number,
): DesiredPostureComparison {
  const desired = baseline.renewalReviewAt ? [baseline.renewalReviewAt] : [];
  if (!baseline.renewalReviewAt) {
    return withSuppression({
      field: 'renewalReviewAt',
      label: FIELD_LABELS.renewalReviewAt,
      state: 'not_configured',
      desired,
      observed: [],
      explanation: 'No analyst-authored renewal review date is configured.',
    }, baseline, nowMs);
  }
  const due = Date.parse(baseline.renewalReviewAt) <= nowMs;
  return withSuppression({
    field: 'renewalReviewAt',
    label: FIELD_LABELS.renewalReviewAt,
    state: due ? 'drift' : 'aligned',
    desired,
    observed: [],
    explanation: due ? 'The planned renewal review date is due.' : 'The planned renewal review date is still in the future.',
  }, baseline, nowMs);
}

export function buildDesiredPostureObservation(report: DomainPostureHttpResponse): DesiredPostureObservation {
  return {
    observedAt: report.checkedAt,
    checks: report.checks.slice(0, 32).map((check) => ({
      id: check.id,
      status: check.status,
      records: check.records.slice(0, 32),
    })),
  };
}

function previousChanges(
  previous: DesiredPostureObservation | null,
  report: DomainPostureHttpResponse,
): DesiredPosturePreviousChange[] {
  if (!previous) return [];
  const currentById = new Map(report.checks.map((check) => [check.id, check]));
  return previous.checks.slice(0, 32).map((prior) => {
    const current = currentById.get(prior.id);
    const previousRecords = prior.records.map((value) => value.toLowerCase()).sort();
    const currentRecords = comparableRecords(current);
    return {
      checkId: prior.id,
      state: currentRecords === null
        ? 'unknown' as const
        : prior.status === current?.status && sameRecords(previousRecords, currentRecords)
          ? 'unchanged' as const
          : 'changed' as const,
      previous: previousRecords,
      current: currentRecords || [],
    };
  });
}

function baselineComparisons(
  baseline: DesiredPostureBaseline | null,
  report: DomainPostureHttpResponse,
  nowMs: number,
): DesiredPostureComparison[] {
  if (!baseline) return [];
  const checks = new Map(report.checks.map((check) => [check.id, check]));
  return [
    recordComparison(baseline, 'nameservers', checks.get('nameservers'), nowMs),
    unsupportedComparison(baseline, 'ds', baseline.ds, nowMs),
    recordComparison(baseline, 'mx', checks.get('mx'), nowMs),
    recordComparison(baseline, 'caa', checks.get('caa'), nowMs),
    unsupportedComparison(baseline, 'tlsIssuer', baseline.tlsIssuer ? [baseline.tlsIssuer] : [], nowMs),
    unsupportedComparison(baseline, 'tlsSpkiSha256', baseline.tlsSpkiSha256 ? [baseline.tlsSpkiSha256] : [], nowMs),
    lockComparison(baseline, checks.get('registration_lock'), nowMs),
    renewalComparison(baseline, nowMs),
  ];
}

export function buildOwnedDomainPostureReview(
  profile: BrandProfile,
  report: DomainPostureHttpResponse,
  now: unknown = new Date().toISOString(),
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
  const nowMs = Number.isFinite(Date.parse(String(now))) ? Date.parse(String(now)) : Date.parse(report.checkedAt);
  const currentAttestations = profile.protectionAttestations.filter((item) => (
    item.expiresAt === null || Date.parse(item.expiresAt) > nowMs
  ));
  const baseline = profile.desiredPostureBaselines.find((item) => item.domain === report.domain) || null;
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
    baselineComparisons: baselineComparisons(baseline, report, nowMs),
    previousChanges: previousChanges(baseline?.previousObservation || null, report),
    limitations: [
      'The desired-state view organizes the selected Brand Profile and this point-in-time audit. It does not change DNS, registrar, mail, or provider configuration.',
      'An external dependency is a review lead. Unavailable evidence is not proof that a dependency is dangling, claimable, insecure, abandoned, or controlled by another party.',
      'Protection controls that cannot be observed from public data remain analyst attestations with their own review and expiry dates.',
    ],
  };
}

import type { BrandProfile, MailProtectionProfile } from './brand-profile-model.ts';
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
  limitations: readonly string[];
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
    limitations: [
      'The desired-state view organizes the selected Brand Profile and this point-in-time audit. It does not change DNS, registrar, mail, or provider configuration.',
      'An external dependency is a review lead. Unavailable evidence is not proof that a dependency is dangling, claimable, insecure, abandoned, or controlled by another party.',
      'Protection controls that cannot be observed from public data remain analyst attestations with their own review and expiry dates.',
    ],
  };
}

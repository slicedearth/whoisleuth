// Pure defensive-registration profile-listing aggregation. A candidate can belong
// to several mutation groups, so group totals intentionally overlap; the
// summary counts unique domains exactly once.

const REGISTERED_STATES = new Set(['registered', 'for_sale', 'expiring']);

type RegistrationOutcome = 'registered' | 'available' | 'unknown';
type CoveragePriority = 'P1' | 'P2';

type ProfileListingCounts = Record<RegistrationOutcome, number> & {
  total: number;
  profileListed: number;
};

type CoverageResult = {
  domain?: unknown;
  sourceDomain?: unknown;
  candidateTld?: unknown;
  mutationTypes?: unknown;
  availability?: unknown;
};

type GeneratedCandidate = {
  domain: string;
  source?: string | null;
  tld?: string | null;
  mutationTypes?: string[];
};

type CoverageCandidate = {
  domain: string;
  source: string | null;
  tld: string | null;
  mutationTypes: string[];
  availability: unknown;
};

type ProfileListingGroup = ProfileListingCounts & {
  key: string;
  label: string;
  domains: string[];
  actionableDomains: string[];
};

type CoveragePlanRow = CoverageCandidate & {
  status: RegistrationOutcome;
  profileListed: boolean;
  priority: CoveragePriority;
  action: 'review_acquisition' | 'resolve_evidence' | 'investigate_registration';
  actionLabel: string;
  rationale: string;
};

function emptyCounts(): ProfileListingCounts {
  return { total: 0, profileListed: 0, registered: 0, available: 0, unknown: 0 };
}

function classifyCandidate(candidate: CoverageCandidate): RegistrationOutcome {
  if (candidate.availability === 'available') return 'available';
  if (typeof candidate.availability === 'string' && REGISTERED_STATES.has(candidate.availability)) return 'registered';
  return 'unknown';
}

function planRow(candidate: CoverageCandidate, status: RegistrationOutcome, profileListed: boolean): CoveragePlanRow {
  if (status === 'available') return {
    ...candidate,
    status,
    profileListed,
    priority: 'P1',
    action: 'review_acquisition',
    actionLabel: 'Review defensive acquisition',
    rationale: 'The authoritative availability result supports a time-sensitive manual registration decision. Recheck before purchase.',
  };
  if (status === 'unknown') return {
    ...candidate,
    status,
    profileListed,
    priority: 'P1',
    action: 'resolve_evidence',
    actionLabel: 'Resolve source coverage',
    rationale: 'The retained sources did not support a registration conclusion. Missing evidence is not availability.',
  };
  return {
    ...candidate,
    status,
    profileListed,
    priority: 'P2',
    action: 'investigate_registration',
    actionLabel: 'Review registered candidate',
    rationale: 'The candidate appears registered. Review current evidence and ownership context before monitoring or escalation.',
  };
}

function addToGroup(
  groups: Map<string, ProfileListingGroup>,
  key: string,
  label: string,
  candidate: CoverageCandidate,
  status: RegistrationOutcome,
  profileListed: boolean,
): void {
  if (!groups.has(key)) groups.set(key, { key, label, ...emptyCounts(), domains: [], actionableDomains: [] });
  const group = groups.get(key);
  if (!group) return;
  group.total += 1;
  group[status] += 1;
  if (profileListed) group.profileListed += 1;
  group.domains.push(candidate.domain);
  group.actionableDomains.push(candidate.domain);
}

function finishGroups(groups: ReadonlyMap<string, ProfileListingGroup>) {
  return [...groups.values()]
    .map((group) => ({
      ...group,
      profileListedShare: group.total ? Math.round((group.profileListed / group.total) * 100) : 0,
    }))
    .sort((a, b) => b.available - a.available || b.registered - a.registered || b.total - a.total || a.label.localeCompare(b.label));
}

export function buildCoverageReport(
  results: readonly CoverageResult[],
  generatedCandidates: readonly GeneratedCandidate[],
  allowlistedDomains: ReadonlySet<string>,
  mutationLabels: Readonly<Record<string, string>>,
) {
  const resultByDomain = new Map(results.map((result) => [String(result.domain || '').toLowerCase(), result]));
  const candidatesByDomain = new Map<string, CoverageCandidate>();

  for (const result of results) {
    if (!Array.isArray(result.mutationTypes) || result.mutationTypes.length === 0) continue;
    const domain = String(result.domain || '').toLowerCase();
    candidatesByDomain.set(domain, {
      domain,
      source: typeof result.sourceDomain === 'string' ? result.sourceDomain : null,
      tld: typeof result.candidateTld === 'string' ? result.candidateTld : domain.split('.').pop() || null,
      mutationTypes: result.mutationTypes.filter((value): value is string => typeof value === 'string'),
      availability: result.availability,
    });
  }

  // Generated candidates that were removed from the scan because the active
  // profile already lists them still count in the profile-listed share.
  for (const generated of generatedCandidates) {
    const domain = String(generated.domain || '').toLowerCase();
    if (!domain || candidatesByDomain.has(domain) || !allowlistedDomains.has(domain)) continue;
    const result = resultByDomain.get(domain);
    candidatesByDomain.set(domain, {
      domain,
      source: generated.source || null,
      tld: generated.tld || domain.split('.').pop() || null,
      mutationTypes: Array.isArray(generated.mutationTypes) ? generated.mutationTypes : [],
      availability: result?.availability || null,
    });
  }

  const summary = emptyCounts();
  const mutationGroups = new Map<string, ProfileListingGroup>();
  const tldGroups = new Map<string, ProfileListingGroup>();
  const candidates: CoveragePlanRow[] = [];
  for (const candidate of candidatesByDomain.values()) {
    const status = classifyCandidate(candidate);
    const profileListed = allowlistedDomains.has(candidate.domain);
    summary.total += 1;
    summary[status] += 1;
    if (profileListed) summary.profileListed += 1;
    candidates.push(planRow(candidate, status, profileListed));
    for (const mutationType of candidate.mutationTypes) {
      addToGroup(mutationGroups, mutationType, mutationLabels[mutationType] || mutationType, candidate, status, profileListed);
    }
    if (candidate.tld) addToGroup(tldGroups, candidate.tld, `.${candidate.tld}`, candidate, status, profileListed);
  }

  const priorityOrder: Record<CoveragePriority, number> = { P1: 0, P2: 1 };
  const actionOrder: Record<CoveragePlanRow['action'], number> = {
    review_acquisition: 0,
    resolve_evidence: 1,
    investigate_registration: 2,
  };
  candidates.sort((left, right) => (
    priorityOrder[left.priority] - priorityOrder[right.priority]
    || actionOrder[left.action] - actionOrder[right.action]
    || left.domain.localeCompare(right.domain)
  ));
  return {
    summary: { ...summary, profileListedShare: summary.total ? Math.round((summary.profileListed / summary.total) * 100) : 0 },
    candidates,
    mutationGroups: finishGroups(mutationGroups),
    tldGroups: finishGroups(tldGroups),
    plan: candidates,
    limitation: 'Profile-listed is an overlapping local profile-membership count, separate from the retained registration outcome. Profile inclusion does not establish protection, ownership, or control.',
  };
}

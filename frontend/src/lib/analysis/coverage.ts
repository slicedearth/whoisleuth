// Pure defensive-registration coverage aggregation. A candidate can belong
// to several mutation groups, so group totals intentionally overlap; the
// summary counts unique domains exactly once.

const REGISTERED_STATES = new Set(['registered', 'for_sale', 'expiring']);

type CoverageStatus = 'protected' | 'registered' | 'available' | 'unknown';

type CoverageCounts = Record<CoverageStatus, number> & {
  total: number;
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

type CoverageGroup = CoverageCounts & {
  key: string;
  label: string;
  domains: string[];
  actionableDomains: string[];
};

function emptyCounts(): CoverageCounts {
  return { total: 0, protected: 0, registered: 0, available: 0, unknown: 0 };
}

function classifyCandidate(candidate: CoverageCandidate, allowlistedDomains: ReadonlySet<string>): CoverageStatus {
  if (allowlistedDomains.has(candidate.domain)) return 'protected';
  if (candidate.availability === 'available') return 'available';
  if (typeof candidate.availability === 'string' && REGISTERED_STATES.has(candidate.availability)) return 'registered';
  return 'unknown';
}

function addToGroup(
  groups: Map<string, CoverageGroup>,
  key: string,
  label: string,
  candidate: CoverageCandidate,
  status: CoverageStatus,
): void {
  if (!groups.has(key)) groups.set(key, { key, label, ...emptyCounts(), domains: [], actionableDomains: [] });
  const group = groups.get(key);
  if (!group) return;
  group.total += 1;
  group[status] += 1;
  group.domains.push(candidate.domain);
  if (status !== 'protected') group.actionableDomains.push(candidate.domain);
}

function finishGroups(groups: ReadonlyMap<string, CoverageGroup>) {
  return [...groups.values()]
    .map((group) => ({
      ...group,
      coveragePercent: group.total ? Math.round((group.protected / group.total) * 100) : 0,
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
  // profile already allowlists them still count as protected coverage.
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
  const mutationGroups = new Map<string, CoverageGroup>();
  const tldGroups = new Map<string, CoverageGroup>();
  const candidates: Array<CoverageCandidate & { status: CoverageStatus }> = [];
  for (const candidate of candidatesByDomain.values()) {
    const status = classifyCandidate(candidate, allowlistedDomains);
    summary.total += 1;
    summary[status] += 1;
    candidates.push({ ...candidate, status });
    for (const mutationType of candidate.mutationTypes) {
      addToGroup(mutationGroups, mutationType, mutationLabels[mutationType] || mutationType, candidate, status);
    }
    if (candidate.tld) addToGroup(tldGroups, candidate.tld, `.${candidate.tld}`, candidate, status);
  }

  return {
    summary: { ...summary, coveragePercent: summary.total ? Math.round((summary.protected / summary.total) * 100) : 0 },
    candidates,
    mutationGroups: finishGroups(mutationGroups),
    tldGroups: finishGroups(tldGroups),
  };
}

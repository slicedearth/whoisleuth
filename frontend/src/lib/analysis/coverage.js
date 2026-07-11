// Pure defensive-registration coverage aggregation. A candidate can belong
// to several mutation groups, so group totals intentionally overlap; the
// summary counts unique domains exactly once.

const REGISTERED_STATES = new Set(['registered', 'for_sale', 'expiring']);

function emptyCounts() {
  return { total: 0, protected: 0, registered: 0, available: 0, unknown: 0 };
}

function classifyCandidate(candidate, allowlistedDomains) {
  if (allowlistedDomains.has(candidate.domain)) return 'protected';
  if (candidate.availability === 'available') return 'available';
  if (REGISTERED_STATES.has(candidate.availability)) return 'registered';
  return 'unknown';
}

function addToGroup(groups, key, label, candidate, status) {
  if (!groups.has(key)) groups.set(key, { key, label, ...emptyCounts(), domains: [], actionableDomains: [] });
  const group = groups.get(key);
  group.total += 1;
  group[status] += 1;
  group.domains.push(candidate.domain);
  if (status !== 'protected') group.actionableDomains.push(candidate.domain);
}

function finishGroups(groups) {
  return [...groups.values()]
    .map((group) => ({
      ...group,
      coveragePercent: group.total ? Math.round((group.protected / group.total) * 100) : 0,
    }))
    .sort((a, b) => b.available - a.available || b.registered - a.registered || b.total - a.total || a.label.localeCompare(b.label));
}

/**
 * @param {Array<object>} results
 * @param {Array<{ domain: string, source?: string | null, tld?: string | null, mutationTypes?: string[] }>} generatedCandidates
 * @param {Set<string>} allowlistedDomains
 * @param {Record<string, string>} mutationLabels
 */
export function buildCoverageReport(results, generatedCandidates, allowlistedDomains, mutationLabels) {
  const resultByDomain = new Map(results.map((result) => [String(result.domain || '').toLowerCase(), result]));
  const candidatesByDomain = new Map();

  for (const result of results) {
    if (!Array.isArray(result.mutationTypes) || result.mutationTypes.length === 0) continue;
    const domain = String(result.domain || '').toLowerCase();
    candidatesByDomain.set(domain, {
      domain,
      source: result.sourceDomain || null,
      tld: result.candidateTld || domain.split('.').pop() || null,
      mutationTypes: result.mutationTypes,
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
  const mutationGroups = new Map();
  const tldGroups = new Map();
  const candidates = [];
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

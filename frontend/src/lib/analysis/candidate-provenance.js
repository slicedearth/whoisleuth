// Request-local provenance for the candidate list currently loaded into the
// query box. Bulk/watchlist records carry their own copy once scanned.

/** @type {Map<string, { domain: string, source: string | null, tld: string | null, mutationTypes: string[] }>} */
let byDomain = new Map();

/** @param {Array<{ domain: string, source?: string | null, sourceDomain?: string | null, tld?: string | null, candidateTld?: string | null, mutationTypes?: string[] }>} [candidates] */
export function setCandidateProvenance(candidates = []) {
  byDomain = new Map();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.domain !== 'string') continue;
    const domain = candidate.domain.trim().toLowerCase();
    if (!domain) continue;
    const mutationTypes = Array.isArray(candidate.mutationTypes)
      ? candidate.mutationTypes.filter((type) => typeof type === 'string' && type)
      : [];
    const existing = byDomain.get(domain);
    if (existing) {
      existing.mutationTypes = [...new Set([...existing.mutationTypes, ...mutationTypes])];
      continue;
    }
    const source = candidate.source || candidate.sourceDomain;
    const tld = candidate.tld || candidate.candidateTld;
    byDomain.set(domain, {
      domain,
      source: typeof source === 'string' ? source : null,
      tld: typeof tld === 'string' ? tld : domain.split('.').pop() || null,
      mutationTypes: [...new Set(mutationTypes)],
    });
  }
}

export function getCandidateProvenance(domain) {
  if (!domain) return null;
  return byDomain.get(String(domain).trim().toLowerCase()) || null;
}

export function listCandidateProvenance() {
  return [...byDomain.values()];
}

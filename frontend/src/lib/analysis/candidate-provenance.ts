// Request-local provenance for the candidate list currently loaded into the
// query box. Bulk/watchlist records carry their own copy once scanned.

export type CandidateProvenance = {
  domain: string;
  source: string | null;
  tld: string | null;
  mutationTypes: string[];
};

export type CandidateProvenanceInput = {
  domain: string;
  source?: string | null;
  sourceDomain?: string | null;
  tld?: string | null;
  candidateTld?: string | null;
  mutationTypes?: unknown[];
};

let byDomain = new Map<string, CandidateProvenance>();

export function setCandidateProvenance(candidates: readonly CandidateProvenanceInput[] = []): void {
  byDomain = new Map();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.domain !== 'string') continue;
    const domain = candidate.domain.trim().toLowerCase();
    if (!domain) continue;
    const mutationTypes = Array.isArray(candidate.mutationTypes)
      ? candidate.mutationTypes.filter((type): type is string => typeof type === 'string' && type.length > 0)
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

export function getCandidateProvenance(domain: unknown): CandidateProvenance | null {
  if (!domain) return null;
  return byDomain.get(String(domain).trim().toLowerCase()) || null;
}

export function listCandidateProvenance(): CandidateProvenance[] {
  return [...byDomain.values()];
}

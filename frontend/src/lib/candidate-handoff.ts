export interface Candidate {
  domain: string;
  source: string;
  mutationTypes: string[];
}

export interface CandidateHandoff {
  version: 1;
  createdAt: string;
  source: 'typosquat' | 'keyword' | 'certificate-transparency' | 'watchlist' | 'manual';
  candidates: Candidate[];
  generatedCandidates?: Candidate[];
}

const KEY = 'whoisleuth:candidate-handoff:v1';

export function saveCandidateHandoff(source: CandidateHandoff['source'], candidates: Candidate[], generatedCandidates?:Candidate[]) {
  const value: CandidateHandoff = { version: 1, createdAt: new Date().toISOString(), source, candidates, ...(generatedCandidates?{generatedCandidates}: {}) };
  sessionStorage.setItem(KEY, JSON.stringify(value));
}

export function loadCandidateHandoff(): CandidateHandoff | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) || 'null') as CandidateHandoff | null;
    return parsed?.version === 1 && Array.isArray(parsed.candidates) ? parsed : null;
  } catch {
    return null;
  }
}

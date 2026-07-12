import { buildHandoff, parseHandoff, HANDOFF_KEY } from './candidate-handoff-core.js';

export interface CertificateTransparencyProvenance {
  hostnames: string[];
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  certificateCount: number;
}

export interface Candidate {
  domain: string;
  source: string;
  mutationTypes: string[];
  certificateTransparency?: CertificateTransparencyProvenance | null;
}

export interface CandidateHandoff {
  version: 1;
  createdAt: string;
  source: 'typosquat' | 'keyword' | 'certificate-transparency' | 'watchlist' | 'manual';
  candidates: Candidate[];
  generatedCandidates?: Candidate[];
}

export function saveCandidateHandoff(source: CandidateHandoff['source'], candidates: Candidate[], generatedCandidates?: Candidate[]) {
  sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(buildHandoff(source, candidates, generatedCandidates)));
}

export function loadCandidateHandoff(): CandidateHandoff | null {
  try {
    return parseHandoff(JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null')) as CandidateHandoff | null;
  } catch {
    return null;
  }
}

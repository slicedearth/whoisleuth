import { buildHandoff, parseSerializedHandoff, HANDOFF_KEY } from './candidate-handoff-core.ts';
import type {
  Candidate,
  CandidateHandoff,
} from './candidate-handoff-core.ts';

export type {
  Candidate,
  CandidateHandoff,
  CertificateTransparencyProvenance,
} from './candidate-handoff-core.ts';

export function saveCandidateHandoff(source: CandidateHandoff['source'], candidates: Candidate[], generatedCandidates?: Candidate[]) {
  sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(buildHandoff(source, candidates, generatedCandidates)));
}

export function loadCandidateHandoff(): CandidateHandoff | null {
  try {
    return parseSerializedHandoff(sessionStorage.getItem(HANDOFF_KEY));
  } catch {
    return null;
  }
}

import {
  handoffMatchesNavigationSource,
  parseSerializedHandoff,
  serializeCandidateHandoff,
  HANDOFF_KEY,
} from './candidate-handoff-core.ts';
import type {
  Candidate,
  CandidateHandoff,
} from './candidate-handoff-core.ts';

export type {
  Candidate,
  CandidateHandoff,
  CertificateTransparencyProvenance,
} from './candidate-handoff-core.ts';

export type CandidateHandoffSaveResult =
  | { saved: true; token: string; generatedContextTruncated: boolean }
  | { saved: false; reason: 'too_large' | 'storage_unavailable' };

function handoffToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function saveCandidateHandoff(
  source: CandidateHandoff['source'],
  candidates: Candidate[],
  generatedCandidates?: Candidate[],
): CandidateHandoffSaveResult {
  let token: string;
  try {
    token = handoffToken();
  } catch {
    return { saved: false, reason: 'storage_unavailable' };
  }
  const prepared = serializeCandidateHandoff(source, candidates, generatedCandidates, undefined, token);
  if (!prepared) return { saved: false, reason: 'too_large' };
  try {
    sessionStorage.setItem(HANDOFF_KEY, prepared.serialized);
    return {
      saved: true,
      token,
      generatedContextTruncated: prepared.handoff.generatedCandidatesTruncated === true,
    };
  } catch {
    return { saved: false, reason: 'storage_unavailable' };
  }
}

export function consumeCandidateHandoff(expectedToken: string, expectedSource: string): CandidateHandoff | null {
  try {
    const serialized = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    const handoff = parseSerializedHandoff(serialized);
    return handoff?.token === expectedToken
      && handoffMatchesNavigationSource(handoff.source, expectedSource)
      ? handoff
      : null;
  } catch {
    return null;
  }
}

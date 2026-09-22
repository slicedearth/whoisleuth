import { LOOKUP_EVIDENCE_SCHEMA } from './analysis/evidence-export.ts';
import { LOOKUP_EVIDENCE_REPLAY_MAX_BYTES, parseLookupEvidenceReplay } from './analysis/lookup-evidence-replay.ts';
import type { BrowserInvestigationPackageReview } from './investigation-package-worker-model.ts';

/** An explicitly selected entry, never an arbitrary first Lookup or saved record. */
export async function readPackagedLookupReview(review: BrowserInvestigationPackageReview, entryId: string) {
  const entries = review.entries.filter(item => item.entry.id === entryId);
  const selected = entries[0];
  if (!review.identityVerified || entries.length !== 1 || selected?.state !== 'identity_verified'
    || selected.entry.schema !== LOOKUP_EVIDENCE_SCHEMA) throw new Error('Select one verified Lookup evidence entry.');
  const file = review.contents.get(entryId);
  if (!file || file.size !== selected.entry.byteLength || file.size > LOOKUP_EVIDENCE_REPLAY_MAX_BYTES) {
    throw new Error('The selected Lookup file is absent or exceeds its replay limit.');
  }
  // Fatal decoding preserves the byte-to-digest relationship. The normal replay
  // reader validates the supported version, source states and publication shape.
  const document = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  const digest = /^sha256:([a-f0-9]{64})$/u.exec(selected.entry.contentDigestSha256)?.[1];
  if (!digest) throw new Error('The package Lookup checksum is invalid.');
  return parseLookupEvidenceReplay(document, { expectedSha256: digest });
}

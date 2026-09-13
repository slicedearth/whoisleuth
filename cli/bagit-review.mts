import { inspectBagItEntries, readBagItZip } from '../packages/interchange/bagit.mts';
import { OFFLINE_ARTIFACT_VERIFICATION_SCHEMA, OFFLINE_ARTIFACT_VERIFICATION_VERSION, type OfflineArtifactVerificationReport } from './artifact-verify.mts';

export async function verifyOfflineBagIt(input: Uint8Array | ReadonlyMap<string, Uint8Array>): Promise<OfflineArtifactVerificationReport> {
  const files = input instanceof Uint8Array ? readBagItZip(input) : input;
  const zipBytes = input instanceof Uint8Array ? input.byteLength : null;
  const { review, inputBytes } = await inspectBagItEntries(files);
  return {
    schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA, version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
    artifact: { kind: 'bagit', schema: null, version: '1.0' },
    state: review.state === 'valid' ? 'integrity_valid' : 'partial',
    checks: { structure: review.complete ? 'verified' : 'failed',
      contentIntegrity: review.state === 'valid' ? 'verified' : review.state === 'invalid' ? 'failed' : 'not_checked',
      contentIntegrityScope: 'manifest_and_files', authenticatedEncryption: 'not_applicable' },
    summary: { inputBytes: zipBytes ?? inputBytes,
      sectionCount: null, recordCount: review.entries.length, ciphertextBytes: null },
    manifestIdentity: null, bagit: review,
    limitations: [
      'BagIt verifies declared file checksums, not payload schemas, factual accuracy, source identity, signatures or trusted timestamps.',
      'Tag files without a checksum are not integrity-checked. No file is imported, executed or fetched; fetch.txt locations and original paths are omitted from this report.',
      'This bounded reader supports BagIt 1.0, UTF-8 text tags, SHA-256 and SHA-512, portable relative paths and the selected-file byte limits. Other encodings, algorithms and unsafe or platform-ambiguous paths are not silently accepted.',
    ],
  };
}

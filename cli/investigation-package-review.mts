import { sha256ArtifactBytes } from '../packages/evidence/artifact-integrity.mts';
import { MAX_INVESTIGATION_PACKAGE_BYTES, inspectInvestigationPackage, type InvestigationPackageSourceLink } from '../packages/investigation/investigation-package.mts';
import { INVESTIGATION_MANIFEST_SCHEMA } from '../packages/investigation/investigation-manifest.mts';
import {
  OFFLINE_ARTIFACT_VERIFICATION_SCHEMA, OFFLINE_ARTIFACT_VERIFICATION_VERSION,
  UnsupportedOfflineArtifactError, isCompleteOfflineArtifactVerification, verifyOfflineArtifact,
  type OfflineArtifactVerificationReport,
} from './artifact-verify.mts';

type EntryState = 'admitted' | 'opaque' | 'unsupported' | 'rejected' | 'review_required';
export type OfflineInvestigationPackageDetails = Readonly<{
  digestSha256: string;
  audience: 'private';
  storageEffect: 'none';
  signatureTrust: 'not_checked';
  timestampAssurance: 'not_checked';
  factualAccuracy: 'not_established';
  entries: readonly Readonly<{
    id: string;
    byteLength: number;
    mediaType: string;
    state: EntryState;
    identity: 'verified' | 'failed';
    verification: Pick<OfflineArtifactVerificationReport, 'artifact' | 'state' | 'checks' | 'summary'> | null;
    issue: string | null;
  }>[];
  links: readonly InvestigationPackageSourceLink[];
}>;

export async function verifyOfflineInvestigationPackage(input: Uint8Array): Promise<OfflineArtifactVerificationReport> {
  if (!(input instanceof Uint8Array) || input.byteLength > MAX_INVESTIGATION_PACKAGE_BYTES) throw new TypeError('Investigation package exceeds its input limit.');
  const bytes = new Uint8Array(input);
  const inspected = await inspectInvestigationPackage(bytes);
  const entries: Array<OfflineInvestigationPackageDetails['entries'][number]> = [];
  for (const reviewed of inspected.entries) {
    let state: EntryState = reviewed.state === 'rejected' ? 'rejected' : reviewed.interpretation === 'opaque' ? 'opaque' : 'unsupported';
    let verification: OfflineInvestigationPackageDetails['entries'][number]['verification'] = null;
    let issue = reviewed.issue ?? (reviewed.interpretation === 'unsupported_json_value'
      ? 'JSON content identity is verified, but this value has no supported offline source-format reader.' : null);
    if (reviewed.state === 'identity_verified' && reviewed.interpretation === 'not_checked') {
      try {
        const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(inspected.contents.get(reviewed.entry.id)!);
        const result = await verifyOfflineArtifact(raw);
        verification = { artifact: result.artifact, state: result.state, checks: result.checks, summary: result.summary };
        state = isCompleteOfflineArtifactVerification(result) ? 'admitted' : 'review_required';
        if (state === 'review_required') issue = 'The supported reader requires additional verification before complete assurance.';
      } catch (cause) {
        state = cause instanceof UnsupportedOfflineArtifactError ? 'unsupported' : 'rejected';
        issue = state === 'unsupported' ? 'No supported offline reader accepts this declared source format.' : 'The source file failed its independent format or integrity checks.';
      }
    }
    entries.push({ id: reviewed.entry.id, byteLength: reviewed.entry.byteLength,
      mediaType: 'mediaType' in reviewed.entry ? reviewed.entry.mediaType : 'application/json',
      state, identity: reviewed.state === 'identity_verified' ? 'verified' : 'failed', verification, issue });
  }
  const complete = entries.every((entry) => entry.state === 'admitted' || entry.state === 'opaque')
    && inspected.links.every((link) => link.state === 'linked');
  return Object.freeze({
    schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA, version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
    artifact: Object.freeze({ kind: 'investigation_package' as const, schema: INVESTIGATION_MANIFEST_SCHEMA, version: inspected.manifest.version }),
    state: complete ? 'verified' : 'partial',
    checks: Object.freeze({ structure: 'verified', contentIntegrity: inspected.identityVerified ? 'verified' : 'failed',
      contentIntegrityScope: 'manifest_and_files', authenticatedEncryption: 'not_applicable' }),
    summary: Object.freeze({ inputBytes: bytes.byteLength, sectionCount: entries.length, recordCount: null, ciphertextBytes: null }),
    manifestIdentity: null,
    package: Object.freeze({ digestSha256: await sha256ArtifactBytes(bytes), audience: 'private', storageEffect: 'none',
      signatureTrust: 'not_checked', timestampAssurance: 'not_checked', factualAccuracy: 'not_established',
      entries: Object.freeze(entries), links: inspected.links }),
    limitations: Object.freeze([
      'The manifest and selected file bytes are checked independently. Re-compressing the ZIP can change its archive digest without changing its verified file content.',
      'Opaque files are retained byte-for-byte, not rendered, executed or validated as images or documents. Unsupported JSON remains separate from admitted source formats.',
      'Source declarations and packaging times are not authenticated. Signatures and timestamp tokens require their own verification and trust decisions.',
      'This command does not import, overwrite or collect evidence. Unchanged bytes and valid source structure do not establish factual accuracy, currentness or safe sharing.',
    ]),
  });
}

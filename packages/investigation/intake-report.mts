import { sha256ArtifactBytes } from '../evidence/artifact-integrity.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { MESSAGE_INTAKE_KINDS, MESSAGE_INTAKE_SCHEMA, MESSAGE_INTAKE_VERSION, MAX_MESSAGE_INTAKE_BYTES,
  type MessageIntakeKind, type CurrentMessageIntakeReport } from '../contracts/message-intake.mts';

export function assertMessageBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > MAX_MESSAGE_INTAKE_BYTES) {
    throw new TypeError('Select one non-empty input of at most 16 MiB. No input was retained.');
  }
}

export async function createIntakeReport(bytes: Uint8Array, kind: MessageIntakeKind, reviewedAt: string): Promise<CurrentMessageIntakeReport> {
  assertMessageBytes(bytes);
  const instant = normalizeExplicitIsoTimestamp(reviewedAt);
  if (!instant || !MESSAGE_INTAKE_KINDS.includes(kind)) throw new TypeError('Input review requires a supported format and a timestamp with an explicit timezone.');
  return { schema: MESSAGE_INTAKE_SCHEMA, schemaVersion: MESSAGE_INTAKE_VERSION, reviewedAt: instant,
    source: { kind, digestSha256: await sha256ArtifactBytes(bytes), byteLength: bytes.byteLength },
    coverage: { state: 'reviewed', reviewedParts: 0, unreviewedAttachments: 0, rejectedLinks: 0, boundsReached: [] },
    identities: [], authenticationClaims: [], authenticationReview: { headers: [], omittedHeaders: 0 }, messageParts: [],
    links: [], indicators: [], indicatorCoverage: { state: 'not_reviewed', candidatesReviewed: 0 }, distributionContext: null,
    actionHints: [], identityRecovery: { reportedActions: [], nextSteps: [] } };
}

import { Buffer } from 'node:buffer';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

import { canonicalArtifactJson } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import {
  hasVerifiedApplicableIntegrity,
  hasVerifiedArtifactStructure,
  MAX_OFFLINE_ARTIFACT_BYTES,
  verifyOfflineArtifact,
  type OfflineArtifactIntegrityScope,
  type OfflineArtifactVerificationCheck,
  type OfflineArtifactVerificationState,
} from './artifact-verify.mts';
import { parseBoundedJsonObject } from './bounded-json.mts';

export const SIGNED_EVIDENCE_PACKAGE_SCHEMA = 'whoisleuth.signed-evidence-package';
export const SIGNED_EVIDENCE_PACKAGE_VERSION = 1;
export const EVIDENCE_SIGNATURE_VERIFICATION_SCHEMA = 'whoisleuth.evidence-signature-verification';
export const EVIDENCE_SIGNATURE_VERIFICATION_VERSION = 2;
export const EVIDENCE_SIGNATURE_ALGORITHM = 'Ed25519';
export const EVIDENCE_SIGNATURE_CANONICALIZATION = 'sorted-json-v1';
export const MAX_SIGNING_KEY_FILE_BYTES = 16 * 1024;

type UnknownRecord = Record<string, unknown>;
type SignedPayload = Readonly<{
  schema: typeof SIGNED_EVIDENCE_PACKAGE_SCHEMA;
  version: typeof SIGNED_EVIDENCE_PACKAGE_VERSION;
  signedAt: string;
  artifact: UnknownRecord;
}>;
export type SignedEvidencePackage = SignedPayload & Readonly<{
  signature: Readonly<{
    algorithm: typeof EVIDENCE_SIGNATURE_ALGORITHM;
    canonicalization: typeof EVIDENCE_SIGNATURE_CANONICALIZATION;
    publicKeySpkiDerBase64: string;
    keyIdSha256: string;
    valueBase64: string;
  }>;
}>;
export type EvidenceSignatureVerification = Readonly<{
  schema: typeof EVIDENCE_SIGNATURE_VERIFICATION_SCHEMA;
  version: typeof EVIDENCE_SIGNATURE_VERIFICATION_VERSION;
  state: 'signature_valid';
  signature: Readonly<{
    state: 'valid';
    signerTrust: 'trusted_key' | 'embedded_key_only';
    signedAt: string;
    keyIdSha256: string;
    publicKeyMatched: boolean | null;
  }>;
  artifact: Readonly<{
    schema: string | null;
    version: number | null;
    kind: string;
    assurance: Readonly<{
      state: OfflineArtifactVerificationState | 'not_verified';
      structure: OfflineArtifactVerificationCheck;
      contentIntegrity: OfflineArtifactVerificationCheck;
      contentIntegrityScope: OfflineArtifactIntegrityScope;
    }>;
  }>;
  limitations: readonly string[];
}>;

const SHA256_RE = /^[a-f0-9]{64}$/u;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/u;
const PACKAGE_KEYS = new Set(['schema', 'version', 'signedAt', 'artifact', 'signature']);
const SIGNATURE_KEYS = new Set([
  'algorithm',
  'canonicalization',
  'publicKeySpkiDerBase64',
  'keyIdSha256',
  'valueBase64',
]);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function parseObject(raw: string, label: string): UnknownRecord {
  return parseBoundedJsonObject(raw, { label, maximumBytes: MAX_OFFLINE_ARTIFACT_BYTES });
}

function hasExactKeys(value: UnknownRecord, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64) {
    throw new TypeError('Signature time must be a valid timestamp.');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError('Signature time must be a valid timestamp.');
  return new Date(parsed).toISOString();
}

function canonicalTimestamp(value: unknown): string {
  const normalized = timestamp(value);
  if (value !== normalized) throw new TypeError('Signature time must use canonical UTC timestamp text.');
  return normalized;
}

function importPrivateKey(pem: string): KeyObject {
  if (Buffer.byteLength(pem, 'utf8') > MAX_SIGNING_KEY_FILE_BYTES) {
    throw new TypeError(`Private key file exceeds ${MAX_SIGNING_KEY_FILE_BYTES} bytes.`);
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new TypeError('Private key file must contain one readable PEM private key.');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('Evidence signing requires an Ed25519 private key.');
  }
  return key;
}

function importPublicKey(value: string | Buffer, label: string): KeyObject {
  if (Buffer.byteLength(value) > MAX_SIGNING_KEY_FILE_BYTES) {
    throw new TypeError(`${label} exceeds ${MAX_SIGNING_KEY_FILE_BYTES} bytes.`);
  }
  let key: KeyObject;
  try {
    key = Buffer.isBuffer(value)
      ? createPublicKey({ key: value, format: 'der', type: 'spki' })
      : createPublicKey(value);
  } catch {
    throw new TypeError(`${label} must contain one readable Ed25519 public key.`);
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new TypeError(`${label} must be an Ed25519 public key.`);
  return key;
}

function spkiDer(key: KeyObject): Buffer {
  const publicKey = key.type === 'public'
    ? key
    : createPublicKey(key.export({ type: 'pkcs8', format: 'pem' }));
  return publicKey.export({ type: 'spki', format: 'der' });
}

function keyId(publicDer: Buffer): string {
  return createHash('sha256').update(publicDer).digest('hex');
}

function payloadBytes(payload: SignedPayload): Buffer {
  return Buffer.from(canonicalArtifactJson(payload), 'utf8');
}

async function signableArtifact(raw: string): Promise<{
  artifact: UnknownRecord;
  verification: Awaited<ReturnType<typeof verifyOfflineArtifact>>;
}> {
  const artifact = parseObject(raw, 'Evidence artefact');
  const verification = await verifyOfflineArtifact(raw);
  if (!['case_response_packet', 'investigation_capsule', 'signed_review_artifact'].includes(verification.artifact.kind)) {
    throw new TypeError('Only reviewed response packets, investigation capsules, and supported review manifests can be signed.');
  }
  if (!hasVerifiedArtifactStructure(verification) || !hasVerifiedApplicableIntegrity(verification)) {
    throw new TypeError('Evidence signing requires verified structure and a verified applicable integrity contract.');
  }
  return { artifact, verification };
}

export async function signEvidencePackage(
  raw: string,
  privateKeyPem: string,
  signedAt = new Date().toISOString(),
): Promise<SignedEvidencePackage> {
  const { artifact } = await signableArtifact(raw);
  const privateKey = importPrivateKey(privateKeyPem);
  const publicDer = spkiDer(privateKey);
  const payload: SignedPayload = Object.freeze({
    schema: SIGNED_EVIDENCE_PACKAGE_SCHEMA,
    version: SIGNED_EVIDENCE_PACKAGE_VERSION,
    signedAt: timestamp(signedAt),
    artifact,
  });
  return Object.freeze({
    ...payload,
    signature: Object.freeze({
      algorithm: EVIDENCE_SIGNATURE_ALGORITHM,
      canonicalization: EVIDENCE_SIGNATURE_CANONICALIZATION,
      publicKeySpkiDerBase64: publicDer.toString('base64'),
      keyIdSha256: keyId(publicDer),
      valueBase64: sign(null, payloadBytes(payload), privateKey).toString('base64'),
    }),
  });
}

export async function verifyEvidencePackageSignature(
  raw: string,
  trustedPublicKeyPem?: string | null,
): Promise<EvidenceSignatureVerification> {
  const value = parseObject(raw, 'Signed evidence package');
  const signature = record(value.signature);
  const artifact = record(value.artifact);
  if (!hasExactKeys(value, PACKAGE_KEYS)
    || value.schema !== SIGNED_EVIDENCE_PACKAGE_SCHEMA
    || value.version !== SIGNED_EVIDENCE_PACKAGE_VERSION
    || !artifact
    || !signature
    || !hasExactKeys(signature, SIGNATURE_KEYS)
    || signature.algorithm !== EVIDENCE_SIGNATURE_ALGORITHM
    || signature.canonicalization !== EVIDENCE_SIGNATURE_CANONICALIZATION
    || typeof signature.publicKeySpkiDerBase64 !== 'string'
    || signature.publicKeySpkiDerBase64.length > 4096
    || !BASE64_RE.test(signature.publicKeySpkiDerBase64)
    || typeof signature.valueBase64 !== 'string'
    || signature.valueBase64.length > 4096
    || !BASE64_RE.test(signature.valueBase64)
    || typeof signature.keyIdSha256 !== 'string'
    || !SHA256_RE.test(signature.keyIdSha256)) {
    throw new TypeError('Signed evidence package has an unsupported or malformed envelope.');
  }
  const signedAt = canonicalTimestamp(value.signedAt);
  const publicDer = Buffer.from(signature.publicKeySpkiDerBase64, 'base64');
  if (keyId(publicDer) !== signature.keyIdSha256) {
    throw new TypeError('Signed evidence package public-key identifier does not match its embedded key.');
  }
  const embeddedPublicKey = importPublicKey(
    publicDer,
    'Embedded evidence-signing public key',
  );
  const payload: SignedPayload = {
    schema: SIGNED_EVIDENCE_PACKAGE_SCHEMA,
    version: SIGNED_EVIDENCE_PACKAGE_VERSION,
    signedAt,
    artifact,
  };
  const signatureBytes = Buffer.from(signature.valueBase64, 'base64');
  if (signatureBytes.length !== 64
    || !verify(null, payloadBytes(payload), embeddedPublicKey, signatureBytes)) {
    throw new TypeError('Signed evidence package failed Ed25519 verification.');
  }
  let artifactVerification: Awaited<ReturnType<typeof verifyOfflineArtifact>> | null = null;
  try { artifactVerification = await verifyOfflineArtifact(JSON.stringify(artifact)); } catch { /* Signature validity remains independently reportable. */ }
  let publicKeyMatched: boolean | null = null;
  if (trustedPublicKeyPem) {
    const trustedDer = spkiDer(importPublicKey(trustedPublicKeyPem, 'Trusted public key file'));
    publicKeyMatched = trustedDer.equals(publicDer);
    if (!publicKeyMatched) throw new TypeError('Signed evidence package does not match the trusted public key.');
  }
  return Object.freeze({
    schema: EVIDENCE_SIGNATURE_VERIFICATION_SCHEMA,
    version: EVIDENCE_SIGNATURE_VERIFICATION_VERSION,
    state: 'signature_valid',
    signature: Object.freeze({
      state: 'valid',
      signerTrust: trustedPublicKeyPem ? 'trusted_key' : 'embedded_key_only',
      signedAt,
      keyIdSha256: signature.keyIdSha256,
      publicKeyMatched,
    }),
    artifact: Object.freeze({
      schema: artifactVerification?.artifact.schema
        ?? (typeof artifact.schema === 'string' && /^[a-z0-9.-]{1,160}$/u.test(artifact.schema) ? artifact.schema : null),
      version: artifactVerification?.artifact.version
        ?? (Number.isSafeInteger(artifact.version ?? artifact.schemaVersion)
          && Number(artifact.version ?? artifact.schemaVersion) >= 1
          && Number(artifact.version ?? artifact.schemaVersion) <= 1_000
          ? Number(artifact.version ?? artifact.schemaVersion)
          : null),
      kind: artifactVerification?.artifact.kind ?? 'unverified_artifact',
      assurance: Object.freeze({
        state: artifactVerification?.state ?? 'not_verified',
        structure: artifactVerification?.checks.structure ?? 'not_checked',
        contentIntegrity: artifactVerification?.checks.contentIntegrity ?? 'not_checked',
        contentIntegrityScope: artifactVerification?.checks.contentIntegrityScope ?? 'not_checked',
      }),
    }),
    limitations: Object.freeze([
      trustedPublicKeyPem
        ? 'The signature and supplied public key match; recipient trust still depends on obtaining that public key through an authenticated channel.'
        : 'The signature is internally valid for the embedded public key, but signer identity was not authenticated because no trusted public key was supplied.',
      'The signature authenticates the canonical sorted-JSON content, not the original whitespace, indentation, or object-key order of the serialised file.',
      ...(artifactVerification
        ? [`Embedded-artifact assurance is reported separately as ${artifactVerification.state}; it does not change the cryptographic signature result.`]
        : ['The embedded artefact did not pass a supported local assurance contract. The cryptographic signature remains valid for its bytes, but no structure or inner-integrity claim is made.']),
      'A valid signature proves the canonical package content has not changed since signing; it does not establish that the retained observations or analyst statements are accurate.',
      'WHOISleuth does not generate, store, recover, rotate, or publish signing keys.',
    ]),
  });
}

export function formatEvidenceSignatureVerification(
  report: EvidenceSignatureVerification,
): string {
  const lines = [
    'WHOISleuth evidence signature verification',
    `State: ${report.state}`,
    `Signer trust: ${report.signature.signerTrust}`,
    `Artifact: ${report.artifact.kind} · ${report.artifact.schema ?? 'unrecognised'} v${report.artifact.version ?? 'unrecognised'}`,
    `Artifact assurance: ${report.artifact.assurance.state}`,
    `Signed: ${report.signature.signedAt}`,
    `Key ID: sha256:${report.signature.keyIdSha256}`,
    `Trusted public key: ${report.signature.publicKeyMatched === null ? 'not supplied' : 'matched'}`,
  ];
  for (const limitation of report.limitations) lines.push(`Limitation: ${limitation}`);
  return `${lines.join('\n')}\n`;
}

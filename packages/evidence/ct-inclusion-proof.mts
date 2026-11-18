import { Sequence } from 'asn1js';
import { Certificate, createECDSASignatureFromCMS } from 'pkijs';
import { exact } from './artifact-structure.mts';
import { normalizeExplicitIsoTimestamp } from './observation.mts';
import { decodeCryptoBase64, parseCryptoDer } from './bounded-crypto-material.mts';
import { CT_INCLUSION_INPUT_SCHEMA, CT_INCLUSION_REVIEW_SCHEMA, CT_INCLUSION_VERSION, MAX_CT_INCLUSION_BYTES, MAX_CT_LEAF_BYTES, MAX_CT_AUDIT_NODES } from '../contracts/ct-inclusion-proof.mts';

const hex = (value: Uint8Array) => [...value].map(byte => byte.toString(16).padStart(2, '0')).join('');
const hash = async (value: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', value));
const combine = (...values: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) { result.set(value, offset); offset += value.length; }
  return result;
};

function unsigned64(value: unknown, label: string): bigint {
  if (!(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    && !(typeof value === 'string' && /^(?:0|[1-9][0-9]{0,19})$/u.test(value))) throw new TypeError(`${label} must be an unsigned 64-bit integer.`);
  const result = BigInt(value);
  if (result > 0xffff_ffff_ffff_ffffn) throw new TypeError(`${label} exceeds 64 bits.`);
  return result;
}

function leafDetails(raw: Uint8Array<ArrayBuffer>) {
  if (raw.length < 17 || raw[0] !== 0 || raw[1] !== 0) throw new TypeError('Only RFC 6962 version-1 timestamped leaves are supported.');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const timestamp = view.getBigUint64(2), type = view.getUint16(10);
  let offset = 12;
  if (type === 1) offset += 32;
  else if (type !== 0) throw new TypeError('The certificate-log entry type is unsupported.');
  if (offset + 3 > raw.length) throw new TypeError('The certificate-log leaf is truncated.');
  const length = raw[offset]! * 65536 + raw[offset + 1]! * 256 + raw[offset + 2]!;
  offset += 3;
  if (!length || offset + length + 2 > raw.length) throw new TypeError('The certificate-log entry is truncated.');
  const entry = raw.slice(offset, offset + length);
  const der = parseCryptoDer(entry, MAX_CT_LEAF_BYTES, 'Certificate-log entry DER');
  if (!(der instanceof Sequence)) throw new TypeError('The certificate-log entry must be a DER sequence.');
  if (type === 0) {
    try { new Certificate({ schema: der }); }
    catch { throw new TypeError('The logged X.509 entry is malformed.'); }
  }
  offset += length;
  if (offset + 2 + view.getUint16(offset) !== raw.length) throw new TypeError('Certificate-log leaf extensions have an invalid length.');
  return { kind: type === 0 ? 'x509' as const : 'precertificate' as const, timestamp, entry };
}

async function inclusionRoot(leafHash: Uint8Array<ArrayBuffer>, index: bigint, size: bigint, path: readonly Uint8Array<ArrayBuffer>[], signal?: AbortSignal) {
  let node = leafHash, position = index, remaining = size - 1n;
  for (const sibling of path) {
    signal?.throwIfAborted();
    if (remaining === 0n) return null;
    if ((position & 1n) === 1n || position === remaining) {
      node = await hash(combine(Uint8Array.of(1), sibling, node));
      while (position !== 0n && (position & 1n) === 0n) { position >>= 1n; remaining >>= 1n; }
    } else node = await hash(combine(Uint8Array.of(1), node, sibling));
    position >>= 1n; remaining >>= 1n;
  }
  return remaining === 0n ? node : null;
}

/** Verifies selected v1 leaf/proof/STH material against one deliberately selected key. */
export async function reviewCtInclusionProof(value: unknown, reviewedAt = new Date().toISOString(), signal?: AbortSignal) {
  signal?.throwIfAborted();
  const input = exact(value, ['schema', 'version', 'protocol', 'leafInputBase64', 'leafIndex', 'auditPath', 'signedTreeHead', 'logKeySpkiBase64', 'logIdBase64'], 'Certificate-log inclusion input');
  if (input.schema !== CT_INCLUSION_INPUT_SCHEMA || input.version !== CT_INCLUSION_VERSION || input.protocol !== 'rfc6962-v1') throw new TypeError('Certificate-log proof schema, version or protocol is unsupported.');
  const at = normalizeExplicitIsoTimestamp(reviewedAt);
  if (!at) throw new TypeError('An explicit review timestamp is required.');
  if (!Array.isArray(input.auditPath) || input.auditPath.length > MAX_CT_AUDIT_NODES) throw new TypeError('The certificate-log audit path exceeds its node limit.');
  const leaf = decodeCryptoBase64(input.leafInputBase64, MAX_CT_LEAF_BYTES, 'Certificate-log leaf');
  const details = leafDetails(leaf);
  const keyBytes = decodeCryptoBase64(input.logKeySpkiBase64, 2 * 1024, 'Selected log key');
  parseCryptoDer(keyBytes, 16 * 1024, 'Selected log key DER');
  const logId = decodeCryptoBase64(input.logIdBase64, 32, 'Declared log ID');
  const path = input.auditPath.map(value => decodeCryptoBase64(value, 32, 'Audit-path hash'));
  const head = exact(input.signedTreeHead, ['tree_size', 'timestamp', 'sha256_root_hash', 'tree_head_signature'], 'Signed tree head');
  const root = decodeCryptoBase64(head.sha256_root_hash, 32, 'Tree root');
  if (logId.length !== 32 || root.length !== 32 || path.some(node => node.length !== 32)) throw new TypeError('Log IDs and Merkle hashes must be exactly 32 bytes.');
  const size = unsigned64(head.tree_size, 'Tree size'), index = unsigned64(input.leafIndex, 'Leaf index'), timestamp = unsigned64(head.timestamp, 'Tree-head timestamp');
  if (size === 0n || index >= size || timestamp > 8_640_000_000_000_000n) throw new TypeError('The leaf index, tree size or tree-head timestamp is invalid.');
  const signature = decodeCryptoBase64(head.tree_head_signature, 8 * 1024, 'Tree-head signature');
  if (signature.length < 5 || new DataView(signature.buffer).getUint16(2) !== signature.length - 4) throw new TypeError('The TLS signature envelope is malformed.');
  if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_CT_INCLUSION_BYTES) throw new TypeError('The certificate-log input exceeds its combined byte budget.');
  const leafHash = await hash(combine(Uint8Array.of(0), leaf));
  const calculated = await inclusionRoot(leafHash, index, size, path, signal);
  const selectedKeyHash = await hash(keyBytes);
  const signedBytes = new Uint8Array(50), signedView = new DataView(signedBytes.buffer);
  signedBytes[1] = 1;
  signedView.setBigUint64(2, timestamp); signedView.setBigUint64(10, size); signedBytes.set(root, 18);
  let signatureState: 'matched' | 'mismatch' | 'unsupported' = 'unsupported';
  if (signature[0] === 4 && (signature[1] === 1 || signature[1] === 3)) {
    try {
      const rsa = signature[1] === 1;
      const key = await crypto.subtle.importKey('spki', keyBytes, rsa ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } : { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      if (!rsa || (key.algorithm as RsaKeyAlgorithm).modulusLength >= 2048 && (key.algorithm as RsaKeyAlgorithm).modulusLength <= 8192) {
        const value = signature.slice(4);
        const encoded = rsa ? value : new Uint8Array(createECDSASignatureFromCMS(parseCryptoDer(value, 8 * 1024, 'ECDSA signature'), 32));
        signatureState = await crypto.subtle.verify(rsa ? 'RSASSA-PKCS1-v1_5' : { name: 'ECDSA', hash: 'SHA-256' }, key, encoded, signedBytes) ? 'matched' : 'mismatch';
      }
    } catch { signatureState = 'mismatch'; }
  }
  signal?.throwIfAborted();
  const checks = [
    { id: 'inclusion', state: calculated !== null && hex(calculated) === hex(root) ? 'matched' : 'mismatch', detail: 'The exact supplied leaf and audit path are checked against the declared tree size and root.' },
    { id: 'log_key', state: hex(selectedKeyHash) === hex(logId) ? 'matched' : 'mismatch', detail: 'The declared log ID must equal SHA-256 of the deliberately selected DER public key.' },
    { id: 'tree_signature', state: signatureState, detail: 'Checks the RFC 6962 tree-head signature using SHA-256 with RSA from 2048 to 8192 bits or P-256 ECDSA.' },
    { id: 'chronology', state: details.timestamp <= timestamp && timestamp <= BigInt(Date.parse(at)) ? 'matched' : 'mismatch', detail: 'The supplied leaf time cannot follow the signed tree-head time, which cannot follow this review.' },
  ];
  return Object.freeze({ schema: CT_INCLUSION_REVIEW_SCHEMA, version: CT_INCLUSION_VERSION, reviewedAt: at,
    protocol: 'rfc6962-v1', state: checks.every(check => check.state === 'matched') ? 'checks_passed' as const : 'review_required' as const,
    leaf: { kind: details.kind, digestSha256: hex(await hash(leaf)), merkleHashSha256: hex(leafHash), entryDigestSha256: hex(await hash(details.entry)) },
    tree: { size: size.toString(), leafIndex: index.toString(), timestamp: new Date(Number(timestamp)).toISOString(), rootSha256: hex(root) },
    selectedLogKeySha256: hex(selectedKeyHash), auditPathNodes: path.length, checks, networkRequestsMade: false,
    limitations: ['Trust is limited to the selected log key and historical signed tree head. Current log qualification, consistency, live deployment and domain control are not established.',
      'A logged certificate or precertificate is not proof of proper issuance or current certificate validity. RFC 9162 version-2 material is not interpreted as version 1. Original material is not copied into this report.'] });
}

import { scanBoundedJson } from '../analysis/bounded-json.mts';
import { exact } from './artifact-structure.mts';
import { CT_INCLUSION_INPUT_SCHEMA, CT_INCLUSION_VERSION, MAX_CT_INCLUSION_BYTES, MAX_CT_LEAF_BYTES } from '../contracts/ct-inclusion-proof.mts';
import { TIMESTAMP_TOKEN_INPUT_SCHEMA, TIMESTAMP_TOKEN_VERSION, MAX_TIMESTAMP_INPUT_BYTES, MAX_TIMESTAMP_ARTIFACT_BYTES, MAX_TIMESTAMP_TOKEN_BYTES, MAX_TIMESTAMP_CERTIFICATE_BYTES } from '../contracts/timestamp-token.mts';

export type SelectedProofKind = 'ct' | 'timestamp';
type MaterialField = Readonly<{ id: string; label: string; maximumBytes: number; maximumFiles: number; optional?: true }>;
export const SELECTED_PROOF_FILES: Readonly<Record<SelectedProofKind, readonly MaterialField[]>> = Object.freeze({
  ct: Object.freeze([
    { id: 'leaf', label: 'Leaf input (base64 text)', maximumBytes: Math.ceil(MAX_CT_LEAF_BYTES / 3) * 4 + 2, maximumFiles: 1 },
    { id: 'proof', label: 'Inclusion proof JSON (leaf_index and audit_path)', maximumBytes: 16 * 1024, maximumFiles: 1 },
    { id: 'head', label: 'Signed tree head JSON', maximumBytes: 16 * 1024, maximumFiles: 1 },
    { id: 'key', label: 'Selected log public key SPKI (base64 text)', maximumBytes: 4 * 1024, maximumFiles: 1 },
    { id: 'logId', label: 'Independently selected log ID (base64 text)', maximumBytes: 64, maximumFiles: 1 },
  ]),
  timestamp: Object.freeze([
    { id: 'artifact', label: 'Original artefact', maximumBytes: MAX_TIMESTAMP_ARTIFACT_BYTES, maximumFiles: 1 },
    { id: 'token', label: 'CMS timestamp token DER', maximumBytes: MAX_TIMESTAMP_TOKEN_BYTES, maximumFiles: 1 },
    { id: 'anchors', label: 'Selected trusted CA anchors PEM', maximumBytes: 256 * 1024, maximumFiles: 1 },
    { id: 'crls', label: 'Revocation lists DER (optional)', maximumBytes: MAX_TIMESTAMP_CERTIFICATE_BYTES, maximumFiles: 6, optional: true as const },
  ]),
});
export type SelectedProofFile = Readonly<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
export type SelectedProofFiles = Readonly<Record<string, readonly SelectedProofFile[]>>;

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4096) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 4096)));
  return btoa(chunks.join(''));
}
function json(text: string) { scanBoundedJson(text); return JSON.parse(text) as unknown; }

/** Assemble existing canonical inputs; no new evidence format or trust inference. */
export async function assembleSelectedProofInput(kind: SelectedProofKind, files: SelectedProofFiles,
  fields: Readonly<{ policy?: string; nonce?: string }> = {}, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const definitions = SELECTED_PROOF_FILES[kind];
  if (!definitions || Object.keys(files).some(id => !definitions.some(field => field.id === id))) throw new TypeError('Select a supported proof family and its declared files.');
  const maximum = kind === 'ct' ? MAX_CT_INCLUSION_BYTES : MAX_TIMESTAMP_INPUT_BYTES;
  let selectedBytes = 0;
  for (const field of definitions) {
    const selection = files[field.id] ?? [];
    if (!Array.isArray(selection) || selection.length > field.maximumFiles || !field.optional && selection.length !== 1) throw new TypeError(`Select the required bounded ${field.label}.`);
    for (const file of selection) {
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > field.maximumBytes) throw new TypeError(`${field.label} exceeds its file byte limit or is empty.`);
      selectedBytes += file.size;
    }
  }
  if (selectedBytes > maximum) throw new TypeError('Selected proof files exceed their combined byte limit.');
  const material: Record<string, Uint8Array[]> = {};
  for (const field of definitions) {
    material[field.id] = [];
    for (const file of files[field.id] ?? []) {
      signal?.throwIfAborted();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length !== file.size) throw new TypeError('Selected proof material changed while being read.');
      material[field.id]!.push(bytes);
    }
  }
  signal?.throwIfAborted();
  const text = (id: string) => new TextDecoder('utf-8', { fatal: true }).decode(material[id]![0]).trim();
  let input: Record<string, unknown>;
  if (kind === 'ct') {
    const proof = exact(json(text('proof')), ['leaf_index', 'audit_path'], 'Selected inclusion proof');
    input = { schema: CT_INCLUSION_INPUT_SCHEMA, version: CT_INCLUSION_VERSION, protocol: 'rfc6962-v1',
      leafInputBase64: text('leaf'), leafIndex: proof.leaf_index, auditPath: proof.audit_path,
      signedTreeHead: json(text('head')), logKeySpkiBase64: text('key'), logIdBase64: text('logId') };
  } else {
    if (typeof fields.policy !== 'string' || fields.policy.length > 200 || typeof fields.nonce !== 'undefined' && (typeof fields.nonce !== 'string' || fields.nonce.length > 80)) throw new TypeError('Select a bounded expected timestamp policy and optional nonce.');
    input = { schema: TIMESTAMP_TOKEN_INPUT_SCHEMA, version: TIMESTAMP_TOKEN_VERSION,
      artifactBase64: base64(material.artifact![0]!), tokenDerBase64: base64(material.token![0]!), trustAnchorsPem: text('anchors'),
      expectedPolicyOid: fields.policy.trim(), ...(fields.nonce?.trim() ? { expectedNonceHex: fields.nonce.trim() } : {}), crlsDerBase64: material.crls!.map(base64) };
  }
  if (new TextEncoder().encode(JSON.stringify(input)).length > maximum) throw new TypeError('Encoded proof material exceeds its combined byte limit.');
  return input;
}

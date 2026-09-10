import { zipSync } from 'fflate';
import { extractBoundedZipEntries } from '../interchange/bounded-zip-extraction.mts';
import { canonicalArtifactJsonV2, sha256ArtifactBytes, sha256ArtifactDigestV2 } from '../evidence/artifact-integrity.mts';
import { INVESTIGATION_CAPSULE_SCHEMA, investigationCapsuleSourceIdentity } from './investigation-capsule.mts';
import {
  MAX_INVESTIGATION_MANIFEST_ARTIFACTS, MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES,
  MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES,
  investigationJsonMetadata, prepareInvestigationManifest, readInvestigationManifest,
  type InvestigationManifestInput, type SupportedInvestigationManifest,
} from './investigation-manifest.mts';

const MANIFEST_PATH = 'manifest.json';
const MAX_PACKAGE_ENTRIES = MAX_INVESTIGATION_MANIFEST_ARTIFACTS + 1;
// Stored ZIP entries use 76 header bytes plus two copies of the generated ASCII
// path (at most 21 bytes). 128 bytes per entry also covers the fixed writer's
// header overhead; the end record is 22 bytes. Payload admission is independent.
export const MAX_INVESTIGATION_PACKAGE_BYTES = MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES
  + MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES + MAX_PACKAGE_ENTRIES * 128 + 22;

export function investigationPackageEntryPath(id: string): string {
  const match = /^artifact-([1-9]\d{0,2})$/u.exec(id);
  if (!match || Number(match[1]) > MAX_INVESTIGATION_MANIFEST_ARTIFACTS) throw new TypeError('Invalid investigation package entry identity.');
  return `artifacts/${id}`;
}

function packagePath(name: string): string {
  if (name === MANIFEST_PATH) return name;
  if (!name.startsWith('artifacts/') || investigationPackageEntryPath(name.slice('artifacts/'.length)) !== name) throw new TypeError('Investigation package contains an unexpected entry path.');
  return name;
}

export async function buildInvestigationPackage(input: InvestigationManifestInput, generatedAt: string, applicationVersion: string) {
  const prepared = await prepareInvestigationManifest(input, generatedAt, applicationVersion);
  const files: Record<string, Uint8Array> = Object.create(null);
  files[MANIFEST_PATH] = new TextEncoder().encode(canonicalArtifactJsonV2(prepared.manifest));
  for (const [index, item] of prepared.manifest.artifacts.entries()) files[investigationPackageEntryPath(item.id)] = prepared.contents[index]!;
  // Stored entries avoid re-compressing images and large JSON while retaining
  // exact source bytes. The reader also admits independently bounded deflate.
  const bytes = zipSync(files, { level: 0, mtime: new Date(1980, 0, 1) });
  if (bytes.byteLength > MAX_INVESTIGATION_PACKAGE_BYTES) throw new TypeError('Investigation package exceeds its byte limit.');
  return Object.freeze({ manifest: prepared.manifest, bytes });
}

type PackageEntry = SupportedInvestigationManifest['artifacts'][number];
export type InvestigationPackageEntryReview = Readonly<{
  entry: PackageEntry;
  state: 'identity_verified' | 'rejected';
  checks: Readonly<{
    byteLength: boolean;
    rawDigest: boolean;
    canonicalDigest: boolean | null;
    schema: boolean | null;
    version: boolean | null;
  }>;
  interpretation: 'not_checked' | 'opaque' | 'unsupported_json_value';
  issue: string | null;
}>;
export type InvestigationPackageSourceLink = Readonly<{
  capsuleEntryId: string;
  sourceEntryId: string | null;
  state: 'linked' | 'missing' | 'ambiguous' | 'mismatch';
}>;

export async function inspectInvestigationPackage(input: Uint8Array) {
  if (!(input instanceof Uint8Array) || input.byteLength < 22 || input.byteLength > MAX_INVESTIGATION_PACKAGE_BYTES) throw new TypeError(`Investigation package input must fit within ${MAX_INVESTIGATION_PACKAGE_BYTES} bytes.`);
  // The bounded reader verifies local/central identity and every selected CRC.
  // All entries are selected: an unverified trailing file cannot hide in a pack.
  const extracted = extractBoundedZipEntries(input, {
    maximumEntries: MAX_PACKAGE_ENTRIES,
    maximumSelectedBytes: MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES + MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES,
    selectedBytesExceededMessage: 'Investigation package exceeds its inflated byte limit.',
    metadataMismatchMessage: 'Investigation package ZIP metadata or CRC is invalid.',
    keyForName: packagePath,
    inspect(info) {
      const key = packagePath(info.name);
      const maximumBytes = key === MANIFEST_PATH ? MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES : MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES;
      if (info.originalSize < 1 || info.originalSize > maximumBytes) throw new TypeError('Investigation package entry exceeds its byte limit.');
      return { key, selected: true, maximumBytes, exceededMessage: 'Investigation package entry exceeds its inflated byte limit.' };
    },
  });
  const manifestBytes = extracted.files.get(MANIFEST_PATH);
  if (!manifestBytes) throw new TypeError('Investigation package is missing its manifest.');
  const manifest = await readInvestigationManifest(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  if (extracted.files.size !== manifest.artifacts.length + 1) throw new TypeError('Investigation package has missing or unlisted files.');
  const entries: InvestigationPackageEntryReview[] = [];
  const contents = new Map<string, Uint8Array>();
  const jsonSources = new Map<string, { schema: string | null; version: number | null; digest: string | null; query: unknown; target: unknown; references: unknown }>();
  for (const entry of manifest.artifacts) {
    const content = extracted.files.get(investigationPackageEntryPath(entry.id));
    if (!content) throw new TypeError('Investigation package is missing a declared file.');
    const isJson = !('mediaType' in entry) || entry.mediaType === 'application/json';
    const byteLength = content.byteLength === entry.byteLength;
    const rawDigest = await sha256ArtifactBytes(content) === entry.contentDigestSha256;
    let canonicalDigest: boolean | null = isJson ? false : null;
    let schema: boolean | null = isJson ? false : null;
    let version: boolean | null = isJson ? false : null;
    let issue: string | null = null;
    let interpretation: InvestigationPackageEntryReview['interpretation'] = isJson ? 'not_checked' : 'opaque';
    if (isJson) {
      try {
        const metadata = investigationJsonMetadata(new TextDecoder('utf-8', { fatal: true }).decode(content));
        canonicalDigest = await sha256ArtifactDigestV2(metadata.value) === entry.canonicalDigestSha256;
        schema = metadata.schema === entry.schema;
        version = metadata.version === entry.version;
        if (!metadata.object) interpretation = 'unsupported_json_value';
        if (metadata.object && byteLength && rawDigest && canonicalDigest && schema && version) {
          const query = metadata.object.query;
          const queryObject = query && typeof query === 'object' && !Array.isArray(query) ? query as Record<string, unknown> : null;
          jsonSources.set(entry.id, {
            schema: metadata.schema, version: metadata.version, digest: entry.canonicalDigestSha256,
            query: queryObject ? { submitted: queryObject.submitted, type: queryObject.type } : null,
            target: metadata.schema === INVESTIGATION_CAPSULE_SCHEMA ? metadata.object.target : null,
            references: metadata.schema === INVESTIGATION_CAPSULE_SCHEMA ? metadata.object.sourceContracts : null,
          });
        }
      } catch { issue = 'The declared JSON file is not valid bounded UTF-8 JSON.'; }
    }
    const verified = byteLength && rawDigest && canonicalDigest !== false && schema !== false && version !== false;
    entries.push(Object.freeze({ entry, state: verified ? 'identity_verified' : 'rejected',
      checks: Object.freeze({ byteLength, rawDigest, canonicalDigest, schema, version }),
      interpretation,
      issue: issue ?? (verified ? null : 'File content does not match its manifest identity.'),
    }));
    // Rejected bytes remain in the selected archive but cannot be used by an
    // importing caller as if they had passed identity verification.
    if (verified) contents.set(entry.id, content);
  }
  const links: InvestigationPackageSourceLink[] = [];
  for (const [id, capsule] of jsonSources) {
    if (capsule.schema !== INVESTIGATION_CAPSULE_SCHEMA) continue;
    const references = Array.isArray(capsule.references) && capsule.references.length <= 4
      ? capsule.references.filter((item) => item && typeof item === 'object' && item.id === 'lookup-evidence') : [];
    if (references.length !== 1) { links.push({ capsuleEntryId: id, sourceEntryId: null, state: 'mismatch' }); continue; }
    const reference = references[0];
    const candidates = [...jsonSources].filter(([otherId, source]) => otherId !== id && source.schema === reference.schema && source.digest === reference.digest);
    if (candidates.length !== 1) {
      const state = candidates.length > 1 ? 'ambiguous' : [...jsonSources.values()].some((source) => source.schema === reference.schema) ? 'mismatch' : 'missing';
      links.push({ capsuleEntryId: id, sourceEntryId: null, state });
      continue;
    }
    const [sourceEntryId, source] = candidates[0]!;
    const identity = investigationCapsuleSourceIdentity(capsule.target, reference, source);
    links.push({ capsuleEntryId: id, sourceEntryId, state: identity.linked ? 'linked' : 'mismatch' });
  }
  return Object.freeze({ manifest, entries: Object.freeze(entries), contents, links: Object.freeze(links),
    identityVerified: entries.every((entry) => entry.state === 'identity_verified'),
    storageEffect: 'none' as const,
    signatureTrust: 'not_checked' as const, timestampAssurance: 'not_checked' as const, factualAccuracy: 'not_established' as const,
  });
}

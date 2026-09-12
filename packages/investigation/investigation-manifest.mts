import { boundedJsonLimitsForBytes, parseBoundedJson, parseBoundedJsonObject } from '../../lib/bounded-json.mts';
import { normalizeBoundedSemanticVersion } from '../../lib/semantic-version.mts';
import { canonicalArtifactJsonV2, sha256ArtifactBytes, sha256ArtifactDigestV2, SORTED_JSON_V2 } from '../evidence/artifact-integrity.mts';
import { array, digest, enumeration, exact, fail, integer, iso, strings, text, validateIntegrity, type UnknownRecord } from '../evidence/artifact-structure.mts';
import {
  MAX_SELECTED_FILES as MAX_INVESTIGATION_MANIFEST_ARTIFACTS,
  MAX_SELECTED_FILE_TOTAL_BYTES as MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES,
  MAX_SELECTED_FILE_BYTES as MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES,
  SELECTED_FILE_MEDIA_TYPES as INVESTIGATION_FILE_MEDIA_TYPES,
} from '../contracts/selected-file-limits.mts';
export { MAX_INVESTIGATION_MANIFEST_ARTIFACTS, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES, MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES, INVESTIGATION_FILE_MEDIA_TYPES };

export const INVESTIGATION_MANIFEST_SCHEMA = 'whoisleuth.investigation-manifest';
export const INVESTIGATION_MANIFEST_VERSION = 3;
export const SUPPORTED_INVESTIGATION_MANIFEST_VERSIONS = [2, INVESTIGATION_MANIFEST_VERSION] as const;
// Independently bounds the path-free metadata, not the selected file content.
export const MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES = 512 * 1024;
type FileMediaType = typeof INVESTIGATION_FILE_MEDIA_TYPES[number];

/** A filename suggests a declaration only; it never validates file contents. */
export function investigationFileMediaType(name: string): FileMediaType {
  const extension = name.toLowerCase().split('.').at(-1);
  switch (extension) {
    case 'json': return 'application/json';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

export type InvestigationManifestArtifactInput = Readonly<{
  content: string | Uint8Array;
  mediaType?: FileMediaType;
  source?: Readonly<{ identity: string | null; observedAt: string | null }>;
}>;
export type InvestigationManifestInput = Readonly<{
  workflow: string;
  configurationDigestSha256: string | null;
  artifacts: readonly InvestigationManifestArtifactInput[];
}>;

function sourceDeclaration(source: InvestigationManifestArtifactInput['source']) {
  const identity = source?.identity ?? null;
  const observedAt = source?.observedAt ?? null;
  if (identity !== null) text(identity, 'Artefact source identity', 240);
  iso(observedAt, 'Artefact source observation time', true);
  return Object.freeze({ identity, observedAt });
}

export function investigationJsonMetadata(content: string, maximumBytes = MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES) {
  const value = parseBoundedJson(content, {
    label: 'Manifest artefact', maximumBytes,
    limits: boundedJsonLimitsForBytes(maximumBytes),
  });
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  let schema: string | null = null;
  // Arbitrary valid JSON remains packageable. An unusable schema declaration
  // is not copied into metadata; the exact source bytes still retain it.
  if (typeof object?.schema === 'string') {
    try { schema = text(object.schema, 'Artefact schema', 160); } catch { /* Unknown marker; not source-format admission. */ }
  }
  const candidate = object?.version ?? object?.schemaVersion;
  const version = Number.isSafeInteger(candidate) && Number(candidate) > 0 && Number(candidate) <= 1_000 ? Number(candidate) : null;
  return { value, object, schema, version };
}

export async function prepareInvestigationManifest(
  input: InvestigationManifestInput,
  generatedAt: string,
  applicationVersionValue: string,
) {
  if (!Array.isArray(input.artifacts) || input.artifacts.length < 1 || input.artifacts.length > MAX_INVESTIGATION_MANIFEST_ARTIFACTS) {
    throw new TypeError(`A manifest requires between 1 and ${MAX_INVESTIGATION_MANIFEST_ARTIFACTS} artefacts.`);
  }
  iso(generatedAt, 'Manifest generatedAt');
  const workflow = text(input.workflow, 'Manifest workflow', 160);
  const applicationVersion = normalizeBoundedSemanticVersion(applicationVersionValue, 'Application');
  const configurationDigestSha256 = input.configurationDigestSha256;
  if (configurationDigestSha256 !== null) digest(configurationDigestSha256, 'configurationDigestSha256');
  let totalBytes = 0;
  // Capture all mutable bytes and declarations before the first asynchronous
  // digest. The package writer uses these same owned bytes, not the caller's view.
  const selected = input.artifacts.map((artifact, index) => {
    if (typeof artifact.content !== 'string' && !(artifact.content instanceof Uint8Array)) throw new TypeError(`Artefact ${index + 1} requires text or bytes.`);
    if (artifact.content.length > MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES || artifact.content.length > MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES - totalBytes) {
      throw new TypeError('Manifest artefacts exceed the per-file or combined limit.');
    }
    const bytes = typeof artifact.content === 'string' ? new TextEncoder().encode(artifact.content) : new Uint8Array(artifact.content);
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES) throw new TypeError(`Artefact ${index + 1} must be between 1 byte and ${MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES} bytes.`);
    if (bytes.byteLength > MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES - totalBytes) throw new TypeError('Manifest artefacts exceed the combined limit.');
    totalBytes += bytes.byteLength;
    const mediaType = enumeration(artifact.mediaType ?? (typeof artifact.content === 'string' ? 'application/json' : 'application/octet-stream'), INVESTIGATION_FILE_MEDIA_TYPES, 'Artefact media type');
    return { bytes, mediaType, source: sourceDeclaration(artifact.source) };
  });
  const artifacts = [];
  for (const [index, file] of selected.entries()) {
    const metadata = file.mediaType === 'application/json'
      ? investigationJsonMetadata(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)) : null;
    artifacts.push(Object.freeze({
      sequence: index + 1, id: `artifact-${index + 1}`,
      schema: metadata?.schema ?? null, version: metadata?.version ?? null,
      byteLength: file.bytes.byteLength,
      contentDigestSha256: await sha256ArtifactBytes(file.bytes),
      canonicalDigestSha256: metadata ? await sha256ArtifactDigestV2(metadata.value) : null,
      mediaType: file.mediaType, source: file.source,
    }));
  }
  const unsigned = Object.freeze({
    schema: INVESTIGATION_MANIFEST_SCHEMA, version: INVESTIGATION_MANIFEST_VERSION,
    generatedAt, application: Object.freeze({ name: 'WHOISleuth', version: applicationVersion }),
    workflow, audience: 'private' as const,
    configuration: Object.freeze({ digestSha256: configurationDigestSha256 }),
    artifacts: Object.freeze(artifacts),
    steps: Object.freeze(artifacts.map((artifact) => Object.freeze({
      sequence: artifact.sequence, artifactId: artifact.id, contentDigestSha256: artifact.contentDigestSha256,
      action: 'packaged' as const, occurredAt: generatedAt,
    }))),
    summary: Object.freeze({ artifactCount: artifacts.length, totalBytes }),
    limitations: Object.freeze([
      'Selected file bytes are unchanged and are not automatically redacted. Review their contents before sharing; original filenames and paths are not retained.',
      'Source identities, observation times and media types are declarations, not independently authenticated evidence. Missing source times remain unknown.',
      'Packaging events use the local clock. They do not establish earlier custody, a trusted timestamp, a signature, source accuracy or current validity.',
      'Digests establish content identity. JSON parsing and declared schema metadata do not establish that a source format is supported or its claims are true.',
    ]),
  });
  const manifest = Object.freeze({ ...unsigned, integrity: Object.freeze({
    algorithm: 'SHA-256' as const, canonicalization: SORTED_JSON_V2,
    digestSha256: await sha256ArtifactDigestV2(unsigned),
  }) });
  if (new TextEncoder().encode(canonicalArtifactJsonV2(manifest)).byteLength > MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES) throw new TypeError('Investigation manifest metadata exceeds its byte limit.');
  return Object.freeze({ manifest, contents: Object.freeze(selected.map((file) => file.bytes)) });
}

export async function buildInvestigationManifest(input: InvestigationManifestInput, generatedAt: string, applicationVersion: string) {
  return (await prepareInvestigationManifest(input, generatedAt, applicationVersion)).manifest;
}

export type InvestigationManifest = Awaited<ReturnType<typeof buildInvestigationManifest>>;
type PublicManifestArtifact = Omit<InvestigationManifest['artifacts'][number], 'mediaType' | 'source' | 'canonicalDigestSha256'> & Readonly<{ canonicalDigestSha256: string }>;
export type PublicInvestigationManifest = Omit<InvestigationManifest, 'version' | 'application' | 'audience' | 'artifacts' | 'steps'> & Readonly<{
  version: 2;
  application: Readonly<{ name: 'WHOISleuth CLI'; version: string }>;
  artifacts: readonly PublicManifestArtifact[];
  steps: readonly Omit<InvestigationManifest['steps'][number], 'action' | 'occurredAt'>[];
}>;
export type SupportedInvestigationManifest = InvestigationManifest | PublicInvestigationManifest;

export function validateInvestigationManifest(value: UnknownRecord): asserts value is UnknownRecord & SupportedInvestigationManifest {
  const version = integer(value.version, 'Investigation manifest version', 2, INVESTIGATION_MANIFEST_VERSION);
  const current = version === INVESTIGATION_MANIFEST_VERSION;
  const root = exact(value, ['schema', 'version', 'generatedAt', 'application', 'workflow', 'configuration', 'artifacts', 'steps', 'summary', 'limitations', 'integrity', ...(current ? ['audience'] : [])], 'Investigation manifest');
  if (root.schema !== INVESTIGATION_MANIFEST_SCHEMA) fail('Investigation manifest schema');
  iso(root.generatedAt, 'Investigation manifest generatedAt');
  const application = exact(root.application, ['name', 'version'], 'Investigation manifest application');
  if (application.name !== (current ? 'WHOISleuth' : 'WHOISleuth CLI')) fail('Investigation manifest application');
  normalizeBoundedSemanticVersion(application.version, 'Application');
  text(root.workflow, 'Investigation manifest workflow', 160);
  if (current && root.audience !== 'private') fail('Investigation manifest audience');
  const configuration = exact(root.configuration, ['digestSha256'], 'Investigation manifest configuration');
  if (configuration.digestSha256 !== null) digest(configuration.digestSha256, 'Investigation manifest configuration');
  const maximumFiles = current ? MAX_INVESTIGATION_MANIFEST_ARTIFACTS : 16;
  const maximumFileBytes = current ? MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES : 16 * 1024 * 1024;
  const maximumTotalBytes = current ? MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES : 32 * 1024 * 1024;
  const artifacts = array(root.artifacts, 'Investigation manifest artifacts', maximumFiles, 1);
  const steps = array(root.steps, 'Investigation manifest steps', maximumFiles, 1);
  if (steps.length !== artifacts.length) fail('Investigation manifest step count');
  let totalBytes = 0;
  for (const [index, candidate] of artifacts.entries()) {
    const item = exact(candidate, ['sequence', 'id', 'schema', 'version', 'byteLength', 'contentDigestSha256', 'canonicalDigestSha256', ...(current ? ['mediaType', 'source'] : [])], `Investigation manifest artifact ${index + 1}`);
    if (integer(item.sequence, 'Investigation manifest artifact sequence', 1, artifacts.length) !== index + 1 || item.id !== `artifact-${index + 1}`) fail('Investigation manifest artifact order');
    if (item.schema !== null) text(item.schema, 'Investigation manifest artifact schema', 160);
    if (item.version !== null) integer(item.version, 'Investigation manifest artifact version', 1, 1_000);
    totalBytes += integer(item.byteLength, 'Investigation manifest artifact bytes', 1, maximumFileBytes);
    digest(item.contentDigestSha256, 'Investigation manifest content digest');
    const mediaType = current ? enumeration(item.mediaType, INVESTIGATION_FILE_MEDIA_TYPES, 'Artefact media type') : 'application/json';
    if (mediaType === 'application/json') digest(item.canonicalDigestSha256, 'Investigation manifest canonical digest');
    else if (item.canonicalDigestSha256 !== null || item.schema !== null || item.version !== null) fail('Opaque artefact JSON metadata');
    if (current) {
      const source = exact(item.source, ['identity', 'observedAt'], 'Artefact source');
      if (source.identity !== null) text(source.identity, 'Artefact source identity', 240);
      iso(source.observedAt, 'Artefact source observation time', true);
    }
    const step = exact(steps[index], ['sequence', 'artifactId', 'contentDigestSha256', ...(current ? ['action', 'occurredAt'] : [])], `Investigation manifest step ${index + 1}`);
    if (step.sequence !== item.sequence || step.artifactId !== item.id || step.contentDigestSha256 !== item.contentDigestSha256) fail('Investigation manifest step linkage');
    if (current && (step.action !== 'packaged' || step.occurredAt !== root.generatedAt)) fail('Investigation manifest packaging event');
  }
  const summary = exact(root.summary, ['artifactCount', 'totalBytes'], 'Investigation manifest summary');
  if (integer(summary.artifactCount, 'Investigation manifest artifact count', 1, maximumFiles) !== artifacts.length
    || integer(summary.totalBytes, 'Investigation manifest total bytes', 1, maximumTotalBytes) !== totalBytes) fail('Investigation manifest summary');
  strings(root.limitations, 'Investigation manifest limitations', 8, 600);
  validateIntegrity(root.integrity, 'Investigation manifest integrity', root.version, version);
}

export async function readInvestigationManifest(raw: string): Promise<SupportedInvestigationManifest> {
  const value = parseBoundedJsonObject(raw, { label: 'Investigation manifest', maximumBytes: MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES });
  validateInvestigationManifest(value);
  const { integrity, ...unsigned } = value;
  if (await sha256ArtifactDigestV2(unsigned) !== integrity.digestSha256) throw new TypeError('Investigation manifest failed its integrity check.');
  return value;
}

export function formatInvestigationManifest(manifest: SupportedInvestigationManifest): string {
  const lines = ['Investigation manifest', `Workflow       ${manifest.workflow}`, `Tool version   ${manifest.application.version}`,
    `Artifacts      ${manifest.summary.artifactCount}`, `Total bytes    ${manifest.summary.totalBytes}`,
    `Configuration  ${manifest.configuration.digestSha256 ?? 'not supplied'}`, `Integrity      ${manifest.integrity.digestSha256}`, '', 'Ordered artefacts:'];
  for (const artifact of manifest.artifacts) lines.push(`  ${artifact.sequence}. ${artifact.schema ?? (artifact.canonicalDigestSha256 ? 'unversioned JSON' : 'opaque file')}${artifact.version ? ` v${artifact.version}` : ''} · ${artifact.contentDigestSha256}`);
  lines.push('', 'No source file paths or artefact contents are retained in this manifest.', '');
  return lines.join('\n');
}

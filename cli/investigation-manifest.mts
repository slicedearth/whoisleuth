import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  canonicalArtifactJson,
  sha256ArtifactDigest,
} from '../frontend/src/lib/analysis/artifact-integrity.ts';
import {
  requireBoundedString,
  requireIsoTimestamp,
} from '../lib/bounded-contract-normalizers.mts';

export const INVESTIGATION_MANIFEST_SCHEMA = 'whoisleuth.investigation-manifest';
export const INVESTIGATION_MANIFEST_VERSION = 1;
export const MAX_INVESTIGATION_MANIFEST_ARTIFACTS = 16;
export const MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES = 15 * 1024 * 1024;
export const MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES = 32 * 1024 * 1024;

const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;

type UnknownRecord = Record<string, unknown>;
export type InvestigationManifestArtifactInput = Readonly<{ content: string }>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function artifactVersion(value: UnknownRecord): number | null {
  const candidate = value.version ?? value.schemaVersion;
  return Number.isSafeInteger(candidate) && Number(candidate) > 0 && Number(candidate) <= 1_000
    ? Number(candidate)
    : null;
}

export async function buildInvestigationManifest(
  input: Readonly<{
    workflow: string;
    configurationDigestSha256: string | null;
    artifacts: readonly InvestigationManifestArtifactInput[];
  }>,
  generatedAtValue: string,
  applicationVersionValue: string,
) {
  if (!Array.isArray(input.artifacts)
    || input.artifacts.length < 1
    || input.artifacts.length > MAX_INVESTIGATION_MANIFEST_ARTIFACTS) {
    throw new TypeError(`A manifest requires between 1 and ${MAX_INVESTIGATION_MANIFEST_ARTIFACTS} JSON artefacts.`);
  }
  const generatedAt = requireIsoTimestamp(generatedAtValue, 'generatedAt');
  const workflow = requireBoundedString(input.workflow, 'workflow', 160);
  const applicationVersion = requireBoundedString(applicationVersionValue, 'applicationVersion', 40);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(applicationVersion)) {
    throw new TypeError('applicationVersion must be a semantic version.');
  }
  const configurationDigestSha256 = input.configurationDigestSha256;
  if (configurationDigestSha256 !== null && !SHA256_RE.test(configurationDigestSha256)) {
    throw new TypeError('configurationDigestSha256 must be a sha256: hexadecimal digest.');
  }
  let totalBytes = 0;
  const artifacts = input.artifacts.map((artifact, index) => {
    if (typeof artifact.content !== 'string') throw new TypeError(`Artifact ${index + 1} must be UTF-8 JSON text.`);
    const byteLength = Buffer.byteLength(artifact.content, 'utf8');
    totalBytes += byteLength;
    if (byteLength < 1 || byteLength > MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES) {
      throw new TypeError(`Artifact ${index + 1} must be between 1 byte and ${MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES} bytes.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(artifact.content);
    } catch {
      throw new TypeError(`Artifact ${index + 1} must be valid JSON.`);
    }
    const value = record(parsed);
    if (!value) throw new TypeError(`Artifact ${index + 1} must contain one JSON object.`);
    const schema = value.schema === undefined
      ? null
      : requireBoundedString(value.schema, `Artifact ${index + 1} schema`, 160);
    const canonical = canonicalArtifactJson(value);
    const contentDigestSha256 = digest(artifact.content);
    return Object.freeze({
      sequence: index + 1,
      id: `artifact-${index + 1}`,
      schema,
      version: artifactVersion(value),
      byteLength,
      contentDigestSha256,
      canonicalDigestSha256: digest(canonical),
    });
  });
  if (totalBytes > MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES) {
    throw new TypeError(`Manifest artefacts exceed the ${MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES}-byte combined limit.`);
  }
  const unsigned = Object.freeze({
    schema: INVESTIGATION_MANIFEST_SCHEMA,
    version: INVESTIGATION_MANIFEST_VERSION,
    generatedAt,
    application: Object.freeze({ name: 'WHOISleuth CLI', version: applicationVersion }),
    workflow,
    configuration: Object.freeze({ digestSha256: configurationDigestSha256 }),
    artifacts: Object.freeze(artifacts),
    steps: Object.freeze(artifacts.map((artifact) => Object.freeze({
      sequence: artifact.sequence,
      artifactId: artifact.id,
      contentDigestSha256: artifact.contentDigestSha256,
    }))),
    summary: Object.freeze({ artifactCount: artifacts.length, totalBytes }),
    limitations: Object.freeze([
      'The manifest records ordered content digests, schema metadata, tool version, and an optional configuration digest; it deliberately omits source file paths and content values.',
      'Reproduction still depends on access to the exact input artefacts, compatible source services, and any separately retained configuration represented by the supplied digest.',
      'Matching digests establish content identity, not the accuracy, provenance, or current validity of an observation.',
    ]),
  });
  return Object.freeze({
    ...unsigned,
    integrity: Object.freeze({ algorithm: 'SHA-256' as const, digestSha256: await sha256ArtifactDigest(unsigned) }),
  });
}

export function formatInvestigationManifest(
  manifest: Awaited<ReturnType<typeof buildInvestigationManifest>>,
): string {
  const lines = [
    'Investigation manifest',
    `Workflow       ${manifest.workflow}`,
    `Tool version   ${manifest.application.version}`,
    `Artifacts      ${manifest.summary.artifactCount}`,
    `Total bytes    ${manifest.summary.totalBytes}`,
    `Configuration  ${manifest.configuration.digestSha256 ?? 'not supplied'}`,
    `Integrity      ${manifest.integrity.digestSha256}`,
    '',
    'Ordered artefacts:',
  ];
  for (const artifact of manifest.artifacts) {
    lines.push(`  ${artifact.sequence}. ${artifact.schema ?? 'unversioned JSON'}${artifact.version ? ` v${artifact.version}` : ''} · ${artifact.contentDigestSha256}`);
  }
  lines.push('', 'No source file paths or artefact contents are retained in this manifest.', '');
  return lines.join('\n');
}

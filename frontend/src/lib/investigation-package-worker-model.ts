import { canonicalArtifactJsonV2 } from '../../../packages/evidence/artifact-integrity.mts';
import { buildInvestigationCapsule, serializeInvestigationCapsule } from '../../../packages/investigation/investigation-capsule.mts';
import { buildInvestigationPackage, inspectInvestigationPackage, MAX_INVESTIGATION_PACKAGE_BYTES } from '../../../packages/investigation/investigation-package.mts';
import { MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES, MAX_INVESTIGATION_MANIFEST_ARTIFACTS, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES, type InvestigationManifestArtifactInput } from '../../../packages/investigation/investigation-manifest.mts';

export type SelectedInvestigationFile = Readonly<{
  file: Blob;
  mediaType: NonNullable<InvestigationManifestArtifactInput['mediaType']>;
  source: NonNullable<InvestigationManifestArtifactInput['source']>;
}>;
type CapsuleInput = Parameters<typeof buildInvestigationCapsule>[0];
type BuildResult = Readonly<{ file: Blob; manifest: Awaited<ReturnType<typeof buildInvestigationPackage>>['manifest'] }>;
type Inspection = Awaited<ReturnType<typeof inspectInvestigationPackage>>;
export type BrowserInvestigationPackageReview = Omit<Inspection, 'contents'> & Readonly<{ contents: ReadonlyMap<string, Blob> }>;
export type InvestigationPackageInputs = {
  build: { files: readonly SelectedInvestigationFile[]; workflow: string; generatedAt: string; applicationVersion: string };
  capsule: { capsule: CapsuleInput; generatedAt: string };
  inspect: { file: Blob };
};
export type InvestigationPackageResults = { build: BuildResult; capsule: BuildResult; inspect: BrowserInvestigationPackageReview };
export type InvestigationPackageKind = keyof InvestigationPackageInputs;
export type InvestigationPackageRequest = { [Kind in InvestigationPackageKind]: { kind: Kind; input: InvestigationPackageInputs[Kind] } }[InvestigationPackageKind];
export type InvestigationPackageResponse = { [Kind in InvestigationPackageKind]: { kind: Kind; result: InvestigationPackageResults[Kind] } }[InvestigationPackageKind]
  | { kind: 'error'; detail: string };

function localBlob(bytes: Uint8Array, type: string): Blob {
  if (!(bytes.buffer instanceof ArrayBuffer)) throw new TypeError('Shared package memory is unsupported.');
  return new Blob([new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)], { type });
}

export function assertInvestigationFileSelection(files: readonly SelectedInvestigationFile[]): void {
  if (!Array.isArray(files) || !files.length || files.length > MAX_INVESTIGATION_MANIFEST_ARTIFACTS) throw new TypeError(`Select 1–${MAX_INVESTIGATION_MANIFEST_ARTIFACTS} files.`);
  let total = 0;
  for (const selected of files) {
    if (!(selected.file instanceof Blob) || !selected.file.size || selected.file.size > MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES) throw new TypeError(`Each selected file must contain 1 byte to ${MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES / 1024 / 1024} MiB.`);
    total += selected.file.size;
    if (total > MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES) throw new TypeError(`Selected files exceed ${MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES / 1024 / 1024} MiB in total.`);
  }
}

export async function runInvestigationPackageOperation(request: InvestigationPackageRequest): Promise<InvestigationPackageResponse> {
  try {
    if (!request?.input) throw new TypeError('Missing package input.');
    if (request.kind === 'inspect') {
      const file = request.input.file;
      if (!(file instanceof Blob) || file.size < 22 || file.size > MAX_INVESTIGATION_PACKAGE_BYTES) throw new TypeError('The selected package exceeds its input limit.');
      const inspected = await inspectInvestigationPackage(new Uint8Array(await file.arrayBuffer()));
      const contents = new Map<string, Blob>();
      for (const entry of inspected.entries) {
        const bytes = inspected.contents.get(entry.entry.id);
        if (bytes) contents.set(entry.entry.id, localBlob(bytes, 'application/octet-stream'));
      }
      return { kind: 'inspect', result: { ...inspected, contents } };
    }
    if (request.kind === 'build') {
      const { files, workflow, generatedAt, applicationVersion } = request.input;
      assertInvestigationFileSelection(files);
      const artifacts: InvestigationManifestArtifactInput[] = [];
      for (const selected of files) artifacts.push({ content: new Uint8Array(await selected.file.arrayBuffer()), mediaType: selected.mediaType, source: selected.source });
      const built = await buildInvestigationPackage({ workflow, configurationDigestSha256: null, artifacts }, generatedAt, applicationVersion);
      return { kind: 'build', result: { file: localBlob(built.bytes, 'application/zip'), manifest: built.manifest } };
    }
    if (request.kind === 'capsule') {
      const { capsule: input, generatedAt } = request.input;
      const capsule = await buildInvestigationCapsule({ ...input, generatedAt });
      const built = await buildInvestigationPackage({ workflow: 'Lookup evidence handoff', configurationDigestSha256: null, artifacts: [
        { content: serializeInvestigationCapsule(capsule), source: { identity: 'Investigation capsule', observedAt: null } },
        { content: `${canonicalArtifactJsonV2(input.lookupEvidence)}\n`, source: { identity: 'Lookup evidence export', observedAt: null } },
      ] }, generatedAt, input.applicationVersion);
      const inspected = await inspectInvestigationPackage(built.bytes);
      if (!inspected.identityVerified || inspected.links.length !== 1 || inspected.links[0]?.state !== 'linked') throw new TypeError('The capsule does not match the selected Lookup source.');
      return { kind: 'capsule', result: { file: localBlob(built.bytes, 'application/zip'), manifest: built.manifest } };
    }
    throw new TypeError('Unsupported package operation.');
  } catch {
    return { kind: 'error', detail: 'The evidence package could not be prepared or verified. Check the file sizes, declared source times and supported manifest format. No saved records were changed.' };
  }
}

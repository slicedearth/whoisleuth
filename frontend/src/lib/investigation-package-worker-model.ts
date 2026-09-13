import { canonicalArtifactJsonV2, sha256ArtifactBytes } from '../../../packages/evidence/artifact-integrity.mts';
import { buildInvestigationCapsule, serializeInvestigationCapsule } from '../../../packages/investigation/investigation-capsule.mts';
import { buildInvestigationPackage, inspectInvestigationPackage, inspectInvestigationPackageEntries, prepareInvestigationPackageEntries, investigationPackagePath, INVESTIGATION_PACKAGE_MANIFEST_PATH, MAX_INVESTIGATION_PACKAGE_ENTRIES } from '../../../packages/investigation/investigation-package.mts';
import { MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES, MAX_INVESTIGATION_MANIFEST_ARTIFACTS, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES, MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES, type InvestigationManifestArtifactInput } from '../../../packages/investigation/investigation-manifest.mts';
import { parseBoundedJson } from '../../../lib/bounded-json.mts';
import { MAX_WEB_CAPTURE_MANIFEST_BYTES } from '../../../packages/contracts/web-capture.mts';
import { readWebCaptureManifest, matchCaptureArtifacts, type CaptureArtifactMatch } from '../../../packages/interchange/web-capture-import.mts';
import { MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES, hasEncryptedInvestigationPackagePrefix } from '../../../packages/contracts/investigation-package-limits.mts';
import { decryptInvestigationPackage, encryptInvestigationPackage } from '../../../packages/investigation/investigation-package-crypto.mts';

export type SelectedInvestigationFile = Readonly<{
  file: Blob;
  mediaType: NonNullable<InvestigationManifestArtifactInput['mediaType']>;
  source: NonNullable<InvestigationManifestArtifactInput['source']>;
}>;
type CapsuleInput = Parameters<typeof buildInvestigationCapsule>[0];
type BuildResult = Readonly<{ file: Blob; manifest: Awaited<ReturnType<typeof buildInvestigationPackage>>['manifest'] }>;
export type InvestigationFolderFile = Readonly<{ path: string; file: Blob }>;
export type BrowserInvestigationFolder = Readonly<{ files: readonly InvestigationFolderFile[]; manifest: BuildResult['manifest'] }>;
type Inspection = Awaited<ReturnType<typeof inspectInvestigationPackage>>;
export type BrowserInvestigationPackageReview = Omit<Inspection, 'contents'> & Readonly<{ contents: ReadonlyMap<string, Blob>; encryption: 'verified' | 'not_applicable' }>;
export type BrowserCaptureAttachmentReview = ReturnType<typeof readWebCaptureManifest> & Readonly<{
  matches: readonly CaptureArtifactMatch[];
  contents: ReadonlyMap<string, Blob>;
  unusedIds: readonly string[];
}>;
export type InvestigationPackageInputs = {
  build: { files: readonly SelectedInvestigationFile[]; workflow: string; generatedAt: string; applicationVersion: string; passphrase?: string };
  folder: Omit<InvestigationPackageInputs['build'], 'passphrase'>;
  capsule: { capsule: CapsuleInput; generatedAt: string; passphrase?: string };
  inspect: { file: Blob; passphrase?: string };
  inspectFolder: { files: readonly InvestigationFolderFile[] };
  capture: { manifest: Blob; files: readonly Blob[] };
};
export type InvestigationPackageResults = { build: BuildResult; folder: BrowserInvestigationFolder; capsule: BuildResult; inspect: BrowserInvestigationPackageReview; inspectFolder: BrowserInvestigationPackageReview; capture: BrowserCaptureAttachmentReview };
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

export function assertInvestigationFolderSelection(files: readonly InvestigationFolderFile[]): void {
  if (!Array.isArray(files) || files.length < 2 || files.length > MAX_INVESTIGATION_PACKAGE_ENTRIES) throw new TypeError('Evidence folder has an invalid entry count.');
  const paths = new Set<string>(); let total = 0;
  for (const item of files) {
    const name = investigationPackagePath(item.path), manifest = name === INVESTIGATION_PACKAGE_MANIFEST_PATH;
    if (paths.has(name)) throw new TypeError('Evidence folder contains a duplicate path.');
    paths.add(name);
    const maximum = manifest ? MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES : MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES;
    if (!(item.file instanceof Blob) || !item.file.size || item.file.size > maximum) throw new TypeError('Evidence folder entry exceeds its byte limit.');
    if (!manifest) { total += item.file.size; if (total > MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES) throw new TypeError('Evidence folder exceeds its combined byte limit.'); }
  }
  if (!paths.has(INVESTIGATION_PACKAGE_MANIFEST_PATH)) throw new TypeError('Evidence folder is missing its manifest.');
}

export async function runInvestigationPackageOperation(request: InvestigationPackageRequest): Promise<InvestigationPackageResponse> {
  try {
    if (!request?.input) throw new TypeError('Missing package input.');
    if (request.kind === 'capture') {
      const { manifest, files } = request.input;
      if (!(manifest instanceof Blob) || !manifest.size || manifest.size > MAX_WEB_CAPTURE_MANIFEST_BYTES) throw new TypeError('Capture manifest exceeds its input limit.');
      if (!Array.isArray(files) || files.length > MAX_INVESTIGATION_MANIFEST_ARTIFACTS) throw new TypeError('Too many capture attachment files.');
      assertInvestigationFileSelection(files.map(file => ({ file, mediaType: 'application/octet-stream', source: { identity: null, observedAt: null } })));
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(await manifest.arrayBuffer());
      const parsed = readWebCaptureManifest(parseBoundedJson(decoded, { label: 'Capture manifest', maximumBytes: MAX_WEB_CAPTURE_MANIFEST_BYTES }));
      const candidates: Array<{ id: string; bytes: number; sha256: string }> = [];
      for (const [index, file] of files.entries()) candidates.push({ id: `file-${index + 1}`, bytes: file.size,
        sha256: await sha256ArtifactBytes(new Uint8Array(await file.arrayBuffer())) });
      const matches = matchCaptureArtifacts(parsed.artifacts, candidates);
      const used = new Set(matches.flatMap(match => match.matchingIds));
      return { kind: 'capture', result: { ...parsed, matches,
        contents: new Map(candidates.filter(candidate => used.has(candidate.id)).map(candidate => [candidate.id, files[Number(candidate.id.slice(5)) - 1]!])),
        unusedIds: candidates.filter(candidate => !used.has(candidate.id)).map(candidate => candidate.id),
      } };
    }
    if (request.kind === 'inspect' || request.kind === 'inspectFolder') {
      let inspected: Inspection;
      let encryption: BrowserInvestigationPackageReview['encryption'] = 'not_applicable';
      if (request.kind === 'inspectFolder') {
        assertInvestigationFolderSelection(request.input.files);
        const selected = request.input.files.map(item => ({ path: item.path, file: item.file }));
        const files = new Map<string, Uint8Array>();
        for (const item of selected) files.set(item.path, new Uint8Array(await item.file.arrayBuffer()));
        inspected = await inspectInvestigationPackageEntries(files);
      } else {
        const file = request.input.file;
        if (!(file instanceof Blob) || file.size < 22 || file.size > MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES) throw new TypeError('The selected package exceeds its input limit.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (hasEncryptedInvestigationPackagePrefix(bytes)) {
          if (typeof request.input.passphrase !== 'string') throw new TypeError('A package passphrase is required.');
          const decrypted = await decryptInvestigationPackage(bytes, request.input.passphrase);
          inspected = decrypted.review;
          decrypted.bytes.fill(0);
          encryption = 'verified';
        } else {
          if (request.input.passphrase !== undefined) throw new TypeError('The package is not encrypted.');
          inspected = await inspectInvestigationPackage(bytes);
        }
      }
      const contents = new Map<string, Blob>();
      for (const entry of inspected.entries) {
        const bytes = inspected.contents.get(entry.entry.id);
        if (bytes) contents.set(entry.entry.id, localBlob(bytes, 'application/octet-stream'));
      }
      return { kind: request.kind, result: { ...inspected, contents, encryption } };
    }
    if (request.kind === 'build' || request.kind === 'folder') {
      const { files, workflow, generatedAt, applicationVersion } = request.input;
      assertInvestigationFileSelection(files);
      const selection = files.map(item => ({ file: item.file, mediaType: item.mediaType, source: { ...item.source } }));
      const artifacts: InvestigationManifestArtifactInput[] = [];
      for (const selected of selection) artifacts.push({ content: new Uint8Array(await selected.file.arrayBuffer()), mediaType: selected.mediaType, source: selected.source });
      if (request.kind === 'folder') {
        if ('passphrase' in request.input) throw new TypeError('Folder exports are not encrypted.');
        const prepared = await prepareInvestigationPackageEntries({ workflow, configurationDigestSha256: null, artifacts }, generatedAt, applicationVersion);
        return { kind: 'folder', result: { manifest: prepared.manifest, files: [...prepared.files].map(([path, bytes]) => ({ path, file: localBlob(bytes, 'application/octet-stream') })) } };
      }
      const built = await buildInvestigationPackage({ workflow, configurationDigestSha256: null, artifacts }, generatedAt, applicationVersion);
      const encrypted = typeof request.input.passphrase === 'string';
      const bytes = encrypted ? await encryptInvestigationPackage(built.bytes, request.input.passphrase!) : built.bytes;
      return { kind: 'build', result: { file: localBlob(bytes, encrypted ? 'application/octet-stream' : 'application/zip'), manifest: built.manifest } };
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
      const encrypted = typeof request.input.passphrase === 'string';
      const bytes = encrypted ? await encryptInvestigationPackage(built.bytes, request.input.passphrase!) : built.bytes;
      return { kind: 'capsule', result: { file: localBlob(bytes, encrypted ? 'application/octet-stream' : 'application/zip'), manifest: built.manifest } };
    }
    throw new TypeError('Unsupported package operation.');
  } catch {
    const unlocking = request?.kind === 'inspect' && typeof request.input?.passphrase === 'string';
    return { kind: 'error', detail: unlocking
      ? 'The package could not be unlocked and verified. Check the passphrase and file integrity. No saved records were changed.'
      : 'The evidence package could not be prepared or verified. Check the file sizes, passphrase, declared source times and supported manifest format. No saved records were changed.' };
  }
}

import { Gunzip, UnzipInflate, unzipSync } from 'fflate';

import {
  EXTERNAL_FINDINGS_SCHEMA,
  EXTERNAL_FINDINGS_VERSION,
  parseExternalFindingsDocument,
} from './external-findings-import.ts';
import {
  MAX_WARC_IMPORT_BYTES,
  parseWarcEvidenceArchive,
  type WarcImportReport,
} from './warc-evidence-import.ts';

export const MAX_WACZ_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_WACZ_ENTRIES = 128;
export const MAX_WACZ_WARC_RESOURCES = 8;
export const MAX_WACZ_MANIFEST_BYTES = 256 * 1024;
export const MAX_WACZ_DECLARED_BYTES = 64 * 1024 * 1024;

export type WaczImportReport = Readonly<{
  document: WarcImportReport['document'];
  archiveDigestSha256: string;
  manifestDigest: 'verified' | 'missing';
  resourcesVerified: number;
  zipEntries: number;
  warcResources: number;
  records: number;
  responses: number;
  accepted: number;
  excluded: number;
  exclusions: readonly string[];
}>;

type WaczResource = Readonly<{
  path: string;
  bytes: number;
  digestSha256: string;
}>;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const SHA256_RE = /^sha256:([a-f0-9]{64})$/iu;
const WACZ_VERSION_RE = /^1\.(?:0|1)(?:\.\d+)?$/u;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeZipPath(value: string): boolean {
  if (
    !value
    || value.length > 240
    || CONTROL_RE.test(value)
    || value.includes('\\')
    || value.startsWith('/')
    || /^[a-z]:/iu.test(value)
    || value.includes('//')
  ) {
    return false;
  }
  const segments = value.endsWith('/') ? value.slice(0, -1).split('/') : value.split('/');
  return segments.every((segment) => (
    Boolean(segment)
    && segment !== '.'
    && segment !== '..'
    && !FORBIDDEN_PATH_SEGMENTS.has(segment.toLowerCase())
  ));
}

function isWarcResourcePath(value: string): boolean {
  return /^archive\/[^/]{1,180}\.warc(?:\.gz)?$/iu.test(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Browser cryptography is unavailable for WACZ integrity verification.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function decodeJson(bytes: Uint8Array, label: string): unknown {
  if (!bytes.byteLength || bytes.byteLength > MAX_WACZ_MANIFEST_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_WACZ_MANIFEST_BYTES}-byte manifest bound.`);
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function parseResource(value: unknown, index: number): WaczResource | null {
  if (!isRecord(value)) {
    throw new Error(`WACZ manifest resource ${index + 1} is not an object.`);
  }
  const path = value.path;
  const bytes = value.bytes;
  const hash = value.hash;
  if (typeof path !== 'string' || !safeZipPath(path)) {
    throw new Error(`WACZ manifest resource ${index + 1} has an unsafe or invalid path.`);
  }
  if (!Number.isSafeInteger(bytes) || Number(bytes) < 0 || Number(bytes) > MAX_WACZ_DECLARED_BYTES) {
    throw new Error(`WACZ manifest resource ${index + 1} has invalid or excessive declared bytes.`);
  }
  if (!isWarcResourcePath(path)) return null;
  const digestMatch = typeof hash === 'string' ? SHA256_RE.exec(hash) : null;
  if (!digestMatch?.[1]) {
    throw new Error(`WACZ WARC resource ${index + 1} does not declare a supported SHA-256 digest.`);
  }
  return Object.freeze({
    path,
    bytes: Number(bytes),
    digestSha256: digestMatch[1].toLowerCase(),
  });
}

function parseManifest(bytes: Uint8Array): readonly WaczResource[] {
  const value = decodeJson(bytes, 'WACZ datapackage.json');
  if (!isRecord(value) || value.profile !== 'data-package') {
    throw new Error('WACZ datapackage.json does not declare the data-package profile.');
  }
  if (typeof value.wacz_version !== 'string' || !WACZ_VERSION_RE.test(value.wacz_version)) {
    throw new Error('WACZ datapackage.json does not declare a supported WACZ 1.x version.');
  }
  if (!Array.isArray(value.resources) || !value.resources.length || value.resources.length > MAX_WACZ_ENTRIES) {
    throw new Error(`WACZ datapackage.json must declare between 1 and ${MAX_WACZ_ENTRIES} resources.`);
  }
  const seen = new Set<string>();
  const resources: WaczResource[] = [];
  for (const [index, item] of value.resources.entries()) {
    const parsed = parseResource(item, index);
    const path = isRecord(item) && typeof item.path === 'string' ? item.path : '';
    const canonicalPath = path.toLowerCase();
    if (seen.has(canonicalPath)) {
      throw new Error('WACZ datapackage.json repeats a resource path.');
    }
    seen.add(canonicalPath);
    if (parsed) resources.push(parsed);
  }
  if (!resources.length || resources.length > MAX_WACZ_WARC_RESOURCES) {
    throw new Error(`WACZ imports require between 1 and ${MAX_WACZ_WARC_RESOURCES} bounded WARC resources.`);
  }
  return Object.freeze(resources);
}

async function verifyManifestDigest(
  manifest: Uint8Array,
  digestBytes: Uint8Array | undefined,
): Promise<'verified' | 'missing'> {
  if (!digestBytes) return 'missing';
  const value = decodeJson(digestBytes, 'WACZ datapackage-digest.json');
  if (!isRecord(value) || value.path !== 'datapackage.json') {
    throw new Error('WACZ datapackage-digest.json does not reference datapackage.json.');
  }
  const match = typeof value.hash === 'string' ? SHA256_RE.exec(value.hash) : null;
  if (!match?.[1]) {
    throw new Error('WACZ datapackage-digest.json does not declare a supported SHA-256 digest.');
  }
  if (await sha256Hex(manifest) !== match[1].toLowerCase()) {
    throw new Error('WACZ datapackage.json does not match its declared digest.');
  }
  return 'verified';
}

function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function gunzipBounded(input: Uint8Array, remainingBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const gunzip = new Gunzip((chunk) => {
      total += chunk.byteLength;
      if (total > remainingBytes) {
        throw new Error(`Expanded WARC data exceeds the ${MAX_WARC_IMPORT_BYTES}-byte import bound.`);
      }
      chunks.push(chunk.slice());
    });
    gunzip.push(input, true);
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('import bound')) throw cause;
    throw new Error('A compressed WACZ WARC resource could not be safely decompressed.');
  }
  if (!total) throw new Error('A compressed WACZ WARC resource was empty.');
  return concatBytes(chunks, total);
}

function unpackSelectedEntries(bytes: Uint8Array): Readonly<{
  files: Readonly<Record<string, Uint8Array>>;
  zipEntries: number;
}> {
  let zipEntries = 0;
  let declaredBytes = 0;
  let selectedBytes = 0;
  const seen = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        zipEntries += 1;
        if (zipEntries > MAX_WACZ_ENTRIES) {
          throw new Error(`WACZ imports are limited to ${MAX_WACZ_ENTRIES} ZIP entries.`);
        }
        if (!safeZipPath(file.name)) throw new Error('The WACZ contains an unsafe ZIP path.');
        const canonicalName = file.name.toLowerCase();
        if (seen.has(canonicalName)) throw new Error('The WACZ repeats a ZIP entry path.');
        seen.add(canonicalName);
        if (
          !Number.isSafeInteger(file.originalSize)
          || file.originalSize < 0
          || !Number.isSafeInteger(file.size)
          || file.size < 0
        ) {
          throw new Error('The WACZ contains invalid ZIP size metadata.');
        }
        declaredBytes += file.originalSize;
        if (declaredBytes > MAX_WACZ_DECLARED_BYTES) {
          throw new Error(`WACZ declared content exceeds the ${MAX_WACZ_DECLARED_BYTES}-byte bound.`);
        }
        const selected = (
          canonicalName === 'datapackage.json'
          || canonicalName === 'datapackage-digest.json'
          || isWarcResourcePath(file.name)
        );
        if (!selected) return false;
        if (![0, UnzipInflate.compression].includes(file.compression)) {
          throw new Error('A required WACZ entry uses an unsupported ZIP compression method.');
        }
        selectedBytes += file.originalSize;
        if (selectedBytes > MAX_WACZ_IMPORT_BYTES + (2 * MAX_WACZ_MANIFEST_BYTES)) {
          throw new Error('Selected WACZ entries exceed the bounded extraction allowance.');
        }
        return true;
      },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('WACZ')) throw cause;
    if (cause instanceof Error && cause.message.startsWith('The WACZ')) throw cause;
    if (cause instanceof Error && cause.message.startsWith('A required')) throw cause;
    if (cause instanceof Error && cause.message.startsWith('Selected')) throw cause;
    throw new Error('The selected WACZ is not a supported, intact ZIP archive.');
  }
  return Object.freeze({ files: Object.freeze(files), zipEntries });
}

export async function parseWaczEvidenceArchive(
  input: ArrayBuffer,
  fileName = 'evidence.wacz',
): Promise<WaczImportReport> {
  if (!input.byteLength || input.byteLength > MAX_WACZ_IMPORT_BYTES) {
    throw new Error(`WACZ imports must be between 1 byte and ${MAX_WACZ_IMPORT_BYTES} bytes.`);
  }
  if (!fileName.toLowerCase().endsWith('.wacz')) {
    throw new Error('Portable WACZ import accepts .wacz files only.');
  }

  const archiveBytes = new Uint8Array(input);
  const archiveDigestSha256 = await sha256Hex(archiveBytes);
  const { files, zipEntries } = unpackSelectedEntries(archiveBytes);
  const manifest = files['datapackage.json'];
  if (!manifest) throw new Error('The WACZ does not contain a root datapackage.json manifest.');
  const resources = parseManifest(manifest);
  const manifestDigest = await verifyManifestDigest(manifest, files['datapackage-digest.json']);
  const declaredPaths = new Set(resources.map((resource) => resource.path));
  const extractedWarcPaths = Object.keys(files).filter(isWarcResourcePath);
  if (
    extractedWarcPaths.length !== resources.length
    || extractedWarcPaths.some((path) => !declaredPaths.has(path))
  ) {
    throw new Error('The WACZ contains a WARC resource that is not uniquely declared in its manifest.');
  }

  const warcChunks: Uint8Array[] = [];
  let warcBytes = 0;
  for (const [index, resource] of resources.entries()) {
    const data = files[resource.path];
    if (!data) throw new Error(`WACZ WARC resource ${index + 1} is missing from the ZIP archive.`);
    if (data.byteLength !== resource.bytes) {
      throw new Error(`WACZ WARC resource ${index + 1} does not match its declared byte length.`);
    }
    if (await sha256Hex(data) !== resource.digestSha256) {
      throw new Error(`WACZ WARC resource ${index + 1} does not match its declared SHA-256 digest.`);
    }
    const warc = resource.path.toLowerCase().endsWith('.gz')
      ? gunzipBounded(data, MAX_WARC_IMPORT_BYTES - warcBytes)
      : data;
    warcBytes += warc.byteLength;
    if (warcBytes > MAX_WARC_IMPORT_BYTES) {
      throw new Error(`Expanded WARC data exceeds the ${MAX_WARC_IMPORT_BYTES}-byte import bound.`);
    }
    warcChunks.push(warc);
  }

  const warcInput = concatBytes(warcChunks, warcBytes);
  const warcBuffer: ArrayBuffer = warcInput.slice().buffer;
  const warcReport = await parseWarcEvidenceArchive(
    warcBuffer,
    'wacz-evidence.warc',
  );
  const packageLimitation = manifestDigest === 'verified'
    ? 'The WACZ manifest digest and each selected WARC resource SHA-256 digest were verified before normalization.'
    : 'Each selected WARC resource SHA-256 digest was verified; the optional WACZ manifest digest was not present.';
  const document = parseExternalFindingsDocument({
    schema: EXTERNAL_FINDINGS_SCHEMA,
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: {
      name: 'Portable WACZ evidence',
      reference: `urn:sha256:${archiveDigestSha256}`,
      collectedAt: warcReport.document.source.collectedAt,
    },
    findings: warcReport.document.findings.map((finding) => ({
      ...finding,
      limitations: [...finding.limitations, packageLimitation],
      reference: `urn:sha256:${archiveDigestSha256}`,
    })),
  });

  return Object.freeze({
    document,
    archiveDigestSha256,
    manifestDigest,
    resourcesVerified: resources.length,
    zipEntries,
    warcResources: resources.length,
    records: warcReport.records,
    responses: warcReport.responses,
    accepted: document.findings.length,
    excluded: warcReport.excluded,
    exclusions: warcReport.exclusions,
  });
}

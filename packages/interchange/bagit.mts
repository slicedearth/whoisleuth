import { zipSync } from 'fflate';
import { extractBoundedZipEntries } from './bounded-zip-extraction.mts';
import {
  MAX_INVESTIGATION_MANIFEST_ARTIFACTS, MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES,
  MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES, MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES,
} from '../contracts/investigation-package-limits.mts';

// Payload admission follows selected evidence files. Separate tag and path
// bounds limit metadata parsing and directory work, not the BagIt specification.
export const MAX_BAGIT_PAYLOAD_FILES = MAX_INVESTIGATION_MANIFEST_ARTIFACTS;
export const MAX_BAGIT_PAYLOAD_BYTES = MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES;
export const MAX_BAGIT_FILE_BYTES = MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES;
export const MAX_BAGIT_TAG_FILES = 32;
export const MAX_BAGIT_TAG_BYTES = MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES;
export const MAX_BAGIT_TOTAL_TAG_BYTES = 4 * MAX_BAGIT_TAG_BYTES;
export const MAX_BAGIT_PATH_BYTES = 1024;
export const MAX_BAGIT_DEPTH = 16;
export const MAX_BAGIT_FILES = MAX_BAGIT_PAYLOAD_FILES + MAX_BAGIT_TAG_FILES;
export const MAX_BAGIT_ENTRIES = MAX_BAGIT_FILES * (MAX_BAGIT_DEPTH + 1);
export const MAX_BAGIT_ZIP_BYTES = MAX_BAGIT_PAYLOAD_BYTES + MAX_BAGIT_TOTAL_TAG_BYTES
  + MAX_BAGIT_ENTRIES * (76 + 2 * MAX_BAGIT_PATH_BYTES) + 65_557;

export type BagItAlgorithm = 'sha256' | 'sha512';
export type BagItFileState = 'verified' | 'mismatch' | 'missing' | 'unverified';
export type BagItReview = Readonly<{
  version: '1.0'; state: 'valid' | 'incomplete' | 'invalid' | 'unsupported';
  complete: boolean; checksumsVerified: boolean;
  algorithms: readonly BagItAlgorithm[]; unsupportedManifests: number;
  payloadBytes: number; tagFiles: number; verifiedTagFiles: number;
  fetchEntries: number; fetchMissing: number;
  entries: readonly Readonly<{ id: string; byteLength: number | null; state: BagItFileState }>[];
  issues: readonly string[];
}>;

export class UnsupportedBagItError extends TypeError {}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const order = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const payloadManifest = /^manifest-([a-z0-9]{1,32})\.txt$/u;
const tagManifest = /^tagmanifest-([a-z0-9]{1,32})\.txt$/u;

/** A deliberately portable path profile; no path is silently rewritten. */
export function bagItPath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > MAX_BAGIT_PATH_BYTES
    || encoder.encode(value).byteLength > MAX_BAGIT_PATH_BYTES
    || decoder.decode(encoder.encode(value)) !== value || /[\x00-\x1f\x7f\\:<>"|?*]/u.test(value)) {
    throw new TypeError('BagIt contains an unsupported or unsafe path.');
  }
  const parts = (value.endsWith('/') ? value.slice(0, -1) : value).split('/');
  if (parts[0]?.startsWith(' ') || parts.length > MAX_BAGIT_DEPTH || parts.some(part => !part || part === '.' || part === '..'
    || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    throw new TypeError('BagIt contains an unsupported or unsafe path.');
  }
  return value;
}

export function bagItEntryMaximum(path: string): number {
  bagItPath(path);
  return path.endsWith('/') ? 0 : path.startsWith('data/') ? MAX_BAGIT_FILE_BYTES : MAX_BAGIT_TAG_BYTES;
}

/** Validate metadata before file reads or allocation; directories end in '/'. */
function admission() {
  const names = new Map<string, boolean>(), directories = new Set<string>(), spelling = new Map<string, string>();
  let files = 0, tags = 0, payloadBytes = 0, tagBytes = 0, count = 0;
  return (entry: Readonly<{ path: string; byteLength: number }>) => {
    if (++count > MAX_BAGIT_ENTRIES) throw new TypeError('BagIt exceeds its entry limit.');
    const path = bagItPath(entry.path), directory = path.endsWith('/');
    const raw = directory ? path.slice(0, -1) : path, key = raw.normalize('NFC').toLowerCase();
    if (names.has(key) || (!directory && directories.has(key))) throw new TypeError('BagIt contains colliding paths.');
    names.set(key, directory);
    const parts = raw.split('/');
    while (parts.length) {
      const parent = parts.join('/'), normal = parent.normalize('NFC').toLowerCase();
      if (spelling.has(normal) && spelling.get(normal) !== parent) throw new TypeError('BagIt contains colliding path spellings.');
      spelling.set(normal, parent);
      if (parent !== raw || directory) {
        if (names.get(normal) === false) throw new TypeError('BagIt contains a file-directory collision.');
        directories.add(normal);
      }
      parts.pop();
    }
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 || entry.byteLength > bagItEntryMaximum(path)) throw new TypeError('BagIt entry exceeds its byte limit.');
    if (directory) return;
    if (path === 'data') throw new TypeError('BagIt data must be a directory.');
    if (path.startsWith('data/')) { files++; payloadBytes += entry.byteLength; }
    else { tags++; tagBytes += entry.byteLength; }
    if (files > MAX_BAGIT_PAYLOAD_FILES || tags > MAX_BAGIT_TAG_FILES
      || payloadBytes > MAX_BAGIT_PAYLOAD_BYTES || tagBytes > MAX_BAGIT_TOTAL_TAG_BYTES) throw new TypeError('BagIt exceeds its file or combined byte limit.');
  };
}

export function assertBagItSelection(entries: readonly Readonly<{ path: string; byteLength: number }>[]): void {
  if (!Array.isArray(entries) || entries.length > MAX_BAGIT_ENTRIES) throw new TypeError('BagIt exceeds its entry limit.');
  const admit = admission();
  for (const entry of entries) admit(entry);
}

function capture(input: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  if (!(input instanceof Map) || input.size > MAX_BAGIT_ENTRIES) throw new TypeError('BagIt requires bounded selected file entries.');
  const entries = [...input].map(([path, bytes]) => {
    if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer)) throw new TypeError('BagIt requires non-shared file bytes.');
    return { path, byteLength: bytes.byteLength };
  });
  assertBagItSelection(entries);
  return new Map([...input].map(([path, bytes]) => [path, new Uint8Array(bytes)]));
}

function lines(bytes: Uint8Array): string[] {
  const text = decoder.decode(bytes);
  if (text.startsWith('\uFEFF') || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) throw new TypeError('BagIt text tags must be UTF-8 without a byte-order mark or control characters.');
  const result = text.split(/\r\n|\r|\n/u);
  if (result.at(-1) === '') result.pop();
  return result;
}

function manifestPath(value: string): string {
  // RFC 8493 escapes only percent, CR and LF, not URL path separators.
  if (/%(?!25|0[dDaA])/u.test(value)) throw new TypeError('BagIt manifest contains an unsupported path escape.');
  return bagItPath(value.replace(/%(25|0d|0a)/giu, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16))));
}

type Manifest = Readonly<{ name: string; algorithm: BagItAlgorithm | null; rows: ReadonlyMap<string, string> }>;
function readManifest(name: string, bytes: Uint8Array, tag: boolean, resolvePath: (value: string) => string): Manifest {
  const code = (tag ? tagManifest : payloadManifest).exec(name)?.[1];
  const algorithm = code === 'sha256' || code === 'sha512' ? code : null;
  const rows = new Map<string, string>();
  for (const line of lines(bytes)) {
    const match = /^([a-fA-F0-9]{1,512})[ \t]+(.+)$/u.exec(line);
    if (!match || (algorithm && match[1]!.length !== (algorithm === 'sha256' ? 64 : 128))) throw new TypeError('BagIt manifest has an invalid checksum line.');
    const path = resolvePath(manifestPath(match[2]!));
    if (path.endsWith('/') || (tag ? path.startsWith('data/') || tagManifest.test(path) : !path.startsWith('data/')) || rows.has(path)) throw new TypeError('BagIt manifest has a duplicate or misplaced entry.');
    if (rows.size >= (tag ? MAX_BAGIT_TAG_FILES : MAX_BAGIT_PAYLOAD_FILES)) throw new TypeError('BagIt manifest exceeds its entry limit.');
    rows.set(path, match[1]!.toLowerCase());
  }
  return { name, algorithm, rows };
}

async function checksum(bytes: Uint8Array, algorithm: BagItAlgorithm): Promise<string> {
  if (!(bytes.buffer instanceof ArrayBuffer)) throw new TypeError('BagIt requires non-shared bytes.');
  const digest = await crypto.subtle.digest(algorithm === 'sha256' ? 'SHA-256' : 'SHA-512', new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function readFetch(bytes: Uint8Array | undefined, resolvePath: (value: string) => string): ReadonlyMap<string, number | null> {
  const entries = new Map<string, number | null>();
  if (!bytes) return entries;
  for (const line of lines(bytes)) {
    const match = /^([a-z][a-z0-9+.-]*:[^\s]{1,8192})[ \t]+(-|[0-9]{1,16})[ \t]+(.+)$/iu.exec(line);
    if (!match) throw new TypeError('BagIt fetch declaration is malformed.');
    const uri = match[1]!;
    if (/[^a-zA-Z0-9._~:/?\[\]@!$&'()*+,;=%-]/u.test(uri) || /%(?![a-fA-F0-9]{2})/u.test(uri)) throw new TypeError('BagIt fetch declaration requires an absolute URI without a fragment.');
    try { new URL(uri); } catch { throw new TypeError('BagIt fetch declaration requires a valid absolute URI.'); }
    const path = resolvePath(manifestPath(match[3]!));
    const size = match[2] === '-' ? null : Number(match[2]);
    if (!path.startsWith('data/') || path.endsWith('/') || entries.has(path) || entries.size >= MAX_BAGIT_PAYLOAD_FILES
      || (size !== null && !Number.isSafeInteger(size))) throw new TypeError('BagIt fetch declaration is invalid.');
    // The URI is deliberately neither retained nor dereferenced.
    entries.set(path, size);
  }
  return entries;
}

function payloadOxum(bytes: Uint8Array | undefined): string | null {
  if (!bytes) return null;
  let current: { name: string; value: string } | null = null;
  let oxum: string | null = null;
  const finish = () => {
    if (current?.name !== 'payload-oxum') return;
    if (oxum !== null || !/^[0-9]{1,16}\.[0-9]{1,16}$/u.test(current.value)) throw new TypeError('BagIt payload size declaration is invalid or repeated.');
    oxum = current.value;
  };
  for (const line of lines(bytes)) {
    if (/^[ \t]/u.test(line)) {
      if (!current) throw new TypeError('BagIt metadata continuation has no field.');
      current.value += ` ${line.trim()}`;
    } else {
      finish();
      const match = /^([^:]+):[ \t](.*)$/u.exec(line);
      if (!match || match[1] !== match[1]!.trim()) throw new TypeError('BagIt metadata field is malformed.');
      current = { name: match[1]!.toLowerCase(), value: match[2]! };
    }
  }
  finish(); return oxum;
}

/** Checks every declared checksum. Payload content is never interpreted. */
export async function inspectBagItEntries(input: ReadonlyMap<string, Uint8Array>): Promise<Readonly<{ review: BagItReview; contents: ReadonlyMap<string, Uint8Array>; inputBytes: number }>> {
  const files = capture(input), declaration = files.get('bagit.txt');
  if (!declaration) throw new TypeError('BagIt declaration is missing.');
  const declared = lines(declaration);
  if (declared.length !== 2 || !/^BagIt-Version: [0-9]+\.[0-9]+$/u.test(declared[0]!) || !/^Tag-File-Character-Encoding: .+$/u.test(declared[1]!)) throw new TypeError('BagIt declaration is malformed.');
  if (declared[0] !== 'BagIt-Version: 1.0' || declared[1]!.toLowerCase() !== 'tag-file-character-encoding: utf-8') throw new UnsupportedBagItError('Only BagIt 1.0 with UTF-8 text tags is supported.');
  if (!files.has('data/') && ![...files.keys()].some(path => path.startsWith('data/'))) throw new TypeError('BagIt payload directory is missing.');
  // Admission has already refused ambiguous normalised names. This unique NFC
  // fallback accommodates filesystems that change Unicode normalisation.
  const normalisedPaths = new Map([...files.keys()].map(path => [path.normalize('NFC'), path]));
  const resolvePath = (path: string) => files.has(path) ? path : normalisedPaths.get(path.normalize('NFC')) ?? path.normalize('NFC');
  const manifests = [...files].filter(([name]) => payloadManifest.test(name)).map(([name, bytes]) => readManifest(name, bytes, false, resolvePath));
  const tagManifests = [...files].filter(([name]) => tagManifest.test(name)).map(([name, bytes]) => readManifest(name, bytes, true, resolvePath));
  if (!manifests.length) throw new TypeError('BagIt requires a payload manifest.');
  const payload = [...files.keys()].filter(path => path.startsWith('data/') && !path.endsWith('/'));
  const required = new Set(manifests.flatMap(manifest => [...manifest.rows.keys()]));
  if (required.size > MAX_BAGIT_PAYLOAD_FILES) throw new TypeError('BagIt exceeds its declared payload limit.');
  const issues = new Set<string>();
  if (manifests.some(manifest => required.size !== manifest.rows.size || [...required].some(path => !manifest.rows.has(path)))) issues.add('Payload manifests disagree about file membership.');
  if (payload.some(path => !required.has(path))) issues.add('A payload file is absent from the payload manifests.');
  if (tagManifests.some(manifest => manifests.some(payload => !manifest.rows.has(payload.name)))) issues.add('A tag manifest does not list every payload manifest.');
  const fetch = readFetch(files.get('fetch.txt'), resolvePath);
  if ([...fetch.keys()].some(path => manifests.some(manifest => !manifest.rows.has(path)))) issues.add('A fetch entry is absent from a payload manifest.');
  if ([...fetch].some(([path, size]) => size !== null && files.has(path) && files.get(path)!.byteLength !== size)) issues.add('A present payload does not match its fetch byte declaration.');
  const missingTags = tagManifests.some(manifest => [...manifest.rows.keys()].some(path => !files.has(path)));
  const filesPresent = !missingTags && [...required].every(path => files.has(path));
  const payloadBytes = payload.reduce((sum, path) => sum + files.get(path)!.byteLength, 0);
  const oxum = payloadOxum(files.get('bag-info.txt'));
  if (filesPresent && oxum !== null && oxum.split('.').map(Number).join('.') !== `${payloadBytes}.${payload.length}`) issues.add('Payload-Oxum does not match the selected payload.');
  const complete = filesPresent && issues.size === 0;
  const digests = new Map<string, string>();
  const tagStates = new Map<string, BagItFileState>();
  const states = new Map<string, BagItFileState>([...new Set([...required, ...payload])].sort(order).map(path => [path, files.has(path) ? 'verified' : 'missing']));
  for (const manifest of [...manifests, ...tagManifests]) {
    for (const [path, expected] of manifest.rows) {
      const bytes = files.get(path);
      if (!bytes) continue;
      const targetStates = path.startsWith('data/') ? states : tagStates;
      if (!targetStates.has(path)) targetStates.set(path, 'verified');
      if (!manifest.algorithm) { if (targetStates.get(path) === 'verified') targetStates.set(path, 'unverified'); continue; }
      const key = `${manifest.algorithm}:${path}`;
      const actual = digests.get(key) ?? await checksum(bytes, manifest.algorithm);
      digests.set(key, actual);
      if (actual !== expected) {
        issues.add('A declared checksum does not match its selected file.');
        targetStates.set(path, 'mismatch');
      }
    }
  }
  for (const path of payload) if (!required.has(path)) states.set(path, 'unverified');
  const unsupportedManifests = [...manifests, ...tagManifests].filter(manifest => !manifest.algorithm).length;
  const state = issues.size ? 'invalid' : !complete ? 'incomplete' : unsupportedManifests ? 'unsupported' : 'valid';
  const contents = new Map<string, Uint8Array>();
  const entries = [...states].map(([path, entryState], index) => {
    const id = `artifact-${index + 1}`, bytes = files.get(path);
    if (bytes && entryState === 'verified' && state === 'valid') contents.set(id, bytes);
    return { id, byteLength: bytes?.byteLength ?? null, state: entryState };
  });
  return { review: {
    version: '1.0', state, complete, checksumsVerified: state === 'valid',
    algorithms: [...new Set([...manifests, ...tagManifests].flatMap(manifest => manifest.algorithm ? [manifest.algorithm] : []))].sort(order),
    unsupportedManifests, payloadBytes, tagFiles: [...files.keys()].filter(path => !path.startsWith('data/') && !path.endsWith('/')).length,
    verifiedTagFiles: [...tagStates.values()].filter(state => state === 'verified').length, fetchEntries: fetch.size, fetchMissing: [...fetch.keys()].filter(path => !files.has(path)).length,
    entries, issues: [...issues],
  }, contents, inputBytes: [...files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0) };
}

export function encodeBagItEntries(input: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const files = capture(input);
  const bytes = zipSync(Object.fromEntries([...files].sort(([left], [right]) => order(left, right))), { level: 0, mtime: new Date(1980, 0, 1) });
  if (bytes.byteLength > MAX_BAGIT_ZIP_BYTES) throw new TypeError('BagIt ZIP exceeds its byte limit.');
  return bytes;
}

export function readBagItZip(input: Uint8Array): ReadonlyMap<string, Uint8Array> {
  if (!(input instanceof Uint8Array) || !(input.buffer instanceof ArrayBuffer) || input.byteLength < 22 || input.byteLength > MAX_BAGIT_ZIP_BYTES) throw new TypeError('BagIt ZIP requires bounded non-shared input bytes.');
  const admit = admission();
  return extractBoundedZipEntries(input, {
    keyForName: bagItPath, maximumEntries: MAX_BAGIT_ENTRIES,
    maximumSelectedBytes: MAX_BAGIT_PAYLOAD_BYTES + MAX_BAGIT_TOTAL_TAG_BYTES,
    selectedBytesExceededMessage: 'BagIt exceeds its combined byte limit.', metadataMismatchMessage: 'BagIt ZIP metadata or CRC is invalid.',
    inspect(entry, metadata) {
      if (metadata.kind === 'special' || (metadata.kind === 'directory' && !entry.name.endsWith('/'))
        || (metadata.kind === 'file' && entry.name.endsWith('/'))) throw new TypeError('BagIt ZIP entries must be ordinary files or directories, not symbolic links or special files.');
      admit({ path: entry.name, byteLength: entry.originalSize });
      return { key: entry.name, selected: true, maximumBytes: bagItEntryMaximum(entry.name), exceededMessage: 'BagIt entry exceeds its byte limit.' };
    },
  }).files;
}

/** Creates SHA-512 by default; SHA-256 is also interoperable. */
export async function prepareBagItEntries(payload: ReadonlyMap<string, Uint8Array>, tags: ReadonlyMap<string, Uint8Array> = new Map(), algorithm: BagItAlgorithm = 'sha512'): Promise<ReadonlyMap<string, Uint8Array>> {
  if (algorithm !== 'sha256' && algorithm !== 'sha512') throw new UnsupportedBagItError('BagIt creation supports SHA-256 or SHA-512.');
  if (!(payload instanceof Map) || payload.size > MAX_BAGIT_PAYLOAD_FILES || !(tags instanceof Map) || tags.size > MAX_BAGIT_TAG_FILES - 4) throw new TypeError('BagIt creation exceeds its file limit.');
  const files = new Map<string, Uint8Array>([['data/', new Uint8Array()]]);
  for (const [path, bytes] of payload) {
    if (!bagItPath(path).startsWith('data/') || path.endsWith('/')) throw new TypeError('BagIt payload paths must be files below data/.');
    files.set(path, bytes);
  }
  for (const [path, bytes] of tags) {
    if (path.startsWith('data/') || path.endsWith('/') || ['bagit.txt', 'bag-info.txt', 'fetch.txt'].includes(path) || payloadManifest.test(path) || tagManifest.test(path)) throw new TypeError('BagIt additional tag conflicts with a format-owned file.');
    files.set(path, bytes);
  }
  files.set('bagit.txt', encoder.encode('BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n'));
  files.set('bag-info.txt', encoder.encode(`Payload-Oxum: ${[...payload.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0)}.${payload.size}\n`));
  const owned = capture(files);
  const manifest: string[] = [];
  for (const path of [...payload.keys()].sort(order)) manifest.push(`${await checksum(owned.get(path)!, algorithm)}  ${path.replaceAll('%', '%25')}`);
  owned.set(`manifest-${algorithm}.txt`, encoder.encode(manifest.length ? `${manifest.join('\n')}\n` : ''));
  const tagRows: string[] = [];
  for (const [path, bytes] of [...owned].sort(([left], [right]) => order(left, right))) if (!path.startsWith('data/')) tagRows.push(`${await checksum(bytes, algorithm)}  ${path.replaceAll('%', '%25')}`);
  owned.set(`tagmanifest-${algorithm}.txt`, encoder.encode(`${tagRows.join('\n')}\n`));
  assertBagItSelection([...owned].map(([path, bytes]) => ({ path, byteLength: bytes.byteLength })));
  return owned;
}

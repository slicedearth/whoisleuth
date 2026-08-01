import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import { hammingDistanceHex, imagePerceptualHash } from '../../lib/perceptual-hash.mts';
import {
  MAX_CAPTURE_HOSTS,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
} from './capture.mts';

export const WEB_CAPTURE_COMPARISON_SCHEMA = 'whoisleuth.web-capture-comparison';
export const WEB_CAPTURE_COMPARISON_VERSION = 1;
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_DOM_DIGEST_BYTES = 1024 * 1024;
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

const SHA256_RE = /^[a-f0-9]{64}$/iu;
const PERCEPTUAL_HASH_RE = /^[a-f0-9]{16}$/iu;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const ROOT_KEYS = new Set(['schema', 'schemaVersion', 'source', 'captures']);
const CAPTURE_KEYS = new Set(['domain', 'capturedAt', 'completeness', 'limitations', 'page', 'requestDomains', 'technologies', 'artifacts']);
const PAGE_KEYS = new Set(['title', 'finalOrigin']);
const ARTIFACT_KEYS = new Set(['kind', 'fileName', 'mimeType', 'sha256', 'perceptualHash', 'bytes', 'width', 'height']);
const DOM_ROOT_KEYS = new Set(['schema', 'version', 'capturedAt', 'domain', 'counts', 'structure', 'visibleText', 'limitations']);
const COUNT_KEYS = new Set(['elements', 'forms', 'controls', 'scripts', 'images']);
const STRUCTURE_KEYS = new Set(['algorithm', 'value', 'truncated']);
const TEXT_KEYS = new Set(['algorithm', 'value', 'bytes', 'truncated']);

type UnknownRecord = Record<string, unknown>;
type CompareOutput = 'json' | 'terminal';
type CompareArguments = Readonly<{ leftManifest: string; rightManifest: string; output: CompareOutput }>;
type Artifact = Readonly<{
  kind: 'screenshot' | 'dom_digest';
  fileName: string;
  mimeType: string;
  sha256: string;
  perceptualHash: string | null;
  bytes: number;
}>;
type CaptureManifest = Readonly<{
  manifestPath: string;
  domain: string;
  capturedAt: string;
  completeness: 'complete' | 'partial';
  title: string | null;
  finalOrigin: string | null;
  requestDomains: string[];
  technologies: string[];
  screenshot: Artifact;
  domDigest: Artifact;
}>;
type DomDigest = Readonly<{
  domain: string;
  counts: Readonly<Record<'elements' | 'forms' | 'controls' | 'scripts' | 'images', number>>;
  structure: Readonly<{ value: string; truncated: boolean }>;
  visibleText: Readonly<{ value: string; bytes: number; truncated: boolean }>;
}>;
type LoadedCapture = Readonly<{
  manifest: CaptureManifest;
  dom: DomDigest;
  screenshotHashVerified: boolean;
  screenshotPerceptualHashVerified: boolean;
  domHashVerified: boolean;
}>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function onlyKeys(value: UnknownRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(value: unknown, maximum: number, label: string, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || CONTROL_RE.test(value)) {
    throw new Error(`${label} must be bounded text without control characters.`);
  }
  return value.replace(/\s+/gu, ' ').trim();
}

function boundedPath(value: unknown, label: string): string {
  const candidate = boundedText(value, 2048, label);
  return path.resolve(candidate ?? '');
}

function artifactName(value: unknown, label: string): string {
  const candidate = boundedText(value, 120, label) ?? '';
  if (candidate === '.' || candidate === '..' || candidate.includes('/') || candidate.includes('\\')) {
    throw new Error(`${label} must be a plain file name.`);
  }
  return candidate;
}

function positiveInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum) {
    throw new Error(`${label} is outside the supported bound.`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`${label} is outside the supported bound.`);
  }
  return Number(value);
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) throw new Error(`${label} must be SHA-256.`);
  return value.toLowerCase();
}

function timestamp(value: unknown, label: string): string {
  const candidate = boundedText(value, 64, label) ?? '';
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return parsed.toISOString();
}

function captureDomain(value: unknown, label: string): string {
  const candidate = (boundedText(value, 253, label) ?? '').toLowerCase().replace(/\.$/u, '');
  const unbracketed = candidate.startsWith('[') && candidate.endsWith(']') ? candidate.slice(1, -1) : candidate;
  if (isIP(unbracketed)) return candidate;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(candidate)) {
    throw new Error(`${label} must be a normalized hostname or IP address.`);
  }
  return candidate;
}

function stringList(value: unknown, maximum: number, label: string): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} exceeds its item bound.`);
  const output = new Set<string>();
  for (const item of value) output.add(captureDomain(item, label));
  return [...output].sort();
}

function technologyList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error(`${label} exceeds its item bound.`);
  const output = new Set<string>();
  for (const item of value) {
    const candidate = boundedText(item, 80, label);
    if (candidate) output.add(candidate);
  }
  return [...output].sort();
}

function origin(value: unknown, label: string): string | null {
  const candidate = boundedText(value, 500, label, true);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error();
    return parsed.origin.toLowerCase();
  } catch {
    throw new Error(`${label} must be one HTTP(S) origin without credentials, path, query, or fragment.`);
  }
}

function parseArtifact(value: unknown, label: string): Artifact {
  const artifact = record(value);
  if (!artifact || !onlyKeys(artifact, ARTIFACT_KEYS)) throw new Error(`${label} contains unsupported fields.`);
  const kind = artifact.kind === 'screenshot' || artifact.kind === 'dom_digest' ? artifact.kind : null;
  if (!kind) throw new Error(`${label} has an unsupported kind.`);
  const maximum = kind === 'screenshot' ? MAX_SCREENSHOT_BYTES : MAX_DOM_DIGEST_BYTES;
  const mimeType = boundedText(artifact.mimeType, 80, `${label} MIME type`)?.toLowerCase() ?? '';
  if ((kind === 'screenshot' && mimeType !== 'image/png') || (kind === 'dom_digest' && mimeType !== 'application/json')) {
    throw new Error(`${label} has an unsupported MIME type.`);
  }
  const perceptualHash = artifact.perceptualHash == null
    ? null
    : typeof artifact.perceptualHash === 'string' && PERCEPTUAL_HASH_RE.test(artifact.perceptualHash)
      ? artifact.perceptualHash.toLowerCase()
      : (() => { throw new Error(`${label} has an invalid perceptual hash.`); })();
  if (kind === 'dom_digest' && perceptualHash) throw new Error(`${label} cannot include a perceptual hash.`);
  return {
    kind,
    fileName: artifactName(artifact.fileName, `${label} file name`),
    mimeType,
    sha256: digest(artifact.sha256, `${label} digest`),
    perceptualHash,
    bytes: positiveInteger(artifact.bytes, maximum, `${label} size`),
  };
}

function parseManifest(value: unknown, manifestPath: string): CaptureManifest {
  const root = record(value);
  if (!root || !onlyKeys(root, ROOT_KEYS) || root.schema !== WEB_CAPTURE_MANIFEST_SCHEMA
    || root.schemaVersion !== WEB_CAPTURE_MANIFEST_VERSION || !Array.isArray(root.captures) || root.captures.length !== 1) {
    throw new Error(`Rendered comparison requires one ${WEB_CAPTURE_MANIFEST_SCHEMA} version ${WEB_CAPTURE_MANIFEST_VERSION} capture.`);
  }
  const capture = record(root.captures[0]);
  if (!capture || !onlyKeys(capture, CAPTURE_KEYS)) throw new Error('Rendered capture contains unsupported fields.');
  const completeness = capture.completeness === 'complete' || capture.completeness === 'partial'
    ? capture.completeness
    : (() => { throw new Error('Rendered capture completeness must be complete or partial.'); })();
  const page = record(capture.page);
  if (!page || !onlyKeys(page, PAGE_KEYS)) throw new Error('Rendered capture page metadata is invalid.');
  if (!Array.isArray(capture.artifacts) || capture.artifacts.length !== 2) {
    throw new Error('Rendered capture must contain one screenshot and one DOM digest artifact.');
  }
  const artifacts = capture.artifacts.map((artifact, index) => parseArtifact(artifact, `Rendered capture artifact ${index + 1}`));
  const screenshot = artifacts.find((artifact) => artifact.kind === 'screenshot');
  const domDigest = artifacts.find((artifact) => artifact.kind === 'dom_digest');
  if (!screenshot || !domDigest) throw new Error('Rendered capture must contain distinct screenshot and DOM digest artifacts.');
  return {
    manifestPath,
    domain: captureDomain(capture.domain, 'Rendered capture domain'),
    capturedAt: timestamp(capture.capturedAt, 'Rendered capture time'),
    completeness,
    title: boundedText(page.title, 300, 'Rendered capture title', true),
    finalOrigin: origin(page.finalOrigin, 'Rendered capture final origin'),
    requestDomains: stringList(capture.requestDomains, MAX_CAPTURE_HOSTS, 'Rendered capture request domains'),
    technologies: technologyList(capture.technologies, 'Rendered capture technologies'),
    screenshot,
    domDigest,
  };
}

function parseDomDigest(value: unknown, expectedDomain: string): DomDigest {
  const root = record(value);
  if (!root || !onlyKeys(root, DOM_ROOT_KEYS) || root.schema !== 'whoisleuth.dom-digest' || root.version !== 1) {
    throw new Error('Rendered DOM digest uses an unsupported schema.');
  }
  const domain = captureDomain(root.domain, 'Rendered DOM digest domain');
  if (domain !== expectedDomain) throw new Error('Rendered DOM digest domain does not match its manifest.');
  timestamp(root.capturedAt, 'Rendered DOM digest time');
  const counts = record(root.counts);
  const structure = record(root.structure);
  const visibleText = record(root.visibleText);
  if (!counts || !onlyKeys(counts, COUNT_KEYS) || !structure || !onlyKeys(structure, STRUCTURE_KEYS)
    || !visibleText || !onlyKeys(visibleText, TEXT_KEYS)) throw new Error('Rendered DOM digest contains unsupported fields.');
  if (structure.algorithm !== 'sha256' || visibleText.algorithm !== 'sha256') {
    throw new Error('Rendered DOM digest uses an unsupported digest algorithm.');
  }
  return {
    domain,
    counts: {
      elements: nonNegativeInteger(counts.elements, 20_000, 'Rendered element count'),
      forms: nonNegativeInteger(counts.forms, 20_000, 'Rendered form count'),
      controls: nonNegativeInteger(counts.controls, 20_000, 'Rendered control count'),
      scripts: nonNegativeInteger(counts.scripts, 20_000, 'Rendered script count'),
      images: nonNegativeInteger(counts.images, 20_000, 'Rendered image count'),
    },
    structure: { value: digest(structure.value, 'Rendered structure digest'), truncated: structure.truncated === true },
    visibleText: {
      value: digest(visibleText.value, 'Rendered visible-text digest'),
      bytes: nonNegativeInteger(visibleText.bytes, 256 * 1024, 'Rendered visible-text byte count'),
      truncated: visibleText.truncated === true,
    },
  };
}

async function boundedFile(filePath: string, maximumBytes: number, expectedBytes: number | null, label: string): Promise<Buffer> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new Error(`${label} must be a regular bounded file.`);
  }
  if (expectedBytes !== null && metadata.size !== expectedBytes) throw new Error(`${label} size does not match its manifest.`);
  const value = await readFile(filePath);
  if (value.length !== metadata.size) throw new Error(`${label} changed while it was being read.`);
  return value;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function loadCapture(manifestPath: string): Promise<LoadedCapture> {
  const bytes = await boundedFile(manifestPath, MAX_MANIFEST_BYTES, null, 'Rendered capture manifest');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Rendered capture manifest is not valid JSON.');
  }
  const manifest = parseManifest(parsed, manifestPath);
  const directory = path.dirname(manifestPath);
  const screenshotBytes = await boundedFile(path.join(directory, manifest.screenshot.fileName), MAX_SCREENSHOT_BYTES, manifest.screenshot.bytes, 'Rendered screenshot');
  const domBytes = await boundedFile(path.join(directory, manifest.domDigest.fileName), MAX_DOM_DIGEST_BYTES, manifest.domDigest.bytes, 'Rendered DOM digest');
  const screenshotHashVerified = sha256(screenshotBytes) === manifest.screenshot.sha256;
  const screenshotPerceptualHashVerified = imagePerceptualHash(screenshotBytes) === manifest.screenshot.perceptualHash;
  const domHashVerified = sha256(domBytes) === manifest.domDigest.sha256;
  if (!screenshotHashVerified || !screenshotPerceptualHashVerified || !domHashVerified) {
    throw new Error('Rendered capture artifact integrity verification failed.');
  }
  let domValue: unknown;
  try {
    domValue = JSON.parse(domBytes.toString('utf8'));
  } catch {
    throw new Error('Rendered DOM digest is not valid JSON.');
  }
  return { manifest, dom: parseDomDigest(domValue, manifest.domain), screenshotHashVerified, screenshotPerceptualHashVerified, domHashVerified };
}

function setComparison(left: readonly string[], right: readonly string[]) {
  const shared = left.filter((value) => right.includes(value));
  if (!left.length && !right.length) return { state: 'not_observed' as const, leftCount: 0, rightCount: 0, sharedCount: 0, shared: [] };
  const equal = left.length === right.length && shared.length === left.length;
  return {
    state: equal ? 'same' as const : shared.length ? 'overlap' as const : 'different' as const,
    leftCount: left.length,
    rightCount: right.length,
    sharedCount: shared.length,
    shared,
  };
}

function scalarComparison(left: string | null, right: string | null) {
  if (!left && !right) return { state: 'not_observed' as const, left, right };
  if (!left || !right) return { state: 'unavailable' as const, left, right };
  return { state: left === right ? 'same' as const : 'different' as const, left, right };
}

export async function compareRenderedCaptures(
  leftPath: string,
  rightPath: string,
  generatedAt = new Date().toISOString(),
) {
  const leftManifest = boundedPath(leftPath, 'Left capture manifest');
  const rightManifest = boundedPath(rightPath, 'Right capture manifest');
  if (leftManifest === rightManifest) throw new Error('Rendered comparison requires two different manifest files.');
  const [left, right] = await Promise.all([loadCapture(leftManifest), loadCapture(rightManifest)]);
  const exactScreenshot = left.manifest.screenshot.sha256 === right.manifest.screenshot.sha256;
  const screenshotDistance = hammingDistanceHex(left.manifest.screenshot.perceptualHash, right.manifest.screenshot.perceptualHash);
  const screenshotNear = screenshotDistance !== null && screenshotDistance <= 6;
  const partial = left.manifest.completeness !== 'complete' || right.manifest.completeness !== 'complete'
    || left.dom.structure.truncated || right.dom.structure.truncated || left.dom.visibleText.truncated || right.dom.visibleText.truncated;
  const countComparison = (key: keyof DomDigest['counts']) => ({
    left: left.dom.counts[key],
    right: right.dom.counts[key],
    delta: right.dom.counts[key] - left.dom.counts[key],
  });
  return {
    schema: WEB_CAPTURE_COMPARISON_SCHEMA,
    version: WEB_CAPTURE_COMPARISON_VERSION,
    generatedAt: timestamp(generatedAt, 'Rendered comparison generation time'),
    left: { domain: left.manifest.domain, capturedAt: left.manifest.capturedAt, completeness: left.manifest.completeness },
    right: { domain: right.manifest.domain, capturedAt: right.manifest.capturedAt, completeness: right.manifest.completeness },
    partial,
    integrity: {
      left: { screenshot: left.screenshotHashVerified, perceptualHash: left.screenshotPerceptualHashVerified, domDigest: left.domHashVerified },
      right: { screenshot: right.screenshotHashVerified, perceptualHash: right.screenshotPerceptualHashVerified, domDigest: right.domHashVerified },
    },
    screenshot: {
      state: exactScreenshot ? 'same' : screenshotDistance === null ? 'unavailable' : screenshotNear ? 'overlap' : 'different',
      method: exactScreenshot ? 'Exact SHA-256 equality' : screenshotDistance === null ? 'Perceptual hash unavailable' : '64-bit dHash distance',
      hammingDistance: screenshotDistance,
      agreementPercent: screenshotDistance === null ? null : Math.round(((64 - screenshotDistance) / 64) * 100),
    },
    renderedDom: {
      structure: {
        state: left.dom.structure.value === right.dom.structure.value ? 'same' : 'different',
        leftTruncated: left.dom.structure.truncated,
        rightTruncated: right.dom.structure.truncated,
      },
      visibleText: {
        state: left.dom.visibleText.value === right.dom.visibleText.value ? 'same' : 'different',
        leftBytes: left.dom.visibleText.bytes,
        rightBytes: right.dom.visibleText.bytes,
        leftTruncated: left.dom.visibleText.truncated,
        rightTruncated: right.dom.visibleText.truncated,
      },
      counts: {
        elements: countComparison('elements'),
        forms: countComparison('forms'),
        controls: countComparison('controls'),
        scripts: countComparison('scripts'),
        images: countComparison('images'),
      },
    },
    page: {
      title: scalarComparison(left.manifest.title, right.manifest.title),
      finalOrigin: scalarComparison(left.manifest.finalOrigin, right.manifest.finalOrigin),
      requestDomains: setComparison(left.manifest.requestDomains, right.manifest.requestDomains),
      technologies: setComparison(left.manifest.technologies, right.manifest.technologies),
    },
    limitations: [
      'This offline comparison verifies and reads only two selected local capture packages; it makes no network request.',
      'Screenshot perceptual proximity is a review lead and does not establish copying, ownership, control, intent, safety, or maliciousness.',
      'Rendered DOM and visible-text digests report exact equality only; a difference does not quantify how much content changed.',
      'Blocked or truncated capture activity remains partial and is never interpreted as observed absence.',
    ],
  };
}

export function parseCaptureCompareArguments(argv: readonly string[]): CompareArguments {
  const inputs: string[] = [];
  let output: CompareOutput = 'terminal';
  for (const argument of argv) {
    if (argument === '--json') output = 'json';
    else if (argument.startsWith('-')) throw new Error(`Unknown rendered comparison option "${argument}".`);
    else inputs.push(argument);
  }
  if (inputs.length !== 2) throw new Error('Usage: whoisleuth-capture compare <left-manifest.json> <right-manifest.json> [--json]');
  return { leftManifest: boundedPath(inputs[0], 'Left capture manifest'), rightManifest: boundedPath(inputs[1], 'Right capture manifest'), output };
}

export function formatRenderedCaptureComparison(document: Awaited<ReturnType<typeof compareRenderedCaptures>>): string {
  const requestDomains = document.page.requestDomains;
  const lines = [
    'Rendered capture comparison',
    `Left              ${document.left.domain} · ${document.left.completeness}`,
    `Right             ${document.right.domain} · ${document.right.completeness}`,
    `Evidence          ${document.partial ? 'Partial' : 'Complete'}`,
    '',
    `Screenshot        ${document.screenshot.state}${document.screenshot.agreementPercent === null ? '' : ` · ${document.screenshot.agreementPercent}% bit agreement`}`,
    `DOM structure     ${document.renderedDom.structure.state}`,
    `Visible text      ${document.renderedDom.visibleText.state}`,
    `Page title        ${document.page.title.state}`,
    `Final origin      ${document.page.finalOrigin.state}`,
    `Request domains   ${requestDomains.state} · ${requestDomains.sharedCount} shared`,
    `Technologies      ${document.page.technologies.state}`,
    '',
    'Rendered counts (left → right)',
    ...Object.entries(document.renderedDom.counts).map(([key, value]) => `  ${key.padEnd(10)} ${value.left} → ${value.right} (${value.delta >= 0 ? '+' : ''}${value.delta})`),
    '',
    'Limitations:',
    ...document.limitations.map((limitation) => `  - ${limitation}`),
  ];
  return `${lines.join('\n')}\n`;
}

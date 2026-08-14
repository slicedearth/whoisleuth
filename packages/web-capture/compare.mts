import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';

import { hammingDistanceHex, inspectDecodedImage } from '../../lib/perceptual-hash.mts';
import { isValidAsciiHostname } from '../../lib/hostname.mts';
import { decodeBoundedUtf8, readBoundedRegularFile } from '../../lib/bounded-file.mts';
import { parseBoundedJson } from '../../lib/bounded-json.mts';
import { normalizeExplicitIsoTimestamp } from '../../lib/observation.mts';
import {
  MAX_WEB_CAPTURE_MANIFEST_BYTES,
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_DOM_ELEMENTS,
  MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
  MAX_WEB_CAPTURE_VISIBLE_TEXT_BYTES,
  WEB_CAPTURE_COMPARISON_SCHEMA,
  WEB_CAPTURE_COMPARISON_VERSION,
  WEB_CAPTURE_DOM_DIGEST_SCHEMA,
  WEB_CAPTURE_DOM_DIGEST_VERSION,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
} from '../../lib/web-capture-contract.mts';
import { MAX_CAPTURE_HOSTS, hasTerminalUnsafeCharacters } from './capture.mts';

export { WEB_CAPTURE_COMPARISON_SCHEMA, WEB_CAPTURE_COMPARISON_VERSION } from '../../lib/web-capture-contract.mts';
export const MAX_MANIFEST_BYTES = MAX_WEB_CAPTURE_MANIFEST_BYTES;
export const MAX_DOM_DIGEST_BYTES = MAX_WEB_CAPTURE_DOM_DIGEST_BYTES;
export const MAX_SCREENSHOT_BYTES = MAX_WEB_CAPTURE_SCREENSHOT_BYTES;

const SHA256_RE = /^[a-f0-9]{64}$/iu;
const PERCEPTUAL_HASH_RE = /^[a-f0-9]{16}$/iu;
const ROOT_KEYS = new Set(['schema', 'schemaVersion', 'source', 'captures']);
const SOURCE_KEYS = new Set(['name', 'reference', 'collectedAt']);
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
  width: number | null;
  height: number | null;
}>;
type CaptureManifest = Readonly<{
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
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || hasTerminalUnsafeCharacters(value)) {
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

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) throw new Error(`${label} must be SHA-256.`);
  return value.toLowerCase();
}

function timestamp(value: unknown, label: string): string {
  const candidate = boundedText(value, 64, label) ?? '';
  const normalized = normalizeExplicitIsoTimestamp(candidate);
  if (!normalized) throw new Error(`${label} must be a valid date and time with an explicit timezone.`);
  return normalized;
}

function captureDomain(value: unknown, label: string): string {
  const candidate = (boundedText(value, 253, label) ?? '').toLowerCase().replace(/\.$/u, '');
  const unbracketed = candidate.startsWith('[') && candidate.endsWith(']') ? candidate.slice(1, -1) : candidate;
  if (isIP(unbracketed)) return candidate;
  if (!isValidAsciiHostname(candidate, { requireDot: false, requireLowercase: true })) {
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

function limitationList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new Error(`${label} must contain between 1 and 8 bounded statements.`);
  }
  return value.map((item, index) => boundedText(item, 300, `${label} ${index + 1}`) ?? '');
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
  if (kind === 'dom_digest'
    && (Object.hasOwn(artifact, 'perceptualHash') || Object.hasOwn(artifact, 'width') || Object.hasOwn(artifact, 'height'))) {
    throw new Error(`${label} cannot include image-only fields.`);
  }
  const perceptualHash = artifact.perceptualHash == null
    ? null
    : typeof artifact.perceptualHash === 'string' && PERCEPTUAL_HASH_RE.test(artifact.perceptualHash)
      ? artifact.perceptualHash.toLowerCase()
      : (() => { throw new Error(`${label} has an invalid perceptual hash.`); })();
  const width = kind === 'screenshot' ? positiveInteger(artifact.width, 10_000, `${label} width`) : null;
  const height = kind === 'screenshot' ? positiveInteger(artifact.height, 10_000, `${label} height`) : null;
  return {
    kind,
    fileName: artifactName(artifact.fileName, `${label} file name`),
    mimeType,
    sha256: digest(artifact.sha256, `${label} digest`),
    perceptualHash,
    bytes: positiveInteger(artifact.bytes, maximum, `${label} size`),
    width,
    height,
  };
}

function parseManifest(value: unknown): CaptureManifest {
  const root = record(value);
  if (!root || !onlyKeys(root, ROOT_KEYS) || root.schema !== WEB_CAPTURE_MANIFEST_SCHEMA
    || root.schemaVersion !== WEB_CAPTURE_MANIFEST_VERSION || !Array.isArray(root.captures) || root.captures.length !== 1) {
    throw new Error(`Rendered comparison requires one ${WEB_CAPTURE_MANIFEST_SCHEMA} version ${WEB_CAPTURE_MANIFEST_VERSION} capture.`);
  }
  const source = record(root.source);
  if (!source || !onlyKeys(source, SOURCE_KEYS)) throw new Error('Rendered capture source metadata is invalid.');
  boundedText(source.name, 80, 'Rendered capture source name');
  boundedText(source.reference, 500, 'Rendered capture source reference', true);
  const sourceCollectedAt = timestamp(source.collectedAt, 'Rendered capture source time');
  const capture = record(root.captures[0]);
  if (!capture || !onlyKeys(capture, CAPTURE_KEYS)) throw new Error('Rendered capture contains unsupported fields.');
  const completeness = capture.completeness === 'complete' || capture.completeness === 'partial'
    ? capture.completeness
    : (() => { throw new Error('Rendered capture completeness must be complete or partial.'); })();
  limitationList(capture.limitations, 'Rendered capture limitations');
  const page = record(capture.page);
  if (!page || !onlyKeys(page, PAGE_KEYS)) throw new Error('Rendered capture page metadata is invalid.');
  if (!Array.isArray(capture.artifacts) || capture.artifacts.length !== 2) {
    throw new Error('Rendered capture must contain one screenshot and one DOM digest artefact.');
  }
  const artifacts = capture.artifacts.map((artifact, index) => parseArtifact(artifact, `Rendered capture artifact ${index + 1}`));
  const screenshot = artifacts.find((artifact) => artifact.kind === 'screenshot');
  const domDigest = artifacts.find((artifact) => artifact.kind === 'dom_digest');
  if (!screenshot || !domDigest) throw new Error('Rendered capture must contain distinct screenshot and DOM digest artefacts.');
  const capturedAt = timestamp(capture.capturedAt, 'Rendered capture time');
  if (sourceCollectedAt !== capturedAt) throw new Error('Rendered capture source time does not match its capture time.');
  return {
    domain: captureDomain(capture.domain, 'Rendered capture domain'),
    capturedAt,
    completeness,
    title: boundedText(page.title, 300, 'Rendered capture title', true),
    finalOrigin: origin(page.finalOrigin, 'Rendered capture final origin'),
    requestDomains: stringList(capture.requestDomains, MAX_CAPTURE_HOSTS, 'Rendered capture request domains'),
    technologies: technologyList(capture.technologies, 'Rendered capture technologies'),
    screenshot,
    domDigest,
  };
}

function parseDomDigest(value: unknown, expectedDomain: string, expectedCapturedAt: string): DomDigest {
  const root = record(value);
  if (!root || !onlyKeys(root, DOM_ROOT_KEYS) || root.schema !== WEB_CAPTURE_DOM_DIGEST_SCHEMA
    || root.version !== WEB_CAPTURE_DOM_DIGEST_VERSION) {
    throw new Error('Rendered DOM digest uses an unsupported schema.');
  }
  const domain = captureDomain(root.domain, 'Rendered DOM digest domain');
  if (domain !== expectedDomain) throw new Error('Rendered DOM digest domain does not match its manifest.');
  if (timestamp(root.capturedAt, 'Rendered DOM digest time') !== expectedCapturedAt) {
    throw new Error('Rendered DOM digest time does not match its manifest.');
  }
  limitationList(root.limitations, 'Rendered DOM digest limitations');
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
      elements: nonNegativeInteger(counts.elements, MAX_WEB_CAPTURE_DOM_ELEMENTS, 'Rendered element count'),
      forms: nonNegativeInteger(counts.forms, MAX_WEB_CAPTURE_DOM_ELEMENTS, 'Rendered form count'),
      controls: nonNegativeInteger(counts.controls, MAX_WEB_CAPTURE_DOM_ELEMENTS, 'Rendered control count'),
      scripts: nonNegativeInteger(counts.scripts, MAX_WEB_CAPTURE_DOM_ELEMENTS, 'Rendered script count'),
      images: nonNegativeInteger(counts.images, MAX_WEB_CAPTURE_DOM_ELEMENTS, 'Rendered image count'),
    },
    structure: {
      value: digest(structure.value, 'Rendered structure digest'),
      truncated: requiredBoolean(structure.truncated, 'Rendered structure truncation state'),
    },
    visibleText: {
      value: digest(visibleText.value, 'Rendered visible-text digest'),
      bytes: nonNegativeInteger(visibleText.bytes, MAX_WEB_CAPTURE_VISIBLE_TEXT_BYTES, 'Rendered visible-text byte count'),
      truncated: requiredBoolean(visibleText.truncated, 'Rendered visible-text truncation state'),
    },
  };
}

async function boundedFile(filePath: string, maximumBytes: number, expectedBytes: number | null, label: string): Promise<Buffer> {
  try {
    return await readBoundedRegularFile(filePath, {
      maximumBytes,
      minimumBytes: 1,
      expectedBytes,
      label,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label} `)) throw error;
    throw new Error(`${label} could not be read.`);
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function loadCapture(manifestPath: string): Promise<LoadedCapture> {
  const bytes = await boundedFile(manifestPath, MAX_MANIFEST_BYTES, null, 'Rendered capture manifest');
  let parsed: unknown;
  try {
    parsed = parseBoundedJson(decodeBoundedUtf8(bytes, 'Rendered capture manifest'), {
      label: 'Rendered capture manifest',
      maximumBytes: MAX_MANIFEST_BYTES,
    });
  } catch {
    throw new Error('Rendered capture manifest is not valid JSON.');
  }
  const manifest = parseManifest(parsed);
  const directory = path.dirname(manifestPath);
  const screenshotBytes = await boundedFile(path.join(directory, manifest.screenshot.fileName), MAX_SCREENSHOT_BYTES, manifest.screenshot.bytes, 'Rendered screenshot');
  const domBytes = await boundedFile(path.join(directory, manifest.domDigest.fileName), MAX_DOM_DIGEST_BYTES, manifest.domDigest.bytes, 'Rendered DOM digest');
  const screenshotHashVerified = sha256(screenshotBytes) === manifest.screenshot.sha256;
  const screenshotInspection = inspectDecodedImage(screenshotBytes);
  const screenshotPerceptualHashVerified = screenshotInspection.decodable
    && screenshotInspection.width === manifest.screenshot.width
    && screenshotInspection.height === manifest.screenshot.height
    && screenshotInspection.perceptualHash === manifest.screenshot.perceptualHash;
  const domHashVerified = sha256(domBytes) === manifest.domDigest.sha256;
  if (!screenshotHashVerified || !screenshotPerceptualHashVerified || !domHashVerified) {
    throw new Error('Rendered capture artefact integrity verification failed.');
  }
  let domValue: unknown;
  try {
    domValue = parseBoundedJson(decodeBoundedUtf8(domBytes, 'Rendered DOM digest'), {
      label: 'Rendered DOM digest',
      maximumBytes: MAX_DOM_DIGEST_BYTES,
    });
  } catch {
    throw new Error('Rendered DOM digest is not valid JSON.');
  }
  return { manifest, dom: parseDomDigest(domValue, manifest.domain, manifest.capturedAt), screenshotHashVerified, screenshotPerceptualHashVerified, domHashVerified };
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

function scalarStateComparison(left: string | null, right: string | null) {
  return { state: scalarComparison(left, right).state };
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
  const capturePartial = left.manifest.completeness !== 'complete' || right.manifest.completeness !== 'complete';
  const partial = capturePartial
    || left.dom.structure.truncated || right.dom.structure.truncated || left.dom.visibleText.truncated || right.dom.visibleText.truncated;
  const compareCapturedSet = (leftValues: readonly string[], rightValues: readonly string[]) => {
    const comparison = setComparison(leftValues, rightValues);
    return capturePartial ? { ...comparison, state: 'unavailable' as const } : comparison;
  };
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
        state: left.dom.structure.value === right.dom.structure.value
          ? left.dom.structure.truncated || right.dom.structure.truncated ? 'unavailable' : 'same'
          : 'different',
        leftTruncated: left.dom.structure.truncated,
        rightTruncated: right.dom.structure.truncated,
      },
      visibleText: {
        state: left.dom.visibleText.value === right.dom.visibleText.value
          ? left.dom.visibleText.truncated || right.dom.visibleText.truncated ? 'unavailable' : 'same'
          : 'different',
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
      title: scalarStateComparison(left.manifest.title, right.manifest.title),
      finalOrigin: scalarComparison(left.manifest.finalOrigin, right.manifest.finalOrigin),
      requestDomains: compareCapturedSet(left.manifest.requestDomains, right.manifest.requestDomains),
      technologies: compareCapturedSet(left.manifest.technologies, right.manifest.technologies),
    },
    limitations: [
      'This offline comparison verifies and reads only two selected local capture packages; it makes no network request.',
      'Screenshot perceptual proximity is a review lead and does not establish copying, ownership, control, intent, safety, or maliciousness.',
      'The structure digest compares only a bounded preorder element-tag sequence, so equal digests do not establish identical nesting, attributes, or DOM. The legacy visibleText field compares the bounded body text-node sequence, including text that may not be visually rendered. A difference does not quantify how much content changed.',
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
    `Element tags      ${document.renderedDom.structure.state}`,
    `Body text nodes   ${document.renderedDom.visibleText.state}`,
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

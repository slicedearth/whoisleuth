import { normalizeDomain } from './case-model.ts';
import {
  EXTERNAL_FINDINGS_SCHEMA,
  EXTERNAL_FINDINGS_VERSION,
  MAX_EXTERNAL_FINDING_DOMAINS,
  MAX_EXTERNAL_FINDINGS_PER_DOMAIN,
  parseExternalFindingsDocument,
  type ExternalFindingsDocument,
} from './external-findings-import.ts';
import {
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
  WEB_CAPTURE_SUMMARY_SCHEMA,
  WEB_CAPTURE_SUMMARY_VERSION,
} from '../../../../lib/web-capture-contract.mts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../../../../lib/observation.mts';
export {
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
  WEB_CAPTURE_SUMMARY_SCHEMA,
  WEB_CAPTURE_SUMMARY_VERSION,
} from '../../../../lib/web-capture-contract.mts';
export const MAX_WEB_CAPTURE_SUMMARIES = 50;
export { MAX_WEB_CAPTURE_DOM_DIGEST_BYTES, MAX_WEB_CAPTURE_SCREENSHOT_BYTES } from '../../../../lib/web-capture-contract.mts';
const MAX_CAPTURE_TECHNOLOGIES = 20;
const MAX_CAPTURE_ORIGINS = 30;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const PERCEPTUAL_HASH_RE = /^[a-f0-9]{16}$/i;
const SUPPORTED_WEB_CAPTURE_MANIFEST_VERSIONS = new Set([1, WEB_CAPTURE_MANIFEST_VERSION]);
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const ROOT_KEYS = new Set(['schema', 'schemaVersion', 'source', 'captures']);
const SOURCE_KEYS = new Set(['name', 'reference', 'collectedAt']);
const CAPTURE_KEYS = new Set([
  'domain',
  'capturedAt',
  'completeness',
  'limitations',
  'pageTitle',
  'finalOrigin',
  'screenshotSha256',
  'technologies',
  'networkOrigins',
]);
const MANIFEST_CAPTURE_KEYS = new Set([
  'domain',
  'capturedAt',
  'completeness',
  'limitations',
  'page',
  'requestDomains',
  'technologies',
  'artifacts',
]);
const PAGE_KEYS = new Set(['title', 'finalOrigin']);
const ARTIFACT_KEYS = new Set(['kind', 'fileName', 'mimeType', 'sha256', 'perceptualHash', 'bytes', 'width', 'height']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function text(value: unknown, maximum: number, label: string, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || CONTROL_RE.test(value)) {
    throw new Error(`${label} must be bounded text without control characters.`);
  }
  return value.replace(/\s+/g, ' ').trim();
}

function timestamp(value: unknown, label: string, optional = false, legacy = false): string | null {
  const candidate = text(value, 64, label, optional);
  if (candidate === null) return null;
  const normalized = normalizeExplicitIsoTimestamp(candidate)
    ?? (legacy ? normalizeLegacyIsoTimestamp(candidate) : null);
  if (!normalized) throw new Error(`${label} must be a valid date and time with an explicit timezone.`);
  return normalized;
}

function origin(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const candidate = text(value, 500, label);
  try {
    const parsed = new URL(candidate ?? '');
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error();
    return parsed.origin.toLowerCase();
  } catch {
    throw new Error(`${label} must be an HTTP(S) origin without credentials, path, query, or fragment.`);
  }
}

function stringList(value: unknown, maximumItems: number, maximumLength: number, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(`${label} exceeds its item bound.`);
  const output = new Set<string>();
  for (const item of value) {
    const normalized = text(item, maximumLength, label);
    if (normalized) output.add(normalized);
  }
  return [...output];
}

export function parseWebCaptureSummary(value: unknown): ExternalFindingsDocument {
  const root = record(value);
  if (
    !root
    || !onlyKeys(root, ROOT_KEYS)
    || root.schema !== WEB_CAPTURE_SUMMARY_SCHEMA
    || root.schemaVersion !== WEB_CAPTURE_SUMMARY_VERSION
  ) {
    throw new Error(`Web captures must use ${WEB_CAPTURE_SUMMARY_SCHEMA} schema version ${WEB_CAPTURE_SUMMARY_VERSION}.`);
  }
  const source = record(root.source);
  if (!source || !onlyKeys(source, SOURCE_KEYS)) throw new Error('Web captures require a bounded source object.');
  const sourceName = text(source.name, 80, 'Capture source name');
  const sourceReference = text(source.reference, 500, 'Capture source reference', true);
  const sourceCollectedAt = timestamp(source.collectedAt, 'Capture source collection time', true);
  if (!Array.isArray(root.captures) || !root.captures.length || root.captures.length > MAX_WEB_CAPTURE_SUMMARIES) {
    throw new Error(`Web captures must contain between 1 and ${MAX_WEB_CAPTURE_SUMMARIES} summaries.`);
  }
  const findings: Array<Record<string, unknown>> = [];
  const domainCounts = new Map<string, number>();
  for (const [index, raw] of root.captures.entries()) {
    const capture = record(raw);
    if (!capture || !onlyKeys(capture, CAPTURE_KEYS)) throw new Error(`Web capture ${index + 1} contains unsupported fields.`);
    const domain = normalizeDomain(text(capture.domain, 253, `Web capture ${index + 1} domain`));
    if (!domain) throw new Error(`Web capture ${index + 1} domain is invalid.`);
    const domainCount = (domainCounts.get(domain) ?? 0) + 1;
    if (domainCount > MAX_EXTERNAL_FINDINGS_PER_DOMAIN) {
      throw new Error(`Web captures exceed the ${MAX_EXTERNAL_FINDINGS_PER_DOMAIN}-summary per-domain limit.`);
    }
    domainCounts.set(domain, domainCount);
    if (domainCounts.size > MAX_EXTERNAL_FINDING_DOMAINS) {
      throw new Error(`Web captures exceed the ${MAX_EXTERNAL_FINDING_DOMAINS}-domain limit.`);
    }
    const observedAt = timestamp(capture.capturedAt, `Web capture ${index + 1} time`);
    const completeness = ['complete', 'inconclusive', 'partial', 'unknown'].includes(String(capture.completeness))
      ? capture.completeness
      : 'unknown';
    const limitations = stringList(capture.limitations, 8, 240, `Web capture ${index + 1} limitations`);
    const pageTitle = text(capture.pageTitle, 300, `Web capture ${index + 1} title`, true);
    const finalOrigin = origin(capture.finalOrigin, `Web capture ${index + 1} final origin`);
    const technologies = stringList(capture.technologies, MAX_CAPTURE_TECHNOLOGIES, 80, `Web capture ${index + 1} technologies`);
    const networkOrigins = stringList(capture.networkOrigins, MAX_CAPTURE_ORIGINS, 500, `Web capture ${index + 1} network origins`)
      .map((item, originIndex) => origin(item, `Web capture ${index + 1} network origin ${originIndex + 1}`))
      .filter((item): item is string => item !== null);
    const screenshotSha256 = capture.screenshotSha256 === undefined || capture.screenshotSha256 === null || capture.screenshotSha256 === ''
      ? null
      : typeof capture.screenshotSha256 === 'string' && SHA256_RE.test(capture.screenshotSha256)
        ? capture.screenshotSha256.toLowerCase()
        : (() => { throw new Error(`Web capture ${index + 1} screenshot digest must be SHA-256.`); })();
    const summaries = [
      pageTitle || finalOrigin
        ? `Sanitised page capture${pageTitle ? ` titled "${pageTitle}"` : ''}${finalOrigin ? ` ended at origin ${finalOrigin}` : ''}.`
        : '',
      technologies.length ? `Observed technology labels: ${technologies.join(', ')}.` : '',
      networkOrigins.length ? `Observed network origins: ${networkOrigins.join(', ')}.` : '',
      screenshotSha256 ? `Screenshot SHA-256: ${screenshotSha256}.` : '',
    ].filter(Boolean);
    if (!summaries.length) throw new Error(`Web capture ${index + 1} contains no supported summary evidence.`);
    findings.push({
      domain,
      category: technologies.length && summaries.length === 1 ? 'http' : 'page',
      evidenceClass: 'deployment_observation',
      summary: summaries.join(' '),
      observedAt,
      completeness,
      limitations: [
        'Imported sanitised capture summary; WHOISleuth did not collect or independently verify this observation.',
        ...limitations,
      ].slice(0, 8),
      reference: sourceReference,
    });
  }
  return parseExternalFindingsDocument({
    schema: EXTERNAL_FINDINGS_SCHEMA,
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: { name: sourceName, reference: sourceReference, collectedAt: sourceCollectedAt },
    findings,
  });
}

function artifactName(value: unknown, label: string): string {
  const candidate = text(value, 120, label) ?? '';
  if (
    candidate === '.'
    || candidate === '..'
    || candidate.includes('/')
    || candidate.includes('\\')
    || candidate.includes('%2f')
    || candidate.includes('%5c')
  ) {
    throw new Error(`${label} must be a plain file name without a path.`);
  }
  return candidate;
}

function positiveInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > maximum) {
    throw new Error(`${label} is outside the supported bound.`);
  }
  return Number(value);
}

export function parseWebCaptureManifest(value: unknown): ExternalFindingsDocument {
  const root = record(value);
  if (
    !root
    || !onlyKeys(root, ROOT_KEYS)
    || root.schema !== WEB_CAPTURE_MANIFEST_SCHEMA
    || !SUPPORTED_WEB_CAPTURE_MANIFEST_VERSIONS.has(Number(root.schemaVersion))
  ) {
    throw new Error(`Web capture manifests must use ${WEB_CAPTURE_MANIFEST_SCHEMA} schema version 1 or ${WEB_CAPTURE_MANIFEST_VERSION}.`);
  }
  const manifestVersion = Number(root.schemaVersion);
  const legacyTimestamps = manifestVersion < WEB_CAPTURE_MANIFEST_VERSION;
  const source = record(root.source);
  if (!source || !onlyKeys(source, SOURCE_KEYS)) throw new Error('Web capture manifests require a bounded source object.');
  const sourceName = text(source.name, 80, 'Capture source name');
  const sourceReference = text(source.reference, 500, 'Capture source reference', true);
  const sourceCollectedAt = timestamp(source.collectedAt, 'Capture source collection time', true, legacyTimestamps);
  if (!Array.isArray(root.captures) || !root.captures.length || root.captures.length > MAX_WEB_CAPTURE_SUMMARIES) {
    throw new Error(`Web capture manifests must contain between 1 and ${MAX_WEB_CAPTURE_SUMMARIES} captures.`);
  }
  const findings: Array<Record<string, unknown>> = [];
  const domainCounts = new Map<string, number>();
  for (const [index, raw] of root.captures.entries()) {
    const capture = record(raw);
    if (!capture || !onlyKeys(capture, MANIFEST_CAPTURE_KEYS)) {
      throw new Error(`Web capture manifest ${index + 1} contains unsupported fields or archive content.`);
    }
    const domain = normalizeDomain(text(capture.domain, 253, `Web capture manifest ${index + 1} domain`));
    if (!domain) throw new Error(`Web capture manifest ${index + 1} domain is invalid.`);
    const domainCount = (domainCounts.get(domain) ?? 0) + 1;
    if (domainCount > MAX_EXTERNAL_FINDINGS_PER_DOMAIN) {
      throw new Error(`Web capture manifests exceed the ${MAX_EXTERNAL_FINDINGS_PER_DOMAIN}-capture per-domain limit.`);
    }
    domainCounts.set(domain, domainCount);
    if (domainCounts.size > MAX_EXTERNAL_FINDING_DOMAINS) {
      throw new Error(`Web capture manifests exceed the ${MAX_EXTERNAL_FINDING_DOMAINS}-domain limit.`);
    }
    const observedAt = timestamp(capture.capturedAt, `Web capture manifest ${index + 1} time`, false, legacyTimestamps);
    const completeness = ['complete', 'inconclusive', 'partial', 'unknown'].includes(String(capture.completeness))
      ? capture.completeness
      : 'unknown';
    const limitations = stringList(capture.limitations, 8, 240, `Web capture manifest ${index + 1} limitations`);
    const page = record(capture.page);
    if (page && !onlyKeys(page, PAGE_KEYS)) throw new Error(`Web capture manifest ${index + 1} page metadata contains unsupported fields.`);
    const pageTitle = text(page?.title, 300, `Web capture manifest ${index + 1} title`, true);
    const finalOrigin = origin(page?.finalOrigin, `Web capture manifest ${index + 1} final origin`);
    const technologies = stringList(capture.technologies, MAX_CAPTURE_TECHNOLOGIES, 80, `Web capture manifest ${index + 1} technologies`);
    const requestDomains = stringList(capture.requestDomains, MAX_CAPTURE_ORIGINS, 253, `Web capture manifest ${index + 1} request domains`)
      .map((item) => normalizeDomain(item))
      .filter((item): item is string => Boolean(item));
    if (!Array.isArray(capture.artifacts) || !capture.artifacts.length || capture.artifacts.length > 2) {
      throw new Error(`Web capture manifest ${index + 1} must contain one or two artifact metadata records.`);
    }
    const artifactSummaries: string[] = [];
    const kinds = new Set<string>();
    for (const [artifactIndex, rawArtifact] of capture.artifacts.entries()) {
      const artifact = record(rawArtifact);
      if (!artifact || !onlyKeys(artifact, ARTIFACT_KEYS)) {
        throw new Error(`Web capture manifest ${index + 1} artifact ${artifactIndex + 1} contains unsupported fields.`);
      }
      const kind = artifact.kind === 'screenshot' || artifact.kind === 'dom_digest' ? artifact.kind : null;
      if (!kind || kinds.has(kind)) throw new Error(`Web capture manifest ${index + 1} has an invalid or duplicate artifact kind.`);
      kinds.add(kind);
      const fileName = artifactName(artifact.fileName, `Web capture manifest ${index + 1} artifact name`);
      const sha256 = typeof artifact.sha256 === 'string' && SHA256_RE.test(artifact.sha256)
        ? artifact.sha256.toLowerCase()
        : null;
      if (!sha256) throw new Error(`Web capture manifest ${index + 1} artifact digest must be SHA-256.`);
      const mimeType = text(artifact.mimeType, 80, `Web capture manifest ${index + 1} artifact MIME type`)?.toLowerCase();
      const maximumBytes = kind === 'screenshot' ? MAX_WEB_CAPTURE_SCREENSHOT_BYTES : MAX_WEB_CAPTURE_DOM_DIGEST_BYTES;
      const bytes = positiveInteger(artifact.bytes, maximumBytes, `Web capture manifest ${index + 1} artifact size`);
      if (kind === 'screenshot') {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType || '')) {
          throw new Error(`Web capture manifest ${index + 1} screenshot MIME type is unsupported.`);
        }
        const width = positiveInteger(artifact.width, 10_000, `Web capture manifest ${index + 1} screenshot width`);
        const height = positiveInteger(artifact.height, 10_000, `Web capture manifest ${index + 1} screenshot height`);
        const perceptualHash = artifact.perceptualHash === undefined || artifact.perceptualHash === null || artifact.perceptualHash === ''
          ? null
          : manifestVersion >= 2 && typeof artifact.perceptualHash === 'string' && PERCEPTUAL_HASH_RE.test(artifact.perceptualHash)
            ? artifact.perceptualHash.toLowerCase()
            : (() => { throw new Error(`Web capture manifest ${index + 1} screenshot perceptual hash is unsupported.`); })();
        artifactSummaries.push(`Screenshot ${fileName}: ${mimeType}, ${width}x${height}, ${bytes} bytes, SHA-256 ${sha256}${perceptualHash ? `, dHash ${perceptualHash}` : ''}.`);
      } else {
        if (mimeType !== 'application/json') throw new Error(`Web capture manifest ${index + 1} DOM digest MIME type is unsupported.`);
        if (artifact.width !== undefined || artifact.height !== undefined || artifact.perceptualHash !== undefined) {
          throw new Error(`Web capture manifest ${index + 1} DOM digest cannot declare image-only fields.`);
        }
        artifactSummaries.push(`DOM digest ${fileName}: application/json, ${bytes} bytes, SHA-256 ${sha256}.`);
      }
    }
    const summaries = [
      pageTitle || finalOrigin
        ? `Sanitised page capture${pageTitle ? ` titled "${pageTitle}"` : ''}${finalOrigin ? ` ended at origin ${finalOrigin}` : ''}.`
        : '',
      technologies.length ? `Observed technology labels: ${technologies.join(', ')}.` : '',
      requestDomains.length ? `Observed request domains: ${requestDomains.join(', ')}.` : '',
      ...artifactSummaries,
    ].filter(Boolean);
    findings.push({
      domain,
      category: 'page',
      evidenceClass: 'deployment_observation',
      summary: summaries.join(' '),
      observedAt,
      completeness,
      limitations: [
        'Imported sanitised capture manifest metadata; WHOISleuth did not receive artefact bytes or independently verify their digests.',
        ...limitations,
      ].slice(0, 8),
      reference: sourceReference,
    });
  }
  return parseExternalFindingsDocument({
    schema: EXTERNAL_FINDINGS_SCHEMA,
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: { name: sourceName, reference: sourceReference, collectedAt: sourceCollectedAt },
    findings,
  });
}

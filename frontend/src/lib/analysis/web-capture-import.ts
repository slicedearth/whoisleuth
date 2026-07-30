import { normalizeDomain } from './case-model.ts';
import {
  EXTERNAL_FINDINGS_SCHEMA,
  EXTERNAL_FINDINGS_VERSION,
  parseExternalFindingsDocument,
  type ExternalFindingsDocument,
} from './external-findings-import.ts';

export const WEB_CAPTURE_SUMMARY_SCHEMA = 'whoisleuth.web-capture-summary';
export const WEB_CAPTURE_SUMMARY_VERSION = 1;
export const MAX_WEB_CAPTURE_SUMMARIES = 50;
const MAX_CAPTURE_TECHNOLOGIES = 20;
const MAX_CAPTURE_ORIGINS = 30;
const SHA256_RE = /^[a-f0-9]{64}$/i;
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

function timestamp(value: unknown, label: string, optional = false): string | null {
  const candidate = text(value, 64, label, optional);
  if (candidate === null) return null;
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date and time.`);
  return new Date(parsed).toISOString();
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
  for (const [index, raw] of root.captures.entries()) {
    const capture = record(raw);
    if (!capture || !onlyKeys(capture, CAPTURE_KEYS)) throw new Error(`Web capture ${index + 1} contains unsupported fields.`);
    const domain = normalizeDomain(text(capture.domain, 253, `Web capture ${index + 1} domain`));
    if (!domain) throw new Error(`Web capture ${index + 1} domain is invalid.`);
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
    for (const summary of summaries) {
      findings.push({
        domain,
        category: summary.startsWith('Observed technology') ? 'http' : 'page',
        summary,
        observedAt,
        completeness,
        limitations: [
          'Imported sanitised capture summary; WHOISleuth did not collect or independently verify this observation.',
          ...limitations,
        ].slice(0, 8),
        reference: sourceReference,
      });
    }
  }
  return parseExternalFindingsDocument({
    schema: EXTERNAL_FINDINGS_SCHEMA,
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: { name: sourceName, reference: sourceReference, collectedAt: sourceCollectedAt },
    findings,
  });
}

import { isValidAsciiDomainName } from '../contracts/domain-name.mts';
import { normalizeExplicitIsoTimestamp } from './observation.mts';

// Earliest and latest web archive captures of one domain's homepage, from an
// explicit analyst action. Only the domain is sent; capture times and HTTP
// statuses are retained, never archived page content.

export const WEB_ARCHIVE_HISTORY_SCHEMA = 'whoisleuth.web-archive-history';
export const WEB_ARCHIVE_HISTORY_VERSION = 1;
export const WEB_ARCHIVE_RESPONSE_BYTES = 16 * 1024;
export const WEB_ARCHIVE_HISTORY_BYTES = 16 * 1024;
export const WEB_ARCHIVE_HISTORY_TIMEOUT_MS = 12_000;
export const WEB_ARCHIVE_PROVIDER = Object.freeze({
  id: 'internet_archive',
  label: 'Internet Archive Wayback Machine',
  endpoint: 'https://web.archive.org/cdx/search/cdx',
  // One page holds the archive's terms of use, privacy policy and copyright policy.
  termsUrl: 'https://archive.org/about/terms',
} as const);
export const WEB_ARCHIVE_QUERIES = Object.freeze(['earliest', 'latest'] as const);
export type WebArchiveQueryKind = typeof WEB_ARCHIVE_QUERIES[number];
export type WebArchiveOutcome = 'capture' | 'no_capture' | 'timeout' | 'error' | 'invalid_response' | 'skipped';

export type WebArchiveQuery = Readonly<{
  kind: WebArchiveQueryKind;
  observedAt: string;
  requestStarted: boolean;
  outcome: WebArchiveOutcome;
  capturedAt: string | null;
  /** HTTP status recorded by the archive for the capture, when it reported one. */
  capturedStatus: number | null;
}>;

export type WebArchiveHistory = Readonly<{
  schema: typeof WEB_ARCHIVE_HISTORY_SCHEMA;
  version: typeof WEB_ARCHIVE_HISTORY_VERSION;
  domain: string;
  startedAt: string;
  completedAt: string;
  queries: readonly WebArchiveQuery[];
}>;

const OUTCOMES = new Set<WebArchiveOutcome>(['capture', 'no_capture', 'timeout', 'error', 'invalid_response', 'skipped']);

export function normaliseWebArchiveRequest(domain: unknown): Readonly<{ domain: string }> {
  if (typeof domain !== 'string' || domain.length > 254 || domain.trim() !== domain) {
    throw new TypeError('Select one domain, without a URL or surrounding whitespace.');
  }
  const name = domain.toLowerCase().replace(/\.$/u, '');
  if (!isValidAsciiDomainName(name) || /^\d+(?:\.\d+)*$/u.test(name)) throw new TypeError('Select a valid domain name.');
  return Object.freeze({ domain: name });
}

/** Archive timestamps are UTC digits (YYYYMMDDhhmmss); partial precision is padded. */
export function webArchiveTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4,14}$/u.test(value)) return null;
  const digits = value.padEnd(14, '0');
  const month = digits.slice(4, 6) === '00' ? '01' : digits.slice(4, 6);
  const day = digits.slice(6, 8) === '00' ? '01' : digits.slice(6, 8);
  const iso = `${digits.slice(0, 4)}-${month}-${day}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}Z`;
  return normalizeExplicitIsoTimestamp(iso);
}

/** Link to the archived capture so the analyst can open it deliberately; never fetched here. */
export function webArchiveCaptureUrl(domain: string, capturedAt: string): string {
  const timestamp = capturedAt.replace(/\D/gu, '').slice(0, 14);
  return `https://web.archive.org/web/${timestamp}/${normaliseWebArchiveRequest(domain).domain}/`;
}

/** Revalidate our bounded backend report before display or comparison. */
export function readWebArchiveHistory(value: unknown, expectedDomain?: string): WebArchiveHistory {
  const fail = (): never => { throw new TypeError('Web archive history response is invalid.'); };
  const object = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : fail();
  const root = object(value);
  if (root.schema !== WEB_ARCHIVE_HISTORY_SCHEMA || root.version !== WEB_ARCHIVE_HISTORY_VERSION) fail();
  const { domain } = normaliseWebArchiveRequest(root.domain);
  if (expectedDomain !== undefined && domain !== expectedDomain) fail();
  const startedAt = normalizeExplicitIsoTimestamp(root.startedAt) ?? fail();
  const completedAt = normalizeExplicitIsoTimestamp(root.completedAt) ?? fail();
  if (completedAt < startedAt || !Array.isArray(root.queries) || root.queries.length !== WEB_ARCHIVE_QUERIES.length) fail();
  const queries = (root.queries as unknown[]).map((raw, index) => {
    const item = object(raw);
    const observedAt = normalizeExplicitIsoTimestamp(item.observedAt) ?? fail();
    const capturedAt = item.capturedAt === null ? null : normalizeExplicitIsoTimestamp(item.capturedAt) ?? fail();
    if (item.kind !== WEB_ARCHIVE_QUERIES[index] || typeof item.requestStarted !== 'boolean'
      || typeof item.outcome !== 'string' || !OUTCOMES.has(item.outcome as WebArchiveOutcome)
      || observedAt < startedAt || observedAt > completedAt
      || (item.outcome === 'capture') !== (capturedAt !== null)
      || capturedAt !== null && capturedAt > observedAt
      || (item.outcome === 'skipped') === item.requestStarted
      || item.capturedStatus !== null && !(Number.isSafeInteger(item.capturedStatus)
        && Number(item.capturedStatus) >= 100 && Number(item.capturedStatus) <= 599)
      || item.capturedStatus !== null && capturedAt === null) fail();
    return Object.freeze({ kind: item.kind, observedAt, requestStarted: item.requestStarted, outcome: item.outcome,
      capturedAt, capturedStatus: item.capturedStatus }) as WebArchiveQuery;
  });
  const [earliest, latest] = queries;
  if (earliest!.capturedAt && latest!.capturedAt && earliest!.capturedAt > latest!.capturedAt) fail();
  return Object.freeze({ schema: WEB_ARCHIVE_HISTORY_SCHEMA, version: WEB_ARCHIVE_HISTORY_VERSION,
    domain, startedAt, completedAt, queries: Object.freeze(queries) });
}

export const WEB_ARCHIVE_LIMITATIONS = Object.freeze([
  'Captures show when the archive recorded this domain’s homepage, not who registered or controlled the domain at that time.',
  'The archive is incomplete; no capture does not show that the site never existed, and a capture does not show it was online continuously.',
]);

import { parseBoundedJsonObject, boundedJsonLimitsForBytes } from '../analysis/bounded-json.mts';
import { parseCredentialFreeHttpUrl } from '../evidence/lookup-target.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { MAX_MESSAGE_INTAKE_BYTES, MAX_INTAKE_URL_LENGTH, type MessageIntakeResult } from '../contracts/message-intake.mts';
import { MAX_HAR_ENTRIES, HAR_TIMING_PHASES, type HarEntry } from '../contracts/har-review.mts';
import { createIntakeReport } from './intake-report.mts';
import { createLinkIntake } from './link-intake.mts';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const milliseconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
function mimeCategory(raw: unknown): HarEntry['mimeCategory'] {
  if (typeof raw !== 'string' || !raw.trim()) return 'unknown';
  const mime = raw.split(';', 1)[0]!.trim().toLowerCase();
  if (['text/html', 'application/xhtml+xml'].includes(mime)) return 'html';
  if (['text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript'].includes(mime)) return 'script';
  if (mime === 'application/json' || mime.endsWith('+json')) return 'json';
  if (['application/xml', 'text/xml'].includes(mime) || mime.endsWith('+xml')) return 'xml';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('font/') || mime.includes('font')) return 'font';
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'media';
  if (mime.startsWith('text/')) return 'text';
  return mime === 'application/octet-stream' ? 'binary' : 'other';
}

/** Retain declared request sequence, not cookies, headers, bodies or replay authority. */
export async function reviewHarInput(bytes: Uint8Array, reviewedAt: string): Promise<MessageIntakeResult> {
  const base = await createIntakeReport(bytes, 'har', reviewedAt);
  const root = parseBoundedJsonObject(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { label: 'HAR input', maximumBytes: MAX_MESSAGE_INTAKE_BYTES,
    limits: { ...boundedJsonLimitsForBytes(MAX_MESSAGE_INTAKE_BYTES), maximumContainerItems: MAX_HAR_ENTRIES } });
  const log = record(root.log);
  if (log.version !== '1.2' || !Array.isArray(log.entries) || log.entries.length > MAX_HAR_ENTRIES) throw new TypeError('Select a HAR 1.2 archive within the entry review bound.');
  const links = createLinkIntake(), entries: HarEntry[] = [];
  let invalidEntries = 0;
  for (const [index, raw] of log.entries.entries()) {
    const entry = record(raw), request = record(entry.request), response = record(entry.response), content = record(response.content), timing = record(entry.timings);
    if (!Object.keys(request).length || !Object.keys(response).length) { invalidEntries++; continue; }
    const url = parseCredentialFreeHttpUrl(request.url, MAX_INTAKE_URL_LENGTH);
    const method = typeof request.method === 'string' ? request.method.toUpperCase() : null;
    const resource = typeof entry._resourceType === 'string' ? entry._resourceType.toLowerCase() : null;
    entries.push({ sequence: index + 1, startedAt: typeof entry.startedDateTime === 'string' ? normalizeExplicitIsoTimestamp(entry.startedDateTime) : null,
      origin: url?.origin ?? null,
      method: method === null ? 'unknown' : ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'CONNECT', 'TRACE'].includes(method) ? method as HarEntry['method'] : 'other',
      status: typeof response.status === 'number' && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null,
      durationMs: milliseconds(entry.time), mimeCategory: mimeCategory(content.mimeType),
      timings: Object.fromEntries(HAR_TIMING_PHASES.map(phase => [phase, milliseconds(timing[phase])])) as HarEntry['timings'],
      resourceType: resource === null ? 'unknown' : ['document', 'script', 'stylesheet', 'image', 'font', 'media', 'xhr', 'fetch', 'ping', 'websocket'].includes(resource) ? resource as HarEntry['resourceType'] : 'other',
      reportedFailure: typeof entry._error === 'string' && Boolean(entry._error) });
    // Queries may carry access tokens or account identifiers. Even transient
    // destination actions from this archive contain only its origin.
    if (url) links.add(url.origin, 'har_request');
  }
  const extracted = links.result();
  return { targets: extracted.targets, report: { ...base, links: extracted.links, harReview: { entries, invalidEntries },
    coverage: { ...base.coverage, state: invalidEntries || extracted.bounded ? 'partial' : 'reviewed', reviewedParts: entries.length,
      rejectedLinks: extracted.rejected, boundsReached: extracted.bounded ? ['Destination list; the admitted request timeline remains available'] : [] } } };
}

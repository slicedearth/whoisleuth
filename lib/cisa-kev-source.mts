// Shared KEV projection. Only bounded identifier membership reaches Lookup.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { parseBoundedJsonObject } from '../packages/analysis/bounded-json.mts';
import { isCveIdentifier } from '../packages/contracts/vulnerability-identifiers.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';

export const KEV_SOURCE_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
export const MAX_KEV_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_KEV_PROJECTION_BYTES = 128 * 1024;
export const KEV_REVIEW_DAYS = 30;
const MAX_ENTRIES = 10_000;
const KEV_VERSION = /^\d{4}\.\d{2}\.\d{2}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export type KevProjection = Readonly<{
  catalogVersion: string;
  releasedAt: string;
  sourceSha256: string;
  sourceUrl: typeof KEV_SOURCE_URL;
  identifiers: readonly string[];
}>;

export function kevProjectionIsCurrent(projection: Pick<KevProjection, 'releasedAt'>, now: Date): boolean {
  const age = now.getTime() - Date.parse(projection.releasedAt);
  return age >= 0 && Math.floor(age / 86_400_000) <= KEV_REVIEW_DAYS;
}

export function assessKevPublisherUpdate(next: KevProjection, previous: Omit<KevProjection, 'sourceUrl'>, now: Date) {
  const date = Date.parse(next.releasedAt);
  const previousDate = Date.parse(previous.releasedAt);
  const incoming = new Set(next.identifiers);
  const removed = previous.identifiers.filter(id => !incoming.has(id)).length;
  const added = incoming.size - (previous.identifiers.length - removed);
  const status = date < previousDate || date > now.getTime() || next.catalogVersion < previous.catalogVersion || removed
    ? 'review_required' as const
    : next.catalogVersion === previous.catalogVersion
      ? date === previousDate && next.sourceSha256 === previous.sourceSha256 && added === 0 ? 'unchanged' as const : 'review_required' as const
      : date > previousDate && kevProjectionIsCurrent(next, now) ? 'additive' as const : 'review_required' as const;
  return { status, added, removed };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function projectCatalogue(value: unknown, expectedVersion: string, expectedReleasedAt: string): string[] {
  const source = record(value);
  if (source.catalogVersion !== expectedVersion || source.dateReleased !== expectedReleasedAt) {
    throw new Error('CISA KEV catalogue version or release date does not match the pinned metadata.');
  }
  if (normalizeExplicitIsoTimestamp(source.dateReleased) === null) throw new TypeError('CISA KEV catalogue has an invalid release timestamp.');
  const vulnerabilities = Array.isArray(source.vulnerabilities) ? source.vulnerabilities : [];
  if (vulnerabilities.length === 0 || vulnerabilities.length > MAX_ENTRIES) {
    throw new RangeError(`CISA KEV catalogue must contain between 1 and ${MAX_ENTRIES} records.`);
  }
  const identifiers = new Set<string>();
  for (const item of vulnerabilities) {
    const cve = record(item).cveID;
    if (!isCveIdentifier(cve)) throw new TypeError('CISA KEV catalogue contains an invalid CVE identifier.');
    identifiers.add(cve);
  }
  if (identifiers.size !== vulnerabilities.length || source.count !== vulnerabilities.length) {
    throw new Error('CISA KEV catalogue count or uniqueness check failed.');
  }
  return [...identifiers].sort();
}

export function admitKevProjection(value: unknown): KevProjection {
  const { catalogVersion, releasedAt, sourceSha256, sourceUrl, identifiers } = record(value);
  if (typeof catalogVersion !== 'string' || !KEV_VERSION.test(catalogVersion)
    || typeof releasedAt !== 'string' || !normalizeExplicitIsoTimestamp(releasedAt)
    || typeof sourceSha256 !== 'string' || !SHA256.test(sourceSha256)
    || sourceUrl !== KEV_SOURCE_URL || !Array.isArray(identifiers) || !identifiers.length
    || identifiers.length > MAX_ENTRIES || !identifiers.every(isCveIdentifier)
    || identifiers.some((id, index) => index > 0 && (identifiers[index - 1] ?? '') >= id)) {
    throw new TypeError('Invalid known-exploited vulnerability projection.');
  }
  const projection = Object.freeze({ catalogVersion, releasedAt, sourceSha256, sourceUrl, identifiers: Object.freeze([...identifiers]) });
  if (Buffer.byteLength(JSON.stringify(projection), 'utf8') > MAX_KEV_PROJECTION_BYTES) {
    throw new RangeError('Known-exploited vulnerability projection exceeds its byte limit.');
  }
  return projection;
}

export function parseKevSource(text: string): KevProjection {
  const source = parseBoundedJsonObject(text, { maximumBytes: MAX_KEV_SOURCE_BYTES, label: 'Known-exploited vulnerability source' });
  return projectKevPublisher(source, createHash('sha256').update(text).digest('hex'));
}

export function projectKevPublisher(source: Record<string, unknown>, sourceSha256: string): KevProjection {
  const catalogVersion = source.catalogVersion;
  const releasedAt = source.dateReleased;
  if (typeof catalogVersion !== 'string' || !KEV_VERSION.test(catalogVersion) || typeof releasedAt !== 'string') {
    throw new TypeError('Invalid known-exploited vulnerability source identity.');
  }
  return admitKevProjection({
    catalogVersion, releasedAt, sourceSha256, sourceUrl: KEV_SOURCE_URL,
    identifiers: projectCatalogue(source, catalogVersion, releasedAt),
  });
}

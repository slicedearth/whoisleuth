import { array, enumeration, exact, iso, text } from '../evidence/artifact-structure.mts';
import { pageObservationOrigin } from './page-behaviour.mts';
import { CASE_PROVIDER_OUTCOMES, CASE_OBSERVED_EFFECT_STATES } from '../cases/case-response-records.mts';
import { CONTEXT_REVIEW_SCHEMA, CONTEXT_REVIEW_VERSION, MAX_CONTEXT_RECORDS, type ContextObservation, type ContextReview } from '../contracts/context-review.mts';

export { PLATFORM_CONTINUITY_INPUT_SCHEMA, PLATFORM_CONTINUITY_INPUT_VERSION } from '../contracts/context-review.mts';
export const PLATFORM_OBJECT_TYPES = ['account', 'tenant', 'application', 'extension', 'package', 'page', 'channel', 'post'] as const;
export type PlatformObjectType = typeof PLATFORM_OBJECT_TYPES[number];
export const PLATFORM_REPORT_STATES = ['not_reported', 'submitted', 'acknowledged'] as const;
export type PlatformObject = Readonly<{ platformOrigin: string; objectType: PlatformObjectType; objectId: string; version: string | null; observedAt: string; source: string;
  report: typeof PLATFORM_REPORT_STATES[number]; providerOutcome: typeof CASE_PROVIDER_OUTCOMES[number] | null; recheck: typeof CASE_OBSERVED_EFFECT_STATES[number]; recheckedAt: string | null }>;

export function readPlatformObjects(raw: unknown): PlatformObject[] {
  const rows = array(raw, 'Platform objects', MAX_CONTEXT_RECORDS).map(value => {
    const row = exact(value, ['platformOrigin', 'objectType', 'objectId', 'version', 'observedAt', 'source', 'report', 'providerOutcome', 'recheck', 'recheckedAt'], 'Platform object');
    const platformOrigin = text(row.platformOrigin, 'Platform origin', 500);
    if (pageObservationOrigin(platformOrigin) !== platformOrigin) throw new TypeError('Platform origin must be an HTTP(S) origin without credentials, paths or query data.');
    const objectId = text(row.objectId, 'Stable object ID', 240);
    if (!/^[A-Za-z0-9_@.:%/+~-]+$/u.test(objectId)) throw new TypeError('Stable object ID must contain identifier characters, not free text.');
    iso(row.observedAt, 'Object observation time'); iso(row.recheckedAt, 'Object recheck time', true);
    const recheck = enumeration(row.recheck, CASE_OBSERVED_EFFECT_STATES, 'Object recheck');
    if ((recheck === 'not_checked') !== (row.recheckedAt === null)) throw new TypeError('A recheck result needs its own observation time; unchecked objects must not carry one.');
    if (row.recheckedAt !== null && Date.parse(row.recheckedAt as string) < Date.parse(row.observedAt as string)) throw new TypeError('Object recheck predates its observation.');
    const report = enumeration(row.report, PLATFORM_REPORT_STATES, 'Report status');
    const providerOutcome = row.providerOutcome === null ? null : enumeration(row.providerOutcome, CASE_PROVIDER_OUTCOMES, 'Provider outcome');
    if (providerOutcome !== null && report === 'not_reported') throw new TypeError('A provider outcome needs a reported object.');
    return { platformOrigin, objectType: enumeration(row.objectType, PLATFORM_OBJECT_TYPES, 'Platform object type'), objectId,
      version: row.version === null ? null : text(row.version, 'Object version', 100), observedAt: row.observedAt as string, source: text(row.source, 'Object source', 500), report, providerOutcome, recheck, recheckedAt: row.recheckedAt as string | null };
  });
  const identities = rows.map(row => JSON.stringify([row.platformOrigin, row.objectType, row.objectId, row.version, row.observedAt]));
  if (new Set(identities).size !== rows.length) throw new TypeError('Duplicate platform object observations must be reconciled explicitly.');
  return rows;
}

export function reviewPlatformContinuity(raw: unknown, reviewedAt: string): ContextReview {
  iso(reviewedAt, 'Review time');
  const rows = readPlatformObjects(raw), groups = new Map<string, PlatformObject[]>();
  for (const row of rows) { const key = JSON.stringify([row.platformOrigin, row.objectType, row.objectId]); groups.set(key, [...(groups.get(key) ?? []), row]); }
  const observations: ContextObservation[] = [];
  for (const values of groups.values()) {
    values.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    const versions = new Set(values.map(row => row.version).filter(value => value !== null));
    for (const row of values) observations.push({ label: `${row.objectType} · ${row.objectId}${row.version ? ` · version ${row.version}` : ''}`, state: 'reported',
      detail: `${row.report.replaceAll('_', ' ')}; provider outcome: ${row.providerOutcome?.replaceAll('_', ' ') ?? 'not supplied'}; independent recheck: ${row.recheck.replaceAll('_', ' ')}${row.recheckedAt ? ` at ${row.recheckedAt}` : ''}. ${versions.size > 1 ? `${versions.size} versions retained for this same declared object.` : 'No version change established.'}`,
      source: `${row.platformOrigin} · ${row.source}`, observedAt: row.observedAt, hostname: new URL(row.platformOrigin).hostname });
  }
  const unresolved = rows.filter(row => ['not_checked', 'still_observed', 'changed', 'unavailable'].includes(row.recheck)).length;
  return { schema: CONTEXT_REVIEW_SCHEMA, version: CONTEXT_REVIEW_VERSION, kind: 'platform_continuity', reviewedAt, title: 'Platform object continuity',
    state: rows.length ? 'reviewed' : 'partial', summary: `Recorded observations: ${rows.length}; distinct platform objects: ${groups.size}; observations needing follow-up or a qualified outcome: ${unresolved}.`, observations,
    nextSteps: ['Use the exact object and version when preparing a provider report; do not report an entire shared platform from a hosted URL alone.', 'Record each report and recheck separately. New versions, changed content and newly observed objects require their own review.'],
    limitations: ['Platform origin, object identity and outcomes are analyst-supplied metadata, not verified provider telemetry.', 'A matching object ID establishes only declared continuity within that platform and object type. Provider resolution is separate from independent recheck; not reproduced does not establish worldwide removal.'] };
}

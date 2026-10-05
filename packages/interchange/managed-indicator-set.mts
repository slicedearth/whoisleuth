import { array, digest, domain, enumeration, exact, exactOptional, integer, iso, text, validateIntegrity } from '../evidence/artifact-structure.mts';
import { canonicalArtifactJsonV2, sha256ArtifactDigestV2, SORTED_JSON_V2 } from '../evidence/artifact-integrity.mts';
import { assertWorkspaceInputGraph } from '../workspace/hostile-input.mts';
import { parseBoundedJson, boundedJsonLimitsForBytes } from '../analysis/bounded-json.mts';
import { MANAGED_INDICATOR_SET_SCHEMA, MANAGED_INDICATOR_SET_VERSION, MAX_MANAGED_INDICATOR_SET_BYTES, MAX_MANAGED_INDICATOR_PLAN_BYTES } from '../contracts/analyst-interchange.mts';
import { defensiveIndicatorProvenance, prepareDefensiveIndicatorExport, MAX_DEFENSIVE_INDICATOR_INPUTS } from './defensive-indicator-export.mts';
import { MAX_STIX_INDICATORS } from './stix-indicator-export.mts';
import { terminalSafeJson } from './json-output.mts';

export const MAX_MANAGED_INDICATORS = MAX_STIX_INDICATORS;
export const MAX_INDICATOR_REVIEW_BASIS = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AVAILABILITY = ['registered', 'for_sale', 'expiring'] as const;
export type ManagedIndicator = {
  id: string; domain: string; createdAt: string; modifiedAt: string; expiresAt: string;
  basis: string; reviewBasis: string;
  observation: ReturnType<typeof defensiveIndicatorProvenance> & { availability: typeof AVAILABILITY[number] };
  withdrawal: { at: string; reason: string } | null;
};
export type ManagedIndicatorSet = {
  schema: typeof MANAGED_INDICATOR_SET_SCHEMA; version: typeof MANAGED_INDICATOR_SET_VERSION;
  id: string; producerId: string; revisionId: string; name: string; revision: number;
  createdAt: string; modifiedAt: string;
  previous: { revisionId: string; digestSha256: string } | null;
  entries: ManagedIndicator[];
  integrity: { algorithm: 'SHA-256'; canonicalization: typeof SORTED_JSON_V2; digestSha256: string };
};
export type ManagedIndicatorChange = { id: string; domain: string; kind: 'added' | 'renewed' | 'withdrawn' };

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError('Indicator identities must be lowercase version-4 UUIDs.');
  return value;
}
function timestamp(value: unknown, label: string): string { iso(value, label); return value as string; }
function basis(value: unknown): string {
  const result = text(value, 'Indicator review basis', MAX_INDICATOR_REVIEW_BASIS).trim();
  if (!result) throw new TypeError('Explain the indicator revision.');
  return result;
}
function bounded(value: unknown, maximumBytes: number) {
  assertWorkspaceInputGraph(value, 'Indicator input', { maximumBytes });
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximumBytes) throw new TypeError('Indicator input exceeds its byte limit.');
}

/** Structural validation is independent of digest verification and author trust. */
export function validateManagedIndicatorSet(value: unknown): ManagedIndicatorSet {
  bounded(value, MAX_MANAGED_INDICATOR_SET_BYTES);
  const root = exact(value, ['schema', 'version', 'id', 'producerId', 'revisionId', 'name', 'revision', 'createdAt', 'modifiedAt', 'previous', 'entries', 'integrity'], 'Managed indicator set');
  if (root.schema !== MANAGED_INDICATOR_SET_SCHEMA || root.version !== MANAGED_INDICATOR_SET_VERSION) throw new TypeError('Unsupported managed indicator set schema or version.');
  const identities = [uuid(root.id), uuid(root.producerId), uuid(root.revisionId)];
  if (!text(root.name, 'Indicator set name', 120).trim()) throw new TypeError('Name the indicator set.');
  const revision = integer(root.revision, 'Indicator revision', 1);
  const created = Date.parse(timestamp(root.createdAt, 'Set creation time')), modified = Date.parse(timestamp(root.modifiedAt, 'Set modification time'));
  if (modified < created || (revision === 1 && modified !== created)) throw new TypeError('Indicator revision times are inconsistent.');
  if (revision === 1) {
    if (root.previous !== null) throw new TypeError('An initial indicator revision has no predecessor.');
  } else {
    const previous = exact(root.previous, ['revisionId', 'digestSha256'], 'Preceding indicator revision');
    identities.push(uuid(previous.revisionId)); digest(previous.digestSha256, 'Preceding revision digest');
  }
  const activeDomains = new Set<string>();
  for (const item of array(root.entries, 'Managed indicators', MAX_MANAGED_INDICATORS, 1)) {
    const entry = exact(item, ['id', 'domain', 'createdAt', 'modifiedAt', 'expiresAt', 'basis', 'reviewBasis', 'observation', 'withdrawal'], 'Managed indicator');
    identities.push(uuid(entry.id)); domain(entry.domain, 'Managed indicator domain');
    const first = Date.parse(timestamp(entry.createdAt, 'Indicator creation time'));
    const last = Date.parse(timestamp(entry.modifiedAt, 'Indicator modification time'));
    const expires = Date.parse(timestamp(entry.expiresAt, 'Indicator review expiry'));
    if (first < created || last < first || last > modified || expires <= first || (entry.withdrawal === null && expires <= last)) throw new TypeError('Indicator entry times are inconsistent.');
    basis(entry.basis); basis(entry.reviewBasis);
    const observation = exact(entry.observation, ['availability', 'riskScore', 'riskModelVersion', 'scanDepth', 'observedAt'], 'Indicator observation');
    enumeration(observation.availability, AVAILABILITY, 'Indicator registration observation');
    if (observation.riskScore !== null) integer(observation.riskScore, 'Retained risk score', 0, 100);
    if (observation.riskModelVersion !== null) integer(observation.riskModelVersion, 'Retained risk model', 1, 1_000);
    enumeration(observation.scanDepth, ['fast', 'deep', 'unknown'], 'Retained scan depth');
    iso(observation.observedAt, 'Retained observation time', true);
    if (entry.withdrawal === null) {
      if (activeDomains.has(entry.domain as string)) throw new TypeError('Only one active identity per domain is allowed in a managed set.');
      activeDomains.add(entry.domain as string);
    } else {
      const withdrawal = exact(entry.withdrawal, ['at', 'reason'], 'Indicator withdrawal');
      if (timestamp(withdrawal.at, 'Withdrawal time') !== entry.modifiedAt) throw new TypeError('Withdrawal must be the final indicator modification.');
      basis(withdrawal.reason);
    }
  }
  if (new Set(identities).size !== identities.length) throw new TypeError('Managed indicator identities must be distinct.');
  validateIntegrity(root.integrity, 'Managed indicator integrity', root.version, MANAGED_INDICATOR_SET_VERSION);
  return value as ManagedIndicatorSet;
}

export async function readManagedIndicatorSet(value: unknown): Promise<ManagedIndicatorSet> {
  const checked = structuredClone(validateManagedIndicatorSet(value));
  const { integrity, ...unsigned } = checked;
  if (await sha256ArtifactDigestV2(unsigned) !== integrity.digestSha256) throw new TypeError('Managed indicator content does not match its recorded digest.');
  return checked;
}

export function parseManagedIndicatorJson(raw: string, plan = false): unknown {
  const maximumBytes = plan ? MAX_MANAGED_INDICATOR_PLAN_BYTES : MAX_MANAGED_INDICATOR_SET_BYTES;
  return parseBoundedJson(raw, { maximumBytes, label: 'Managed indicator input', limits: boundedJsonLimitsForBytes(maximumBytes) });
}

/** Both writers enforce the reader's budget on final UTF-8 bytes, including escapes. */
export function serializeManagedIndicatorSet(manifest: ManagedIndicatorSet): string {
  const pretty = `${terminalSafeJson(manifest, 2)}\n`;
  if (new TextEncoder().encode(pretty).byteLength <= MAX_MANAGED_INDICATOR_SET_BYTES) return pretty;
  const compact = terminalSafeJson(manifest);
  if (new TextEncoder().encode(compact).byteLength > MAX_MANAGED_INDICATOR_SET_BYTES) {
    throw new TypeError('The indicator revision exceeds the file byte limit after safe JSON encoding; no partial file was created.');
  }
  return compact;
}

export function managedIndicatorState(entry: ManagedIndicator, at: string): 'active' | 'expired' | 'withdrawn' {
  iso(at, 'Review time');
  return entry.withdrawal ? 'withdrawn' : Date.parse(entry.expiresAt) <= Date.parse(at) ? 'expired' : 'active';
}

/** A known predecessor detects removal, rollback and edits to original observations. */
export function compareManagedIndicatorRevisions(previous: ManagedIndicatorSet, next: ManagedIndicatorSet): ManagedIndicatorChange[] {
  validateManagedIndicatorSet(previous); validateManagedIndicatorSet(next);
  if (previous.id !== next.id || previous.producerId !== next.producerId || previous.name !== next.name || previous.createdAt !== next.createdAt
    || next.revision !== previous.revision + 1 || next.previous?.revisionId !== previous.revisionId || next.previous.digestSha256 !== previous.integrity.digestSha256
    || Math.floor(Date.parse(next.modifiedAt) / 1000) <= Math.floor(Date.parse(previous.modifiedAt) / 1000)) {
    throw new TypeError('This is not the next revision of the selected indicator set. Keep both files and review the predecessor.');
  }
  const old = new Map(previous.entries.map(entry => [entry.id, entry]));
  const changes: ManagedIndicatorChange[] = [];
  for (const entry of next.entries) {
    const retained = old.get(entry.id);
    if (!retained) {
      if (entry.createdAt !== next.modifiedAt || entry.modifiedAt !== next.modifiedAt || entry.withdrawal) throw new TypeError('A new indicator must start in the new revision.');
      changes.push({ id: entry.id, domain: entry.domain, kind: 'added' }); continue;
    }
    old.delete(entry.id);
    if (canonicalArtifactJsonV2(retained) === canonicalArtifactJsonV2(entry)) continue;
    if (retained.withdrawal || entry.modifiedAt !== next.modifiedAt || retained.domain !== entry.domain || retained.createdAt !== entry.createdAt
      || retained.basis !== entry.basis || canonicalArtifactJsonV2(retained.observation) !== canonicalArtifactJsonV2(entry.observation)
      || (entry.withdrawal && retained.expiresAt !== entry.expiresAt)) throw new TypeError('A revision cannot rewrite observations or modify a withdrawn identity.');
    changes.push({ id: entry.id, domain: entry.domain, kind: entry.withdrawal ? 'withdrawn' : 'renewed' });
  }
  if (old.size) throw new TypeError('A revision cannot remove retained indicator history.');
  if (!changes.length) throw new TypeError('No indicator change was selected.');
  return changes;
}

export async function buildManagedIndicatorRevision(input: unknown, now = new Date().toISOString()) {
  bounded(input, MAX_MANAGED_INDICATOR_PLAN_BYTES);
  const plan = exactOptional(structuredClone(input), ['basis'], ['name', 'previous', 'rows', 'selectedDomains', 'officialDomains', 'allowlistedDomains', 'commonInfrastructureDomains', 'renewIds', 'withdrawIds', 'reintroduceDomains', 'expiresAt'], 'Indicator revision plan');
  const previous = plan.previous === undefined ? null : await readManagedIndicatorSet(plan.previous);
  const generatedAt = timestamp(now, 'Revision time');
  const reviewBasis = basis(plan.basis);
  const name = plan.name === undefined && previous ? previous.name : text(plan.name, 'Indicator set name', 120).trim();
  if (!name || (previous && name !== previous.name)) throw new TypeError('A revision retains the original set name.');
  function values(key: string, maximum: number, read: (item: unknown) => string): string[] {
    const result = array(plan[key] ?? [], key, maximum).map(read);
    if (new Set(result).size !== result.length) throw new TypeError('Revision selections must not contain duplicates.');
    return result;
  }
  const domains = (key: string) => values(key, MAX_DEFENSIVE_INDICATOR_INPUTS, item => { domain(item, 'Selected domain'); return item as string; });
  const selectedDomains = domains('selectedDomains');
  const preflight = prepareDefensiveIndicatorExport(array(plan.rows ?? [], 'Reviewed rows', MAX_DEFENSIVE_INDICATOR_INPUTS), {
    selectedDomains, officialDomains: domains('officialDomains'), allowlistedDomains: domains('allowlistedDomains'), commonInfrastructureDomains: domains('commonInfrastructureDomains'),
  }, MAX_MANAGED_INDICATORS);
  if (preflight.truncated) throw new TypeError('The selected revision exceeds the managed-set entry limit; no partial revision was created.');
  const renew = new Set(values('renewIds', MAX_MANAGED_INDICATORS, uuid));
  const withdraw = new Set(values('withdrawIds', MAX_MANAGED_INDICATORS, uuid));
  const reintroduce = new Set(domains('reintroduceDomains'));
  if ([...renew].some(id => withdraw.has(id))) throw new TypeError('An indicator cannot be renewed and withdrawn in one revision.');
  const entries = structuredClone(previous?.entries ?? []);
  const known = new Map(entries.map(entry => [entry.id, entry]));
  for (const id of [...renew, ...withdraw]) if (!known.has(id) || known.get(id)!.withdrawal) throw new TypeError('Select an existing, non-withdrawn indicator identity.');
  const active = new Set(entries.filter(entry => !entry.withdrawal).map(entry => entry.domain));
  const withdrawn = new Set(entries.filter(entry => entry.withdrawal).map(entry => entry.domain));
  const additions = preflight.entries.filter(entry => !active.has(entry.domain));
  if ([...reintroduce].some(value => !withdrawn.has(value) || !additions.some(entry => entry.domain === value))) throw new TypeError('Reintroduction must select a withdrawn domain being added with a new identity.');
  for (const entry of additions) if (withdrawn.has(entry.domain) && !reintroduce.has(entry.domain)) throw new TypeError('Explicitly approve a new identity before reintroducing a withdrawn domain.');
  let expiresAt: string | null = null;
  if (additions.length || renew.size) {
    expiresAt = timestamp(plan.expiresAt, 'New review expiry');
    if (Date.parse(expiresAt) <= Date.parse(generatedAt)) throw new TypeError('The new review expiry must be in the future.');
  } else if (plan.expiresAt !== undefined) timestamp(plan.expiresAt, 'New review expiry');
  for (const entry of entries) {
    if (renew.has(entry.id)) { entry.expiresAt = expiresAt!; entry.modifiedAt = generatedAt; entry.reviewBasis = reviewBasis; }
    if (withdraw.has(entry.id)) { entry.withdrawal = { at: generatedAt, reason: reviewBasis }; entry.modifiedAt = generatedAt; entry.reviewBasis = reviewBasis; }
  }
  const randomId = () => globalThis.crypto.randomUUID();
  for (const entry of additions) entries.push({ id: randomId(), domain: entry.domain, createdAt: generatedAt, modifiedAt: generatedAt, expiresAt: expiresAt!, basis: reviewBasis, reviewBasis,
    observation: { availability: entry.source.availability as typeof AVAILABILITY[number], ...defensiveIndicatorProvenance(entry.source) }, withdrawal: null });
  if (!additions.length && !renew.size && !withdraw.size) throw new TypeError('No eligible addition, renewal or withdrawal was selected.');
  const unsigned = { schema: MANAGED_INDICATOR_SET_SCHEMA, version: MANAGED_INDICATOR_SET_VERSION,
    id: previous?.id ?? randomId(), producerId: previous?.producerId ?? randomId(), revisionId: randomId(), name,
    revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? generatedAt, modifiedAt: generatedAt,
    previous: previous ? { revisionId: previous.revisionId, digestSha256: previous.integrity.digestSha256 } : null, entries };
  const manifest = validateManagedIndicatorSet({ ...unsigned, integrity: { algorithm: 'SHA-256', canonicalization: SORTED_JSON_V2, digestSha256: await sha256ArtifactDigestV2(unsigned) } });
  serializeManagedIndicatorSet(manifest);
  const changes: ManagedIndicatorChange[] = previous ? compareManagedIndicatorRevisions(previous, manifest) : manifest.entries.map(entry => ({ id: entry.id, domain: entry.domain, kind: 'added' }));
  return { manifest, changes, unchanged: manifest.entries.length - changes.length, exclusions: preflight.exclusions };
}

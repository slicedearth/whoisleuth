// Source-qualified, privacy-minimised retained infrastructure evidence. No collector
// or store lives here; supplied observations never initiate network work.
import { exact, text, enumeration, array, strings, iso, boolean } from '../evidence/artifact-structure.mts';
import { normalizeDomain } from '../evidence/domain-name.mts';
import { canonicalIpAddress } from '../contracts/ip-address.mts';
import { parseBoundedJson } from '../analysis/bounded-json.mts';
import { technologyEvidenceRoles } from '../../lib/technology-evidence-role.mts';

export const INFRASTRUCTURE_OBSERVATION_SCHEMA = 'whoisleuth.infrastructure-observation';
export const INFRASTRUCTURE_OBSERVATION_VERSION = 1;
export const MAX_INFRASTRUCTURE_OBSERVATION_BYTES = 128 * 1024;
export const MAX_INFRASTRUCTURE_HOSTS = 128;
export const MAX_INFRASTRUCTURE_DNS_ROWS = 512;
export const MAX_INFRASTRUCTURE_CERTIFICATES = 32;
export const MAX_INFRASTRUCTURE_ROLES = 128;
export const INFRASTRUCTURE_SOURCE_FAMILIES = ['dns', 'certificate_log', 'tls', 'technology', 'ip_registration', 'routing', 'origin_observation', 'analyst'] as const;
export const INFRASTRUCTURE_PROVIDER_ROLES = ['dns_operator', 'observed_edge', 'application_platform', 'framework_runtime', 'embedded_dependency', 'address_registration', 'routing_origin', 'observed_origin'] as const;
export const INFRASTRUCTURE_DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR'] as const;
export type InfrastructureProviderRole = typeof INFRASTRUCTURE_PROVIDER_ROLES[number];
export type InfrastructureSource = { id: string; name: string; family: typeof INFRASTRUCTURE_SOURCE_FAMILIES[number]; evidenceClass: 'local_observation' | 'provider_report'; reference: string | null };
export type InfrastructureDnsObservation = { sourceId: string; queriedName: string; ownerName: string; type: typeof INFRASTRUCTURE_DNS_TYPES[number]; observedAt: string; outcome: 'answered' | 'no_data' | 'nxdomain' | 'failed' | 'not_checked'; values: string[]; complete: boolean; truncated: boolean };
export type InfrastructureCertificateObservation = { sourceId: string; fingerprintSha256: string; observedAt: string; names: string[]; namesComplete: boolean };
export type InfrastructureRoleObservation = { sourceId: string; subject: string; subjectType: 'hostname' | 'address'; role: InfrastructureProviderRole; providerId: string; providerLabel: string; value: string; observedAt: string; complete: boolean };
export type InfrastructureObservation = {
  schema: typeof INFRASTRUCTURE_OBSERVATION_SCHEMA; version: typeof INFRASTRUCTURE_OBSERVATION_VERSION;
  id: string; target: string; observedAt: string; mode: 'supplied' | 'selected_lookup' | 'certificate_log';
  scope: { hostnames: string[]; dnsTypes: InfrastructureDnsObservation['type'][]; selection: 'explicit_hosts' | 'certificate_names' };
  coverage: { state: 'complete' | 'partial' | 'failed'; truncated: boolean; detail: string };
  sources: InfrastructureSource[]; dns: InfrastructureDnsObservation[];
  certificates: InfrastructureCertificateObservation[]; roles: InfrastructureRoleObservation[]; limitations: string[];
};
function hostname(raw: unknown): string {
  const value = text(raw, 'Infrastructure hostname', 253);
  if (normalizeDomain(value) !== value) throw new TypeError('Infrastructure hostnames must be exact canonical hostnames.');
  return value;
}
function name(raw: unknown): string {
  const value = text(raw, 'Certificate name', 255);
  hostname(value.startsWith('*.') ? value.slice(2) : value);
  return value;
}
function identifier(raw: unknown, label: string): string {
  const value = text(raw, label, 120);
  if (!/^[a-zA-Z0-9_-]+$/u.test(value)) throw new TypeError(`${label} must use a bounded portable identity.`);
  return value;
}
function unique<T>(values: T[], label: string, key: (value: T) => string = value => String(value)): T[] {
  if (new Set(values.map(key)).size !== values.length) throw new TypeError(`${label} contains duplicate or ambiguous identities.`);
  return values;
}
function at(raw: unknown): string { iso(raw, 'Infrastructure observation time'); return new Date(raw as string).toISOString(); }
function flag(raw: unknown): boolean { boolean(raw, 'Infrastructure completeness'); return raw as boolean; }

/** Exact current reader. Old Case pins lacking this field remain unknown, never reconstructed. */
export function readInfrastructureObservation(raw: unknown): InfrastructureObservation {
  // Bound hostile object traversal before serialisation or parsing work.
  const root = exact(raw, ['schema', 'version', 'id', 'target', 'observedAt', 'mode', 'scope', 'coverage', 'sources', 'dns', 'certificates', 'roles', 'limitations'], 'Infrastructure snapshot');
  if (root.schema !== INFRASTRUCTURE_OBSERVATION_SCHEMA || root.version !== INFRASTRUCTURE_OBSERVATION_VERSION) throw new TypeError('Unsupported infrastructure snapshot schema or version.');
  const scope = exact(root.scope, ['hostnames', 'dnsTypes', 'selection'], 'Infrastructure scope');
  const selection = enumeration(scope.selection, ['explicit_hosts', 'certificate_names'] as const, 'Selection scope');
  const hostnames = unique(array(scope.hostnames, 'Selected hostnames', MAX_INFRASTRUCTURE_HOSTS, selection === 'explicit_hosts' ? 1 : 0).map(hostname), 'Selected hostnames');
  const dnsTypes = unique(array(scope.dnsTypes, 'Selected DNS types', 6).map(value => enumeration(value, INFRASTRUCTURE_DNS_TYPES, 'DNS type')), 'Selected DNS types');
  const coverage = exact(root.coverage, ['state', 'truncated', 'detail'], 'Infrastructure coverage');
  const sources = unique(array(root.sources, 'Infrastructure sources', 16, 1).map(rawSource => {
    const source = exact(rawSource, ['id', 'name', 'family', 'evidenceClass', 'reference'], 'Infrastructure source');
    const reference = source.reference === null ? null : text(source.reference, 'Source reference', 300);
    if (reference !== null && /[?#]|\b(?:cookie|password|bearer)\s*[:=]/iu.test(reference)) throw new TypeError('Source references must not retain query strings, fragments or credentials.');
    if (reference?.includes('://')) {
      let url: URL; try { url = new URL(reference); } catch { throw new TypeError('Source reference URL is invalid.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Source references cannot retain credentials or unsafe URL schemes.');
    }
    return { id: identifier(source.id, 'Source ID'), name: text(source.name, 'Source name', 80), family: enumeration(source.family, INFRASTRUCTURE_SOURCE_FAMILIES, 'Source family'), evidenceClass: enumeration(source.evidenceClass, ['local_observation', 'provider_report'] as const, 'Evidence class'), reference };
  }), 'Source IDs', value => value.id);
  const sourceMap = new Map(sources.map(value => [value.id, value]));
  function sourceId(rawId: unknown, families: readonly InfrastructureSource['family'][]): string {
    const id = identifier(rawId, 'Observation source ID'), source = sourceMap.get(id);
    if (!source || !families.includes(source.family)) throw new TypeError('An observation requires its own matching source family.');
    return id;
  }
  const dns = array(root.dns, 'DNS observations', MAX_INFRASTRUCTURE_DNS_ROWS).map(rawRow => {
    const row = exact(rawRow, ['sourceId', 'queriedName', 'ownerName', 'type', 'observedAt', 'outcome', 'values', 'complete', 'truncated'], 'DNS observation');
    const type = enumeration(row.type, INFRASTRUCTURE_DNS_TYPES, 'DNS type');
    const queriedName = hostname(row.queriedName), ownerName = hostname(row.ownerName);
    if (!hostnames.includes(queriedName) || !dnsTypes.includes(type)) throw new TypeError('DNS observation falls outside its explicit selected scope.');
    const outcome = enumeration(row.outcome, ['answered', 'no_data', 'nxdomain', 'failed', 'not_checked'] as const, 'DNS outcome');
    const values = unique(array(row.values, 'DNS record values', 32).map(rawValue => {
      const value = text(rawValue, 'DNS value', 300);
      if (type === 'A' || type === 'AAAA') {
        const address = canonicalIpAddress(value);
        if (address !== value || (type === 'A') !== !value.includes(':')) throw new TypeError('DNS address value does not match its type.');
      } else if (type === 'MX') {
        const match = /^(\d{1,5}) ([a-z0-9.-]+)$/u.exec(value);
        if (!match || Number(match[1]) > 65535) throw new TypeError('MX records require an explicit preference and target.');
        hostname(match[2]);
      } else hostname(value);
      return value;
    }), 'DNS values');
    if ((outcome === 'answered') !== (values.length > 0)) throw new TypeError('Answered DNS observations require values; other outcomes cannot retain answers.');
    if (type === 'CNAME' && values.length > 1) throw new TypeError('One CNAME owner cannot have competing alias targets.');
    return { sourceId: sourceId(row.sourceId, ['dns']), queriedName, ownerName, type, observedAt: at(row.observedAt), outcome, values, complete: flag(row.complete), truncated: flag(row.truncated) };
  });
  unique(dns, 'DNS observation identities', row => JSON.stringify([row.sourceId, row.queriedName, row.ownerName, row.type, row.observedAt]));
  const certificates = array(root.certificates, 'Certificate observations', MAX_INFRASTRUCTURE_CERTIFICATES).map(rawRow => {
    const row = exact(rawRow, ['sourceId', 'fingerprintSha256', 'observedAt', 'names', 'namesComplete'], 'Certificate observation');
    const fingerprintSha256 = text(row.fingerprintSha256, 'Certificate digest', 64);
    if (!/^[a-f0-9]{64}$/u.test(fingerprintSha256)) throw new TypeError('Certificate identity requires an exact SHA-256 digest.');
    return { sourceId: sourceId(row.sourceId, ['tls', 'certificate_log']), fingerprintSha256, observedAt: at(row.observedAt), names: unique(array(row.names, 'Certificate names', MAX_INFRASTRUCTURE_HOSTS, 1).map(name), 'Certificate names'), namesComplete: flag(row.namesComplete) };
  });
  unique(certificates, 'Certificate observation identities', row => JSON.stringify([row.sourceId, row.fingerprintSha256, row.observedAt]));
  const roleFamilies: Record<InfrastructureProviderRole, InfrastructureSource['family'][]> = {
    dns_operator: ['dns'], observed_edge: ['technology'], application_platform: ['technology'], framework_runtime: ['technology'], embedded_dependency: ['technology'], address_registration: ['ip_registration'], routing_origin: ['routing'], observed_origin: ['origin_observation'],
  };
  const roles = array(root.roles, 'Provider role observations', MAX_INFRASTRUCTURE_ROLES).map(rawRow => {
    const row = exact(rawRow, ['sourceId', 'subject', 'subjectType', 'role', 'providerId', 'providerLabel', 'value', 'observedAt', 'complete'], 'Provider role observation');
    const subjectType = enumeration(row.subjectType, ['hostname', 'address'] as const, 'Provider subject type');
    const subject = subjectType === 'hostname' ? hostname(row.subject) : text(row.subject, 'Provider address', 45);
    if (subjectType === 'address' && canonicalIpAddress(subject) !== subject) throw new TypeError('Provider role address is invalid.');
    if (subjectType === 'hostname' && !hostnames.includes(subject)) throw new TypeError('Provider-role hostname falls outside the selected scope.');
    const role = enumeration(row.role, INFRASTRUCTURE_PROVIDER_ROLES, 'Provider role');
    const value = text(row.value, 'Provider role value', 300);
    if (role === 'routing_origin') {
      if (subjectType !== 'address' || !/^AS(?:[1-9]\d{0,9})$/u.test(value) || Number(value.slice(2)) > 4_294_967_295) throw new TypeError('Routing evidence requires an address and independently sourced ASN.');
    }
    if (role === 'observed_origin' && normalizeDomain(value) !== value && canonicalIpAddress(value) !== value) throw new TypeError('Independently observed origin must retain an exact hostname or address.');
    return { sourceId: sourceId(row.sourceId, roleFamilies[role]), subject, subjectType, role, providerId: identifier(row.providerId, 'Provider ID'), providerLabel: text(row.providerLabel, 'Provider label', 100), value, observedAt: at(row.observedAt), complete: flag(row.complete) };
  });
  unique(roles, 'Provider-role observation identities', row => JSON.stringify([row.sourceId, row.subjectType, row.subject, row.role, row.providerId, row.observedAt]));
  if (roles.some(row => row.subjectType === 'address' && !dns.some(answer => answer.values.includes(row.subject)))) throw new TypeError('Provider-role addresses must have explicit supporting DNS address observations within the snapshot.');
  const result: InfrastructureObservation = { schema: INFRASTRUCTURE_OBSERVATION_SCHEMA, version: INFRASTRUCTURE_OBSERVATION_VERSION, id: identifier(root.id, 'Snapshot ID'), target: hostname(root.target), observedAt: at(root.observedAt), mode: enumeration(root.mode, ['supplied', 'selected_lookup', 'certificate_log'] as const, 'Collection mode'), scope: { hostnames, dnsTypes, selection: enumeration(scope.selection, ['explicit_hosts', 'certificate_names'] as const, 'Selection scope') }, coverage: { state: enumeration(coverage.state, ['complete', 'partial', 'failed'] as const, 'Coverage state'), truncated: flag(coverage.truncated), detail: text(coverage.detail, 'Coverage detail', 500) }, sources, dns, certificates, roles, limitations: unique(strings(root.limitations, 'Infrastructure limitations', 12, 300), 'Infrastructure limitations') };
  if ([...dns, ...certificates, ...roles].some(row => row.observedAt > result.observedAt)) throw new TypeError('Snapshot time cannot precede one of its retained observations.');
  if (result.coverage.state === 'complete' && (result.coverage.truncated || dns.some(row => !row.complete || row.truncated || ['failed', 'not_checked'].includes(row.outcome)) || certificates.some(row => !row.namesComplete) || roles.some(row => !row.complete))) throw new TypeError('Complete snapshot coverage cannot contain incomplete observations.');
  if (result.coverage.state === 'complete' && hostnames.some(host => dnsTypes.some(type => !dns.some(row => row.queriedName === host && row.type === type)))) throw new TypeError('Complete DNS coverage requires every explicitly selected host/type pair.');
  if (new TextEncoder().encode(`${JSON.stringify(result)}\n`).byteLength > MAX_INFRASTRUCTURE_OBSERVATION_BYTES) throw new TypeError('Infrastructure snapshot exceeds its retained byte bound.');
  return result;
}
export function normalizeInfrastructureObservation(raw: unknown): InfrastructureObservation | null {
  if (raw === undefined || raw === null) return null;
  return readInfrastructureObservation(raw);
}
export function parseInfrastructureObservation(raw: string): InfrastructureObservation {
  return readInfrastructureObservation(parseBoundedJson(raw, { label: 'Infrastructure snapshot', maximumBytes: MAX_INFRASTRUCTURE_OBSERVATION_BYTES }));
}
export function serialiseInfrastructureObservation(raw: unknown): string { return `${JSON.stringify(readInfrastructureObservation(raw))}\n`; }

export function infrastructureObservationFacts(raw: unknown) {
  const snapshot = readInfrastructureObservation(raw);
  const sources = new Map(snapshot.sources.map(source => [source.id, source]));
  const facts: { key: string; hostname: string; family: string; value: string; observedAt: string; source: InfrastructureSource; complete: boolean }[] = [];
  for (const row of snapshot.dns) for (const value of row.values) facts.push({ key: JSON.stringify([row.sourceId, row.ownerName, row.type]), hostname: row.ownerName, family: row.type, value, observedAt: row.observedAt, source: sources.get(row.sourceId)!, complete: row.complete && !row.truncated });
  for (const row of snapshot.dns) facts.push({ key: JSON.stringify([row.sourceId, row.queriedName, row.ownerName, row.type, 'outcome']), hostname: row.ownerName, family: `${row.type}_outcome`, value: row.outcome, observedAt: row.observedAt, source: sources.get(row.sourceId)!, complete: row.complete && !row.truncated && !['failed', 'not_checked'].includes(row.outcome) });
  for (const row of snapshot.certificates) for (const value of row.names) facts.push({ key: JSON.stringify([row.sourceId, row.fingerprintSha256, 'certificate_names']), hostname: value, family: 'certificate_names', value, observedAt: row.observedAt, source: sources.get(row.sourceId)!, complete: row.namesComplete });
  for (const row of snapshot.roles) facts.push({ key: JSON.stringify([row.sourceId, row.subject, row.role]), hostname: row.subject, family: row.role, value: `${row.providerId}: ${row.value}`, observedAt: row.observedAt, source: sources.get(row.sourceId)!, complete: row.complete });
  return { snapshot, facts };
}
export function compareInfrastructureObservations(earlierRaw: unknown, laterRaw: unknown) {
  const earlier = infrastructureObservationFacts(earlierRaw), later = infrastructureObservationFacts(laterRaw);
  const scope = (row: InfrastructureObservation) => JSON.stringify({ target: row.target, mode: row.mode, selection: row.scope.selection, hostnames: [...row.scope.hostnames].sort(), dnsTypes: [...row.scope.dnsTypes].sort(), sources: [...row.sources].sort((a, b) => a.id.localeCompare(b.id)) });
  const comparable = scope(earlier.snapshot) === scope(later.snapshot) && earlier.snapshot.observedAt < later.snapshot.observedAt;
  const complete = comparable && [earlier.snapshot, later.snapshot].every(row => row.coverage.state === 'complete' && !row.coverage.truncated);
  const groups = new Map<string, { hostname: string; family: string; source: InfrastructureSource; before: string[]; after: string[]; complete: boolean }>();
  for (const [side, values] of [['before', earlier.facts], ['after', later.facts]] as const) for (const fact of values) {
    const group = groups.get(fact.key) ?? { hostname: fact.hostname, family: fact.family, source: fact.source, before: [], after: [], complete: true };
    group[side].push(fact.value); group.complete &&= fact.complete; groups.set(fact.key, group);
  }
  const rows = [...groups.values()].map(row => {
    row.before = [...new Set(row.before)].sort(); row.after = [...new Set(row.after)].sort();
    const same = JSON.stringify(row.before) === JSON.stringify(row.after);
    const state = !comparable ? 'incomparable' : same ? complete && row.complete ? 'unchanged' : 'unknown' : !row.before.length ? row.complete ? 'newly_observed' : 'unknown' : !row.after.length ? complete && row.complete ? 'not_returned' : 'unknown' : complete && row.complete ? 'changed' : 'unknown';
    return { ...row, state, detail: state === 'not_returned' ? 'Not returned by this comparable bounded collection; this does not establish disappearance.' : state === 'newly_observed' ? 'Newly present in retained evidence; not necessarily newly created.' : state === 'unknown' ? 'Incomplete evidence cannot establish a removal or change.' : state === 'incomparable' ? 'Source, scope, mode or observation ordering differs; no temporal change is inferred.' : 'Source-qualified retained observation comparison.' };
  });
  return { state: comparable ? complete ? 'compared' : 'partial' : 'incomparable', earlier: earlier.snapshot.id, later: later.snapshot.id, rows, limitations: ['No new collection was made. Retained changes do not establish ownership, safety, control or maliciousness.', 'Provider-reported history remains labelled separately from local observations. Empty, failed, limited and changed-source snapshots cannot replace a stronger baseline.'] };
}

/** Technology roles reuse the canonical role owner, not a new signature catalogue. */
export function infrastructureTechnologyRoles(value: unknown) { return technologyEvidenceRoles(value); }

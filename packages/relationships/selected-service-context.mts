import { parseBoundedJsonObject } from '../analysis/bounded-json.mts';
import { addressValue, canonicalIpAddress } from '../contracts/ip-address.mts';
import { exact, exactOptional } from '../evidence/artifact-structure.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { createIncrementalSha256 } from '../evidence/record-identity.mts';
import { compileCidr, inCompiledCidr } from './common-infrastructure.mts';
import { FRESHNESS_DAYS } from './common-infrastructure-health.mts';
import { SELECTED_SERVICE_CONTEXT_INPUT_SCHEMA, SELECTED_SERVICE_CONTEXT_SCHEMA, SELECTED_SERVICE_CONTEXT_VERSION,
  MAX_SELECTED_SERVICE_LIST_BYTES, MAX_SELECTED_SERVICE_ENTRIES, MAX_SELECTED_SERVICE_TARGETS, SERVICE_CONTEXT_ROLES, selectedServiceContextTarget } from '../contracts/selected-service-context.mts';

function text(value: unknown, limit: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${label} is invalid or exceeds its bound.`);
  return value.trim();
}
function hostname(value: unknown): string | null {
  const name = selectedServiceContextTarget(value);
  return name && !addressValue(name) ? name : null;
}

/** Local, selected MISP-compatible hostname/CIDR context; never an allowlist. */
export function reviewSelectedServiceContext(value: unknown, reviewedAt = new Date().toISOString()) {
  const input = exact(value, ['schema', 'version', 'targets', 'role', 'warningListJson', 'provenance'], 'Selected service context');
  if (input.schema !== SELECTED_SERVICE_CONTEXT_INPUT_SCHEMA || input.version !== SELECTED_SERVICE_CONTEXT_VERSION
    || !SERVICE_CONTEXT_ROLES.some(role => role.value === input.role)) throw new TypeError('Selected service context has an unsupported contract.');
  const at = normalizeExplicitIsoTimestamp(reviewedAt);
  if (!at || !Array.isArray(input.targets) || !input.targets.length || input.targets.length > MAX_SELECTED_SERVICE_TARGETS) throw new TypeError('Select a bounded non-empty target list and explicit review time.');
  const targets = [...new Set(input.targets.map(value => {
    if (typeof value !== 'string' || value.length > 254) throw new TypeError('Select a hostname or canonical IP address, not a URL.');
    const target = selectedServiceContextTarget(value);
    if (!target) throw new TypeError('Select a hostname or canonical IP address, not a URL.');
    return target;
  }))];
  const provenance = exactOptional(input.provenance, [], ['sourceUrl', 'revision', 'licence'], 'Selected-list provenance');
  let sourceUrl: string | null = null;
  if (provenance.sourceUrl !== undefined) {
    const url = new URL(text(provenance.sourceUrl, 2_048, 'Source URL'));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) throw new TypeError('Source provenance requires a credential-free HTTPS URL without query or fragment.');
    sourceUrl = url.toString();
  }
  const revision = provenance.revision === undefined ? null : text(provenance.revision, 128, 'Source revision');
  const licence = provenance.licence === undefined ? null : text(provenance.licence, 200, 'Source licence');
  if (typeof input.warningListJson !== 'string' || input.warningListJson.length > MAX_SELECTED_SERVICE_LIST_BYTES) throw new TypeError('Selected warning data exceeds its text bound.');
  const raw = new TextEncoder().encode(input.warningListJson);
  if (raw.length > MAX_SELECTED_SERVICE_LIST_BYTES) throw new TypeError('Selected warning data exceeds its byte bound.');
  const list = parseBoundedJsonObject(input.warningListJson, { maximumBytes: MAX_SELECTED_SERVICE_LIST_BYTES, label: 'Selected warning data',
    limits: { maximumDepth: 8, maximumKeys: 100, maximumValues: MAX_SELECTED_SERVICE_ENTRIES + 1_024,
      maximumContainerItems: MAX_SELECTED_SERVICE_ENTRIES, maximumStringCodeUnits: MAX_SELECTED_SERVICE_LIST_BYTES } });
  const name = text(list.name, 200, 'List name');
  if (!['hostname', 'cidr'].includes(String(list.type)) || !Array.isArray(list.list) || !list.list.length || list.list.length > MAX_SELECTED_SERVICE_ENTRIES
    || !Number.isSafeInteger(list.version) || (list.version as number) < 1
    || list.category !== undefined && !['known', 'false_positive'].includes(String(list.category))) throw new TypeError('Only bounded hostname and CIDR warning lists are supported.');
  const seen = new Set<string>();
  const hostEntries = new Map<string, { exact: boolean; raw: string }[]>();
  const ranges: { raw: string; compiled: NonNullable<ReturnType<typeof compileCidr>> }[] = [];
  for (const entry of list.list) {
    const original = text(entry, 254, 'Warning-list entry');
    if (list.type === 'cidr') {
      const ip = canonicalIpAddress(original), compiled = compileCidr(ip ? `${ip}/${addressValue(ip)!.family === 4 ? 32 : 128}` : original);
      if (!compiled || seen.has(compiled.cidr)) throw new TypeError('CIDR entries are malformed or duplicated.');
      seen.add(compiled.cidr); ranges.push({ raw: original, compiled });
    } else {
      const name = hostname(original.replace(/^\./u, ''));
      if (!name || !name.includes('.') || seen.has(original.toLowerCase())) throw new TypeError('Hostname entries are malformed or duplicated.');
      seen.add(original.toLowerCase());
      const bucket = hostEntries.get(name) ?? [];
      bucket.push({ exact: !original.startsWith('.'), raw: original }); hostEntries.set(name, bucket);
    }
  }
  const version = String(list.version);
  const candidateDate = /^\d{8}$/u.test(version) ? `${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}` : null;
  const publishedAt = candidateDate && normalizeExplicitIsoTimestamp(`${candidateDate}T00:00:00.000Z`) ? candidateDate : null;
  if (candidateDate && !publishedAt) throw new TypeError('The selected list publication date is invalid.');
  if (ranges.length * targets.length > 1_000_000) throw new TypeError('This CIDR review exceeds its comparison budget; select fewer targets or a narrower list.');
  const ageDays = publishedAt ? Math.floor((Date.parse(at) - Date.parse(publishedAt)) / 86_400_000) : null;
  if (ageDays !== null && ageDays < 0) throw new TypeError('The selected list publication date follows the review time.');
  const sourceHealth = ageDays === null ? 'unknown' as const : ageDays > FRESHNESS_DAYS ? 'stale' as const : 'current' as const;
  const results = targets.map(target => {
    const address = addressValue(target);
    const matches: { entry: string; basis: 'ip_cidr' | 'hostname_exact' | 'hostname_suffix' }[] = [];
    if (address) for (const range of ranges) {
      if (inCompiledCidr(address, range.compiled)) matches.push({ entry: range.raw, basis: 'ip_cidr' });
      if (matches.length > 8) break;
    }
    else {
      const labels = target.split('.');
      for (let index = 0; index < labels.length - 1; index++) for (const entry of hostEntries.get(labels.slice(index).join('.')) ?? []) {
        if (index > 0 || entry.exact) matches.push({ entry: entry.raw, basis: index ? 'hostname_suffix' : 'hostname_exact' });
      }
    }
    return { target, matches: matches.slice(0, 8), truncated: matches.length > 8 };
  });
  const digest = createIncrementalSha256(MAX_SELECTED_SERVICE_LIST_BYTES); digest.update(raw);
  return Object.freeze({ schema: SELECTED_SERVICE_CONTEXT_SCHEMA, version: SELECTED_SERVICE_CONTEXT_VERSION, reviewedAt: at,
    state: sourceHealth === 'current' && !results.some(result => result.truncated) ? 'reviewed' as const : 'partial' as const,
    source: { name, version: list.version, role: input.role as string, category: list.category ?? null, publishedAt, sourceHealth, ageDays,
      digestSha256: digest.digestHex(), entryCount: list.list.length, sourceUrl, revision, licence, provenance: 'analyst_selected' as const },
    results, counts: { targets: results.length, matchedTargets: results.filter(result => result.matches.length).length }, networkRequestsMade: false,
    limitations: ['Matches retain the selected publisher’s claim; provenance and licence declarations are not independently authenticated. Stale or undated lists are historical context only.',
      'CIDR membership, exact hostname and DNS-boundary suffix matches are separate. Leading-dot hostname entries match descendants, not the suffix itself. Substring, regex and URL matching are unsupported.',
      'This does not establish safety, ownership, control or maliciousness, change Risk, suppress evidence, download data or contact targets. No match is not an absence finding.'] });
}

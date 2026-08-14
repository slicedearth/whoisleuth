import { normalizeDomain, type CaseRecord } from './case-model.ts';
import {
  MAX_CASE_ASSERTIONS,
  mergeCaseAssertions,
  type CaseAssertionExternalEntityType,
  type CaseAssertionExternalProvenance,
  type CaseAssertionRecord,
} from './case-response-model.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../lib/observation.mts';

export const MAX_EXTERNAL_INTELLIGENCE_IMPORT_BYTES = 512 * 1024;
export const MAX_EXTERNAL_INTELLIGENCE_OBJECTS = 500;
export const MAX_EXTERNAL_INTELLIGENCE_ITEMS = 100;
export const MAX_EXTERNAL_INTELLIGENCE_EXCLUSIONS = 100;
export const MAX_EXTERNAL_INTELLIGENCE_TREE_DEPTH = 12;
export const MAX_EXTERNAL_INTELLIGENCE_TREE_NODES = 8_000;

export type ExternalIntelligenceFormat = 'stix' | 'misp';
export type ExternalIntelligenceClaimType = 'attribute' | 'indicator' | 'observable';

export type ExternalIntelligenceItem = Readonly<{
  key: string;
  externalId: string | null;
  entityType: CaseAssertionExternalEntityType;
  entityValue: string;
  claimType: ExternalIntelligenceClaimType;
  observedAt: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  publisher: string | null;
  confidence: number | null;
  labels: readonly string[];
  markings: readonly string[];
}>;

export type ExternalIntelligenceExclusion = Readonly<{
  externalId: string | null;
  type: string;
  reason: string;
}>;

export type ExternalIntelligencePreview = Readonly<{
  format: ExternalIntelligenceFormat;
  sourceName: string;
  publisher: string | null;
  sourceDigestSha256: string;
  items: readonly ExternalIntelligenceItem[];
  duplicatesSkipped: number;
  conflicts: readonly ExternalIntelligenceExclusion[];
  exclusions: readonly ExternalIntelligenceExclusion[];
  truncated: boolean;
  limitations: readonly string[];
}>;

export type ExternalIntelligenceMergeResult = Readonly<{
  cases: CaseRecord[];
  record: CaseRecord;
  assertionsAdded: number;
  duplicatesSkipped: number;
  capacitySkipped: number;
}>;

type Candidate = Omit<ExternalIntelligenceItem, 'key'>;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const STIX_ID_RE = /^[a-z0-9-]{1,80}--[0-9a-f-]{8,100}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || CONTROL_RE.test(value)) return null;
  return value.trim();
}

function iso(value: unknown): string | null {
  const candidate = text(value, 64);
  return candidate ? normalizeExplicitIsoTimestamp(candidate) : null;
}

function optionalIso(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = iso(value);
  if (!normalized) throw new TypeError(`${label} must include an explicit timezone.`);
  return normalized;
}

function epochIso(value: unknown): string | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,12}$/u.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const parsed = numeric * 1_000;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function confidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
}

function stringList(value: unknown, maximum = 20): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const item of value.slice(0, maximum * 2)) {
    const normalized = text(item, 240);
    if (normalized) output.add(normalized);
    if (output.size >= maximum) break;
  }
  return [...output].sort();
}

function tagNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return stringList(value.map((item) => record(item)?.name), 20);
}

function normalizeIpv4(value: unknown): string | null {
  const candidate = text(value, 64);
  if (!candidate || !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(candidate)) return null;
  const octets = candidate.split('.').map(Number);
  return octets.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
    ? octets.join('.')
    : null;
}

function normalizeIpv6(value: unknown): string | null {
  const candidate = text(value, 128);
  if (!candidate || !candidate.includes(':') || candidate.includes('%')) return null;
  try {
    const hostname = new URL(`http://[${candidate}]/`).hostname.toLowerCase();
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  } catch {
    return null;
  }
}

function normalizeUrl(value: unknown): string | null {
  const candidate = text(value, 1_000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed.toString().slice(0, 1_000);
  } catch {
    return null;
  }
}

function normalizeAsn(value: unknown): string | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^(?:AS)?\d{1,10}$/iu.test(value.trim())
      ? Number(value.trim().replace(/^AS/iu, ''))
      : NaN;
  return Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 4_294_967_295 ? `AS${numeric}` : null;
}

function normalizeCertificate(value: unknown): string | null {
  const candidate = text(value, 128)?.replaceAll(':', '').toLowerCase() ?? '';
  return /^[0-9a-f]{64}$/u.test(candidate) ? candidate : null;
}

function normalizedEntity(
  type: CaseAssertionExternalEntityType,
  value: unknown,
): string | null {
  if (type === 'domain' || type === 'hostname') return normalizeDomain(value) || null;
  if (type === 'url') return normalizeUrl(value);
  if (type === 'ipv4') return normalizeIpv4(value);
  if (type === 'ipv6') return normalizeIpv6(value);
  if (type === 'asn') return normalizeAsn(value);
  return normalizeCertificate(value);
}

function stableItemKey(item: Candidate): string {
  return [
    item.claimType,
    item.entityType,
    item.entityValue,
    item.externalId ?? '',
  ].join('\u0000');
}

function exclusion(externalId: unknown, type: unknown, reason: string): ExternalIntelligenceExclusion {
  return {
    externalId: text(externalId, 200),
    type: text(type, 80) ?? 'unknown',
    reason,
  };
}

export function assertExternalIntelligenceTreeBounds(value: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > MAX_EXTERNAL_INTELLIGENCE_TREE_NODES) {
      throw new Error('The intelligence document exceeds the bounded node limit.');
    }
    if (current.depth > MAX_EXTERNAL_INTELLIGENCE_TREE_DEPTH) {
      throw new Error('The intelligence document is nested too deeply.');
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_EXTERNAL_INTELLIGENCE_OBJECTS * 4) {
        throw new Error('The intelligence document contains an oversized array.');
      }
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    const object = record(current.value);
    if (!object) continue;
    const entries = Object.entries(object);
    if (entries.length > 200) throw new Error('The intelligence document contains an oversized object.');
    for (const [key, child] of entries) {
      if (!text(key, 160)) throw new Error('The intelligence document contains an unsafe object key.');
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function stixEntity(type: unknown, item: Record<string, unknown>): {
  entityType: CaseAssertionExternalEntityType;
  value: unknown;
} | null {
  if (type === 'domain-name') return { entityType: 'domain', value: item.value };
  if (type === 'url') return { entityType: 'url', value: item.value };
  if (type === 'ipv4-addr') return { entityType: 'ipv4', value: item.value };
  if (type === 'ipv6-addr') return { entityType: 'ipv6', value: item.value };
  if (type === 'autonomous-system') return { entityType: 'asn', value: item.number };
  if (type === 'x509-certificate') {
    const hashes = record(item.hashes);
    return { entityType: 'certificate', value: hashes?.['SHA-256'] ?? hashes?.sha256 };
  }
  return null;
}

function stixPatternEntity(pattern: unknown): {
  entityType: CaseAssertionExternalEntityType;
  value: string;
} | null {
  const candidate = text(pattern, 1_200);
  if (!candidate) return null;
  const stringMatch = candidate.match(/^\[(domain-name|url|ipv4-addr|ipv6-addr):value\s*=\s*'([^'\\]{1,1000})'\]$/u);
  if (stringMatch?.[1] && stringMatch[2]) {
    const entityType = ({
      'domain-name': 'domain',
      url: 'url',
      'ipv4-addr': 'ipv4',
      'ipv6-addr': 'ipv6',
    } as const)[stringMatch[1] as 'domain-name' | 'url' | 'ipv4-addr' | 'ipv6-addr'];
    return { entityType, value: stringMatch[2] };
  }
  const asnMatch = candidate.match(/^\[autonomous-system:number\s*=\s*(\d{1,10})\]$/u);
  if (asnMatch?.[1]) return { entityType: 'asn', value: asnMatch[1] };
  const certificateMatch = candidate.match(/^\[x509-certificate:hashes\.'SHA-256'\s*=\s*'([0-9a-fA-F:]{64,95})'\]$/u);
  return certificateMatch?.[1] ? { entityType: 'certificate', value: certificateMatch[1] } : null;
}

function resolveStixMarkings(
  refs: unknown,
  definitions: ReadonlyMap<string, string>,
): string[] {
  return stringList(refs, 12).map((item) => definitions.get(item) ?? item);
}

function parseStix(
  root: Record<string, unknown>,
): Omit<ExternalIntelligencePreview, 'sourceDigestSha256' | 'items' | 'duplicatesSkipped' | 'conflicts' | 'truncated'> & {
  candidates: Candidate[];
} {
  if (root.type !== 'bundle' || !Array.isArray(root.objects)) throw new Error('STIX import requires a STIX 2.1 bundle.');
  if (root.objects.length > MAX_EXTERNAL_INTELLIGENCE_OBJECTS) {
    throw new Error(`STIX bundles are limited to ${MAX_EXTERNAL_INTELLIGENCE_OBJECTS} objects.`);
  }
  const objects = root.objects.map(record);
  if (objects.some((item) => item?.spec_version !== undefined && item.spec_version !== '2.1')) {
    throw new Error('Only STIX 2.1 objects are supported.');
  }
  const identities = new Map<string, string>();
  const markingDefinitions = new Map<string, string>();
  const observations = new Map<string, string>();
  for (const item of objects) {
    if (!item) continue;
    const id = text(item.id, 200);
    if (item.type === 'identity' && id) {
      const name = text(item.name, 160);
      if (name) identities.set(id, name);
    }
    if (item.type === 'marking-definition' && id) {
      const definition = record(item.definition);
      const label = item.definition_type === 'tlp'
        ? `TLP:${text(definition?.tlp, 40)?.toUpperCase() ?? 'UNKNOWN'}`
        : text(item.definition_type, 80) ?? id;
      markingDefinitions.set(id, label);
    }
    if (item.type === 'observed-data' && Array.isArray(item.object_refs)) {
      const observedAt = optionalIso(item.last_observed, 'STIX last_observed')
        ?? optionalIso(item.first_observed, 'STIX first_observed');
      if (observedAt) {
        for (const reference of stringList(item.object_refs, 100)) observations.set(reference, observedAt);
      }
    }
  }
  const defaultPublisher = identities.size === 1 ? [...identities.values()][0] ?? null : null;
  const candidates: Candidate[] = [];
  const exclusions: ExternalIntelligenceExclusion[] = [];
  for (const item of objects) {
    if (!item) {
      exclusions.push(exclusion(null, null, 'Malformed STIX object.'));
      continue;
    }
    const type = text(item.type, 80);
    const externalId = text(item.id, 200);
    if (!type || !externalId || !STIX_ID_RE.test(externalId)) {
      exclusions.push(exclusion(item.id, item.type, 'Missing or invalid STIX type or identifier.'));
      continue;
    }
    const direct = stixEntity(type, item);
    const patterned = type === 'indicator' && item.pattern_type === 'stix' ? stixPatternEntity(item.pattern) : null;
    const entity = direct ?? patterned;
    if (!entity) {
      if (!['identity', 'marking-definition', 'observed-data', 'relationship'].includes(type)) {
        exclusions.push(exclusion(externalId, type, 'Unsupported STIX object or indicator pattern.'));
      }
      continue;
    }
    const entityValue = normalizedEntity(entity.entityType, entity.value);
    if (!entityValue) {
      exclusions.push(exclusion(externalId, type, 'The supported STIX entity value is malformed or unsafe.'));
      continue;
    }
    const publisher = identities.get(text(item.created_by_ref, 200) ?? '') ?? defaultPublisher;
    candidates.push({
      externalId,
      entityType: entity.entityType,
      entityValue,
      claimType: direct ? 'observable' : 'indicator',
      observedAt: observations.get(externalId) ?? optionalIso(item.valid_from, 'STIX valid_from'),
      createdAt: optionalIso(item.created, 'STIX created'),
      modifiedAt: optionalIso(item.modified, 'STIX modified'),
      publisher,
      confidence: confidence(item.confidence),
      labels: stringList(item.labels),
      markings: resolveStixMarkings(item.object_marking_refs, markingDefinitions),
    });
  }
  return {
    format: 'stix',
    sourceName: text(root.id, 160) ?? 'STIX 2.1 bundle',
    publisher: defaultPublisher,
    candidates,
    exclusions: exclusions.slice(0, MAX_EXTERNAL_INTELLIGENCE_EXCLUSIONS),
    limitations: [
      'Only bounded domain, URL, IP, ASN, certificate, and simple exact-match Indicator objects are supported.',
      'WHOISleuth imports external claims as case assertions. It does not independently collect, verify, score, enrich, or act on them.',
    ],
  };
}

function mispEntity(type: unknown, value: unknown): {
  entityType: CaseAssertionExternalEntityType;
  value: unknown;
} | null {
  if (type === 'domain') return { entityType: 'domain', value };
  if (type === 'hostname') return { entityType: 'hostname', value };
  if (type === 'url') return { entityType: 'url', value };
  if (type === 'ip-src' || type === 'ip-dst') {
    return { entityType: typeof value === 'string' && value.includes(':') ? 'ipv6' : 'ipv4', value };
  }
  if (type === 'AS') return { entityType: 'asn', value };
  if (type === 'x509-fingerprint-sha256') return { entityType: 'certificate', value };
  return null;
}

function parseMisp(
  root: Record<string, unknown>,
): Omit<ExternalIntelligencePreview, 'sourceDigestSha256' | 'items' | 'duplicatesSkipped' | 'conflicts' | 'truncated'> & {
  candidates: Candidate[];
} {
  const event = record(root.Event);
  if (!event || !Array.isArray(event.Attribute)) throw new Error('MISP import requires one event with an Attribute array.');
  if (event.Attribute.length > MAX_EXTERNAL_INTELLIGENCE_OBJECTS) {
    throw new Error(`MISP events are limited to ${MAX_EXTERNAL_INTELLIGENCE_OBJECTS} attributes.`);
  }
  const organization = record(event.Orgc);
  const publisher = text(organization?.name, 160);
  const sourceName = text(event.info, 160) ?? 'MISP event';
  const eventLabels = tagNames(event.Tag);
  const eventMarkings = [
    ...(event.distribution === undefined ? [] : [`distribution=${String(event.distribution).slice(0, 20)}`]),
    ...(text(record(event.SharingGroup)?.name, 160) ? [`sharing-group=${text(record(event.SharingGroup)?.name, 160)}`] : []),
  ];
  const candidates: Candidate[] = [];
  const exclusions: ExternalIntelligenceExclusion[] = [];
  for (const raw of event.Attribute) {
    const item = record(raw);
    if (!item) {
      exclusions.push(exclusion(null, null, 'Malformed MISP attribute.'));
      continue;
    }
    const externalId = text(item.uuid, 200);
    const type = text(item.type, 80);
    if (!externalId || !UUID_RE.test(externalId) || !type) {
      exclusions.push(exclusion(item.uuid, item.type, 'Missing or invalid MISP attribute type or UUID.'));
      continue;
    }
    if (item.deleted === true) {
      exclusions.push(exclusion(externalId, type, 'Deleted MISP attributes are not imported.'));
      continue;
    }
    const entity = mispEntity(type, item.value);
    if (!entity) {
      exclusions.push(exclusion(externalId, type, 'Unsupported MISP attribute type.'));
      continue;
    }
    const entityValue = normalizedEntity(entity.entityType, entity.value);
    if (!entityValue) {
      exclusions.push(exclusion(externalId, type, 'The supported MISP attribute value is malformed or unsafe.'));
      continue;
    }
    candidates.push({
      externalId: externalId.toLowerCase(),
      entityType: entity.entityType,
      entityValue,
      claimType: 'attribute',
      observedAt: optionalIso(item.last_seen, 'MISP last_seen')
        ?? optionalIso(item.first_seen, 'MISP first_seen')
        ?? epochIso(item.timestamp),
      createdAt: epochIso(item.timestamp),
      modifiedAt: null,
      publisher,
      confidence: confidence(item.confidence),
      labels: [...new Set([...eventLabels, ...tagNames(item.Tag)])].sort().slice(0, 20),
      markings: [
        ...eventMarkings,
        ...(item.distribution === undefined ? [] : [`attribute-distribution=${String(item.distribution).slice(0, 20)}`]),
      ].slice(0, 12),
    });
  }
  return {
    format: 'misp',
    sourceName,
    publisher,
    candidates,
    exclusions: exclusions.slice(0, MAX_EXTERNAL_INTELLIGENCE_EXCLUSIONS),
    limitations: [
      'Only bounded domain, hostname, URL, IP, ASN, and SHA-256 certificate-fingerprint attributes are supported.',
      'WHOISleuth does not preserve MISP comments, publish events, enable correlation or IDS flags, or contact another system.',
    ],
  };
}

function finalizePreview(
  parsed: ReturnType<typeof parseStix> | ReturnType<typeof parseMisp>,
  sourceDigestSha256: string,
): ExternalIntelligencePreview {
  const conflictKeys = new Set<string>();
  const externalValues = new Map<string, string>();
  for (const candidate of parsed.candidates) {
    if (!candidate.externalId) continue;
    const valueKey = `${candidate.entityType}\u0000${candidate.entityValue}`;
    const existing = externalValues.get(candidate.externalId);
    if (existing && existing !== valueKey) conflictKeys.add(candidate.externalId);
    else externalValues.set(candidate.externalId, valueKey);
  }
  const conflicts = parsed.candidates
    .filter((candidate) => candidate.externalId && conflictKeys.has(candidate.externalId))
    .map((candidate) => exclusion(candidate.externalId, candidate.entityType, 'One external identifier resolves to conflicting normalised values.'))
    .slice(0, MAX_EXTERNAL_INTELLIGENCE_EXCLUSIONS);
  const unique = new Map<string, ExternalIntelligenceItem>();
  let duplicatesSkipped = 0;
  for (const candidate of parsed.candidates) {
    if (candidate.externalId && conflictKeys.has(candidate.externalId)) continue;
    const key = stableItemKey(candidate);
    if (unique.has(key)) {
      duplicatesSkipped += 1;
      continue;
    }
    unique.set(key, { ...candidate, key });
  }
  const all = [...unique.values()].sort((left, right) =>
    left.entityType.localeCompare(right.entityType)
    || left.entityValue.localeCompare(right.entityValue)
    || left.claimType.localeCompare(right.claimType)
    || left.key.localeCompare(right.key));
  const items = all.slice(0, MAX_EXTERNAL_INTELLIGENCE_ITEMS);
  return {
    format: parsed.format,
    sourceName: parsed.sourceName,
    publisher: parsed.publisher,
    sourceDigestSha256,
    items,
    duplicatesSkipped,
    conflicts,
    exclusions: parsed.exclusions,
    truncated: all.length > items.length || parsed.exclusions.length >= MAX_EXTERNAL_INTELLIGENCE_EXCLUSIONS,
    limitations: parsed.limitations,
  };
}

export function parseExternalIntelligenceDocument(
  value: unknown,
  sourceDigestSha256Raw: unknown,
): ExternalIntelligencePreview {
  const sourceDigestSha256 = text(sourceDigestSha256Raw, 64)?.toLowerCase() ?? '';
  if (!SHA256_RE.test(sourceDigestSha256)) throw new Error('External intelligence requires the local source file SHA-256 digest.');
  assertExternalIntelligenceTreeBounds(value);
  const root = record(value);
  if (!root) throw new Error('External intelligence must be a JSON object.');
  if (root.type === 'bundle') return finalizePreview(parseStix(root), sourceDigestSha256);
  if (record(root.Event)) return finalizePreview(parseMisp(root), sourceDigestSha256);
  throw new Error('The selected file is neither a supported STIX 2.1 bundle nor a MISP event.');
}

function hash(value: string): string {
  let result = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function assertionKey(item: ExternalIntelligenceItem, digest: string): string {
  return [
    digest,
    item.externalId ?? '',
    item.claimType,
    item.entityType,
    item.entityValue,
  ].join('\u0000');
}

function assertionFrom(
  item: ExternalIntelligenceItem,
  preview: ExternalIntelligencePreview,
  now: string,
): CaseAssertionRecord {
  const provenance: CaseAssertionExternalProvenance = {
    origin: 'external_import',
    format: preview.format,
    sourceName: preview.sourceName,
    sourceDigestSha256: preview.sourceDigestSha256,
    publisher: item.publisher ?? preview.publisher,
    externalId: item.externalId,
    entityType: item.entityType,
    entityValue: item.entityValue,
    observedAt: item.observedAt,
    createdAt: item.createdAt,
    modifiedAt: item.modifiedAt,
    confidence: item.confidence,
    labels: [...item.labels],
    markings: [...item.markings],
  };
  const statement = `${preview.sourceName} reported ${item.entityType} ${item.entityValue} as an external ${item.claimType}.`;
  return {
    id: `external-${preview.sourceDigestSha256.slice(0, 16)}-${hash(assertionKey(item, preview.sourceDigestSha256))}`,
    kind: 'unknown',
    statement: statement.slice(0, 2_000),
    rationale: 'Imported from a local intelligence file. WHOISleuth did not collect or independently verify this claim.',
    evidencePinIds: [],
    state: 'open',
    createdAt: now,
    updatedAt: now,
    provenance,
  };
}

export function mergeExternalIntelligenceIntoCase(
  current: readonly CaseRecord[],
  caseId: unknown,
  preview: ExternalIntelligencePreview,
  nowRaw: unknown = new Date().toISOString(),
): ExternalIntelligenceMergeResult {
  const id = text(caseId, 64);
  const now = iso(nowRaw);
  if (!id || !now) throw new Error('Select an existing case before merging external intelligence.');
  const index = current.findIndex((item) => item.id === id);
  const existing = current[index];
  if (index < 0 || !existing) throw new Error('The selected case no longer exists.');

  const provenanceKeys = new Set(existing.assertions.flatMap((item) => {
    const provenance = item.provenance;
    if (!provenance) return [];
    return [[
      provenance.sourceDigestSha256,
      provenance.externalId ?? '',
      provenance.entityType,
      provenance.entityValue,
    ].join('\u0000')];
  }));
  const additions: CaseAssertionRecord[] = [];
  let duplicatesSkipped = 0;
  let capacitySkipped = 0;
  const available = Math.max(0, MAX_CASE_ASSERTIONS - existing.assertions.length);
  for (const item of preview.items) {
    const provenanceKey = [
      preview.sourceDigestSha256,
      item.externalId ?? '',
      item.entityType,
      item.entityValue,
    ].join('\u0000');
    if (provenanceKeys.has(provenanceKey)) {
      duplicatesSkipped += 1;
      continue;
    }
    if (additions.length >= available) {
      capacitySkipped += 1;
      continue;
    }
    provenanceKeys.add(provenanceKey);
    additions.push(assertionFrom(item, preview, now));
  }
  const assertions = mergeCaseAssertions(existing.assertions, additions, now);
  const recordValue: CaseRecord = {
    ...existing,
    assertions,
    updatedAt: additions.length ? now : existing.updatedAt,
  };
  const cases = [...current];
  cases[index] = recordValue;
  return {
    cases,
    record: recordValue,
    assertionsAdded: additions.length,
    duplicatesSkipped,
    capacitySkipped,
  };
}

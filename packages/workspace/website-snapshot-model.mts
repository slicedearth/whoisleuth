import { normalizeDomain } from '../cases/case-model.mts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../evidence/observation.mts';
import { assertWorkspaceDeclaredVersion, assertWorkspaceInputGraph, assertWorkspacePortableVersion, ordinaryWorkspaceRecord } from './hostile-input.mts';
import {
  MAX_WEBSITE_SNAPSHOTS,
  MAX_WEBSITE_SNAPSHOTS_PER_DOMAIN,
  MAX_WEBSITE_SNAPSHOT_STORE_BYTES,
  SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS,
  WEBSITE_SNAPSHOT_SCHEMA,
  WEBSITE_SNAPSHOT_SCHEMA_VERSION,
} from '../contracts/workspace-portability.mts';

export {
  MAX_WEBSITE_SNAPSHOTS,
  MAX_WEBSITE_SNAPSHOTS_PER_DOMAIN,
  MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES,
  MAX_WEBSITE_SNAPSHOT_STORE_BYTES,
  SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS,
  WEBSITE_SNAPSHOT_SCHEMA,
  WEBSITE_SNAPSHOT_SCHEMA_VERSION,
} from '../contracts/workspace-portability.mts';

export type WebsiteSnapshotTechnology = Readonly<{
  id: string;
  name: string;
  category: string;
  confidence: string;
}>;
export type WebsiteSnapshotPosture = Readonly<{ id: string; state: string }>;
export type WebsiteSnapshotSource = Readonly<{ source: string; state: string }>;
export type WebsiteSnapshotDependency = Readonly<{
  recordType: 'CNAME' | 'HTTPS' | 'NS' | 'MX' | 'HTTP';
  target: string;
  state: 'candidate' | 'unresolved' | 'active' | 'unsupported' | 'false_positive';
  qualification: string;
  serviceFamily: string | null;
}>;
export type WebsiteCertificateObservation = Readonly<{
  observationVersion: 1;
  source: 'tls';
  collectionDepth: 'deep';
  fingerprintSha256: string;
  spkiFingerprintSha256: string | null;
  issuer: string | null;
  subject: string | null;
  serialNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
  authorized: boolean | null;
  hostnameMatches: boolean | null;
  validity: string | null;
  complete: boolean;
  truncated: boolean;
}>;
export type WebsiteIdentityDigests = Readonly<{
  normalizedHtml: string | null;
  visibleText: string | null;
  domStructure: string | null;
  formStructure: string | null;
  resourceHosts: string | null;
  trackingIdentifiers: string | null;
  faviconHash: string | null;
}>;
export type WebsiteIdentityValues = Readonly<{
  resourceHosts: readonly string[];
  trackingIdentifiers: readonly { type: string; value: string }[];
  formActionOrigins: readonly string[];
}>;
export type WebsiteProfileSnapshot = Readonly<{
  id: string;
  domain: string;
  observedAt: string;
  savedAt: string;
  complete: boolean;
  truncated: boolean;
  technologies: WebsiteSnapshotTechnology[];
  posture: WebsiteSnapshotPosture[];
  identity: WebsiteIdentityDigests;
  identityValues: WebsiteIdentityValues;
  sources: WebsiteSnapshotSource[];
  dependencies: WebsiteSnapshotDependency[];
  certificate: WebsiteCertificateObservation | null;
}>;
export type WebsiteSnapshotChange = Readonly<{
  field: string;
  state: 'added' | 'removed' | 'changed' | 'unavailable' | 'incomparable';
  before: string | null;
  after: string | null;
}>;
export type WebsiteDependencyTransition = Readonly<{
  target: string;
  recordType: WebsiteSnapshotDependency['recordType'];
  state: 'active_to_unresolved' | 'active_to_deprovision_cue' | 'added' | 'removed';
  detail: string;
}>;

type UnknownRecord = Record<string, unknown>;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const DIGEST_RE = /^[a-f0-9]{16,128}$/iu;
const SHA256_RE = /^[a-f0-9]{64}$/iu;
const SERIAL_RE = /^[a-f0-9]{1,128}$/iu;

function record(value: unknown): UnknownRecord | null {
  return ordinaryWorkspaceRecord(value, 'Website-snapshot input');
}
function text(value: unknown, maximum: number): string {
  return typeof value === 'string' && value.length <= maximum && !CONTROL_RE.test(value)
    ? value.trim()
    : '';
}
function timestamp(value: unknown, legacy = false): string {
  return normalizeExplicitIsoTimestamp(value)
    ?? (legacy ? normalizeLegacyIsoTimestamp(value) : null)
    ?? '';
}
function digest(value: unknown): string | null {
  const candidate = text(value, 128).toLowerCase();
  return DIGEST_RE.test(candidate) ? candidate : null;
}
function values(raw: unknown, limit: number, normalize: (value: unknown) => unknown | null): unknown[] {
  if (!Array.isArray(raw)) return [];
  const output: unknown[] = [];
  const seen = new Set<string>();
  for (const value of raw.slice(0, limit * 4)) {
    const normalized = normalize(value);
    if (!normalized) continue;
    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function technology(value: unknown): WebsiteSnapshotTechnology | null {
  const item = record(value);
  const id = text(item?.id, 80);
  const name = text(item?.name, 120);
  if (!id || !name) return null;
  return { id, name, category: text(item?.category, 80) || 'technology', confidence: text(item?.confidence, 40) || 'unknown' };
}
function posture(value: unknown): WebsiteSnapshotPosture | null {
  const item = record(value);
  const id = text(item?.id, 80);
  const state = text(item?.state, 40);
  return id && state ? { id, state } : null;
}
function source(value: unknown): WebsiteSnapshotSource | null {
  const item = record(value);
  const sourceName = text(item?.source, 40);
  const state = text(item?.state, 40);
  return sourceName && state ? { source: sourceName, state } : null;
}
function dependency(value: unknown): WebsiteSnapshotDependency | null {
  const item = record(value);
  const recordType = text(item?.recordType, 10);
  const target = normalizeDomain(item?.target);
  const state = text(item?.state, 40);
  if (!target
    || !['CNAME', 'HTTPS', 'NS', 'MX', 'HTTP'].includes(recordType)
    || !['candidate', 'unresolved', 'active', 'unsupported', 'false_positive'].includes(state)) return null;
  return {
    recordType: recordType as WebsiteSnapshotDependency['recordType'],
    target,
    state: state as WebsiteSnapshotDependency['state'],
    qualification: text(item?.qualification, 80) || 'inconclusive',
    serviceFamily: nullableText(item?.serviceFamily, 120),
  };
}
function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
function nullableText(value: unknown, maximum: number): string | null {
  return text(value, maximum) || null;
}
function certificate(value: unknown, legacyTimestamps = false): WebsiteCertificateObservation | null {
  const item = record(value);
  const fingerprintSha256 = text(item?.fingerprintSha256, 64).toLowerCase();
  if (!SHA256_RE.test(fingerprintSha256)) return null;
  const spkiCandidate = text(item?.spkiFingerprintSha256, 64).toLowerCase();
  const serialCandidate = text(item?.serialNumber, 128).toLowerCase();
  return {
    observationVersion: 1,
    source: 'tls',
    collectionDepth: 'deep',
    fingerprintSha256,
    spkiFingerprintSha256: SHA256_RE.test(spkiCandidate) ? spkiCandidate : null,
    issuer: nullableText(item?.issuer, 180),
    subject: nullableText(item?.subject, 180),
    serialNumber: SERIAL_RE.test(serialCandidate) ? serialCandidate : null,
    validFrom: timestamp(item?.validFrom, legacyTimestamps) || null,
    validTo: timestamp(item?.validTo, legacyTimestamps) || null,
    authorized: nullableBoolean(item?.authorized),
    hostnameMatches: nullableBoolean(item?.hostnameMatches),
    validity: nullableText(item?.validity, 40),
    complete: item?.complete === true,
    truncated: item?.truncated === true,
  };
}
function identity(value: unknown): WebsiteIdentityDigests {
  const item = record(value);
  return {
    normalizedHtml: digest(item?.normalizedHtml),
    visibleText: digest(item?.visibleText),
    domStructure: digest(item?.domStructure),
    formStructure: digest(item?.formStructure),
    resourceHosts: digest(item?.resourceHosts),
    trackingIdentifiers: digest(item?.trackingIdentifiers),
    faviconHash: digest(item?.faviconHash),
  };
}

function origin(value: unknown): string {
  const candidate = text(value, 500);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol)
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      ? parsed.origin.toLowerCase()
      : '';
  } catch {
    return '';
  }
}

function identityValues(value: unknown): WebsiteIdentityValues {
  const item = record(value);
  const resourceHosts = values(item?.resourceHosts, 30, (candidate) => normalizeDomain(candidate)) as string[];
  const trackingIdentifiers = values(item?.trackingIdentifiers, 30, (candidate) => {
    const tracker = record(candidate);
    const type = text(tracker?.type, 40).toLowerCase();
    const trackerValue = text(tracker?.value, 64).toUpperCase();
    return /^[a-z-]{1,40}$/u.test(type) && /^[A-Z0-9-]{1,64}$/u.test(trackerValue)
      ? { type, value: trackerValue }
      : null;
  }) as Array<{ type: string; value: string }>;
  const formActionOrigins = values(item?.formActionOrigins, 20, origin) as string[];
  return { resourceHosts, trackingIdentifiers, formActionOrigins };
}

export function normalizeWebsiteProfileSnapshot(
  raw: unknown,
  sourceVersion = WEBSITE_SNAPSHOT_SCHEMA_VERSION,
): WebsiteProfileSnapshot | null {
  const value = record(raw);
  const legacyTimestamps = sourceVersion < WEBSITE_SNAPSHOT_SCHEMA_VERSION;
  const domain = normalizeDomain(value?.domain);
  const observedAt = timestamp(value?.observedAt, legacyTimestamps);
  const savedAt = timestamp(value?.savedAt, legacyTimestamps);
  const id = text(value?.id, 128);
  if (!domain || !observedAt || !savedAt || !id) return null;
  return {
    id,
    domain,
    observedAt,
    savedAt,
    complete: value?.complete === true,
    truncated: value?.truncated === true,
    technologies: values(value?.technologies, 40, technology) as WebsiteSnapshotTechnology[],
    posture: values(value?.posture, 40, posture) as WebsiteSnapshotPosture[],
    identity: identity(value?.identity),
    identityValues: identityValues(value?.identityValues),
    sources: values(value?.sources, 16, source) as WebsiteSnapshotSource[],
    dependencies: values(value?.dependencies, 20, dependency) as WebsiteSnapshotDependency[],
    certificate: certificate(value?.certificate, legacyTimestamps),
  };
}

export function normalizeWebsiteSnapshotStore(raw: unknown) {
  assertWorkspaceInputGraph(raw, 'Website-snapshot store');
  assertWorkspaceDeclaredVersion(raw, 'Website-snapshot store');
  const value = record(raw);
  if (value?.schema === WEBSITE_SNAPSHOT_SCHEMA
    && Number(value?.version) > WEBSITE_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('This website-snapshot collection uses a newer schema and cannot be read safely.');
  }
  if (value?.schema === WEBSITE_SNAPSHOT_SCHEMA
    && Number.isSafeInteger(value.version)
    && !SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS.includes(Number(value.version))) {
    throw new Error('This website-snapshot collection uses an unsupported schema and cannot be read safely.');
  }
  const sourceVersion = value?.schema === WEBSITE_SNAPSHOT_SCHEMA
    && Number.isSafeInteger(value.version)
    ? Number(value.version)
    : WEBSITE_SNAPSHOT_SCHEMA_VERSION;
  const sourceValues = Array.isArray(raw) ? raw : Array.isArray(value?.snapshots) ? value.snapshots : [];
  const snapshots = values(
    sourceValues,
    MAX_WEBSITE_SNAPSHOTS * 2,
    (candidate) => normalizeWebsiteProfileSnapshot(candidate, sourceVersion),
  ) as WebsiteProfileSnapshot[];
  const perDomain = new Map<string, number>();
  const retained: WebsiteProfileSnapshot[] = [];
  for (const snapshot of snapshots.sort((left, right) => right.savedAt.localeCompare(left.savedAt))) {
    const count = perDomain.get(snapshot.domain) ?? 0;
    if (count >= MAX_WEBSITE_SNAPSHOTS_PER_DOMAIN || retained.length >= MAX_WEBSITE_SNAPSHOTS) continue;
    perDomain.set(snapshot.domain, count + 1);
    retained.push(snapshot);
  }
  return { schema: WEBSITE_SNAPSHOT_SCHEMA, version: WEBSITE_SNAPSHOT_SCHEMA_VERSION, snapshots: retained };
}
export function websiteSnapshotStoreVersion(raw: unknown): number {
  const value = record(raw);
  return Number.isSafeInteger(value?.version) ? Number(value?.version) : WEBSITE_SNAPSHOT_SCHEMA_VERSION;
}
export function serializeWebsiteSnapshotStore(raw: unknown): string {
  const store = normalizeWebsiteSnapshotStore(raw);
  const serialized = JSON.stringify(store);
  if (new TextEncoder().encode(serialized).byteLength > MAX_WEBSITE_SNAPSHOT_STORE_BYTES) {
    throw new Error('Website snapshots exceed the 512 KiB browser-local limit.');
  }
  return serialized;
}
export function saveWebsiteSnapshot(localRaw: unknown, candidateRaw: unknown) {
  const candidate = normalizeWebsiteProfileSnapshot(candidateRaw);
  if (!candidate) throw new Error('The website snapshot is incomplete or invalid.');
  const current = normalizeWebsiteSnapshotStore(localRaw).snapshots;
  const snapshots = current.filter((item) => item.id !== candidate.id);
  snapshots.unshift(candidate);
  return normalizeWebsiteSnapshotStore(snapshots).snapshots;
}
export function deleteWebsiteSnapshot(localRaw: unknown, id: string) {
  return normalizeWebsiteSnapshotStore(localRaw).snapshots.filter((item) => item.id !== id);
}
export function buildWebsiteSnapshotExport(raw: unknown, generatedAt = new Date().toISOString()) {
  const store = normalizeWebsiteSnapshotStore(raw);
  return { ...store, generatedAt: timestamp(generatedAt) || new Date().toISOString() };
}
export function mergeWebsiteSnapshots(localRaw: unknown, incomingRaw: unknown) {
  assertWorkspaceInputGraph(localRaw, 'Local website-snapshot store');
  assertWorkspaceInputGraph(incomingRaw, 'Imported website-snapshot document');
  assertWorkspacePortableVersion(incomingRaw, WEBSITE_SNAPSHOT_SCHEMA_VERSION, 'Imported website-snapshot document');
  const local = normalizeWebsiteSnapshotStore(localRaw).snapshots;
  const incoming = normalizeWebsiteSnapshotStore(incomingRaw).snapshots;
  const byId = new Map(local.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    if (byId.has(item.id)) updated += 1;
    else added += 1;
    byId.set(item.id, item);
  }
  const snapshots = normalizeWebsiteSnapshotStore([...byId.values()]).snapshots;
  return { snapshots, added, updated, skipped: Math.max(0, incoming.length - added - updated) };
}

function compareMap(
  field: string,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): WebsiteSnapshotChange[] {
  const changes: WebsiteSnapshotChange[] = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const left = before.get(key) ?? null;
    const right = after.get(key) ?? null;
    if (left === right) continue;
    changes.push({ field: `${field}.${key}`, state: left === null ? 'added' : right === null ? 'removed' : 'changed', before: left, after: right });
  }
  return changes;
}
export function compareWebsiteSnapshots(beforeRaw: unknown, afterRaw: unknown) {
  const before = normalizeWebsiteProfileSnapshot(beforeRaw);
  const after = normalizeWebsiteProfileSnapshot(afterRaw);
  if (!before || !after || before.domain !== after.domain) {
    return {
      compatible: false,
      changes: [{ field: 'snapshot', state: 'incomparable', before: before?.domain ?? null, after: after?.domain ?? null }] as WebsiteSnapshotChange[],
      dependencyTransitions: [] as WebsiteDependencyTransition[],
    };
  }
  const changes = [
    ...compareMap('technology', new Map(before.technologies.map((item) => [item.id, `${item.name}|${item.category}|${item.confidence}`])), new Map(after.technologies.map((item) => [item.id, `${item.name}|${item.category}|${item.confidence}`]))),
    ...compareMap('posture', new Map(before.posture.map((item) => [item.id, item.state])), new Map(after.posture.map((item) => [item.id, item.state]))),
    ...compareMap('source', new Map(before.sources.map((item) => [item.source, item.state])), new Map(after.sources.map((item) => [item.source, item.state]))),
    ...compareMap(
      'dependency',
      new Map(before.dependencies.map((item) => [`${item.recordType}:${item.target}`, `${item.state}|${item.qualification}`])),
      new Map(after.dependencies.map((item) => [`${item.recordType}:${item.target}`, `${item.state}|${item.qualification}`])),
    ),
  ];
  const dependencyTransitions: WebsiteDependencyTransition[] = [];
  const beforeDependencies = new Map(before.dependencies.map((item) => [`${item.recordType}:${item.target}`, item]));
  const afterDependencies = new Map(after.dependencies.map((item) => [`${item.recordType}:${item.target}`, item]));
  for (const key of [...new Set([...beforeDependencies.keys(), ...afterDependencies.keys()])].sort()) {
    const left = beforeDependencies.get(key);
    const right = afterDependencies.get(key);
    if (left?.state === 'active' && right?.qualification === 'known_deprovision_pattern') {
      dependencyTransitions.push({
        target: right.target,
        recordType: right.recordType,
        state: 'active_to_deprovision_cue',
        detail: 'An earlier active navigation target now matches a reviewed passive deprovision-page cue. Verify the service account and DNS manually; this does not establish claimability.',
      });
    } else if (left?.state === 'active' && right?.state === 'unresolved') {
      dependencyTransitions.push({
        target: right.target,
        recordType: right.recordType,
        state: 'active_to_unresolved',
        detail: 'An earlier active dependency is unresolved in the later retained observation. Resolver or collection failure remains possible.',
      });
    } else if (!left && right) {
      dependencyTransitions.push({ target: right.target, recordType: right.recordType, state: 'added', detail: 'This dependency first appears in the later retained snapshot.' });
    } else if (left && !right && after.complete) {
      dependencyTransitions.push({ target: left.target, recordType: left.recordType, state: 'removed', detail: 'This dependency is not represented in the later complete snapshot. It may have been intentionally removed or replaced.' });
    }
    if (dependencyTransitions.length >= 20) break;
  }
  for (const key of Object.keys(before.identity) as Array<keyof WebsiteIdentityDigests>) {
    const left = before.identity[key];
    const right = after.identity[key];
    if (left === right) continue;
    changes.push({ field: `identity.${key}`, state: left === null || right === null ? 'unavailable' : 'changed', before: left, after: right });
  }
  changes.push(
    ...compareMap(
      'identityValues.resourceHosts',
      new Map(before.identityValues.resourceHosts.map((item) => [item, item])),
      new Map(after.identityValues.resourceHosts.map((item) => [item, item])),
    ),
    ...compareMap(
      'identityValues.trackingIdentifiers',
      new Map(before.identityValues.trackingIdentifiers.map((item) => [`${item.type}:${item.value}`, item.value])),
      new Map(after.identityValues.trackingIdentifiers.map((item) => [`${item.type}:${item.value}`, item.value])),
    ),
    ...compareMap(
      'identityValues.formActionOrigins',
      new Map(before.identityValues.formActionOrigins.map((item) => [item, item])),
      new Map(after.identityValues.formActionOrigins.map((item) => [item, item])),
    ),
  );
  if (before.certificate || after.certificate) {
    if (!before.certificate || !after.certificate) {
      changes.push({
        field: 'certificate.observation',
        state: 'unavailable',
        before: before.certificate?.fingerprintSha256 ?? null,
        after: after.certificate?.fingerprintSha256 ?? null,
      });
    } else {
      const certificateFields: Array<keyof WebsiteCertificateObservation> = [
        'fingerprintSha256',
        'spkiFingerprintSha256',
        'issuer',
        'subject',
        'serialNumber',
        'validFrom',
        'validTo',
        'authorized',
        'hostnameMatches',
        'validity',
        'complete',
        'truncated',
      ];
      for (const key of certificateFields) {
        const left = before.certificate[key];
        const right = after.certificate[key];
        if (left === right) continue;
        changes.push({
          field: `certificate.${key}`,
          state: left === null || right === null ? 'unavailable' : 'changed',
          before: left === null ? null : String(left),
          after: right === null ? null : String(right),
        });
      }
    }
  }
  if (before.complete !== after.complete || before.truncated !== after.truncated) {
    changes.push({ field: 'completeness', state: 'incomparable', before: `${before.complete}/${before.truncated}`, after: `${after.complete}/${after.truncated}` });
  }
  return { compatible: true, changes, dependencyTransitions };
}

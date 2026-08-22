/**
 * Canonical, framework-independent analyst review identity and lifecycle.
 *
 * Review state is an analyst-authored overlay on retained evidence. It never
 * rewrites the evidence that produced a Review Item and it never treats
 * missing, partial, stale, or unavailable evidence as resolution.
 */

import {
  ANALYST_REVIEW_DISPOSITIONS,
  ANALYST_REVIEW_EVIDENCE_FAMILIES,
  ANALYST_REVIEW_STATE_SCHEMA,
  ANALYST_REVIEW_STATE_SCHEMA_VERSION,
  MAX_ANALYST_REVIEW_ASSOCIATIONS,
  MAX_ANALYST_REVIEW_HISTORY,
  MAX_ANALYST_REVIEW_ITEMS,
  MAX_ANALYST_REVIEW_RATIONALE_LENGTH,
  MAX_ANALYST_REVIEW_STATE_BYTES,
  MAX_ANALYST_REVIEW_STATE_RECORDS,
  type AnalystReviewDecisionSnapshot,
  type AnalystReviewDisposition,
  type AnalystReviewEvidenceFamily,
  type AnalystReviewItem,
  type AnalystReviewLifecycle,
  type AnalystReviewStateRecord,
  type AnalystReviewStateStore,
} from '../contracts/analyst-review-state-contract.mts';

export * from '../contracts/analyst-review-state-contract.mts';
type UnknownRecord = Record<string, unknown>;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const SAFE_REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_SUBJECT_RE = /^review:[a-z0-9_]{1,40}:[a-f0-9]{16}$/u;
const SAFE_FINGERPRINT_RE = /^material:[a-f0-9]{16}$/u;
const FAMILY_VALUES = new Set<string>(ANALYST_REVIEW_EVIDENCE_FAMILIES);
const DISPOSITION_VALUES = new Set<string>(ANALYST_REVIEW_DISPOSITIONS);
const RECORD_KEYS = Object.freeze([
  'subjectKey', 'reviewedFingerprint', 'evidenceFamily', 'disposition', 'rationale',
  'reviewedAt', 'reviewDueAt', 'expiresAt', 'caseIds', 'campaignIds', 'history',
]);
const SNAPSHOT_KEYS = Object.freeze([
  'reviewedFingerprint', 'disposition', 'rationale', 'reviewedAt', 'reviewDueAt', 'expiresAt',
]);
const STORE_KEYS = Object.freeze(['schema', 'version', 'records']);

function inputError(detail: string): TypeError {
  return new TypeError(`Analyst review state must be bounded ordinary JSON data; ${detail}.`);
}

function ordinaryRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw inputError(`${label} must be an object`);
  }
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw inputError(`${label} could not be inspected safely`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw inputError(`${label} has a custom prototype`);
  }
  if (keys.some((key) => typeof key !== 'string')) {
    throw inputError(`${label} has symbol keys`);
  }
  for (const key of keys as string[]) {
    let descriptor: PropertyDescriptor | undefined;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
    catch { throw inputError(`${label} has an unreadable property`); }
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      throw inputError(`${label} has accessor or non-enumerable properties`);
    }
  }
  return value as UnknownRecord;
}

function assertExactKeys(value: UnknownRecord, expected: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw inputError(`${label} has missing or undeclared fields`);
  }
}

export function assertAnalystReviewInputGraph(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number; label: string }> = [{ value, depth: 0, label: 'root' }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let textUnits = 0;
  while (pending.length) {
    const current = pending.pop()!;
    const candidate = current.value;
    if (typeof candidate === 'string') {
      textUnits += candidate.length;
      if (textUnits > MAX_ANALYST_REVIEW_STATE_BYTES * 2) throw inputError('aggregate text exceeds its ceiling');
      continue;
    }
    if (candidate === null || candidate === undefined || typeof candidate === 'boolean' || typeof candidate === 'number') continue;
    if (typeof candidate !== 'object') throw inputError(`${current.label} contains a non-JSON value`);
    if (current.depth > 8) throw inputError('nesting exceeds its ceiling');
    nodes += 1;
    if (nodes > 8_000) throw inputError('the graph exceeds its node ceiling');
    if (seen.has(candidate)) throw inputError('cycles and shared object references are not supported');
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      if (Object.getPrototypeOf(candidate) !== Array.prototype || candidate.length > 2_000) {
        throw inputError(`${current.label} exceeds its array bound or has a custom prototype`);
      }
      const keys = Reflect.ownKeys(candidate);
      if (keys.some((key) => typeof key === 'symbol') || keys.length !== candidate.length + 1) {
        throw inputError(`${current.label} is sparse or has custom fields`);
      }
      for (let index = 0; index < candidate.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          throw inputError(`${current.label} contains an accessor or sparse entry`);
        }
        pending.push({ value: descriptor.value, depth: current.depth + 1, label: `${current.label}[${index}]` });
      }
      continue;
    }
    const item = ordinaryRecord(candidate, current.label);
    if (Object.keys(item).length > 16) throw inputError(`${current.label} exceeds its key ceiling`);
    for (const [key, child] of Object.entries(item)) {
      pending.push({ value: child, depth: current.depth + 1, label: `${current.label}.${key}` });
    }
  }
}

function boundedText(value: unknown, maximum: number, label: string, required = true): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || CONTROL_RE.test(value)) {
    if (!required && (value === null || value === undefined || value === '')) return '';
    throw inputError(`${label} is invalid`);
  }
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if ((required && !normalized) || normalized.length > maximum) throw inputError(`${label} is invalid`);
  return normalized;
}

function timestamp(value: unknown, label: string, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) throw inputError(`${label} is invalid`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw inputError(`${label} must use an explicit valid date and time`);
  const normalized = new Date(parsed).toISOString();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) throw inputError(`${label} must use an explicit timezone`);
  return normalized;
}

function referenceList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_ANALYST_REVIEW_ASSOCIATIONS) {
    throw inputError(`${label} exceeds its association ceiling`);
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string' || !SAFE_REFERENCE_RE.test(entry)) throw inputError(`${label} contains an invalid identifier`);
    return entry;
  });
  if (new Set(normalized).size !== normalized.length) throw inputError(`${label} contains duplicate identifiers`);
  return normalized.sort();
}

function fingerprint(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_FINGERPRINT_RE.test(value)) throw inputError(`${label} is invalid`);
  return value;
}

function disposition(value: unknown, label: string): AnalystReviewDisposition {
  if (typeof value !== 'string' || !DISPOSITION_VALUES.has(value)) throw inputError(`${label} is invalid`);
  return value as AnalystReviewDisposition;
}

function family(value: unknown, label: string): AnalystReviewEvidenceFamily {
  if (typeof value !== 'string' || !FAMILY_VALUES.has(value)) throw inputError(`${label} is invalid`);
  return value as AnalystReviewEvidenceFamily;
}

function normalizeSnapshot(raw: unknown, label: string): AnalystReviewDecisionSnapshot {
  const value = ordinaryRecord(raw, label);
  assertExactKeys(value, SNAPSHOT_KEYS, label);
  const normalizedDisposition = disposition(value.disposition, `${label}.disposition`);
  const normalized: AnalystReviewDecisionSnapshot = {
    reviewedFingerprint: fingerprint(value.reviewedFingerprint, `${label}.reviewedFingerprint`),
    disposition: normalizedDisposition,
    rationale: boundedText(value.rationale, MAX_ANALYST_REVIEW_RATIONALE_LENGTH, `${label}.rationale`),
    reviewedAt: timestamp(value.reviewedAt, `${label}.reviewedAt`)!,
    reviewDueAt: timestamp(value.reviewDueAt, `${label}.reviewDueAt`, true),
    expiresAt: timestamp(value.expiresAt, `${label}.expiresAt`, true),
  };
  if ((normalizedDisposition === 'expected' || normalizedDisposition === 'suppressed') && !normalized.expiresAt) {
    throw inputError(`${label}.expiresAt is required for a time-bounded disposition`);
  }
  return normalized;
}

function normalizeStateRecord(raw: unknown, label: string): AnalystReviewStateRecord {
  const value = ordinaryRecord(raw, label);
  assertExactKeys(value, RECORD_KEYS, label);
  if (typeof value.subjectKey !== 'string' || !SAFE_SUBJECT_RE.test(value.subjectKey)) {
    throw inputError(`${label}.subjectKey is invalid`);
  }
  if (!Array.isArray(value.history) || value.history.length > MAX_ANALYST_REVIEW_HISTORY) {
    throw inputError(`${label}.history exceeds its ceiling`);
  }
  const decision = normalizeSnapshot({
    reviewedFingerprint: value.reviewedFingerprint,
    disposition: value.disposition,
    rationale: value.rationale,
    reviewedAt: value.reviewedAt,
    reviewDueAt: value.reviewDueAt,
    expiresAt: value.expiresAt,
  }, `${label}.decision`);
  const history = value.history.map((entry, index) => normalizeSnapshot(entry, `${label}.history[${index}]`));
  return {
    subjectKey: value.subjectKey,
    evidenceFamily: family(value.evidenceFamily, `${label}.evidenceFamily`),
    ...decision,
    caseIds: referenceList(value.caseIds, `${label}.caseIds`),
    campaignIds: referenceList(value.campaignIds, `${label}.campaignIds`),
    history,
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function emptyAnalystReviewStateStore(): AnalystReviewStateStore {
  return { schema: ANALYST_REVIEW_STATE_SCHEMA, version: ANALYST_REVIEW_STATE_SCHEMA_VERSION, records: [] };
}

export function analystReviewStateStoreVersion(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let descriptor: PropertyDescriptor | undefined;
  try { descriptor = Object.getOwnPropertyDescriptor(raw, 'version'); }
  catch { return null; }
  return descriptor && 'value' in descriptor && Number.isSafeInteger(descriptor.value) && Number(descriptor.value) > 0
    ? Number(descriptor.value)
    : null;
}

export function normalizeAnalystReviewStateStore(raw: unknown): AnalystReviewStateStore {
  if (raw === null || raw === undefined) return emptyAnalystReviewStateStore();
  assertAnalystReviewInputGraph(raw);
  const value = ordinaryRecord(raw, 'root');
  assertExactKeys(value, STORE_KEYS, 'root');
  if (value.schema !== ANALYST_REVIEW_STATE_SCHEMA) throw new Error('This data is not a WHOISleuth analyst review-state document.');
  if (value.version !== ANALYST_REVIEW_STATE_SCHEMA_VERSION) {
    if (typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version > ANALYST_REVIEW_STATE_SCHEMA_VERSION) {
      throw new Error(`Analyst review state uses newer schema ${value.version}. Update the app before reading or changing it.`);
    }
    throw new Error(`Expected analyst review-state schema ${ANALYST_REVIEW_STATE_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(value.records) || value.records.length > MAX_ANALYST_REVIEW_STATE_RECORDS) {
    throw inputError('records exceed the collection ceiling');
  }
  const records = value.records.map((entry, index) => normalizeStateRecord(entry, `records[${index}]`));
  if (new Set(records.map((entry) => entry.subjectKey)).size !== records.length) {
    throw inputError('records contain duplicate subject keys');
  }
  records.sort((left, right) => left.subjectKey.localeCompare(right.subjectKey, 'en'));
  const store: AnalystReviewStateStore = {
    schema: ANALYST_REVIEW_STATE_SCHEMA,
    version: ANALYST_REVIEW_STATE_SCHEMA_VERSION,
    records,
  };
  if (byteLength(JSON.stringify(store)) > MAX_ANALYST_REVIEW_STATE_BYTES) {
    throw new Error('Analyst review state exceeds the 512 KiB browser-local storage limit.');
  }
  return store;
}

export function serializeAnalystReviewStateStore(raw: unknown): string {
  return JSON.stringify(normalizeAnalystReviewStateStore(raw));
}

export function serialiseAnalystReviewStateJson(value: unknown): string {
  return `${JSON.stringify(normalizeAnalystReviewStateStore(value), null, 2)}\n`;
}

function canonicalPart(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(CONTROL_RE, '').trim().slice(0, 500);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.slice(0, 100).map(canonicalPart).sort().join(',')}]`;
  if (typeof value === 'object') {
    const candidate = value as UnknownRecord;
    return `{${Object.keys(candidate).sort().slice(0, 100).map((key) => `${canonicalPart(key)}:${canonicalPart(candidate[key])}`).join(',')}}`;
  }
  return '';
}

function stableHash(parts: readonly unknown[]): string {
  assertAnalystReviewInputGraph(parts);
  const source = parts.slice(0, 100).map(canonicalPart).join('\u001f').slice(0, 32_768);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left ^= code;
    left = Math.imul(left, 0x01000193);
    right ^= code + index;
    right = Math.imul(right, 0x85ebca6b);
    right ^= right >>> 13;
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

export function analystReviewSubjectKey(evidenceFamily: AnalystReviewEvidenceFamily, stableParts: readonly unknown[]): string {
  if (!FAMILY_VALUES.has(evidenceFamily)) throw new TypeError('Choose a supported Review Item evidence family.');
  return `review:${evidenceFamily}:${stableHash(stableParts)}`;
}

export function analystReviewMaterialFingerprint(materialParts: readonly unknown[]): string {
  return `material:${stableHash(materialParts)}`;
}

function currentSnapshot(record: AnalystReviewStateRecord): AnalystReviewDecisionSnapshot {
  return {
    reviewedFingerprint: record.reviewedFingerprint,
    disposition: record.disposition,
    rationale: record.rationale,
    reviewedAt: record.reviewedAt,
    reviewDueAt: record.reviewDueAt,
    expiresAt: record.expiresAt,
  };
}

function snapshotIdentity(snapshot: AnalystReviewDecisionSnapshot): string {
  return JSON.stringify([
    snapshot.reviewedFingerprint,
    snapshot.disposition,
    snapshot.rationale,
    snapshot.reviewedAt,
    snapshot.reviewDueAt,
    snapshot.expiresAt,
  ]);
}

function mergedReviewHistory(
  current: AnalystReviewStateRecord,
  other: AnalystReviewStateRecord,
): AnalystReviewDecisionSnapshot[] {
  const currentIdentity = snapshotIdentity(currentSnapshot(current));
  const byIdentity = new Map<string, AnalystReviewDecisionSnapshot>();
  for (const snapshot of [...current.history, currentSnapshot(other), ...other.history]) {
    const identity = snapshotIdentity(snapshot);
    if (identity !== currentIdentity && !byIdentity.has(identity)) byIdentity.set(identity, snapshot);
  }
  return [...byIdentity.entries()]
    .sort(([leftIdentity, left], [rightIdentity, right]) => (
      right.reviewedAt.localeCompare(left.reviewedAt)
      || leftIdentity.localeCompare(rightIdentity)
    ))
    .slice(0, MAX_ANALYST_REVIEW_HISTORY)
    .map(([, snapshot]) => snapshot);
}

export function setAnalystReviewDecision(
  raw: unknown,
  item: AnalystReviewItem,
  input: Readonly<{
    disposition: AnalystReviewDisposition;
    rationale: unknown;
    reviewedAt?: unknown;
    reviewDueAt?: unknown;
    expiresAt?: unknown;
    caseIds?: readonly string[];
    campaignIds?: readonly string[];
  }>,
): AnalystReviewStateStore {
  const store = normalizeAnalystReviewStateStore(raw);
  if (!SAFE_SUBJECT_RE.test(item.subjectKey) || !SAFE_FINGERPRINT_RE.test(item.materialFingerprint)) {
    throw new TypeError('The Review Item identity is invalid. Reload retained evidence before recording a decision.');
  }
  if (!DISPOSITION_VALUES.has(input.disposition)) throw new TypeError('Choose a valid Review Item disposition.');
  if (input.disposition === 'resolved' && (item.completeness !== 'complete' || item.age === 'stale')) {
    throw new Error('Partial, inconclusive, or stale evidence cannot resolve a Review Item. Refresh or attach current complete evidence first.');
  }
  const rationale = boundedText(input.rationale, MAX_ANALYST_REVIEW_RATIONALE_LENGTH, 'rationale');
  const reviewedAt = timestamp(input.reviewedAt ?? new Date().toISOString(), 'reviewedAt')!;
  const expiresAt = timestamp(input.expiresAt, 'expiresAt', true);
  const reviewDueAt = timestamp(input.reviewDueAt, 'reviewDueAt', true);
  if ((input.disposition === 'expected' || input.disposition === 'suppressed') && !expiresAt) {
    throw new Error('Expected and suppressed Review Items require an expiry so the evidence returns to review.');
  }
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(reviewedAt)) {
    throw new Error('Review Item expiry must be later than the review time.');
  }
  if (reviewDueAt && Date.parse(reviewDueAt) <= Date.parse(reviewedAt)) {
    throw new Error('The next review time must be later than the review time.');
  }
  const previous = store.records.find((record) => record.subjectKey === item.subjectKey) ?? null;
  const caseIds = referenceList(input.caseIds ?? (item.caseId ? [item.caseId] : []), 'caseIds');
  const campaignIds = referenceList(input.campaignIds ?? item.campaignIds, 'campaignIds');
  const next: AnalystReviewStateRecord = {
    subjectKey: item.subjectKey,
    reviewedFingerprint: item.materialFingerprint,
    evidenceFamily: item.evidenceFamily,
    disposition: input.disposition,
    rationale,
    reviewedAt,
    reviewDueAt,
    expiresAt,
    caseIds,
    campaignIds,
    history: previous
      ? [currentSnapshot(previous), ...previous.history].slice(0, MAX_ANALYST_REVIEW_HISTORY)
      : [],
  };
  return normalizeAnalystReviewStateStore({
    schema: ANALYST_REVIEW_STATE_SCHEMA,
    version: ANALYST_REVIEW_STATE_SCHEMA_VERSION,
    records: [next, ...store.records.filter((record) => record.subjectKey !== item.subjectKey)],
  });
}

export function analystReviewLifecycle(
  item: AnalystReviewItem,
  raw: unknown,
  nowRaw: unknown = new Date().toISOString(),
): AnalystReviewLifecycle {
  const store = normalizeAnalystReviewStateStore(raw);
  const decision = store.records.find((record) => record.subjectKey === item.subjectKey) ?? null;
  if (!decision) {
    return { state: 'open', effectiveDisposition: 'open', decision: null, reason: 'No analyst lifecycle decision is retained.', expired: false, invalidated: false, recurred: false, reviewDue: false };
  }
  const now = timestamp(nowRaw, 'now')!;
  const invalidated = decision.reviewedFingerprint !== item.materialFingerprint;
  const expired = decision.expiresAt !== null && Date.parse(decision.expiresAt) <= Date.parse(now);
  const reviewDue = decision.reviewDueAt !== null && Date.parse(decision.reviewDueAt) <= Date.parse(now);
  const priorClosed = decision.disposition !== 'open' || decision.history.some((entry) => entry.disposition !== 'open');
  if (invalidated) {
    return {
      state: 'invalidated', effectiveDisposition: 'open', decision,
      reason: 'Material evidence changed after the retained decision. The previous rationale remains in history, but the item is open again.',
      expired: false, invalidated: true, recurred: priorClosed, reviewDue,
    };
  }
  if (expired) {
    return {
      state: 'expired', effectiveDisposition: 'open', decision,
      reason: 'The time-bounded decision expired. The item has returned to review without changing its evidence.',
      expired: true, invalidated: false, recurred: true, reviewDue: true,
    };
  }
  if (reviewDue && decision.disposition !== 'open') {
    return {
      state: 'recurred', effectiveDisposition: 'open', decision,
      reason: 'The retained follow-up time has arrived. The previous decision remains historical and the item is open for review.',
      expired: false, invalidated: false, recurred: true, reviewDue: true,
    };
  }
  if (decision.disposition === 'resolved' && (item.completeness !== 'complete' || item.age === 'stale')) {
    return {
      state: 'invalidated', effectiveDisposition: 'open', decision,
      reason: 'The current evidence is partial, inconclusive, or stale, so the retained resolved decision cannot close this item.',
      expired: false, invalidated: true, recurred: true, reviewDue,
    };
  }
  return {
    state: decision.disposition,
    effectiveDisposition: decision.disposition,
    decision,
    reason: decision.disposition === 'open'
      ? 'The analyst retained this item as open.'
      : `The analyst retained this item as ${decision.disposition}; the source evidence remains unchanged.`,
    expired: false,
    invalidated: false,
    recurred: false,
    reviewDue,
  };
}

export function orphanedAnalystReviewStates(
  raw: unknown,
  currentItems: readonly Pick<AnalystReviewItem, 'subjectKey'>[],
): readonly AnalystReviewStateRecord[] {
  const store = normalizeAnalystReviewStateStore(raw);
  const current = new Set(currentItems.slice(0, MAX_ANALYST_REVIEW_ITEMS).map((item) => item.subjectKey));
  return store.records.filter((record) => !current.has(record.subjectKey));
}

export function buildAnalystReviewStateExport(raw: unknown): AnalystReviewStateStore {
  return normalizeAnalystReviewStateStore(raw);
}

export function analystReviewStateRecords(raw: unknown): readonly AnalystReviewStateRecord[] {
  return normalizeAnalystReviewStateStore(raw).records;
}

export function analystReviewStateStoreFromRecords(records: readonly unknown[]): AnalystReviewStateStore {
  return normalizeAnalystReviewStateStore({
    schema: ANALYST_REVIEW_STATE_SCHEMA,
    version: ANALYST_REVIEW_STATE_SCHEMA_VERSION,
    records,
  });
}

export function mergeAnalystReviewStateStores(
  localRaw: unknown,
  importedRaw: unknown,
): { store: AnalystReviewStateStore; added: number; updated: number; skipped: number } {
  const local = normalizeAnalystReviewStateStore(localRaw);
  const imported = normalizeAnalystReviewStateStore(importedRaw);
  const records = new Map(local.records.map((record) => [record.subjectKey, record]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const candidate of imported.records) {
    const existing = records.get(candidate.subjectKey);
    if (!existing) {
      records.set(candidate.subjectKey, candidate);
      added += 1;
    } else {
      const current = candidate.reviewedAt > existing.reviewedAt ? candidate : existing;
      const other = current === candidate ? existing : candidate;
      const merged = { ...current, history: mergedReviewHistory(current, other) };
      if (JSON.stringify(merged) === JSON.stringify(existing)) {
        skipped += 1;
      } else {
        records.set(candidate.subjectKey, merged);
        updated += 1;
      }
    }
  }
  return {
    store: normalizeAnalystReviewStateStore({
      schema: ANALYST_REVIEW_STATE_SCHEMA,
      version: ANALYST_REVIEW_STATE_SCHEMA_VERSION,
      records: [...records.values()],
    }),
    added,
    updated,
    skipped,
  };
}

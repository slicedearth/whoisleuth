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
  MAX_ANALYST_REVIEW_IDENTITY_BYTES,
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
const SAFE_SUBJECT_RE = /^review:[a-z0-9_]{1,40}:[a-f0-9]{64}$/u;
const SAFE_FINGERPRINT_RE = /^material:[a-f0-9]{64}$/u;
const DEVELOPMENT_SUBJECT_RE = /^review:([a-z0-9_]{1,40}):[a-f0-9]{16}$/u;
const DEVELOPMENT_FINGERPRINT_RE = /^material:[a-f0-9]{16}$/u;
const FAMILY_VALUES = new Set<string>(ANALYST_REVIEW_EVIDENCE_FAMILIES);
const DISPOSITION_VALUES = new Set<string>(ANALYST_REVIEW_DISPOSITIONS);
const RECORD_KEYS = Object.freeze([
  'subjectKey', 'reviewedFingerprint', 'evidenceFamily', 'disposition', 'rationale',
  'reviewedAt', 'reviewDueAt', 'expiresAt', 'caseIds', 'campaignIds', 'history', 'historyOmitted',
]);
const DEVELOPMENT_RECORD_KEYS = Object.freeze(RECORD_KEYS.filter((key) => key !== 'historyOmitted'));
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
    if (candidate === null || candidate === undefined || typeof candidate === 'boolean') continue;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw inputError(`${current.label} contains a non-finite number`);
      continue;
    }
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
  if (normalized.expiresAt && Date.parse(normalized.expiresAt) <= Date.parse(normalized.reviewedAt)) {
    throw inputError(`${label}.expiresAt must be later than reviewedAt`);
  }
  if (normalized.reviewDueAt && Date.parse(normalized.reviewDueAt) <= Date.parse(normalized.reviewedAt)) {
    throw inputError(`${label}.reviewDueAt must be later than reviewedAt`);
  }
  return normalized;
}

function historyOmitted(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw inputError(`${label} is invalid`);
  return Number(value);
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
    historyOmitted: historyOmitted(value.historyOmitted, `${label}.historyOmitted`),
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

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalIdentityValue(value: unknown): string {
  if (value === undefined) return '["undefined"]';
  if (value === null) return '["null"]';
  if (typeof value === 'string') return `["string",${JSON.stringify(value)}]`;
  if (typeof value === 'boolean') return `["boolean",${value ? 'true' : 'false'}]`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw inputError('identity input contains a non-finite number');
    return `["number",${JSON.stringify(Object.is(value, -0) ? '-0' : String(value))}]`;
  }
  if (Array.isArray(value)) return `["array",[${value.map(canonicalIdentityValue).join(',')}]]`;
  const candidate = value as UnknownRecord;
  const entries = Object.keys(candidate)
    .sort(compareCodeUnits)
    .map((key) => `[${JSON.stringify(key)},${canonicalIdentityValue(candidate[key])}]`);
  return `["object",[${entries.join(',')}]]`;
}

export function canonicalAnalystReviewIdentityJson(parts: readonly unknown[]): string {
  if (!Array.isArray(parts)) throw inputError('identity parts must be an array');
  assertAnalystReviewInputGraph(parts);
  const source = canonicalIdentityValue(parts);
  if (new TextEncoder().encode(source).byteLength > MAX_ANALYST_REVIEW_IDENTITY_BYTES) {
    throw inputError(`identity input exceeds its ${MAX_ANALYST_REVIEW_IDENTITY_BYTES}-byte canonical ceiling`);
  }
  return source;
}

const SHA256_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(bytes: Uint8Array): string {
  // This digest is a collision-resistant record identity, not a password,
  // signature, MAC, or substitute for the platform cryptography used there.
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.byteLength * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!;
      const right = words[index - 2]!;
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const first = (h! + sum1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const second = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }
  return [...state].map((value) => value.toString(16).padStart(8, '0')).join('');
}

function stableHash(parts: readonly unknown[]): string {
  return sha256Hex(new TextEncoder().encode(canonicalAnalystReviewIdentityJson(parts)));
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
): Pick<AnalystReviewStateRecord, 'history' | 'historyOmitted'> {
  const currentIdentity = snapshotIdentity(currentSnapshot(current));
  const byIdentity = new Map<string, AnalystReviewDecisionSnapshot>();
  for (const snapshot of [...current.history, currentSnapshot(other), ...other.history]) {
    const identity = snapshotIdentity(snapshot);
    if (identity !== currentIdentity && !byIdentity.has(identity)) byIdentity.set(identity, snapshot);
  }
  const ordered = [...byIdentity.entries()]
    .sort(([leftIdentity, left], [rightIdentity, right]) => (
      right.reviewedAt.localeCompare(left.reviewedAt)
      || leftIdentity.localeCompare(rightIdentity)
    ));
  return {
    history: ordered.slice(0, MAX_ANALYST_REVIEW_HISTORY).map(([, snapshot]) => snapshot),
    historyOmitted: Math.max(current.historyOmitted, other.historyOmitted)
      + Math.max(0, ordered.length - MAX_ANALYST_REVIEW_HISTORY),
  };
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
  const priorHistory = previous ? [currentSnapshot(previous), ...previous.history] : [];
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
    history: priorHistory.slice(0, MAX_ANALYST_REVIEW_HISTORY),
    historyOmitted: (previous?.historyOmitted ?? 0)
      + Math.max(0, priorHistory.length - MAX_ANALYST_REVIEW_HISTORY),
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
      const merged = { ...current, ...mergedReviewHistory(current, other) };
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

function developmentFingerprint(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DEVELOPMENT_FINGERPRINT_RE.test(value)) throw inputError(`${label} is invalid`);
  return `material:${stableHash(['retired-development-material', value])}`;
}

function normalizeDevelopmentSnapshot(raw: unknown, label: string): AnalystReviewDecisionSnapshot {
  const value = ordinaryRecord(raw, label);
  assertExactKeys(value, SNAPSHOT_KEYS, label);
  const reviewedAt = timestamp(value.reviewedAt, `${label}.reviewedAt`)!;
  const reviewDueAt = timestamp(value.reviewDueAt, `${label}.reviewDueAt`, true);
  const expiresAt = timestamp(value.expiresAt, `${label}.expiresAt`, true);
  return {
    reviewedFingerprint: developmentFingerprint(value.reviewedFingerprint, `${label}.reviewedFingerprint`),
    disposition: disposition(value.disposition, `${label}.disposition`),
    rationale: boundedText(value.rationale, MAX_ANALYST_REVIEW_RATIONALE_LENGTH, `${label}.rationale`),
    reviewedAt,
    reviewDueAt: reviewDueAt && Date.parse(reviewDueAt) > Date.parse(reviewedAt) ? reviewDueAt : null,
    expiresAt: expiresAt && Date.parse(expiresAt) > Date.parse(reviewedAt) ? expiresAt : null,
  };
}

/**
 * Converts only the short-lived local development identity format. The old
 * decision becomes history under an orphaned, open subject so it can never
 * suppress or resolve evidence produced by the corrected identity contract.
 */
export function migrateDevelopmentAnalystReviewStateStore(raw: unknown): AnalystReviewStateStore {
  try { return normalizeAnalystReviewStateStore(raw); }
  catch (strictCause) {
    assertAnalystReviewInputGraph(raw);
    const value = ordinaryRecord(raw, 'root');
    assertExactKeys(value, STORE_KEYS, 'root');
    if (value.schema !== ANALYST_REVIEW_STATE_SCHEMA || value.version !== ANALYST_REVIEW_STATE_SCHEMA_VERSION
      || !Array.isArray(value.records) || value.records.length > MAX_ANALYST_REVIEW_STATE_RECORDS) throw strictCause;
    const records = value.records.map((entry, index): AnalystReviewStateRecord => {
      const label = `records[${index}]`;
      const candidate = ordinaryRecord(entry, label);
      assertExactKeys(candidate, DEVELOPMENT_RECORD_KEYS, label);
      if (typeof candidate.subjectKey !== 'string') throw strictCause;
      const subjectMatch = candidate.subjectKey.match(DEVELOPMENT_SUBJECT_RE);
      if (!subjectMatch || !FAMILY_VALUES.has(subjectMatch[1]!)) throw strictCause;
      const evidenceFamily = family(candidate.evidenceFamily, `${label}.evidenceFamily`);
      if (evidenceFamily !== subjectMatch[1]) throw inputError(`${label}.subjectKey family is inconsistent`);
      const previous = normalizeDevelopmentSnapshot({
        reviewedFingerprint: candidate.reviewedFingerprint,
        disposition: candidate.disposition,
        rationale: candidate.rationale,
        reviewedAt: candidate.reviewedAt,
        reviewDueAt: candidate.reviewDueAt,
        expiresAt: candidate.expiresAt,
      }, `${label}.decision`);
      if (!Array.isArray(candidate.history) || candidate.history.length > MAX_ANALYST_REVIEW_HISTORY) {
        throw inputError(`${label}.history exceeds its ceiling`);
      }
      const retainedHistory = [
        previous,
        ...candidate.history.map((snapshot, historyIndex) => normalizeDevelopmentSnapshot(snapshot, `${label}.history[${historyIndex}]`)),
      ];
      return {
        subjectKey: `review:${evidenceFamily}:${stableHash(['retired-development-subject', candidate.subjectKey])}`,
        reviewedFingerprint: previous.reviewedFingerprint,
        evidenceFamily,
        disposition: 'open',
        rationale: 'A retired local development identity was reopened. Review the current source evidence before recording a new decision.',
        reviewedAt: previous.reviewedAt,
        reviewDueAt: null,
        expiresAt: null,
        caseIds: referenceList(candidate.caseIds, `${label}.caseIds`),
        campaignIds: referenceList(candidate.campaignIds, `${label}.campaignIds`),
        history: retainedHistory.slice(0, MAX_ANALYST_REVIEW_HISTORY),
        historyOmitted: Math.max(0, retainedHistory.length - MAX_ANALYST_REVIEW_HISTORY),
      };
    });
    return normalizeAnalystReviewStateStore({
      schema: ANALYST_REVIEW_STATE_SCHEMA,
      version: ANALYST_REVIEW_STATE_SCHEMA_VERSION,
      records,
    });
  }
}

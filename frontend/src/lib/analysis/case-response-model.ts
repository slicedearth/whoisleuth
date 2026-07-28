// Bounded, framework-neutral analyst response records. These records are
// deliberately separate from collected evidence snapshots: a pin describes a
// fact selected by an analyst, a decision records analyst reasoning, and an
// action records a reviewed external or internal follow-up.

export const MAX_CASE_EVIDENCE_PINS = 40;
export const MAX_CASE_DECISIONS = 30;
export const MAX_CASE_ACTIONS = 50;
export const MAX_RESPONSE_LABEL_LENGTH = 80;
export const MAX_RESPONSE_VALUE_LENGTH = 1000;
export const MAX_RESPONSE_RATIONALE_LENGTH = 2000;
export const MAX_RESPONSE_RECIPIENT_LENGTH = 320;
export const MAX_RESPONSE_REFERENCE_LENGTH = 500;
export const MAX_RESPONSE_LIMITATIONS = 8;
export const MAX_RESPONSE_LIMITATION_LENGTH = 240;
export const MAX_DECISION_PIN_REFERENCES = 20;

export const CASE_PIN_COMPLETENESS = ['complete', 'partial', 'inconclusive', 'unknown'] as const;
export type CasePinCompleteness = typeof CASE_PIN_COMPLETENESS[number];

export const CASE_ACTION_TYPES = [
  'registrar_report',
  'registry_report',
  'network_hosting_report',
  'security_contact_report',
  'defensive_control',
  'internal_review',
] as const;
export type CaseActionType = typeof CASE_ACTION_TYPES[number];

export const CASE_ACTION_STATES = [
  'planned',
  'ready_for_review',
  'submitted',
  'acknowledged',
  'resolved',
  'closed',
] as const;
export type CaseActionState = typeof CASE_ACTION_STATES[number];

export type CaseEvidencePin = {
  id: string;
  label: string;
  value: string;
  source: string;
  observedAt: string;
  completeness: CasePinCompleteness;
  limitations: string[];
  createdAt: string;
};

export type CaseDecisionRecord = {
  id: string;
  summary: string;
  rationale: string;
  evidencePinIds: string[];
  createdAt: string;
};

export type CaseActionRecord = {
  id: string;
  type: CaseActionType;
  recipient: string;
  contactSource: string;
  contactLimitations: string[];
  dueAt: string | null;
  state: CaseActionState;
  reference: string | null;
  followUpAt: string | null;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
};

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const COMPLETENESS = new Set<string>(CASE_PIN_COMPLETENESS);
const ACTION_TYPES = new Set<string>(CASE_ACTION_TYPES);
const ACTION_STATES = new Set<string>(CASE_ACTION_STATES);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_RE, ' ').trim().slice(0, maximum);
}

function iso(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length <= 64 && !CONTROL_RE.test(value)) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
}

function optionalIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function hash(value: string): string {
  let result = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}-${hash(JSON.stringify(value))}`;
}

function freshId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeId(value: unknown, prefix: string, raw: unknown): string {
  return typeof value === 'string' && SAFE_ID_RE.test(value)
    ? value
    : deterministicId(prefix, raw);
}

function limitations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value.slice(0, MAX_RESPONSE_LIMITATIONS * 2)) {
    const normalized = text(item, MAX_RESPONSE_LIMITATION_LENGTH);
    if (normalized) unique.add(normalized);
    if (unique.size >= MAX_RESPONSE_LIMITATIONS) break;
  }
  return [...unique];
}

function uniqueIds(value: unknown, validIds?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value.slice(0, MAX_DECISION_PIN_REFERENCES * 2)) {
    if (typeof item !== 'string' || !SAFE_ID_RE.test(item) || (validIds && !validIds.has(item))) continue;
    unique.add(item);
    if (unique.size >= MAX_DECISION_PIN_REFERENCES) break;
  }
  return [...unique];
}

function normalizePin(raw: unknown, fallback: string): CaseEvidencePin | null {
  const item = record(raw);
  const label = text(item.label, MAX_RESPONSE_LABEL_LENGTH);
  const value = text(item.value, MAX_RESPONSE_VALUE_LENGTH);
  if (!label || !value) return null;
  const createdAt = iso(item.createdAt, fallback);
  return {
    id: safeId(item.id, 'pin', { label, value, createdAt }),
    label,
    value,
    source: text(item.source, MAX_RESPONSE_LABEL_LENGTH) || 'analyst_selected',
    observedAt: iso(item.observedAt, createdAt),
    completeness: typeof item.completeness === 'string' && COMPLETENESS.has(item.completeness)
      ? item.completeness as CasePinCompleteness
      : 'unknown',
    limitations: limitations(item.limitations),
    createdAt,
  };
}

export function normalizeCaseEvidencePins(raw: unknown, fallback: string): CaseEvidencePin[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaseEvidencePin>();
  for (const item of raw.slice(0, MAX_CASE_EVIDENCE_PINS * 2)) {
    const normalized = normalizePin(item, fallback);
    if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-MAX_CASE_EVIDENCE_PINS);
}

export function appendCaseEvidencePin(
  current: readonly CaseEvidencePin[],
  raw: unknown,
  now: string,
): CaseEvidencePin[] {
  const item = record(raw);
  const created = normalizePin({ ...item, id: freshId('pin'), createdAt: now }, now);
  if (!created) throw new Error('An evidence pin requires a label and value.');
  return normalizeCaseEvidencePins([...current, created], now);
}

function normalizeDecision(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
): CaseDecisionRecord | null {
  const item = record(raw);
  const summary = text(item.summary, MAX_RESPONSE_LABEL_LENGTH);
  const rationale = text(item.rationale, MAX_RESPONSE_RATIONALE_LENGTH);
  if (!summary || !rationale) return null;
  const createdAt = iso(item.createdAt, fallback);
  return {
    id: safeId(item.id, 'decision', { summary, rationale, createdAt }),
    summary,
    rationale,
    evidencePinIds: uniqueIds(item.evidencePinIds, validPinIds),
    createdAt,
  };
}

export function normalizeCaseDecisions(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
): CaseDecisionRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaseDecisionRecord>();
  for (const item of raw.slice(0, MAX_CASE_DECISIONS * 2)) {
    const normalized = normalizeDecision(item, fallback, validPinIds);
    if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-MAX_CASE_DECISIONS);
}

export function appendCaseDecision(
  current: readonly CaseDecisionRecord[],
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
): CaseDecisionRecord[] {
  const item = record(raw);
  const created = normalizeDecision({ ...item, id: freshId('decision'), createdAt: now }, now, validPinIds);
  if (!created) throw new Error('A decision requires a summary and rationale.');
  return normalizeCaseDecisions([...current, created], now, validPinIds);
}

function normalizeAction(raw: unknown, fallback: string): CaseActionRecord | null {
  const item = record(raw);
  const recipient = text(item.recipient, MAX_RESPONSE_RECIPIENT_LENGTH);
  if (!recipient) return null;
  const createdAt = iso(item.createdAt, fallback);
  const updatedAt = iso(item.updatedAt, createdAt);
  return {
    id: safeId(item.id, 'action', { recipient, createdAt }),
    type: typeof item.type === 'string' && ACTION_TYPES.has(item.type)
      ? item.type as CaseActionType
      : 'internal_review',
    recipient,
    contactSource: text(item.contactSource, MAX_RESPONSE_LABEL_LENGTH) || 'analyst_supplied',
    contactLimitations: limitations(item.contactLimitations),
    dueAt: optionalIso(item.dueAt),
    state: typeof item.state === 'string' && ACTION_STATES.has(item.state)
      ? item.state as CaseActionState
      : 'planned',
    reference: text(item.reference, MAX_RESPONSE_REFERENCE_LENGTH) || null,
    followUpAt: optionalIso(item.followUpAt),
    outcome: text(item.outcome, MAX_RESPONSE_RATIONALE_LENGTH) || null,
    createdAt,
    updatedAt,
  };
}

export function normalizeCaseActions(raw: unknown, fallback: string): CaseActionRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaseActionRecord>();
  for (const item of raw.slice(0, MAX_CASE_ACTIONS * 2)) {
    const normalized = normalizeAction(item, fallback);
    if (!normalized) continue;
    const existing = byId.get(normalized.id);
    if (!existing || Date.parse(normalized.updatedAt) >= Date.parse(existing.updatedAt)) {
      byId.set(normalized.id, normalized);
    }
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-MAX_CASE_ACTIONS);
}

export function appendCaseAction(
  current: readonly CaseActionRecord[],
  raw: unknown,
  now: string,
): CaseActionRecord[] {
  const item = record(raw);
  const created = normalizeAction({ ...item, id: freshId('action'), createdAt: now, updatedAt: now }, now);
  if (!created) throw new Error('An action requires a recipient or internal owner.');
  return normalizeCaseActions([...current, created], now);
}

export function updateCaseAction(
  current: readonly CaseActionRecord[],
  raw: unknown,
  now: string,
): CaseActionRecord[] {
  const patch = record(raw);
  const id = typeof patch.id === 'string' && SAFE_ID_RE.test(patch.id) ? patch.id : '';
  const existing = current.find((item) => item.id === id);
  if (!existing) throw new Error('That case action no longer exists.');
  const updated = normalizeAction({ ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: now }, now);
  if (!updated) throw new Error('An action requires a recipient or internal owner.');
  return normalizeCaseActions(current.map((item) => item.id === id ? updated : item), now);
}

export function mergeCaseEvidencePins(
  local: readonly CaseEvidencePin[],
  imported: readonly CaseEvidencePin[],
  fallback: string,
): CaseEvidencePin[] {
  return normalizeCaseEvidencePins([...local, ...imported], fallback);
}

export function mergeCaseDecisions(
  local: readonly CaseDecisionRecord[],
  imported: readonly CaseDecisionRecord[],
  fallback: string,
  validPinIds?: ReadonlySet<string>,
): CaseDecisionRecord[] {
  return normalizeCaseDecisions([...local, ...imported], fallback, validPinIds);
}

export function mergeCaseActions(
  local: readonly CaseActionRecord[],
  imported: readonly CaseActionRecord[],
  fallback: string,
): CaseActionRecord[] {
  return normalizeCaseActions([...local, ...imported], fallback);
}

import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../../../../lib/observation.mts';

export const MAX_CASE_INVESTIGATION_BRANCHES = 8;
export const MAX_CASE_BRANCH_NAME_LENGTH = 80;
export const MAX_CASE_BRANCH_REFERENCES = 12;
export const CASE_INVESTIGATION_BRANCH_STATES = ['active', 'resolved'] as const;

export type CaseInvestigationBranchState = typeof CASE_INVESTIGATION_BRANCH_STATES[number];
export type CaseInvestigationBranch = Readonly<{
  id: string;
  name: string;
  state: CaseInvestigationBranchState;
  evidencePinIds: readonly string[];
  checkpointIds: readonly string[];
  assertionIds: readonly string[];
  actionIds: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;

export type CaseInvestigationBranchReferences = Readonly<{
  evidencePinIds: ReadonlySet<string>;
  checkpointIds: ReadonlySet<string>;
  assertionIds: ReadonlySet<string>;
  actionIds: ReadonlySet<string>;
}>;

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/u;
const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_REPLACE_RE, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

type BranchTimestampOptions = Readonly<{ legacyTimestamps?: boolean }>;

function iso(value: unknown, fallback: string, options: BranchTimestampOptions = {}): string {
  return normalizeExplicitIsoTimestamp(value)
    ?? (options.legacyTimestamps ? normalizeLegacyIsoTimestamp(value) : null)
    ?? fallback;
}

function hash(value: string): string {
  let output = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    output ^= value.charCodeAt(index);
    output = Math.imul(output, 16777619);
  }
  return (output >>> 0).toString(36);
}

function safeId(value: unknown, raw: unknown): string {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : `branch-${hash(JSON.stringify(raw))}`;
}

function freshId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `branch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function ids(value: unknown, valid: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const item of value.slice(0, MAX_CASE_BRANCH_REFERENCES * 2)) {
    if (typeof item === 'string' && SAFE_ID_RE.test(item) && valid.has(item)) output.add(item);
    if (output.size >= MAX_CASE_BRANCH_REFERENCES) break;
  }
  return [...output];
}

function normalizeBranch(
  value: unknown,
  fallback: string,
  references: CaseInvestigationBranchReferences,
  options: BranchTimestampOptions = {},
): CaseInvestigationBranch | null {
  const item = record(value);
  const name = text(item.name, MAX_CASE_BRANCH_NAME_LENGTH);
  if (!name) return null;
  const createdAt = iso(item.createdAt, fallback, options);
  const branch = Object.freeze({
    id: safeId(item.id, { name, createdAt }),
    name,
    state: item.state === 'resolved' ? 'resolved' as const : 'active' as const,
    evidencePinIds: Object.freeze(ids(item.evidencePinIds, references.evidencePinIds)),
    checkpointIds: Object.freeze(ids(item.checkpointIds, references.checkpointIds)),
    assertionIds: Object.freeze(ids(item.assertionIds, references.assertionIds)),
    actionIds: Object.freeze(ids(item.actionIds, references.actionIds)),
    createdAt,
    updatedAt: iso(item.updatedAt, createdAt, options),
  });
  return branch.evidencePinIds.length || branch.checkpointIds.length || branch.assertionIds.length || branch.actionIds.length
    ? branch
    : null;
}

export function caseInvestigationBranchReferences(input: Readonly<{
  evidencePins: readonly Readonly<{ id: string; checkpointId: string | null }>[];
  assertions: readonly Readonly<{ id: string }>[];
  actions: readonly Readonly<{ id: string }>[];
}>): CaseInvestigationBranchReferences {
  return Object.freeze({
    evidencePinIds: new Set(input.evidencePins.map((item) => item.id)),
    checkpointIds: new Set(input.evidencePins.flatMap((item) => item.checkpointId ? [item.checkpointId] : [])),
    assertionIds: new Set(input.assertions.map((item) => item.id)),
    actionIds: new Set(input.actions.map((item) => item.id)),
  });
}

export function normalizeCaseInvestigationBranches(
  value: unknown,
  fallback: string,
  references: CaseInvestigationBranchReferences,
  options: BranchTimestampOptions = {},
): CaseInvestigationBranch[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, CaseInvestigationBranch>();
  for (const item of value.slice(0, MAX_CASE_INVESTIGATION_BRANCHES * 2)) {
    const normalized = normalizeBranch(item, fallback, references, options);
    if (!normalized) continue;
    const current = byId.get(normalized.id);
    if (!current || normalized.updatedAt > current.updatedAt) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(-MAX_CASE_INVESTIGATION_BRANCHES);
}

export function appendCaseInvestigationBranch(
  current: readonly CaseInvestigationBranch[],
  value: unknown,
  now: string,
  references: CaseInvestigationBranchReferences,
): CaseInvestigationBranch[] {
  if (current.length >= MAX_CASE_INVESTIGATION_BRANCHES) {
    throw new Error(`Each case is limited to ${MAX_CASE_INVESTIGATION_BRANCHES} investigation branches.`);
  }
  const item = record(value);
  const branch = normalizeBranch({ ...item, id: freshId(), createdAt: now, updatedAt: now }, now, references);
  if (!branch) throw new Error('An investigation branch requires a name and at least one valid case reference.');
  return normalizeCaseInvestigationBranches([...current, branch], now, references);
}

export function updateCaseInvestigationBranch(
  current: readonly CaseInvestigationBranch[],
  value: unknown,
  now: string,
  references: CaseInvestigationBranchReferences,
): CaseInvestigationBranch[] {
  const patch = record(value);
  const id = typeof patch.id === 'string' && SAFE_ID_RE.test(patch.id) ? patch.id : '';
  const index = current.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('That investigation branch no longer exists.');
  const existing = current[index];
  if (!existing) throw new Error('That investigation branch no longer exists.');
  const normalized = normalizeBranch({
    ...existing,
    ...(Object.hasOwn(patch, 'name') ? { name: patch.name } : {}),
    ...(Object.hasOwn(patch, 'state') ? { state: patch.state } : {}),
    ...(Object.hasOwn(patch, 'evidencePinIds') ? { evidencePinIds: patch.evidencePinIds } : {}),
    ...(Object.hasOwn(patch, 'checkpointIds') ? { checkpointIds: patch.checkpointIds } : {}),
    ...(Object.hasOwn(patch, 'assertionIds') ? { assertionIds: patch.assertionIds } : {}),
    ...(Object.hasOwn(patch, 'actionIds') ? { actionIds: patch.actionIds } : {}),
    id,
    updatedAt: now,
  }, now, references);
  if (!normalized) throw new Error('An investigation branch requires a name and at least one valid case reference.');
  const next = [...current];
  next[index] = normalized;
  return normalizeCaseInvestigationBranches(next, now, references);
}

export function mergeCaseInvestigationBranches(
  local: readonly CaseInvestigationBranch[],
  imported: readonly CaseInvestigationBranch[],
  fallback: string,
  references: CaseInvestigationBranchReferences,
): CaseInvestigationBranch[] {
  return normalizeCaseInvestigationBranches([...local, ...imported], fallback, references);
}

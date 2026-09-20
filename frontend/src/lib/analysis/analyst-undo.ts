export const ANALYST_UNDO_WINDOW_MS = 12_000;
export const MAX_ANALYST_UNDO_TEXT_LENGTH = 120;

export const ANALYST_UNDO_KINDS = Object.freeze([
  'bulk_review_state',
  'case_tags',
  'shortlist_membership',
  'local_label',
] as const);

export type AnalystUndoKind = typeof ANALYST_UNDO_KINDS[number];

export class AnalystUndoConflictError extends Error {
  constructor() {
    super('The saved value changed after this action. Undo was not applied; the newer changes were preserved.');
    this.name = 'AnalystUndoConflictError';
  }
}

/** Compare bounded, canonical values inside the existing storage transaction. */
export function assertAnalystUndoCurrent<T>(current: T, expected: T): void {
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new AnalystUndoConflictError();
}

export type AnalystUndoDescriptor = {
  id: string;
  kind: AnalystUndoKind;
  action: string;
  affectedRecord: string;
  createdAt: number;
  expiresAt: number;
};

function boundedText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, MAX_ANALYST_UNDO_TEXT_LENGTH)
    : '';
}

export function createAnalystUndoDescriptor(
  input: {
    kind: AnalystUndoKind;
    action: unknown;
    affectedRecord: unknown;
  },
  now = Date.now(),
  windowMs = ANALYST_UNDO_WINDOW_MS,
): AnalystUndoDescriptor {
  const action = boundedText(input.action);
  const affectedRecord = boundedText(input.affectedRecord);
  const ttl = Number.isFinite(windowMs)
    ? Math.min(ANALYST_UNDO_WINDOW_MS, Math.max(1_000, Math.trunc(windowMs)))
    : ANALYST_UNDO_WINDOW_MS;
  if (!ANALYST_UNDO_KINDS.includes(input.kind) || !action || !affectedRecord) {
    throw new Error('Undo actions require a supported local mutation, action, and affected record.');
  }
  return {
    id: `${input.kind}:${now}:${crypto.randomUUID()}`,
    kind: input.kind,
    action,
    affectedRecord,
    createdAt: now,
    expiresAt: now + ttl,
  };
}

export function analystUndoRemainingMs(
  descriptor: AnalystUndoDescriptor,
  now = Date.now(),
): number {
  return Math.max(0, descriptor.expiresAt - now);
}

export function analystUndoExpired(
  descriptor: AnalystUndoDescriptor,
  now = Date.now(),
): boolean {
  return analystUndoRemainingMs(descriptor, now) === 0;
}

// Document-local ownership only. No draft values enter this leave/sign-out guard.
export type UnconfirmedCaseDraft = Readonly<{ owner: object; caseId: string; form: string }>;
const unprotected = new Map<object, Omit<UnconfirmedCaseDraft, 'owner'> | null>();
const listeners = new Set<() => void>();
export function hasUnprotectedCaseDrafts(): boolean { return unprotected.size > 0; }
export function setCaseDraftUnprotected(owner: object, value: boolean, unconfirmed?: Omit<UnconfirmedCaseDraft, 'owner'>): void {
  const previous = unprotected.get(owner);
  if (value) {
    const next = unconfirmed ? Object.freeze({ caseId: unconfirmed.caseId, form: unconfirmed.form }) : null;
    if (unprotected.has(owner) && previous?.caseId === next?.caseId && previous?.form === next?.form) return;
    unprotected.set(owner, next);
  } else if (!unprotected.delete(owner)) return;
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* Display observers cannot change a write or its leave guard. */ }
  }
}

export function unconfirmedCaseDrafts(): readonly UnconfirmedCaseDraft[] {
  return [...unprotected].flatMap(([owner, context]) => context ? [Object.freeze({ owner, ...context })] : []);
}

export function subscribeCaseDraftState(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

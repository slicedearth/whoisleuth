// Document-local ownership only. No draft values enter this leave/sign-out guard.
const unprotected = new Set<object>();
export function hasUnprotectedCaseDrafts(): boolean { return unprotected.size > 0; }
export function setCaseDraftUnprotected(owner: object, value: boolean): void {
  if (value) unprotected.add(owner); else unprotected.delete(owner);
}

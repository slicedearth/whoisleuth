/** Keep completion of one save from clearing a later edit or another record's draft. */
export function createDraftRevision(owner: () => string) {
  let revision = 0;
  return Object.freeze({
    changed: (): void => { revision += 1; },
    capture: (): (() => boolean) => {
      const submittedRevision = revision;
      const submittedOwner = owner();
      return () => revision === submittedRevision && owner() === submittedOwner;
    },
  });
}

export function restoreSubmittedFocus(
  origin: Element | null,
  target: HTMLElement | null | undefined,
  owner: Node | null | undefined,
): boolean {
  if (!owner?.isConnected || !target?.isConnected || ('disabled' in target && target.disabled)) return false;
  const document = target.ownerDocument;
  if (document.activeElement !== document.body && document.activeElement !== origin) return false;
  target.focus({ preventScroll: true });
  return true;
}

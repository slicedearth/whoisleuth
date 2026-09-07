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

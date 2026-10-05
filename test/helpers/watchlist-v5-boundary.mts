/** Independent historical shape; deliberately imports no current model or limit. */
export function watchlistV5Boundary(fixture: string, bytes: number, recoveredLists = 1) {
  const value = JSON.parse(fixture);
  const template = structuredClone(value.watchlists.Retained);
  for (let index = 1; index < recoveredLists; index++) value.watchlists[`Retained-${index}`] = structuredClone(template);
  const padding: Array<{ reason: string }> = [];
  for (const [name, entry] of Object.entries(value.watchlists) as Array<[string, typeof template]>) {
    if (!name.startsWith('Retained')) continue;
    for (const member of entry.domainMetadata) {
      for (let index = 0; index < 3; index++) {
        const context = { brandProfileId: `boundary-${index}`, priority: 'unassigned', reason: '', changedAt: null, reviewDueAt: null };
        member.contexts.push(context);
        padding.push(context);
      }
    }
  }
  let remaining = bytes - Buffer.byteLength(JSON.stringify(value));
  if (remaining < 0) throw new RangeError('Boundary is below the independent fixture shape.');
  for (const context of padding) {
    const length = Math.min(300, remaining);
    context.reason = 'x'.repeat(length);
    remaining -= length;
  }
  if (remaining) throw new RangeError('Boundary exceeds the legal context padding.');
  return value;
}

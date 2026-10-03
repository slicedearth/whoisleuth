/** Append only a committed storage receipt; never infer pruning from a requested write. */
export function casePruningNotice(count: number): string {
  return count > 0 ? ` Removed ${count} older evidence snapshot${count === 1 ? '' : 's'} to fit workspace storage.` : '';
}

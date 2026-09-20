export type LookupAssetInputCoverage = Readonly<{
  id: string;
  supplied: number;
  inspected: number;
  admitted: number;
  invalid: number;
  duplicates: number;
  omitted: number;
}>;

/** Counts describe the projection input, not the collector's upstream universe. */
export function createGraphInputReader() {
  const coverage = new Map<string, LookupAssetInputCoverage>();
  function values<T>(
    id: string,
    value: unknown,
    maximum: number,
    normalise: (value: unknown) => T | null,
    identity?: (value: T) => string,
  ): T[] {
    const input = Array.isArray(value) ? value : [];
    const inspected = Math.min(input.length, maximum * 4);
    const result: T[] = [];
    const seen = new Set<string>();
    let invalid = 0;
    let duplicates = 0;
    let omitted = 0;
    for (let index = 0; index < inspected; index += 1) {
      const item = normalise(input[index]);
      if (item === null) { invalid += 1; continue; }
      const key = identity?.(item);
      if (key !== undefined && seen.has(key)) { duplicates += 1; continue; }
      if (key !== undefined) seen.add(key);
      if (result.length === maximum) { omitted += 1; continue; }
      result.push(item);
    }
    coverage.set(id, { id, supplied: input.length, inspected, admitted: result.length, invalid, duplicates, omitted });
    return result;
  }
  return { values, coverage };
}

export function graphInputIsIncomplete(row: LookupAssetInputCoverage): boolean {
  return row.supplied > row.inspected || row.invalid > 0 || row.omitted > 0;
}

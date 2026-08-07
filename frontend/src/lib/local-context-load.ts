import { isExpectedBrowserLocalDataFailure } from './browser-local-data.ts';

export function unavailableLocalContextLabels(
  results: readonly PromiseSettledResult<unknown>[],
  labels: readonly string[],
): string[] {
  if (results.length !== labels.length) throw new TypeError('Local-context results and labels must have the same length.');
  const unavailable: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') continue;
    if (!isExpectedBrowserLocalDataFailure(result.reason)) throw result.reason;
    unavailable.push(labels[index] ?? 'saved context');
  }
  return unavailable;
}

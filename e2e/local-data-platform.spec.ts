import { expect, test } from './fixtures';
import { runIndexedDbFeasibilityProbe } from '../frontend/src/lib/local-data-platform-probe';

test('native IndexedDB satisfies the bounded local data feasibility probe', async ({ page }) => {
  await page.goto('/dashboard');
  const result = await page.evaluate(runIndexedDbFeasibilityProbe);

  expect(result).toEqual({
    supported: true,
    opened: true,
    transactionCommitted: true,
    keyedReadMatched: true,
    indexedCollectionReadMatched: true,
    abortedTransactionRolledBack: true,
    deleteMatched: true,
    cleanupSucceeded: true,
    error: null,
  });

  const retainedProbeDatabases = await page.evaluate(async () => {
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    return databases
      .map((database) => database.name || '')
      .filter((name) => name.startsWith('whoisleuth-local-data-probe-'));
  });
  expect(retainedProbeDatabases).toEqual([]);
});

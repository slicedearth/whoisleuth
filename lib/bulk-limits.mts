// Shared collection ceilings for both the browser and local CLI. These limits
// bound one analyst-triggered job; deployment rate and operation budgets remain
// separate controls around the individual lookup requests.

export const MAX_FAST_BULK_QUERIES = 500;
export const MAX_DEEP_BULK_QUERIES = 50;
export const MAX_FAST_BULK_CONCURRENCY = 8;
export const MAX_DEEP_BULK_CONCURRENCY = 3;

export function bulkQueryLimit(mode: unknown): number {
  return mode === 'deep' ? MAX_DEEP_BULK_QUERIES : MAX_FAST_BULK_QUERIES;
}

export function bulkConcurrencyLimit(mode: unknown): number {
  return mode === 'deep' ? MAX_DEEP_BULK_CONCURRENCY : MAX_FAST_BULK_CONCURRENCY;
}

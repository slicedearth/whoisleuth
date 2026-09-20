// Shared execution limits for capability reporting and the monitoring runtime.
export const SCHEDULED_MONITOR_CYCLE_BUDGET = Object.freeze({
  maxLookups: 2,
  maxProcessedDeliveries: 8,
  softCycleBudgetMs: 24_000,
  // No fixed estimate: each operation receives the remaining cycle deadline.
  minLookupWindowMs: 0,
});

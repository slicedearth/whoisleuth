import { limitedBulkSources } from './bulk-source-coverage.ts';

export type BulkPacing = 'gentle' | 'balanced' | 'standard';
export type BulkPacingOption = Readonly<{
  id: BulkPacing;
  label: string;
  detail: string;
  fastConcurrency: number;
  deepConcurrency: number;
}>;
export type BulkProgressEstimate = Readonly<{
  completed: number;
  total: number;
  remaining: number;
  percent: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  label: string;
}>;
export type BulkProgressOutcomes = Readonly<{
  settled: number;
  complete: number;
  limited: number;
  failed: number;
  pending: number;
}>;

export const BULK_PACING_OPTIONS: readonly BulkPacingOption[] = Object.freeze([
  Object.freeze({
    id: 'gentle',
    label: 'Gentle',
    detail: 'Lowest parallel request pressure',
    fastConcurrency: 2,
    deepConcurrency: 1,
  }),
  Object.freeze({
    id: 'balanced',
    label: 'Balanced',
    detail: 'Moderate parallel request pressure',
    fastConcurrency: 6,
    deepConcurrency: 2,
  }),
  Object.freeze({
    id: 'standard',
    label: 'Standard',
    detail: 'Current bounded maximum',
    fastConcurrency: 12,
    deepConcurrency: 4,
  }),
]);

const PACING_IDS = new Set<BulkPacing>(BULK_PACING_OPTIONS.map((option) => option.id));
const MAX_ESTIMATE_MS = 24 * 60 * 60 * 1000;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeBulkPacing(value: unknown): BulkPacing {
  return typeof value === 'string' && PACING_IDS.has(value as BulkPacing)
    ? value as BulkPacing
    : 'standard';
}

export function bulkConcurrency(mode: 'fast' | 'deep', pacing: unknown): number {
  const normalized = normalizeBulkPacing(pacing);
  const option = BULK_PACING_OPTIONS.find((candidate) => candidate.id === normalized)
    ?? BULK_PACING_OPTIONS[BULK_PACING_OPTIONS.length - 1]!;
  return mode === 'fast' ? option.fastConcurrency : option.deepConcurrency;
}

function durationLabel(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `about ${seconds}s remaining`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `about ${minutes}m remaining`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return `about ${hours}h remaining`;
}

export function buildBulkProgressEstimate(
  completedValue: unknown,
  totalValue: unknown,
  elapsedValue: unknown,
): BulkProgressEstimate {
  const total = Number.isSafeInteger(totalValue) && Number(totalValue) > 0
    ? Math.min(Number(totalValue), 2_000)
    : 0;
  const completed = Number.isSafeInteger(completedValue) && Number(completedValue) >= 0
    ? Math.min(Number(completedValue), total)
    : 0;
  const elapsedMs = Number.isFinite(Number(elapsedValue)) && Number(elapsedValue) >= 0
    ? Math.min(Math.round(Number(elapsedValue)), MAX_ESTIMATE_MS)
    : 0;
  const remaining = total - completed;
  const estimatedRemainingMs = completed > 0 && remaining > 0 && elapsedMs > 0
    ? Math.min(MAX_ESTIMATE_MS, Math.round((elapsedMs / completed) * remaining))
    : null;
  return {
    completed,
    total,
    remaining,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    elapsedMs,
    estimatedRemainingMs,
    label: total === 0
      ? 'No scan queued'
      : remaining === 0
        ? 'Scan complete'
        : estimatedRemainingMs === null
          ? `${remaining} remaining`
          : `${remaining} remaining · ${durationLabel(estimatedRemainingMs)}`,
  };
}

export function buildBulkProgressOutcomes(
  rowsValue: unknown,
  totalValue: unknown,
): BulkProgressOutcomes {
  const rows = Array.isArray(rowsValue) ? rowsValue.slice(0, 2_000).map(record) : [];
  const total = Number.isSafeInteger(totalValue) && Number(totalValue) > 0
    ? Math.min(Number(totalValue), 2_000)
    : rows.length;
  let complete = 0;
  let limited = 0;
  let failed = 0;
  for (const row of rows) {
    const status = String(row.status ?? '').trim().toLowerCase();
    if (status === 'error' || status === 'failed') {
      failed += 1;
      continue;
    }
    if (limitedBulkSources(row.domain, row.sourceCoverage).length) {
      limited += 1;
      continue;
    }
    complete += 1;
  }
  const settled = complete + limited + failed;
  return {
    settled,
    complete,
    limited,
    failed,
    pending: Math.max(0, total - settled),
  };
}

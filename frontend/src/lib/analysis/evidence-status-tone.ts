export type EvidenceStatusTone = 'complete' | 'partial' | 'error' | 'neutral';

const ERROR_STATES = new Set(['error', 'failed', 'failure', 'conflict', 'rejected']);
const PARTIAL_STATES = new Set([
  'partial',
  'warning',
  'review',
  'inconclusive',
  'rate limited',
  'rate_limited',
]);
const NEUTRAL_STATES = new Set([
  'unavailable',
  'unsupported',
  'skipped',
  'disabled',
  'not found',
  'not_found',
  'not collected',
  'not_collected',
  'unknown',
  'not evaluated',
  'not_evaluated',
]);

function normalizedStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function evidenceStatusTone(
  status: unknown,
  options: Readonly<{ complete?: boolean; neutral?: boolean }> = {},
): EvidenceStatusTone {
  if (options.neutral) return 'neutral';
  const normalized = normalizedStatus(status);
  if (ERROR_STATES.has(normalized)) return 'error';
  if (NEUTRAL_STATES.has(normalized) || !normalized) return 'neutral';
  if (PARTIAL_STATES.has(normalized) || options.complete === false) return 'partial';
  return 'complete';
}

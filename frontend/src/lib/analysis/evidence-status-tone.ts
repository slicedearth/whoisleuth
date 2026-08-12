export type EvidenceStatusTone = 'success' | 'complete' | 'partial' | 'error' | 'neutral';
export type EvidenceStatusChipClass = 'good' | 'factual' | 'warn' | 'danger' | 'unavailable';

const SUCCESS_STATES = new Set([
  'success',
]);

const COMPLETE_STATES = new Set([
  'complete',
  'completed',
  'supported',
  'observed',
  'provided',
  'registered',
  'active',
  'available',
]);
const ERROR_STATES = new Set([
  'error',
  'failed',
  'failure',
  'conflict',
  'rejected',
  'invalid response',
  'invalid_response',
  'network error',
  'network_error',
  'timeout',
]);
const PARTIAL_STATES = new Set([
  'partial',
  'warning',
  'review',
  'inconclusive',
  'incomplete',
  'limited',
  'stale',
  'truncated',
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
  'not applicable',
  'not_applicable',
  'unknown',
  'not evaluated',
  'not_evaluated',
  'omitted',
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
  if (SUCCESS_STATES.has(normalized)) return 'success';
  return COMPLETE_STATES.has(normalized) ? 'complete' : 'neutral';
}

export function evidenceStatusChipClass(
  status: unknown,
  options: Readonly<{ complete?: boolean; neutral?: boolean }> = {},
): EvidenceStatusChipClass {
  const tone = evidenceStatusTone(status, options);
  if (tone === 'success') return 'good';
  if (tone === 'complete') return 'factual';
  if (tone === 'partial') return 'warn';
  if (tone === 'error') return 'danger';
  return 'unavailable';
}

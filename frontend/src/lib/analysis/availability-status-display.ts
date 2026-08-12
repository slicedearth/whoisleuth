import type { CaptureAvailabilityState } from './client-response-contracts.ts';

export type AvailabilityStatusDisplay = Readonly<{
  className: 'factual' | 'warn' | 'danger' | 'unavailable';
  label: string;
}>;

const CAPTURE_AVAILABILITY_DISPLAY: Record<CaptureAvailabilityState, AvailabilityStatusDisplay> = {
  available: { className: 'factual', label: 'Available' },
  expiring: { className: 'warn', label: 'Expiring' },
  for_sale: { className: 'factual', label: 'For sale' },
  registered: { className: 'factual', label: 'Registered' },
  unknown: { className: 'unavailable', label: 'Unknown' },
};

const FAILURE_DISPLAY: AvailabilityStatusDisplay = { className: 'danger', label: 'Error' };

function normalizeAvailabilityState(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/gu, '_').slice(0, 64)
    : '';
}

function fallbackLabel(value: string): string {
  if (!value) return 'Unknown';
  const words = value.replace(/_+/gu, ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function availabilityStatusDisplay(value: unknown): AvailabilityStatusDisplay {
  const normalized = normalizeAvailabilityState(value);
  if (normalized === 'error' || normalized === 'failed' || normalized === 'failure') {
    return normalized === 'error' ? FAILURE_DISPLAY : { ...FAILURE_DISPLAY, label: fallbackLabel(normalized) };
  }
  if (normalized in CAPTURE_AVAILABILITY_DISPLAY) {
    return CAPTURE_AVAILABILITY_DISPLAY[normalized as CaptureAvailabilityState];
  }
  return { className: 'unavailable', label: fallbackLabel(normalized) };
}

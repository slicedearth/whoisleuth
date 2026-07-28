import { MAX_RDAP_ENDPOINT_LENGTH } from './rdap-bootstrap.mts';
import type { RdapAttempt } from './rdap-types.mts';

const MAX_RDAP_ATTEMPT_DETAIL_LENGTH = 240;

function safeAttemptDetail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, MAX_RDAP_ATTEMPT_DETAIL_LENGTH) : null;
}

export function rdapAttempt(
  endpoint: string,
  outcome: string,
  options: { status?: number | null; detail?: string | null; selected?: boolean } = {},
): RdapAttempt {
  const { status = null, detail = null, selected = false } = options;
  return {
    endpoint: String(endpoint).slice(0, MAX_RDAP_ENDPOINT_LENGTH),
    transportSecurity: /^https:\/\//i.test(endpoint) ? 'https' : 'http',
    status: Number.isInteger(status) ? status : null,
    outcome,
    detail: safeAttemptDetail(detail),
    selected,
  };
}

export function rdapFailure(outcome: string, status: number | null): string {
  if (outcome === 'invalid_json') return 'returned invalid JSON';
  if (outcome === 'invalid_response') return 'returned an invalid RDAP object';
  if (outcome === 'rate_limited') return `returned HTTP ${status}`;
  if (outcome === 'server_error' || outcome === 'client_error') {
    return `returned HTTP ${status}`;
  }
  return outcome.replaceAll('_', ' ');
}

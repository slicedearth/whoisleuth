export const SELECTED_SERVICE_CONTEXT_INPUT_SCHEMA = 'whoisleuth.selected-service-context.input';
export const SELECTED_SERVICE_CONTEXT_SCHEMA = 'whoisleuth.selected-service-context';
export const SELECTED_SERVICE_CONTEXT_VERSION = 1;
// The reviewed full hostname edition contains about 46,000 entries / 1 MiB.
export const MAX_SELECTED_SERVICE_LIST_BYTES = 6 * 1024 * 1024;
export const MAX_SELECTED_SERVICE_ENTRIES = 50_000;
export const MAX_SELECTED_SERVICE_TARGETS = 2_000;
export const SERVICE_CONTEXT_ROLES = Object.freeze([
  { value: 'research_scanner', label: 'Research scanner' },
  { value: 'dynamic_dns', label: 'Dynamic DNS' },
  { value: 'shared_service', label: 'Shared service' },
] as const);
import { isValidAsciiDomainName } from './domain-name.mts';
import { canonicalIpAddress } from './ip-address.mts';


export function selectedServiceContextTarget(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 254 || /[\s/@?#\\]/u.test(value)) return null;
  const address = canonicalIpAddress(value);
  if (address) return address;
  const hostname = value.toLowerCase().replace(/\.$/u, '');
  return isValidAsciiDomainName(hostname, { requireLowercase: true }) ? hostname : null;
}

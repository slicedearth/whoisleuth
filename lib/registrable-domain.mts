import { getDomain, getPublicSuffix } from 'tldts';

import { isValidAsciiDomainName } from './hostname.mts';
import { MAX_DOMAIN_NAME_LENGTH, MAX_DOMAIN_LABEL_LENGTH } from '../packages/contracts/domain-name.mts';

// Reserve the shortest generated name and its separating dot.
export const MAX_DISCOVERY_SUFFIX_LENGTH = MAX_DOMAIN_NAME_LENGTH - 2;

/** ICANN suffix rules for a plain ASCII hostname; private suffixes do not change identity. */
export function publicSuffixForAsciiHostname(value: unknown): string | null {
  if (!isValidAsciiDomainName(value, { requireDot: false, requireLowercase: true })) return null;
  return getPublicSuffix(value);
}

/** Preserve reserved single labels; compound suffixes must match the local ICANN suffix rules. */
export function normalizeDiscoverySuffix(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_DISCOVERY_SUFFIX_LENGTH + 1 || /[\u0000-\u001f\u007f]/u.test(raw)) return null;
  const value = raw.trim().toLowerCase().replace(/^\./u, '');
  if (!value || value.length > MAX_DISCOVERY_SUFFIX_LENGTH) return null;
  if (value.length <= MAX_DOMAIN_LABEL_LENGTH && /^[a-z]{2,}$/u.test(value)) return value;
  return value.includes('.') && publicSuffixForAsciiHostname(value) === value ? value : null;
}

// Returns one canonical registrable-domain identity for an already public DNS
// hostname. Callers retain the original hostname separately when subdomain
// context matters; authority, evidence binding and scoring use this value.
export function canonicalRegistrableDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/u.test(trimmed)) return null;
  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//iu, '').split(/[/?#]/u)[0] ?? '';
  if (withoutScheme.endsWith('..')) return null;
  const candidate = withoutScheme.replace(/\.$/u, '');
  if (!candidate) return null;
  let hostname: string;
  try {
    hostname = new URL(`https://${candidate}/`).hostname.toLowerCase().replace(/\.$/u, '');
  } catch {
    return null;
  }
  if (!isValidAsciiDomainName(hostname, { requireDot: true, requireLowercase: true })) return null;
  // Keep this boundary identical to classifyQuery() and the collection
  // runtime: registrable identity follows the ICANN Public Suffix List, while
  // privately operated suffixes remain ordinary host context.
  const domain = getDomain(hostname);
  return domain
    && isValidAsciiDomainName(domain, { requireDot: true, requireLowercase: true })
    && (hostname === domain || hostname.endsWith(`.${domain}`))
    ? domain
    : null;
}

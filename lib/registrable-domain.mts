import { getDomain } from 'tldts';

import { isValidAsciiDomainName } from './hostname.mts';

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

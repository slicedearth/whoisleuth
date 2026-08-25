// Dependency-neutral canonicalisation for analyst-supplied domain names.
// Callers that accept untrusted values must apply their own type and raw-input
// bounds before using this compatibility normaliser.

import {
  MAX_DOMAIN_LABEL_LENGTH,
  MAX_DOMAIN_NAME_LENGTH,
} from '../contracts/domain-name.mts';

/**
 * Strict, canonical domain normalisation. Parses through the WHATWG URL host
 * (which strips scheme/path/port/userinfo and applies IDNA/punycode so Unicode
 * and its punycode form collapse to one value), lowercases, drops a single
 * terminal root dot, and validates LDH hostname labels. Rejects IPs, ASNs,
 * whitespace/control characters, underscores, empty/overlong/hyphen-edged
 * labels, and undotted names. Returns '' for anything unusable.
 */
export function normalizeDomain(value: unknown): string {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || /[\s\x00-\x1f\x7f]/u.test(raw)) return '';
  let hostname;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(raw);
    hostname = new URL(hasScheme ? raw : `http://${raw}`).hostname;
  } catch {
    return '';
  }
  hostname = hostname.toLowerCase().replace(/\.$/u, '');
  if (!hostname || hostname.length > MAX_DOMAIN_NAME_LENGTH) return '';
  if (hostname.includes(':') || hostname.startsWith('[')) return '';
  const labels = hostname.split('.');
  if (labels.length < 2) return '';
  const labelPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;
  for (const label of labels) {
    if (!label || label.length > MAX_DOMAIN_LABEL_LENGTH || !labelPattern.test(label)) return '';
  }
  if (/^[0-9]+$/u.test(labels.at(-1) ?? '')) return '';
  return hostname;
}

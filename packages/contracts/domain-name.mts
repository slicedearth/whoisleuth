// Dependency-neutral DNS name bounds shared by wire contracts and pure
// normalisers. These are canonical A-label limits, not raw-input allowances.

export const MAX_DOMAIN_NAME_LENGTH = 253;
export const MAX_DOMAIN_LABEL_LENGTH = 63;

const ASCII_LABEL_RE = /^[A-Za-z0-9-]+$/u;

// Syntax only: public-suffix policy and network-address safety are separate.
export function isValidAsciiHostname(value: unknown, options: Readonly<{
  requireDot?: boolean;
  requireLowercase?: boolean;
}> = {}): value is string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_DOMAIN_NAME_LENGTH
    || (options.requireLowercase === true && value !== value.toLowerCase())) return false;
  const labels = value.split('.');
  if (options.requireDot !== false && labels.length < 2) return false;
  return labels.every((label) => label.length > 0 && label.length <= MAX_DOMAIN_LABEL_LENGTH
    && !label.startsWith('-') && !label.endsWith('-') && ASCII_LABEL_RE.test(label));
}

function isIpv4Literal(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/u.test(part) && Number(part) <= 255);
}

export function isValidAsciiDomainName(value: unknown, options: Readonly<{
  requireDot?: boolean;
  requireLowercase?: boolean;
}> = {}): value is string {
  return isValidAsciiHostname(value, options) && !isIpv4Literal(value);
}

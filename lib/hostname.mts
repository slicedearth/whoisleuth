// Linear-time validation for already-normalized ASCII DNS hostnames. Keep this
// helper deliberately independent of public-suffix policy: callers decide
// whether a syntactically valid hostname must also be registrable.

const ASCII_LABEL_RE = /^[A-Za-z0-9-]+$/u;

function isValidAsciiHostname(value: unknown, options: Readonly<{
  requireDot?: boolean;
  requireLowercase?: boolean;
}> = {}): value is string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 253
    || (options.requireLowercase === true && value !== value.toLowerCase())) return false;

  const labels = value.split('.');
  if (options.requireDot !== false && labels.length < 2) return false;
  for (const label of labels) {
    if (!label
      || label.length > 63
      || label.startsWith('-')
      || label.endsWith('-')
      || !ASCII_LABEL_RE.test(label)) return false;
  }
  return true;
}

function isIpv4Literal(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part)) return false;
    return Number(part) <= 255;
  });
}

// Domain-only records must not accept an IPv4 literal merely because its
// dotted decimal labels also satisfy hostname syntax. IPv6 literals already
// fail the ASCII hostname grammar because they contain colons.
function isValidAsciiDomainName(value: unknown, options: Readonly<{
  requireDot?: boolean;
  requireLowercase?: boolean;
}> = {}): value is string {
  return isValidAsciiHostname(value, options) && !isIpv4Literal(value);
}

export { isValidAsciiDomainName, isValidAsciiHostname };

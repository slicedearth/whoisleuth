// Linear-time validation for already-normalized ASCII DNS hostnames. Keep this
// helper deliberately independent of public-suffix policy: callers decide
// whether a syntactically valid hostname must also be registrable.

const ASCII_LABEL_RE = /^[a-z0-9-]+$/iu;

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

export { isValidAsciiHostname };

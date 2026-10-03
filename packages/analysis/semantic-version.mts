// Dependency-free semantic-version validation shared by release tooling,
// runtime identity, and the frontend build. Callers provide a bounded label so
// errors retain their local context without reimplementing SemVer parsing.

export const MAX_SEMANTIC_VERSION_LENGTH = 128;

function fail(label: string, detail: string): never {
  throw new TypeError(`${label} ${detail}`);
}

function validateIdentifierList(
  value: string,
  label: string,
  kind: string,
  forbidNumericLeadingZero: boolean,
): void {
  const identifiers = value.split('.');
  if (identifiers.some((identifier) => identifier.length === 0)) {
    fail(label, `${kind} contains an empty identifier.`);
  }
  for (const identifier of identifiers) {
    if (!/^[0-9A-Za-z-]+$/u.test(identifier)) {
      fail(label, `${kind} contains an invalid identifier.`);
    }
    if (forbidNumericLeadingZero && /^[0-9]+$/u.test(identifier) && identifier.length > 1 && identifier.startsWith('0')) {
      fail(label, `${kind} numeric identifiers must not contain leading zeroes.`);
    }
  }
}

export function normalizeBoundedSemanticVersion(value: unknown, label = 'Semantic'): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_SEMANTIC_VERSION_LENGTH
    || value.trim() !== value) {
    fail(label, 'version must be a bounded semantic-version string.');
  }

  const buildParts = value.split('+');
  if (buildParts.length > 2) fail(label, 'version contains more than one build-metadata separator.');
  const [precedence, buildMetadata] = buildParts;
  if (!precedence) fail(label, 'version must include numeric precedence.');
  const prereleaseSeparator = precedence.indexOf('-');
  const core = prereleaseSeparator === -1 ? precedence : precedence.slice(0, prereleaseSeparator);
  const prerelease = prereleaseSeparator === -1 ? undefined : precedence.slice(prereleaseSeparator + 1);
  const coreParts = core.split('.');

  if (coreParts.length !== 3 || coreParts.some((part) => !/^(?:0|[1-9][0-9]*)$/u.test(part))) {
    fail(label, 'version must contain major, minor, and patch numbers without leading zeroes.');
  }
  if (prerelease !== undefined) validateIdentifierList(prerelease, label, 'prerelease', true);
  if (buildMetadata !== undefined) validateIdentifierList(buildMetadata, label, 'build metadata', false);
  return value;
}

export function normalizeBoundedStableSemanticVersion(value: unknown, label = 'Stable semantic'): string {
  const version = normalizeBoundedSemanticVersion(value, label);
  if (version.includes('-') || version.includes('+')) {
    fail(label, 'version must not include prerelease or build identifiers.');
  }
  return version;
}

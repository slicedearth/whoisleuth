// Registry capability evaluation over the immutable reviewed catalogue.

import {
  CAPABILITY_BY_SUFFIX,
  DEFAULT_CAPABILITY,
  EXPLICIT_CAPABILITIES,
  MAX_CAPABILITY_INPUT_LENGTH,
  REGISTRY_CAPABILITIES_VERSION,
  REGISTRY_STANDARDS_COVERAGE_SNAPSHOT,
  VERSION_26_NO_RDAP_SUFFIXES,
} from './registry-capability-catalogue.mts';
import type {
  RegistryCapability,
  RegistryCompatibilityRow,
  RegistryStandardsCoverageSnapshot,
} from './registry-capability-catalogue.mts';

function cloneCapability(
  capability: Readonly<RegistryCapability>,
  { suffixes = capability.suffixes }: { suffixes?: string[] } = {},
): RegistryCapability {
  return {
    ...capability,
    suffixes: [...suffixes],
    fixtureScenarios: [...capability.fixtureScenarios],
    verificationFiles: [...capability.verificationFiles],
    documentationUrls: [...capability.documentationUrls],
  };
}

function canonicalSuffix(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > MAX_CAPABILITY_INPUT_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  let trimmed = value.trim();
  if (trimmed.startsWith('.')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('.')) trimmed = trimmed.slice(0, -1);
  if (trimmed.startsWith('.') || trimmed.endsWith('.')) return null;
  if (!trimmed || /[\s\\/%@:?#]/u.test(trimmed)) return null;

  let ascii = '';
  try {
    const parsed = new URL(`http://${trimmed}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    ascii = parsed.hostname;
  } catch {
    return null;
  }
  if (!ascii || ascii.length > MAX_CAPABILITY_INPUT_LENGTH) return null;
  const labels = ascii.toLowerCase().split('.');
  if (
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    return null;
  }
  const suffix = labels.at(-1) || null;
  return suffix && /[a-z]/.test(suffix) ? suffix : null;
}

function registryCapabilityFor(value: unknown): RegistryCompatibilityRow | null {
  const suffix = canonicalSuffix(value);
  if (!suffix) return null;
  const capability = CAPABILITY_BY_SUFFIX.get(suffix);
  if (capability) {
    return {
      ...cloneCapability(capability, { suffixes: [suffix] }),
      explicitSuffixProfile: true,
    };
  }
  return {
    ...cloneCapability(DEFAULT_CAPABILITY, { suffixes: [suffix] }),
    explicitSuffixProfile: false,
  };
}

function registryAccessDiagnosticFor(value: unknown) {
  const capability = registryCapabilityFor(value);
  if (
    !capability ||
    (capability.whoisAccessProfile === 'iana-referral' &&
      capability.rdapAccessProfile === 'iana-bootstrap')
  ) {
    return null;
  }
  return {
    suffix: capability.suffixes[0],
    coverageState: capability.coverageState,
    whoisAccessProfile: capability.whoisAccessProfile,
    rdapAccessProfile: capability.rdapAccessProfile,
    limitation: capability.limitation,
    authority: 'context_only' as const,
  };
}

function listRegistryCapabilities(): RegistryCapability[] {
  return EXPLICIT_CAPABILITIES.map((capability) =>
    cloneCapability(capability),
  );
}

function registryStandardsCoverageSnapshot(): RegistryStandardsCoverageSnapshot {
  return {
    ...REGISTRY_STANDARDS_COVERAGE_SNAPSHOT,
    sources: {
      ...REGISTRY_STANDARDS_COVERAGE_SNAPSHOT.sources,
      urls: [...REGISTRY_STANDARDS_COVERAGE_SNAPSHOT.sources.urls],
    },
    counts: { ...REGISTRY_STANDARDS_COVERAGE_SNAPSHOT.counts },
    exceptions: REGISTRY_STANDARDS_COVERAGE_SNAPSHOT.exceptions.map((entry) => ({
      ...entry,
    })),
  };
}

function registryCompatibilityMatrix(): RegistryCompatibilityRow[] {
  return listRegistryCapabilities()
    .flatMap((capability) =>
      capability.suffixes.map((suffix) => ({
        ...cloneCapability(capability, { suffixes: [suffix] }),
        explicitSuffixProfile: true,
      })),
    )
    .sort((left, right) =>
      (left.suffixes[0] ?? '').localeCompare(right.suffixes[0] ?? ''),
    );
}

export {
  REGISTRY_CAPABILITIES_VERSION,
  VERSION_26_NO_RDAP_SUFFIXES,
  registryCapabilityFor,
  registryCompatibilityMatrix,
  listRegistryCapabilities,
  registryAccessDiagnosticFor,
  registryStandardsCoverageSnapshot,
};
export type {
  RdapAccessProfile,
  RegistryCapability,
  RegistryCompatibilityRow,
  RegistryStandardsCoverageSnapshot,
  WhoisAccessProfile,
  WhoisQueryProfile,
} from './registry-capability-catalogue.mts';

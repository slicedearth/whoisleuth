// Registry compatibility metadata. IANA bootstrap and referral discovery
// remain authoritative. Explicit query profiles may alter only the first
// referred registry query after a fixture-backed adapter is integrated.

import { domainToASCII } from 'node:url';

type CoverageState = 'discovery_only' | 'fixture_verified';
type RegistryClass = 'country-code' | 'generic' | 'unknown';
type WhoisQueryProfile = 'plain-domain' | 'denic-domain-ace' | 'jprs-domain-english';

type RegistryCapability = {
  id: string;
  suffixes: string[];
  registryClass: RegistryClass;
  rdapDiscovery: 'iana-bootstrap';
  whoisDiscovery: 'iana-referral';
  whoisQueryProfile: WhoisQueryProfile;
  whoisQueryScope: 'first-referral';
  whoisEncodingProfile: 'utf-8';
  whoisParserProfile: string;
  fallbackProfile: 'gt-registry-web' | null;
  coverageState: CoverageState;
  fixtureScenarios: string[];
  verificationFiles: string[];
  limitation: string;
};

type RegistryCompatibilityRow = RegistryCapability & {
  explicitSuffixProfile: boolean;
};

const REGISTRY_CAPABILITIES_VERSION = 3;
const MAX_CAPABILITY_INPUT_LENGTH = 253;

const DISCOVERY_LIMITATION = 'IANA discovery is available, but no suffix-specific query, encoding, or parser behavior is fixture-verified.';
const FIXTURE_LIMITATION = 'Synthetic fixtures verify the current parser profile; they do not prove current live-registry reachability, policy, or field publication.';

function freezeCapability(capability: RegistryCapability): Readonly<RegistryCapability> {
  Object.freeze(capability.suffixes);
  Object.freeze(capability.fixtureScenarios);
  Object.freeze(capability.verificationFiles);
  return Object.freeze(capability);
}

const DEFAULT_CAPABILITY = freezeCapability({
  id: 'iana-generic',
  suffixes: [],
  registryClass: 'unknown',
  rdapDiscovery: 'iana-bootstrap',
  whoisDiscovery: 'iana-referral',
  whoisQueryProfile: 'plain-domain',
  whoisQueryScope: 'first-referral',
  whoisEncodingProfile: 'utf-8',
  whoisParserProfile: 'generic-colon',
  fallbackProfile: null,
  coverageState: 'discovery_only',
  fixtureScenarios: ['registered', 'not_found', 'rate_limited'],
  verificationFiles: ['fixtures/whois-registry-fixtures.js'],
  limitation: DISCOVERY_LIMITATION,
});

const EXPLICIT_CAPABILITIES = [
  {
    id: 'eligibility-contact', suffixes: ['au'], registryClass: 'country-code',
    whoisParserProfile: 'eligibility-contact', fixtureScenarios: ['registered'],
  },
  {
    id: 'fred-contact-indirection', suffixes: ['cz'], registryClass: 'country-code',
    whoisParserProfile: 'fred-contact-indirection', fixtureScenarios: ['registered'],
  },
  {
    id: 'denic-domain-ace', suffixes: ['de'], registryClass: 'country-code',
    whoisQueryProfile: 'denic-domain-ace', whoisParserProfile: 'alternate-labels',
    fixtureScenarios: ['registered'],
  },
  {
    id: 'educause-indented', suffixes: ['edu'], registryClass: 'generic',
    whoisParserProfile: 'indented-contact-blocks', fixtureScenarios: ['registered'],
  },
  {
    id: 'gt-registry-web', suffixes: ['gt'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fallbackProfile: 'gt-registry-web',
    fixtureScenarios: ['registered', 'not_found', 'unavailable'],
    verificationFiles: ['test/whois-gt-fallback.test.js'],
  },
  {
    id: 'alternate-labels', suffixes: ['it'], registryClass: 'country-code',
    whoisParserProfile: 'alternate-labels-and-bare-nameservers', fixtureScenarios: ['registered'],
  },
  {
    id: 'bracketed-bilingual', suffixes: ['jp'], registryClass: 'country-code',
    whoisQueryProfile: 'jprs-domain-english', whoisParserProfile: 'bracketed-bilingual',
    fixtureScenarios: ['registered'],
  },
  {
    id: 'dot-leader', suffixes: ['kr'], registryClass: 'country-code',
    whoisParserProfile: 'dot-leader', fixtureScenarios: ['registered'],
  },
  {
    id: 'prefixed-dot-leader', suffixes: ['tr'], registryClass: 'country-code',
    whoisParserProfile: 'prefixed-dot-leader-and-bare-nameservers', fixtureScenarios: ['registered'],
  },
].map((entry) => freezeCapability({
  ...entry,
  fallbackProfile: entry.fallbackProfile || null,
  rdapDiscovery: 'iana-bootstrap',
  whoisDiscovery: 'iana-referral',
  whoisQueryProfile: entry.whoisQueryProfile || 'plain-domain',
  whoisQueryScope: 'first-referral',
  whoisEncodingProfile: 'utf-8',
  coverageState: 'fixture_verified',
  verificationFiles: entry.verificationFiles || ['fixtures/whois-registry-fixtures.js'],
  limitation: FIXTURE_LIMITATION,
} as RegistryCapability));

const CAPABILITY_BY_SUFFIX = new Map<string, Readonly<RegistryCapability>>();
for (const capability of EXPLICIT_CAPABILITIES) {
  for (const suffix of capability.suffixes) {
    if (CAPABILITY_BY_SUFFIX.has(suffix)) throw new Error(`Duplicate registry capability suffix: ${suffix}`);
    CAPABILITY_BY_SUFFIX.set(suffix, capability);
  }
}

function cloneCapability(
  capability: Readonly<RegistryCapability>,
  { suffixes = capability.suffixes }: { suffixes?: string[] } = {},
): RegistryCapability {
  return {
    ...capability,
    suffixes: [...suffixes],
    fixtureScenarios: [...capability.fixtureScenarios],
    verificationFiles: [...capability.verificationFiles],
  };
}

function canonicalSuffix(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_CAPABILITY_INPUT_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)) return null;
  let trimmed = value.trim();
  if (trimmed.startsWith('.')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('.')) trimmed = trimmed.slice(0, -1);
  if (trimmed.startsWith('.') || trimmed.endsWith('.')) return null;
  if (!trimmed) return null;
  const ascii = domainToASCII(trimmed);
  if (!ascii || ascii.length > MAX_CAPABILITY_INPUT_LENGTH) return null;
  const labels = ascii.toLowerCase().split('.');
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  const suffix = labels.at(-1) || null;
  return suffix && /[a-z]/.test(suffix) ? suffix : null;
}

function registryCapabilityFor(value: unknown): RegistryCompatibilityRow | null {
  const suffix = canonicalSuffix(value);
  if (!suffix) return null;
  const capability = CAPABILITY_BY_SUFFIX.get(suffix);
  if (capability) return { ...cloneCapability(capability), explicitSuffixProfile: true };
  return {
    ...cloneCapability(DEFAULT_CAPABILITY, { suffixes: [suffix] }),
    explicitSuffixProfile: false,
  };
}

function listRegistryCapabilities(): RegistryCapability[] {
  return EXPLICIT_CAPABILITIES.map((capability) => cloneCapability(capability));
}

function registryCompatibilityMatrix(): RegistryCompatibilityRow[] {
  return listRegistryCapabilities()
    .flatMap((capability) => capability.suffixes.map((suffix) => ({
      ...cloneCapability(capability, { suffixes: [suffix] }),
      explicitSuffixProfile: true,
    })))
    .sort((a, b) => a.suffixes[0].localeCompare(b.suffixes[0]));
}

export {
  REGISTRY_CAPABILITIES_VERSION,
  registryCapabilityFor,
  registryCompatibilityMatrix,
  listRegistryCapabilities,
};
export type { RegistryCapability, RegistryCompatibilityRow, WhoisQueryProfile };

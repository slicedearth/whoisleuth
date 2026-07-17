// Registry compatibility metadata. IANA bootstrap and referral discovery
// remain authoritative. Explicit query profiles may alter only the first
// referred registry query after a fixture-backed adapter is integrated.

import { domainToASCII } from 'node:url';

type CoverageState = 'discovery_only' | 'access_documented' | 'fixture_verified';
type RegistryClass = 'country-code' | 'generic' | 'unknown';
type WhoisQueryProfile = 'plain-domain' | 'denic-domain-ace' | 'jprs-domain-english';
type WhoisAccessProfile = 'iana-referral' | 'source-ip-authorization-required' | 'no-iana-service';
type RdapAccessProfile = 'iana-bootstrap' | 'no-iana-service';

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
  whoisAccessProfile: WhoisAccessProfile;
  rdapAccessProfile: RdapAccessProfile;
  coverageState: CoverageState;
  fixtureScenarios: string[];
  verificationFiles: string[];
  documentationUrls: string[];
  limitation: string;
};

type RegistryCompatibilityRow = RegistryCapability & {
  explicitSuffixProfile: boolean;
};

const REGISTRY_CAPABILITIES_VERSION = 5;
const MAX_CAPABILITY_INPUT_LENGTH = 253;

const DISCOVERY_LIMITATION = 'IANA discovery is available, but no suffix-specific query, encoding, or parser behavior is fixture-verified.';
const FIXTURE_LIMITATION = 'Synthetic fixtures verify the current parser profile; they do not prove current live-registry reachability, policy, or field publication.';
const ES_ACCESS_LIMITATION = 'The registry WHOIS service requires advance source-IP authorization. A failed or unavailable query is not evidence that the domain is unregistered.';
const VN_ACCESS_LIMITATION = 'IANA publishes no domain WHOIS or RDAP service for this suffix. The official browser lookup is not integrated, and missing registry data is not evidence that the domain is unregistered.';
const UK_TRANSITION_LIMITATION = 'Synthetic fixtures verify the documented sectioned port-43 response while that WHOIS service is phased out. RDAP remains the preferred registry source, and fixture coverage does not prove current reachability or field publication.';

function freezeCapability(capability: RegistryCapability): Readonly<RegistryCapability> {
  Object.freeze(capability.suffixes);
  Object.freeze(capability.fixtureScenarios);
  Object.freeze(capability.verificationFiles);
  Object.freeze(capability.documentationUrls);
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
  whoisAccessProfile: 'iana-referral',
  rdapAccessProfile: 'iana-bootstrap',
  coverageState: 'discovery_only',
  fixtureScenarios: ['registered', 'not_found', 'rate_limited'],
  verificationFiles: ['fixtures/whois-registry-fixtures.js'],
  documentationUrls: [],
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
    id: 'source-ip-authorized-whois', suffixes: ['es'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'source-ip-authorization-required',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: [
      'https://www.iana.org/domains/root/db/es.html',
      'https://www.dominios.es/es/sobre-dominios/valores-anadidos/whois-43',
    ],
    limitation: ES_ACCESS_LIMITATION,
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
  {
    id: 'sectioned-registry-response', suffixes: ['uk'], registryClass: 'country-code',
    whoisParserProfile: 'indented-section-values-and-bare-nameservers',
    fixtureScenarios: ['registered', 'not_found', 'malformed'],
    documentationUrls: [
      'https://registrars.nominet.uk/uk-namespace/registration-and-domain-management/query-tools/whois/',
      'https://registrars.nominet.uk/uk-namespace/registration-and-domain-management/query-tools/whois/whois-basic-instructions/',
      'https://registrars.nominet.uk/uk-namespace/registration-and-domain-management/query-tools/whois/whois-detailed-instructions/',
      'https://registrars.nominet.uk/uk-namespace/registration-and-domain-management/acceptable-use-policy/',
    ],
    limitation: UK_TRANSITION_LIMITATION,
  },
  {
    id: 'no-iana-registry-service', suffixes: ['vn'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'no-iana-service',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: [
      'https://www.iana.org/domains/root/db/vn.html',
      'https://whois.vnnic.vn/',
    ],
    limitation: VN_ACCESS_LIMITATION,
  },
].map((entry) => freezeCapability({
  ...entry,
  fallbackProfile: entry.fallbackProfile || null,
  rdapDiscovery: 'iana-bootstrap',
  whoisDiscovery: 'iana-referral',
  whoisQueryProfile: entry.whoisQueryProfile || 'plain-domain',
  whoisQueryScope: 'first-referral',
  whoisEncodingProfile: 'utf-8',
  whoisAccessProfile: entry.whoisAccessProfile || 'iana-referral',
  rdapAccessProfile: entry.rdapAccessProfile || 'iana-bootstrap',
  coverageState: entry.coverageState || 'fixture_verified',
  verificationFiles: entry.verificationFiles || ['fixtures/whois-registry-fixtures.js'],
  documentationUrls: entry.documentationUrls || [],
  limitation: entry.limitation || FIXTURE_LIMITATION,
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
    documentationUrls: [...capability.documentationUrls],
  };
}

function registryAccessDiagnosticFor(value: unknown) {
  const capability = registryCapabilityFor(value);
  if (!capability || (capability.whoisAccessProfile === 'iana-referral'
    && capability.rdapAccessProfile === 'iana-bootstrap')) return null;
  return {
    suffix: capability.suffixes[0],
    coverageState: capability.coverageState,
    whoisAccessProfile: capability.whoisAccessProfile,
    rdapAccessProfile: capability.rdapAccessProfile,
    limitation: capability.limitation,
    authority: 'context_only' as const,
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
  registryAccessDiagnosticFor,
};
export type {
  RdapAccessProfile,
  RegistryCapability,
  RegistryCompatibilityRow,
  WhoisAccessProfile,
  WhoisQueryProfile,
};

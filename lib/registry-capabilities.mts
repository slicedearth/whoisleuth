// Registry compatibility metadata. IANA bootstrap and referral discovery
// remain authoritative. Explicit query profiles may alter only the first
// referred registry query after a fixture-backed adapter is integrated.

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

const REGISTRY_CAPABILITIES_VERSION = 8;
const MAX_CAPABILITY_INPUT_LENGTH = 253;

const DISCOVERY_LIMITATION = 'IANA discovery is available, but no suffix-specific query, encoding, or parser behavior is fixture-verified.';
const FIXTURE_LIMITATION = 'Synthetic fixtures verify the current parser profile; they do not prove current live-registry reachability, policy, or field publication.';
const ES_ACCESS_LIMITATION = 'The registry WHOIS service requires advance source-IP authorization. A failed or unavailable query is not evidence that the domain is unregistered.';
const VN_ACCESS_LIMITATION = 'IANA publishes no domain WHOIS or RDAP service for this suffix. The official browser lookup is not integrated, and missing registry data is not evidence that the domain is unregistered.';
const UK_TRANSITION_LIMITATION = 'Synthetic fixtures verify the documented sectioned port-43 response while that WHOIS service is phased out. RDAP remains the preferred registry source, and fixture coverage does not prove current reachability or field publication.';
const MY_ACCESS_LIMITATION = 'Synthetic fixtures verify the current parser profile. The registry limits public WHOIS use, prohibits abusive high-volume automation, and states that a missing record is not proof of availability; WHOISleuth retains bounded request controls and authority-aware interpretation.';

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
    id: 'nic-ar-colon', suffixes: ['ar'], registryClass: 'country-code',
    whoisParserProfile: 'nic-ar-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://nic.ar/index.php/en/whois',
      'https://www.iana.org/domains/root/db/ar.html',
    ],
  },
  {
    id: 'nic-at-colon', suffixes: ['at'], registryClass: 'country-code',
    whoisParserProfile: 'nic-at-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.nic.at/en/my-at-domain/domain-search/whois',
      'https://www.iana.org/domains/root/db/at.html',
    ],
  },
  {
    id: 'eligibility-contact', suffixes: ['au'], registryClass: 'country-code',
    whoisParserProfile: 'eligibility-contact', fixtureScenarios: ['registered'],
  },
  {
    id: 'dns-belgium-sectioned', suffixes: ['be'], registryClass: 'country-code',
    whoisParserProfile: 'sectioned-registrar-and-nameservers', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.dnsbelgium.be/en/our-role/registry-registrar-registrant',
      'https://www.iana.org/domains/root/db/be.html',
    ],
  },
  {
    id: 'registro-br-colon', suffixes: ['br'], registryClass: 'country-code',
    whoisParserProfile: 'registro-br-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://registro.br/tecnologia/ferramentas/whois/',
      'https://www.iana.org/domains/root/db/br.html',
    ],
  },
  {
    id: 'cira-colon', suffixes: ['ca'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.cira.ca/en/ca-domains/whois/',
      'https://www.iana.org/domains/root/db/ca.html',
    ],
  },
  {
    id: 'nic-chile-colon', suffixes: ['cl'], registryClass: 'country-code',
    whoisParserProfile: 'nic-chile-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.nic.cl/normativa/politica-publicacion-de-datos-cl.pdf',
      'https://www.iana.org/domains/root/db/cl.html',
    ],
  },
  {
    id: 'cnnic-colon', suffixes: ['cn'], registryClass: 'country-code',
    whoisParserProfile: 'cnnic-roid-and-lifecycle', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www2.cnnic.cn/2/3/index.html',
      'https://www.iana.org/domains/root/db/cn.html',
    ],
  },
  {
    id: 'ustld-colon', suffixes: ['us'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.about.us/faqs',
      'https://www.iana.org/domains/root/db/us.html',
    ],
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
    id: 'punktum-sectioned', suffixes: ['dk'], registryClass: 'country-code',
    whoisParserProfile: 'punktum-domain-dns-and-hostname', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://punktum.dk/en/articles/additional-services',
      'https://www.iana.org/domains/root/db/dk.html',
    ],
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
    id: 'eurid-sectioned', suffixes: ['eu'], registryClass: 'country-code',
    whoisParserProfile: 'sectioned-registrar-and-nameservers', fixtureScenarios: ['registered', 'malformed'],
    documentationUrls: [
      'https://eurid.eu/en/knowledge-centre/rules-for-eu-domains/',
      'https://eurid.eu/d/22380/whois_policy_en.pdf',
      'https://www.iana.org/domains/root/db/eu.html',
    ],
  },
  {
    id: 'gt-registry-web', suffixes: ['gt'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fallbackProfile: 'gt-registry-web',
    fixtureScenarios: ['registered', 'not_found', 'unavailable'],
    verificationFiles: ['test/whois-gt-fallback.test.js'],
  },
  {
    id: 'weare-ie-colon', suffixes: ['ie'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.weare.ie/wp-content/uploads/2023/12/WHOIS-Services-Policy-2023.pdf',
      'https://www.iana.org/domains/root/db/ie.html',
    ],
  },
  {
    id: 'nixi-colon', suffixes: ['in'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.registry.in/policies',
      'https://www.iana.org/domains/root/db/in.html',
    ],
  },
  {
    id: 'pandi-colon', suffixes: ['id'], registryClass: 'country-code',
    whoisParserProfile: 'pandi-domain-id-and-sponsor', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://pandi.id/public/files/2024/9/kebijakan-umum-nama-domain-versi-7-0-bilingual-1727681641.pdf',
      'https://www.iana.org/domains/root/db/id.html',
    ],
  },
  {
    id: 'isoc-il-colon', suffixes: ['il'], registryClass: 'country-code',
    whoisParserProfile: 'isoc-validity-and-multiword-status', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://en.isoc.org.il/whois',
      'https://www.iana.org/domains/root/db/il.html',
    ],
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
    id: 'fi-dot-leader', suffixes: ['fi'], registryClass: 'country-code',
    whoisParserProfile: 'dot-leader', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.traficom.fi/en/fi-domains/point-contact-and-contact-channels/whois-shows-public-information-domain-name',
      'https://www.iana.org/domains/root/db/fi.html',
    ],
  },
  {
    id: 'dot-leader', suffixes: ['kr'], registryClass: 'country-code',
    whoisParserProfile: 'dot-leader', fixtureScenarios: ['registered'],
  },
  {
    id: 'registry-mx-colon', suffixes: ['mx'], registryClass: 'country-code',
    whoisParserProfile: 'contact-blocks-and-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.dominios.mx/whois/',
      'https://www.iana.org/domains/root/db/mx.html',
    ],
  },
  {
    id: 'mynic-colon', suffixes: ['my'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://mynic.my/WHOIS',
      'https://www.iana.org/domains/root/db/my.html',
    ],
    limitation: MY_ACCESS_LIMITATION,
  },
  {
    id: 'norid-dot-leader', suffixes: ['no'], registryClass: 'country-code',
    whoisParserProfile: 'norid-handle-dot-leader', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://teknisk.norid.no/uploads/2018/08/Whois_DAS_Interface_Specification.10e1.pdf',
      'https://www.norid.no/en/domeneoppslag/',
      'https://www.iana.org/domains/root/db/no.html',
    ],
  },
  {
    id: 'afnic-colon', suffixes: ['fr'], registryClass: 'country-code',
    whoisParserProfile: 'afnic-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.afnic.fr/en/domain-names-and-support/everything-there-is-to-know-about-domain-names/find-a-domain-name-or-a-holder-using-whois/',
      'https://www.iana.org/domains/root/db/fr.html',
    ],
  },
  {
    id: 'structured-underscore', suffixes: ['nz'], registryClass: 'country-code',
    whoisParserProfile: 'structured-underscore',
    fixtureScenarios: ['registered', 'not_found', 'rate_limited', 'restricted'],
    documentationUrls: [
      'https://docs.internetnz.nz/whois/',
      'https://www.iana.org/domains/root/db/nz.html',
    ],
  },
  {
    id: 'nask-sectioned', suffixes: ['pl'], registryClass: 'country-code',
    whoisParserProfile: 'nask-sectioned', fixtureScenarios: ['registered', 'malformed'],
    documentationUrls: [
      'https://www.dns.pl/en/whois',
      'https://www.iana.org/domains/root/db/pl.html',
    ],
  },
  {
    id: 'dns-pt-colon', suffixes: ['pt'], registryClass: 'country-code',
    whoisParserProfile: 'dns-pt-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.dns.pt/fotos/editor2/pt_registration_rules_apos_consulta.pdf',
      'https://www.iana.org/domains/root/db/pt.html',
    ],
  },
  {
    id: 'rotld-colon', suffixes: ['ro'], registryClass: 'country-code',
    whoisParserProfile: 'rotld-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.rotld.ro/reguli-de-inregistrare/',
      'https://www.iana.org/domains/root/db/ro.html',
    ],
  },
  {
    id: 'tci-colon', suffixes: ['ru'], registryClass: 'country-code',
    whoisParserProfile: 'tci-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://cctld.ru/en/service/whois/',
      'https://www.iana.org/domains/root/db/ru.html',
    ],
  },
  {
    id: 'internetstiftelsen-colon', suffixes: ['se'], registryClass: 'country-code',
    whoisParserProfile: 'internetstiftelsen-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://internetstiftelsen.se/domaner/registrera-ett-domannamn/regler-och-beskrivning-av-domannamnssokningar/',
      'https://www.iana.org/domains/root/db/se.html',
    ],
  },
  {
    id: 'sgnic-colon', suffixes: ['sg'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.sgnic.sg/docs/default-source/policies-and-agreements/whois-policy.pdf',
      'https://www.sgnic.sg/technical-services/rdap',
      'https://www.iana.org/domains/root/db/sg.html',
    ],
  },
  {
    id: 'register-si-colon', suffixes: ['si'], registryClass: 'country-code',
    whoisParserProfile: 'register-si-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.register.si/en/disclosure-of-information-about-a-si-domain-holder/',
      'https://www.iana.org/domains/root/db/si.html',
    ],
  },
  {
    id: 'sk-nic-colon', suffixes: ['sk'], registryClass: 'country-code',
    whoisParserProfile: 'sk-nic-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://sk-nic.sk/en/faq-en/general/',
      'https://www.iana.org/domains/root/db/sk.html',
    ],
  },
  {
    id: 'prefixed-dot-leader', suffixes: ['tr'], registryClass: 'country-code',
    whoisParserProfile: 'prefixed-dot-leader-and-bare-nameservers', fixtureScenarios: ['registered'],
  },
  {
    id: 'twnic-colon', suffixes: ['tw'], registryClass: 'country-code',
    whoisParserProfile: 'twnic-record-dates-and-provider', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.twnic.tw/dnservice/policy/?lang=en',
      'https://www.iana.org/domains/root/db/tw.html',
    ],
  },
  {
    id: 'hostmaster-ua-colon', suffixes: ['ua'], registryClass: 'country-code',
    whoisParserProfile: 'hostmaster-ua-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.hostmaster.ua/policy/Reglament_UA_1.0_EN.pdf',
      'https://www.iana.org/domains/root/db/ua.html',
    ],
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
  if (!trimmed || /[\s\\/%@:?#]/u.test(trimmed)) return null;
  let ascii = '';
  try {
    const parsed = new URL(`http://${trimmed}`);
    if (parsed.username || parsed.password || parsed.port || parsed.pathname !== '/'
      || parsed.search || parsed.hash) return null;
    ascii = parsed.hostname;
  } catch {
    return null;
  }
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

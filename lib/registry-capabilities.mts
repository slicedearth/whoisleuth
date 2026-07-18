// Registry compatibility metadata. IANA bootstrap and referral discovery
// remain authoritative. Explicit query profiles may alter only the first
// referred registry query after a fixture-backed adapter is integrated.

type CoverageState = 'discovery_only' | 'access_documented' | 'fixture_verified';
type RegistryClass = 'country-code' | 'generic' | 'unknown';
type WhoisQueryProfile = 'plain-domain' | 'denic-domain-ace' | 'jprs-domain-english';
type WhoisAccessProfile = 'iana-referral' | 'registry-policy-restricted' | 'source-ip-authorization-required' | 'no-iana-service';
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

type RegistryCapabilitySeed = Pick<
  RegistryCapability,
  'id' | 'suffixes' | 'registryClass' | 'whoisParserProfile' | 'fixtureScenarios'
> & Partial<Omit<
  RegistryCapability,
  'id' | 'suffixes' | 'registryClass' | 'whoisParserProfile' | 'fixtureScenarios'
>>;

const REGISTRY_CAPABILITIES_VERSION = 16;
const MAX_CAPABILITY_INPUT_LENGTH = 253;

const DISCOVERY_LIMITATION = 'IANA discovery is available, but no suffix-specific query, encoding, or parser behavior is fixture-verified.';
const FIXTURE_LIMITATION = 'Synthetic fixtures verify the current parser profile; they do not prove current live-registry reachability, policy, or field publication.';
const ES_ACCESS_LIMITATION = 'The registry WHOIS service requires advance source-IP authorization. A failed or unavailable query is not evidence that the domain is unregistered.';
const SWITCH_ACCESS_LIMITATION = 'The registry directs public domain searches to its official lookup. Its non-standard-port Domain Check is not integrated, and IANA publishes no RDAP service. Missing registry data is not evidence that the domain is unregistered.';
const VN_ACCESS_LIMITATION = 'IANA publishes no domain WHOIS or RDAP service for this suffix. The official browser lookup is not integrated, and missing registry data is not evidence that the domain is unregistered.';
const UK_TRANSITION_LIMITATION = 'Synthetic fixtures verify the documented sectioned port-43 response while that WHOIS service is phased out. RDAP remains the preferred registry source, and fixture coverage does not prove current reachability or field publication.';
const MY_ACCESS_LIMITATION = 'Synthetic fixtures verify the current parser profile. The registry limits public WHOIS use, prohibits abusive high-volume automation, and states that a missing record is not proof of availability; WHOISleuth retains bounded request controls and authority-aware interpretation.';
const NO_IANA_MACHINE_SERVICE_LIMITATION = 'IANA publishes no domain WHOIS or RDAP service for this suffix. Missing registry data is not evidence that the domain is unregistered.';
const NORID_CLOSED_SUFFIX_LIMITATION = 'The registry has not opened this suffix for registrations, and IANA publishes no domain WHOIS or RDAP service. Missing registry data is contextual only and must not be interpreted as a live availability result.';
const VERSION_15_NO_IANA_MACHINE_SERVICE_SUFFIXES = Object.freeze([
  'ao', 'az', 'bb', 'bd', 'bs', 'bt', 'bz', 'cd', 'cg', 'ck',
  'cu', 'cw', 'dj', 'eg', 'et', 'fk', 'gm', 'gu', 'jo', 'kh',
]);
const VERSION_16_NO_IANA_MACHINE_SERVICE_SUFFIXES = Object.freeze([
  'aq', 'er', 'ga', 'gb', 'gw', 'jm', 'km', 'kp', 'kw', 'lc',
  'lk', 'lr', 'mh', 'mp', 'mt', 'mv', 'ne', 'ni', 'np', 'nr',
  'pa', 'ps', 'py', 'sl', 'sv', 'sz', 'tj', 'tt', 'va',
  'xn--54b7fta0cc', 'xn--fzc2c9e2c', 'xn--node', 'xn--xkc2al3hye2a', 'zw',
]);
const NO_IANA_MACHINE_SERVICE_SUFFIXES = Object.freeze([
  ...VERSION_15_NO_IANA_MACHINE_SERVICE_SUFFIXES,
  ...VERSION_16_NO_IANA_MACHINE_SERVICE_SUFFIXES,
]);

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

const EXPLICIT_CAPABILITY_SEEDS: RegistryCapabilitySeed[] = [
  {
    id: 'nic-ar-colon', suffixes: ['ar'], registryClass: 'country-code',
    whoisParserProfile: 'nic-ar-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://nic.ar/index.php/en/whois',
      'https://www.iana.org/domains/root/db/ar.html',
    ],
  },
  {
    id: 'nic-at-colon', suffixes: ['at'], registryClass: 'country-code',
    whoisParserProfile: 'nic-at-colon', fixtureScenarios: ['registered', 'not_found'],
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
    id: 'register-bg-sectioned', suffixes: ['bg'], registryClass: 'country-code',
    whoisParserProfile: 'register-bg-sectioned', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.register.bg/',
      'https://www.iana.org/domains/root/db/bg.html',
    ],
  },
  {
    id: 'registro-br-colon', suffixes: ['br'], registryClass: 'country-code',
    whoisParserProfile: 'registro-br-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://registro.br/tecnologia/ferramentas/whois/',
      'https://www.iana.org/domains/root/db/br.html',
    ],
  },
  {
    id: 'cira-colon', suffixes: ['ca'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.cira.ca/en/ca-domains/whois/',
      'https://www.iana.org/domains/root/db/ca.html',
    ],
  },
  {
    id: 'nic-chile-colon', suffixes: ['cl'], registryClass: 'country-code',
    whoisParserProfile: 'nic-chile-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.nic.cl/normativa/politica-publicacion-de-datos-cl.pdf',
      'https://www.iana.org/domains/root/db/cl.html',
    ],
  },
  {
    id: 'switch-policy-restricted', suffixes: ['ch', 'li'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'registry-policy-restricted',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: [
      'https://www.nic.ch/whois/',
      'https://www.nic.ch/whois/domaincheck/',
      'https://www.iana.org/domains/root/db/ch.html',
      'https://www.iana.org/domains/root/db/li.html',
    ],
    limitation: SWITCH_ACCESS_LIMITATION,
  },
  {
    id: 'aeda-colon', suffixes: ['ae'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: ['https://www.iana.org/domains/root/db/ae.html'],
  },
  {
    id: 'identity-digital-colon-ai', suffixes: ['ai'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: ['https://www.iana.org/domains/root/db/ai.html'],
  },
  {
    id: 'amnic-sectioned', suffixes: ['am', 'xn--y9a3aq'], registryClass: 'country-code',
    whoisParserProfile: 'amnic-sectioned', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.amnic.net/',
      'https://www.iana.org/domains/root/db/am.html',
      'https://www.iana.org/domains/root/db/xn--y9a3aq.html',
    ],
  },
  {
    id: 'no-iana-machine-service-al', suffixes: ['al'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'no-iana-service',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: ['https://www.iana.org/domains/root/db/al.html'],
    limitation: NO_IANA_MACHINE_SERVICE_LIMITATION,
  },
  ...NO_IANA_MACHINE_SERVICE_SUFFIXES.map((suffix): RegistryCapabilitySeed => ({
    id: `no-iana-machine-service-${suffix}`,
    suffixes: [suffix],
    registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'no-iana-service',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: [`https://www.iana.org/domains/root/db/${suffix}.html`],
    limitation: NO_IANA_MACHINE_SERVICE_LIMITATION,
  })),
  {
    id: 'no-iana-machine-service-ba', suffixes: ['ba'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'no-iana-service',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: ['https://www.iana.org/domains/root/db/ba.html'],
    limitation: NO_IANA_MACHINE_SERVICE_LIMITATION,
  },
  {
    id: 'cctld-by-colon', suffixes: ['by', 'xn--90ais'], registryClass: 'country-code',
    whoisParserProfile: 'cctld-by-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://cctld.by/',
      'https://www.iana.org/domains/root/db/by.html',
      'https://www.iana.org/domains/root/db/xn--90ais.html',
    ],
  },
  {
    id: 'registry-co-colon', suffixes: ['co'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: ['https://www.iana.org/domains/root/db/co.html'],
  },
  {
    id: 'no-iana-machine-service-cy', suffixes: ['cy'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'no-iana-service',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: ['https://www.iana.org/domains/root/db/cy.html'],
    limitation: NO_IANA_MACHINE_SERVICE_LIMITATION,
  },
  {
    id: 'no-iana-machine-service-gr', suffixes: ['gr', 'xn--qxam'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'no-iana-service',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: [
      'https://www.iana.org/domains/root/db/gr.html',
      'https://www.iana.org/domains/root/db/xn--qxam.html',
    ],
    limitation: NO_IANA_MACHINE_SERVICE_LIMITATION,
  },
  {
    id: 'hkirc-sectioned', suffixes: ['hk', 'xn--j6w193g'], registryClass: 'country-code',
    whoisParserProfile: 'hkirc-sectioned', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.hkirc.hk/',
      'https://www.iana.org/domains/root/db/hk.html',
      'https://www.iana.org/domains/root/db/xn--j6w193g.html',
    ],
  },
  {
    id: 'irnic-handle-blocks', suffixes: ['ir'], registryClass: 'country-code',
    whoisParserProfile: 'irnic-handle-blocks', fixtureScenarios: ['registered'],
    documentationUrls: ['https://www.nic.ir/', 'https://www.iana.org/domains/root/db/ir.html'],
  },
  {
    id: 'kenic-colon', suffixes: ['ke'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: ['https://kenic.or.ke/', 'https://www.iana.org/domains/root/db/ke.html'],
  },
  {
    id: 'nic-kz-dot-leader', suffixes: ['kz', 'xn--80ao21a'], registryClass: 'country-code',
    whoisParserProfile: 'nic-kz-dot-leader', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://nic.kz/',
      'https://www.iana.org/domains/root/db/kz.html',
      'https://www.iana.org/domains/root/db/xn--80ao21a.html',
    ],
  },
  {
    id: 'dns-lu-hyphenated', suffixes: ['lu'], registryClass: 'country-code',
    whoisParserProfile: 'dns-lu-hyphenated', fixtureScenarios: ['registered'],
    documentationUrls: ['https://www.dns.lu/', 'https://www.iana.org/domains/root/db/lu.html'],
  },
  {
    id: 'nic-md-colon', suffixes: ['md'], registryClass: 'country-code',
    whoisParserProfile: 'nic-md-colon', fixtureScenarios: ['registered'],
    documentationUrls: ['https://nic.md/', 'https://www.iana.org/domains/root/db/md.html'],
  },
  {
    id: 'identity-digital-colon-me', suffixes: ['me'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: ['https://www.iana.org/domains/root/db/me.html'],
  },
  {
    id: 'identity-digital-colon-mn', suffixes: ['mn'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: ['https://www.iana.org/domains/root/db/mn.html'],
  },
  {
    id: 'nic-pk-colon', suffixes: ['pk'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: ['https://www.pknic.net.pk/', 'https://www.iana.org/domains/root/db/pk.html'],
  },
  {
    id: 'nic-sa-colon', suffixes: ['sa'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: ['https://nic.sa/', 'https://www.iana.org/domains/root/db/sa.html'],
  },
  {
    id: 'thnic-holder-colon', suffixes: ['th', 'xn--o3cw4h'], registryClass: 'country-code',
    whoisParserProfile: 'thnic-holder-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.thnic.co.th/',
      'https://www.iana.org/domains/root/db/th.html',
      'https://www.iana.org/domains/root/db/xn--o3cw4h.html',
    ],
  },
  {
    id: 'ati-tn-dot-leader', suffixes: ['tn'], registryClass: 'country-code',
    whoisParserProfile: 'ati-tn-dot-leader', fixtureScenarios: ['registered'],
    documentationUrls: ['https://www.ati.tn/', 'https://www.iana.org/domains/root/db/tn.html'],
  },
  {
    id: 'nic-io-colon', suffixes: ['io', 'ac'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.iana.org/domains/root/db/io.html',
      'https://www.iana.org/domains/root/db/ac.html',
    ],
  },
  {
    id: 'nic-af-colon', suffixes: ['af'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: ['https://nic.af/', 'https://www.iana.org/domains/root/db/af.html'],
  },
  {
    id: 'no-iana-machine-service-ph', suffixes: ['ph'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'no-iana-service',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: ['https://www.iana.org/domains/root/db/ph.html'],
    limitation: NO_IANA_MACHINE_SERVICE_LIMITATION,
  },
  {
    id: 'no-iana-machine-service-za', suffixes: ['za'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'no-iana-service',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: ['https://www.iana.org/domains/root/db/za.html'],
    limitation: NO_IANA_MACHINE_SERVICE_LIMITATION,
  },
  {
    id: 'cnnic-colon', suffixes: ['cn', 'xn--fiqs8s', 'xn--fiqz9s'], registryClass: 'country-code',
    whoisParserProfile: 'cnnic-roid-and-lifecycle', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www2.cnnic.cn/2/3/index.html',
      'https://www.iana.org/domains/root/db/cn.html',
      'https://www.iana.org/domains/root/db/xn--fiqs8s.html',
      'https://www.iana.org/domains/root/db/xn--fiqz9s.html',
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
    whoisParserProfile: 'fred-contact-indirection', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.nic.cz/whois/',
      'https://www.iana.org/domains/root/db/cz.html',
    ],
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
    id: 'eif-sectioned', suffixes: ['ee'], registryClass: 'country-code',
    whoisParserProfile: 'eif-sectioned', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.internet.ee/domains/whois-terms-and-conditions',
      'https://www.internet.ee/registrar-portal/help-and-info/eif-s-information-systems-and-technical-conditions',
      'https://www.iana.org/domains/root/db/ee.html',
    ],
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
    id: 'eurid-sectioned', suffixes: ['eu', 'xn--e1a4c', 'xn--qxa6a'], registryClass: 'country-code',
    whoisParserProfile: 'sectioned-registrar-and-nameservers', fixtureScenarios: ['registered', 'not_found', 'malformed'],
    documentationUrls: [
      'https://eurid.eu/en/knowledge-centre/rules-for-eu-domains/',
      'https://eurid.eu/d/22380/whois_policy_en.pdf',
      'https://www.iana.org/domains/root/db/eu.html',
      'https://www.iana.org/domains/root/db/xn--e1a4c.html',
      'https://www.iana.org/domains/root/db/xn--qxa6a.html',
    ],
  },
  {
    id: 'gt-registry-web', suffixes: ['gt'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fallbackProfile: 'gt-registry-web',
    fixtureScenarios: ['registered', 'not_found', 'unavailable'],
    verificationFiles: ['test/whois-gt-fallback.test.js'],
  },
  {
    id: 'carnet-icann-colon', suffixes: ['hr'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://domene.hr/en/portal/home',
      'https://www.iana.org/domains/root/db/hr.html',
    ],
  },
  {
    id: 'iszt-minimal-colon', suffixes: ['hu'], registryClass: 'country-code',
    whoisParserProfile: 'iszt-minimal-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.domain.hu/domain-search/',
      'https://www.iana.org/domains/root/db/hu.html',
    ],
  },
  {
    id: 'weare-ie-colon', suffixes: ['ie'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.weare.ie/wp-content/uploads/2023/12/WHOIS-Services-Policy-2023.pdf',
      'https://www.iana.org/domains/root/db/ie.html',
    ],
  },
  {
    id: 'nixi-colon', suffixes: [
      'in',
      'xn--2scrj9c',
      'xn--3hcrj9c',
      'xn--45br5cyl',
      'xn--45brj9c',
      'xn--fpcrj9c3d',
      'xn--gecrj9c',
      'xn--h2breg3eve',
      'xn--h2brj9c',
      'xn--h2brj9c8c',
      'xn--rvc1e0am3e',
      'xn--s9brj9c',
      'xn--xkc2dl3a5ee0h',
    ], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.registry.in/policies',
      'https://www.iana.org/domains/root/db/in.html',
      'https://www.iana.org/domains/root/db/xn--2scrj9c.html',
      'https://www.iana.org/domains/root/db/xn--3hcrj9c.html',
      'https://www.iana.org/domains/root/db/xn--45br5cyl.html',
      'https://www.iana.org/domains/root/db/xn--45brj9c.html',
      'https://www.iana.org/domains/root/db/xn--fpcrj9c3d.html',
      'https://www.iana.org/domains/root/db/xn--gecrj9c.html',
      'https://www.iana.org/domains/root/db/xn--h2breg3eve.html',
      'https://www.iana.org/domains/root/db/xn--h2brj9c.html',
      'https://www.iana.org/domains/root/db/xn--h2brj9c8c.html',
      'https://www.iana.org/domains/root/db/xn--rvc1e0am3e.html',
      'https://www.iana.org/domains/root/db/xn--s9brj9c.html',
      'https://www.iana.org/domains/root/db/xn--xkc2dl3a5ee0h.html',
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
    id: 'isnic-handle-blocks', suffixes: ['is'], registryClass: 'country-code',
    whoisParserProfile: 'isnic-handle-blocks', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.isnic.is/en/about/copyright',
      'https://www.iana.org/domains/root/db/is.html',
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
    whoisParserProfile: 'dot-leader', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.traficom.fi/en/fi-domains/point-contact-and-contact-channels/whois-shows-public-information-domain-name',
      'https://www.iana.org/domains/root/db/fi.html',
    ],
  },
  {
    id: 'dot-leader', suffixes: ['kr', 'xn--3e0b707e'], registryClass: 'country-code',
    whoisParserProfile: 'dot-leader', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.iana.org/domains/root/db/kr.html',
      'https://www.iana.org/domains/root/db/xn--3e0b707e.html',
    ],
  },
  {
    id: 'domreg-lt-colon', suffixes: ['lt'], registryClass: 'country-code',
    whoisParserProfile: 'domreg-lt-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.domreg.lt/en/faq/for-domain-registrants/how-to-access-public-information-on-domains/',
      'https://www.iana.org/domains/root/db/lt.html',
    ],
  },
  {
    id: 'nic-lv-sectioned', suffixes: ['lv'], registryClass: 'country-code',
    whoisParserProfile: 'nic-lv-sectioned', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.nic.lv/whois?lang=en',
      'https://www.iana.org/domains/root/db/lv.html',
    ],
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
    whoisParserProfile: 'norid-handle-dot-leader', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://teknisk.norid.no/uploads/2018/08/Whois_DAS_Interface_Specification.10e1.pdf',
      'https://www.norid.no/en/domeneoppslag/',
      'https://www.iana.org/domains/root/db/no.html',
    ],
  },
  {
    id: 'norid-closed-no-iana-service', suffixes: ['bv', 'sj'], registryClass: 'country-code',
    whoisParserProfile: 'generic-colon', fixtureScenarios: [],
    coverageState: 'access_documented', whoisAccessProfile: 'no-iana-service',
    rdapAccessProfile: 'no-iana-service', verificationFiles: [],
    documentationUrls: [
      'https://www.norid.no/en/omnorid/',
      'https://www.norid.no/en/omnorid/toppdomenet-bv/',
      'https://www.iana.org/domains/root/db/bv.html',
      'https://www.iana.org/domains/root/db/sj.html',
    ],
    limitation: NORID_CLOSED_SUFFIX_LIMITATION,
  },
  {
    id: 'sidn-sectioned', suffixes: ['nl'], registryClass: 'country-code',
    whoisParserProfile: 'sidn-sectioned', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.sidn.nl/en/nl-domain-name/looking-up-a-domain-name',
      'https://www.iana.org/domains/root/db/nl.html',
    ],
  },
  {
    id: 'afnic-colon', suffixes: ['fr', 'pm', 're', 'tf', 'wf', 'yt'], registryClass: 'country-code',
    whoisParserProfile: 'afnic-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.afnic.fr/en/domain-names-and-support/everything-there-is-to-know-about-domain-names/find-a-domain-name-or-a-holder-using-whois/',
      'https://www.iana.org/domains/root/db/fr.html',
      'https://www.iana.org/domains/root/db/pm.html',
      'https://www.iana.org/domains/root/db/re.html',
      'https://www.iana.org/domains/root/db/tf.html',
      'https://www.iana.org/domains/root/db/wf.html',
      'https://www.iana.org/domains/root/db/yt.html',
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
    id: 'rnids-colon', suffixes: ['rs', 'xn--90a3ac'], registryClass: 'country-code',
    whoisParserProfile: 'rnids-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.rnids.rs/en/domain-names',
      'https://www.iana.org/domains/root/db/rs.html',
      'https://www.iana.org/domains/root/db/xn--90a3ac.html',
    ],
  },
  {
    id: 'tci-colon', suffixes: ['ru', 'su', 'xn--p1ai'], registryClass: 'country-code',
    whoisParserProfile: 'tci-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://cctld.ru/en/service/whois/',
      'https://www.iana.org/domains/root/db/ru.html',
      'https://www.iana.org/domains/root/db/su.html',
      'https://www.iana.org/domains/root/db/xn--p1ai.html',
    ],
  },
  {
    id: 'internetstiftelsen-colon', suffixes: ['se'], registryClass: 'country-code',
    whoisParserProfile: 'internetstiftelsen-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://internetstiftelsen.se/domaner/registrera-ett-domannamn/regler-och-beskrivning-av-domannamnssokningar/',
      'https://www.iana.org/domains/root/db/se.html',
    ],
  },
  {
    id: 'sgnic-colon', suffixes: ['sg', 'xn--clchc0ea0b2g2a9gcd', 'xn--yfro4i67o'], registryClass: 'country-code',
    whoisParserProfile: 'icann-style-colon', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.sgnic.sg/docs/default-source/policies-and-agreements/whois-policy.pdf',
      'https://www.sgnic.sg/faq/being-a-registrar',
      'https://www.iana.org/domains/root/db/sg.html',
      'https://www.iana.org/domains/root/db/xn--clchc0ea0b2g2a9gcd.html',
      'https://www.iana.org/domains/root/db/xn--yfro4i67o.html',
    ],
  },
  {
    id: 'register-si-colon', suffixes: ['si'], registryClass: 'country-code',
    whoisParserProfile: 'register-si-colon', fixtureScenarios: ['registered', 'not_found'],
    documentationUrls: [
      'https://www.register.si/en/disclosure-of-information-about-a-si-domain-holder/',
      'https://www.iana.org/domains/root/db/si.html',
    ],
  },
  {
    id: 'sk-nic-colon', suffixes: ['sk'], registryClass: 'country-code',
    whoisParserProfile: 'sk-nic-colon', fixtureScenarios: ['registered', 'not_found'],
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
    id: 'twnic-colon', suffixes: ['tw', 'xn--kprw13d', 'xn--kpry57d'], registryClass: 'country-code',
    whoisParserProfile: 'twnic-record-dates-and-provider', fixtureScenarios: ['registered'],
    documentationUrls: [
      'https://www.twnic.tw/dnservice/policy/?lang=en',
      'https://www.iana.org/domains/root/db/tw.html',
      'https://www.iana.org/domains/root/db/xn--kprw13d.html',
      'https://www.iana.org/domains/root/db/xn--kpry57d.html',
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
];

const EXPLICIT_CAPABILITIES = EXPLICIT_CAPABILITY_SEEDS.map((entry) => freezeCapability({
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

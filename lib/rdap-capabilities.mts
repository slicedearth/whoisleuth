// Bounded interpretation of RDAP conformance declarations already present in
// a normalized response. This module performs no help request or reverse
// search and does not treat an absent extension declaration as proof that a
// server cannot support the related operation.

type UnknownRecord = Record<string, unknown>;

export const RDAP_CAPABILITY_INSPECTION_VERSION = 1;
export const RDAP_EXTENSION_CATALOG_REVIEWED_AT = '2026-07-31';
export const MAX_RDAP_CAPABILITY_DECLARATIONS = 50;
export const MAX_RDAP_UNKNOWN_CAPABILITIES = 20;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

export type RdapCapabilityState = 'complete' | 'partial' | 'unavailable';
export type RdapExtensionCategory =
  | 'core'
  | 'standard'
  | 'profile'
  | 'operator'
  | 'unknown';

export interface RdapExtensionDeclaration {
  identifier: string;
  label: string;
  category: RdapExtensionCategory;
  registered: boolean | null;
  status: 'current' | 'obsolete' | 'unknown';
  capability: string;
}

export interface RdapReverseSearchCapability {
  state: 'advertised' | 'not_advertised' | 'unknown';
  execution: 'not_attempted';
  helpDiscoveryRequired: true;
  actionAvailable: false;
  detail: string;
  limitations: string[];
}

export interface RdapCapabilityInspection {
  version: typeof RDAP_CAPABILITY_INSPECTION_VERSION;
  catalogReviewedAt: typeof RDAP_EXTENSION_CATALOG_REVIEWED_AT;
  state: RdapCapabilityState;
  declarations: RdapExtensionDeclaration[];
  unknownIdentifiers: string[];
  omittedDeclarations: number;
  reverseSearch: RdapReverseSearchCapability;
  limitations: string[];
}

interface CatalogEntry {
  label: string;
  category: Exclude<RdapExtensionCategory, 'unknown'>;
  status?: 'current' | 'obsolete';
  capability: string;
}

export interface ReviewedRdapExtensionCatalogEntry {
  identifier: string;
  status: 'current' | 'obsolete';
}

// Reviewed against the protocol registry on 2026-07-31. The registry-drift
// audit owns freshness checks; runtime lookup behavior never depends on this
// catalogue being exhaustive.
const EXTENSION_CATALOG: Readonly<Record<string, CatalogEntry>> = Object.freeze({
  rdap_level_0: {
    label: 'Core RDAP response',
    category: 'core',
    capability: 'Baseline lookup response conformance.',
  },
  arin_originas0: {
    label: 'Origin AS extension',
    category: 'operator',
    capability: 'Operator-specific origin autonomous-system data.',
  },
  artrecord: {
    label: 'Registry record extension',
    category: 'operator',
    capability: 'Operator-specific registry record data.',
  },
  autnums: {
    label: 'Autonomous-system search resource',
    category: 'standard',
    capability: 'Autonomous-system search path support declaration.',
  },
  autnumsearchresults: {
    label: 'Autonomous-system search results',
    category: 'standard',
    capability: 'Autonomous-system search result container declaration.',
  },
  cidr0: {
    label: 'CIDR network extension',
    category: 'standard',
    capability: 'CIDR prefix representation in network responses.',
  },
  farv1: {
    label: 'Federated authentication',
    category: 'standard',
    capability: 'Federated authorisation profile declaration.',
  },
  fred: {
    label: 'Registry-system extension',
    category: 'operator',
    capability: 'Operator-specific registry-system fields.',
  },
  geofeed1: {
    label: 'Geofeed extension',
    category: 'standard',
    capability: 'Geofeed publication through RDAP.',
  },
  icann_rdap_response_profile_0: {
    label: 'Response profile 0',
    category: 'profile',
    status: 'obsolete',
    capability: 'Obsolete generic-domain response profile declaration.',
  },
  icann_rdap_response_profile_1: {
    label: 'Response profile 1',
    category: 'profile',
    capability: 'Generic-domain response profile declaration.',
  },
  icann_rdap_technical_implementation_guide_0: {
    label: 'Implementation guide 0',
    category: 'profile',
    status: 'obsolete',
    capability: 'Obsolete generic-domain implementation profile declaration.',
  },
  icann_rdap_technical_implementation_guide_1: {
    label: 'Implementation guide 1',
    category: 'profile',
    capability: 'Generic-domain technical implementation profile declaration.',
  },
  ips: {
    label: 'IP network search resource',
    category: 'standard',
    capability: 'IP network search path support declaration.',
  },
  ipsearchresults: {
    label: 'IP network search results',
    category: 'standard',
    capability: 'IP network search result container declaration.',
  },
  nask: {
    label: 'Registry response extension',
    category: 'operator',
    capability: 'Operator-specific registry response fields.',
  },
  nro_rdap_profile_0: {
    label: 'Address-registry response profile',
    category: 'profile',
    capability: 'Regional address-registry response profile declaration.',
  },
  nro_rdap_profile_asn_flat_0: {
    label: 'Flat ASN profile',
    category: 'profile',
    capability: 'Flat autonomous-system hierarchy profile declaration.',
  },
  nro_rdap_profile_asn_hierarchical_0: {
    label: 'Hierarchical ASN profile',
    category: 'profile',
    capability: 'Hierarchical autonomous-system profile declaration.',
  },
  paging: {
    label: 'Result paging',
    category: 'standard',
    capability: 'Paged search-result behaviour.',
  },
  platformns: {
    label: 'Nameserver platform extension',
    category: 'operator',
    capability: 'Operator-specific nameserver platform context.',
  },
  rdap_objecttag: {
    label: 'Object tags',
    category: 'standard',
    capability: 'Structured entity identifiers for query bootstrapping.',
  },
  redacted: {
    label: 'Redaction metadata',
    category: 'standard',
    capability: 'Machine-readable response redaction markers.',
  },
  redirect_with_content: {
    label: 'Redirect with content',
    category: 'operator',
    capability: 'Operator-specific redirect response content.',
  },
  regtype: {
    label: 'Registration type extension',
    category: 'operator',
    capability: 'Operator-specific registration-type context.',
  },
  reverse_search: {
    label: 'Reverse search',
    category: 'standard',
    capability: 'Server advertises the reverse-search protocol extension.',
  },
  rirsearch1: {
    label: 'Address-registry search',
    category: 'standard',
    capability: 'Versioned network and autonomous-system search behaviour.',
  },
  sorting: {
    label: 'Result sorting',
    category: 'standard',
    capability: 'Sorted search-result behaviour.',
  },
  subsetting: {
    label: 'Partial response',
    category: 'standard',
    capability: 'Field-subset response behaviour.',
  },
  ttl0: {
    label: 'DNS TTL extension',
    category: 'standard',
    capability: 'DNS time-to-live values in RDAP responses.',
  },
});

export function reviewedRdapExtensionCatalog(): ReviewedRdapExtensionCatalogEntry[] {
  return Object.entries(EXTENSION_CATALOG)
    .filter(([, entry]) => entry.category !== 'core')
    .map(([identifier, entry]) => Object.freeze({
      identifier,
      status: entry.status ?? 'current',
    }))
    .sort((left, right) => left.identifier.localeCompare(right.identifier));
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || CONTROL_RE.test(value) || value.length > 160) return '';
  return value.trim().toLowerCase();
}

function sourceState(parsed: UnknownRecord | null, status: unknown): RdapCapabilityState {
  if (!parsed || !['success', 'complete', 'partial'].includes(typeof status === 'string' ? status : '')) {
    return 'unavailable';
  }
  return status === 'partial'
    || parsed.serverTruncated === true
    || parsed.conformanceTruncated === true
    ? 'partial'
    : 'complete';
}

function reverseSearchCapability(
  state: RdapCapabilityState,
  declared: boolean,
): RdapReverseSearchCapability {
  if (declared) {
    return {
      state: 'advertised',
      execution: 'not_attempted',
      helpDiscoveryRequired: true,
      actionAvailable: false,
      detail: 'This response advertises the reverse-search extension. The server help document must still be inspected before any property or query can be offered.',
      limitations: [
        'An extension declaration does not prove that this endpoint permits anonymous use, supports a particular property, or will return complete results.',
        'No reverse-search request was made.',
      ],
    };
  }
  if (state === 'complete') {
    return {
      state: 'not_advertised',
      execution: 'not_attempted',
      helpDiscoveryRequired: true,
      actionAvailable: false,
      detail: 'This individual response did not advertise reverse search. A separate help response could still declare server-level support.',
      limitations: [
        'Absence from an individual response is not proof that the server does not support reverse search.',
        'No help or reverse-search request was made.',
      ],
    };
  }
  return {
    state: 'unknown',
    execution: 'not_attempted',
    helpDiscoveryRequired: true,
    actionAvailable: false,
    detail: 'The response was unavailable or incomplete, so reverse-search support cannot be assessed.',
    limitations: [
      'Missing or truncated conformance data is not evidence that reverse search is unsupported.',
      'No help or reverse-search request was made.',
    ],
  };
}

export function inspectRdapCapabilities(
  parsedValue: unknown,
  status: unknown,
): RdapCapabilityInspection {
  const parsed = record(parsedValue);
  const state = sourceState(parsed, status);
  const rawDeclarations = Array.isArray(parsed?.conformance) ? parsed.conformance : [];
  const unique = new Set<string>();
  for (const value of rawDeclarations.slice(0, MAX_RDAP_CAPABILITY_DECLARATIONS * 2)) {
    const normalized = identifier(value);
    if (normalized) unique.add(normalized);
    if (unique.size >= MAX_RDAP_CAPABILITY_DECLARATIONS) break;
  }
  const declarations = [...unique].sort().map((value): RdapExtensionDeclaration => {
    const entry = EXTENSION_CATALOG[value];
    return entry
      ? {
          identifier: value,
          label: entry.label,
          category: entry.category,
          registered: entry.category === 'core' ? null : true,
          status: entry.status ?? 'current',
          capability: entry.capability,
        }
      : {
          identifier: value,
          label: 'Unclassified declaration',
          category: 'unknown',
          registered: null,
          status: 'unknown',
          capability: 'The identifier is retained for analyst review but is not interpreted by this catalogue.',
        };
  });
  const omittedDeclarations = Math.max(0, rawDeclarations.length - unique.size);
  const unknownIdentifiers = declarations
    .filter((entry) => entry.category === 'unknown')
    .map((entry) => entry.identifier)
    .slice(0, MAX_RDAP_UNKNOWN_CAPABILITIES);
  const limitations = [
    'Declarations describe what the server claims for this response; they do not prove that an operation is authorised, implemented correctly, complete, or available anonymously.',
    'Unknown identifiers remain visible and neutral. Catalogue recognition never affects availability or Risk scoring.',
  ];
  if (state === 'unavailable') {
    limitations.unshift('No usable RDAP publication was available for capability inspection.');
  } else if (state === 'partial' || omittedDeclarations > 0) {
    limitations.unshift('The conformance declaration set was incomplete or locally capped.');
  }

  return {
    version: RDAP_CAPABILITY_INSPECTION_VERSION,
    catalogReviewedAt: RDAP_EXTENSION_CATALOG_REVIEWED_AT,
    state,
    declarations,
    unknownIdentifiers,
    omittedDeclarations,
    reverseSearch: reverseSearchCapability(
      state,
      declarations.some((entry) => entry.identifier === 'reverse_search'),
    ),
    limitations,
  };
}

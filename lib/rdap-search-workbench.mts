const RDAP_SEARCH_WORKBENCH_SCHEMA = 'whoisleuth.rdap-search-workbench';
const RDAP_SEARCH_WORKBENCH_VERSION = 1;
const MAX_HELP_ENTRIES = 64;
const MAX_QUERY_VALUE_LENGTH = 254;

const SEARCHABLE_RESOURCE_TYPES = new Set(['domains', 'nameservers', 'entities', 'ips', 'autnums']);
const RELATED_RESOURCE_TYPES = new Set(['domains', 'nameservers', 'entities', 'ips', 'autnums']);
const RECOGNIZED_PROPERTIES = new Set(['handle', 'fn', 'email', 'role']);
const SENSITIVE_PROPERTIES = new Set(['fn', 'email']);

type RdapReverseSearchDeclaration = Readonly<{
  searchableResourceType: string;
  relatedResourceType: string;
  property: string;
}>;

type RdapReverseSearchCapability = RdapReverseSearchDeclaration & Readonly<{
  state: 'supported' | 'unsupported';
  disclosure: 'identifier' | 'contact';
  limitation: string | null;
}>;

type RdapSearchHelpSummary = Readonly<{
  schema: typeof RDAP_SEARCH_WORKBENCH_SCHEMA;
  version: typeof RDAP_SEARCH_WORKBENCH_VERSION;
  state: 'supported' | 'partial' | 'unsupported' | 'invalid';
  capabilities: readonly RdapReverseSearchCapability[];
  rejectedCount: number;
  truncated: boolean;
  limitations: readonly string[];
}>;

type RdapReverseSearchPlan = Readonly<{
  schema: typeof RDAP_SEARCH_WORKBENCH_SCHEMA;
  version: typeof RDAP_SEARCH_WORKBENCH_VERSION;
  state: 'ready' | 'unsupported' | 'invalid';
  requestPath: string | null;
  query: Readonly<Record<string, string>> | null;
  disclosure: Readonly<{
    class: 'identifier' | 'contact';
    summary: string;
    requiresApproval: boolean;
  }> | null;
  limitation: string | null;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 48 || !/^[a-z][a-z0-9_-]*$/u.test(normalized)) return null;
  return normalized;
}

function declarationKey(value: RdapReverseSearchDeclaration): string {
  return `${value.searchableResourceType}:${value.relatedResourceType}:${value.property}`;
}

function emptySummary(
  state: 'unsupported' | 'invalid',
  limitation: string,
  rejectedCount = 0,
): RdapSearchHelpSummary {
  return Object.freeze({
    schema: RDAP_SEARCH_WORKBENCH_SCHEMA,
    version: RDAP_SEARCH_WORKBENCH_VERSION,
    state,
    capabilities: Object.freeze([]),
    rejectedCount,
    truncated: false,
    limitations: Object.freeze([limitation]),
  });
}

function normalizeRdapSearchHelp(value: unknown): RdapSearchHelpSummary {
  const document = record(value);
  if (!document) return emptySummary('invalid', 'The RDAP help response was not an object.');

  const raw = document.reverse_search_properties;
  if (raw === undefined) {
    return emptySummary('unsupported', 'The help response did not advertise reverse-search properties.');
  }
  if (!Array.isArray(raw)) {
    return emptySummary('invalid', 'The advertised reverse-search properties were malformed.', 1);
  }

  const capabilities: RdapReverseSearchCapability[] = [];
  const seen = new Set<string>();
  let rejectedCount = 0;
  const truncated = raw.length > MAX_HELP_ENTRIES;
  for (const entry of raw.slice(0, MAX_HELP_ENTRIES)) {
    const candidate = record(entry);
    const searchableResourceType = boundedToken(candidate?.searchableResourceType);
    const relatedResourceType = boundedToken(candidate?.relatedResourceType);
    const property = boundedToken(candidate?.property);
    if (!searchableResourceType || !relatedResourceType || !property) {
      rejectedCount += 1;
      continue;
    }
    const declaration = { searchableResourceType, relatedResourceType, property };
    const key = declarationKey(declaration);
    if (seen.has(key)) continue;
    seen.add(key);
    const supported = SEARCHABLE_RESOURCE_TYPES.has(searchableResourceType)
      && RELATED_RESOURCE_TYPES.has(relatedResourceType)
      && RECOGNIZED_PROPERTIES.has(property);
    capabilities.push(Object.freeze({
      ...declaration,
      state: supported ? 'supported' : 'unsupported',
      disclosure: SENSITIVE_PROPERTIES.has(property) ? 'contact' : 'identifier',
      limitation: supported ? null : 'The server advertised a tuple that this release does not construct.',
    }));
  }

  if (truncated) rejectedCount += raw.length - MAX_HELP_ENTRIES;
  const supportedCount = capabilities.filter((entry) => entry.state === 'supported').length;
  const limitations: string[] = [];
  if (truncated) limitations.push(`Only the first ${MAX_HELP_ENTRIES} advertised properties were reviewed.`);
  if (rejectedCount > 0) limitations.push(`${rejectedCount} malformed or excess properties were not used.`);
  if (capabilities.some((entry) => entry.state === 'unsupported')) {
    limitations.push('Unrecognized advertised tuples remain visible but cannot be planned by this release.');
  }
  if (supportedCount === 0) limitations.push('No supported reverse-search tuple was advertised.');

  return Object.freeze({
    schema: RDAP_SEARCH_WORKBENCH_SCHEMA,
    version: RDAP_SEARCH_WORKBENCH_VERSION,
    state: supportedCount === 0 ? 'unsupported' : limitations.length > 0 ? 'partial' : 'supported',
    capabilities: Object.freeze(capabilities),
    rejectedCount,
    truncated,
    limitations: Object.freeze(limitations),
  });
}

function normalizeQueryValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_QUERY_VALUE_LENGTH) return null;
  if (/[\x00-\x1f\x7f]/u.test(normalized)) return null;
  return normalized;
}

function planRdapReverseSearch(
  help: RdapSearchHelpSummary,
  requested: RdapReverseSearchDeclaration & Readonly<{ value: unknown }>,
): RdapReverseSearchPlan {
  const searchableResourceType = boundedToken(requested.searchableResourceType);
  const relatedResourceType = boundedToken(requested.relatedResourceType);
  const property = boundedToken(requested.property);
  const value = normalizeQueryValue(requested.value);
  if (!searchableResourceType || !relatedResourceType || !property || !value) {
    return Object.freeze({
      schema: RDAP_SEARCH_WORKBENCH_SCHEMA,
      version: RDAP_SEARCH_WORKBENCH_VERSION,
      state: 'invalid',
      requestPath: null,
      query: null,
      disclosure: null,
      limitation: 'The requested resource types, property, or value were invalid or outside the supported bounds.',
    });
  }

  const capability = help.capabilities.find((entry) => (
    entry.state === 'supported'
    && entry.searchableResourceType === searchableResourceType
    && entry.relatedResourceType === relatedResourceType
    && entry.property === property
  ));
  if (!capability) {
    return Object.freeze({
      schema: RDAP_SEARCH_WORKBENCH_SCHEMA,
      version: RDAP_SEARCH_WORKBENCH_VERSION,
      state: 'unsupported',
      requestPath: null,
      query: null,
      disclosure: null,
      limitation: 'The supplied help response did not advertise this exact reverse-search tuple.',
    });
  }

  const parameter = `${relatedResourceType}_${property}`;
  const contactDisclosure = capability.disclosure === 'contact';
  return Object.freeze({
    schema: RDAP_SEARCH_WORKBENCH_SCHEMA,
    version: RDAP_SEARCH_WORKBENCH_VERSION,
    state: 'ready',
    requestPath: `/${searchableResourceType}`,
    query: Object.freeze({ [parameter]: value }),
    disclosure: Object.freeze({
      class: capability.disclosure,
      summary: contactDisclosure
        ? `Would disclose the supplied ${property} contact value to the selected RDAP server.`
        : `Would disclose the supplied ${property} identifier to the selected RDAP server.`,
      requiresApproval: true,
    }),
    limitation: 'This is an offline request plan. It neither sends the query nor establishes result authority, completeness, or currentness.',
  });
}

export {
  MAX_HELP_ENTRIES,
  MAX_QUERY_VALUE_LENGTH,
  RDAP_SEARCH_WORKBENCH_SCHEMA,
  RDAP_SEARCH_WORKBENCH_VERSION,
  normalizeRdapSearchHelp,
  planRdapReverseSearch,
};
export type {
  RdapReverseSearchCapability,
  RdapReverseSearchDeclaration,
  RdapReverseSearchPlan,
  RdapSearchHelpSummary,
};

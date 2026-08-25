import { defineSchemaCompatibility } from './schema-compatibility.mts';

export const RDAP_NAMESERVER_SEARCH_SCHEMA = 'whoisleuth.rdap-nameserver-search';
export const RDAP_NAMESERVER_SEARCH_VERSION = 1;
export const MAX_RDAP_NAMESERVER_SEARCH_RESULTS = 200;

export type RdapNameserverSearchState =
  | 'success'
  | 'partial'
  | 'no_results'
  | 'unsupported'
  | 'rate_limited'
  | 'unavailable';

export const RDAP_NAMESERVER_SEARCH_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.rdap-nameserver-search',
  kind: 'derived',
  schema: RDAP_NAMESERVER_SEARCH_SCHEMA,
  currentVersion: RDAP_NAMESERVER_SEARCH_VERSION,
  supportedVersions: [RDAP_NAMESERVER_SEARCH_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'none',
  byteBudget: null,
  owner: 'packages/contracts/rdap-nameserver-search.mts',
  note: 'Registry-scoped RDAP nameserver-search result with a bounded lower-bound result set and exact current browser reader.',
});

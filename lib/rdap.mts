// Public RDAP facade shared by the Express server and Netlify Functions.

import {
  BOOTSTRAP_STALE_TTL_MS,
  BOOTSTRAP_TTL_MS,
  clearRdapBootstrapCache,
  fetchBootstrap,
  uniqueRdapBases as uniqueBases,
} from './rdap-bootstrap.mts';
import {
  fetchRdapFromBasesWithParser,
  fetchRdapRecordWithParser,
} from './rdap-client.mts';
import {
  normalizeRdapEvents,
  parseRdap,
  summarizeLifecycle,
} from './rdap-normalization.mts';
import {
  fetchRegistrarRdapRecordWithParser,
  selectRegistrarRdapLink,
} from './rdap-registrar.mts';
import {
  fetchRdapDetailedWithTimeout,
  type RdapFetch,
} from './rdap-transport.mts';
import type { RegistryRdapLinkSource } from './rdap-types.mts';
import { registryServiceAdmissionFor } from './registry-capabilities.mts';

async function fetchRdapFromBases<const T extends string>(
  type: T,
  value: string,
  bases: unknown,
  fetchUpstream: RdapFetch = fetchRdapDetailedWithTimeout,
) {
  return fetchRdapFromBasesWithParser(
    type,
    value,
    bases,
    parseRdap,
    fetchUpstream,
  );
}

async function fetchRdapRecord<const T extends string>(
  type: T,
  value: string,
  options: {
    fetchRecord?: typeof fetchRdapRecordWithParser;
  } = {},
) {
  if (type === 'domain' && registryServiceAdmissionFor(value, 'rdap')?.allowed === false) {
    return null;
  }
  const fetchRecord = options.fetchRecord ?? fetchRdapRecordWithParser;
  return fetchRecord(type, value, parseRdap);
}

async function fetchRegistrarRdapRecord(
  domain: string,
  registryRecord: RegistryRdapLinkSource | null | undefined,
  options: { fetchUpstream?: RdapFetch } = {},
) {
  return fetchRegistrarRdapRecordWithParser(
    domain,
    registryRecord,
    parseRdap,
    options,
  );
}

export {
  BOOTSTRAP_TTL_MS,
  BOOTSTRAP_STALE_TTL_MS,
  fetchBootstrap,
  clearRdapBootstrapCache,
  fetchRdapRecord,
  fetchRdapFromBases,
  fetchRegistrarRdapRecord,
  selectRegistrarRdapLink,
  uniqueBases,
  parseRdap,
  normalizeRdapEvents,
  summarizeLifecycle,
};

export type {
  NormalizedRdapAutnumRecord,
  NormalizedRdapDomainRecord,
  NormalizedRdapNetworkRecord,
  NormalizedRdapRecord,
  NormalizedRdapRecordFor,
  RdapLookupRecord,
  RdapType,
} from './rdap-types.mts';

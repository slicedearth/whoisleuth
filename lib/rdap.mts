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
import { REGISTRY_CAPABILITIES_VERSION, registryServiceAdmissionFor } from './registry-capabilities.mts';

// A null record does not establish domain absence. Keep the HTTP explanation
// aligned with the same admission decision used before bootstrap discovery.
function rdapUnavailableResponse(type: string, value: string) {
  const admission = type === 'domain' ? registryServiceAdmissionFor(value, 'rdap') : null;
  if (admission?.allowed === false) {
    return {
      error: 'RDAP collection was not attempted because the retained registry capability policy does not admit this service.',
      source: 'retained_registry_capability_policy',
      capabilityVersion: REGISTRY_CAPABILITIES_VERSION,
      limitation: admission.limitation,
    };
  }
  return { error: `No RDAP registry found for "${value}" via IANA bootstrap` };
}

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
    signal?: AbortSignal;
  } = {},
) {
  options.signal?.throwIfAborted();
  if (type === 'domain' && registryServiceAdmissionFor(value, 'rdap')?.allowed === false) {
    return null;
  }
  const fetchRecord = options.fetchRecord ?? fetchRdapRecordWithParser;
  return fetchRecord(type, value, parseRdap, options.signal ? { signal: options.signal } : {});
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
  rdapUnavailableResponse,
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

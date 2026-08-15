// Historical browser-safe import facade. The pure domain-control manifest
// contract is shared by browser, CLI, and Node adapters.
export {
  DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA,
  DOMAIN_CONTROL_PASSPORT_LIMITATIONS,
  DOMAIN_CONTROL_PASSPORT_SCHEMA,
  DOMAIN_CONTROL_PASSPORT_VERSION,
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
  MAX_DOMAIN_CONTROL_PASSPORT_BYTES,
  MAX_DOMAIN_CONTROL_PASSPORT_ENTRIES,
  assertDomainControlPassportByteBudget,
  buildUnsignedDomainControlPassport,
  domainControlPassportSerialisedBytes,
  normalizeDomainControlPassportDocument,
} from '../../../../packages/evidence/domain-control-runtime.mts';

export type {
  DomainControlPassport,
  DomainControlPassportEntry,
  UnsignedDomainControlPassport,
} from '../../../../packages/evidence/domain-control-runtime.mts';

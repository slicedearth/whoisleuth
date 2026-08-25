// Historical browser-safe import facade. Domain-control record normalisation
// is owned by the pure evidence package and shared unchanged across runtimes.
export {
  MAX_CANONICAL_DOMAIN_CONTROL_RECORDS,
  canonicalCaaRecord,
  canonicalDomainControlRecordList,
  canonicalDsRecord,
  canonicalMxRecord,
} from '../../../../packages/evidence/domain-control-runtime.mts';

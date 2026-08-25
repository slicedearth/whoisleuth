import { defineSchemaCompatibility } from './schema-compatibility.mts';

export const SSLBL_SNAPSHOT_SCHEMA = 'whoisleuth.sslbl-certificate-snapshot';
export const SSLBL_SNAPSHOT_VERSION = 1;

export const SSLBL_SNAPSHOT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.sslbl-certificate-snapshot',
  kind: 'derived',
  schema: SSLBL_SNAPSHOT_SCHEMA,
  currentVersion: SSLBL_SNAPSHOT_VERSION,
  supportedVersions: [SSLBL_SNAPSHOT_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'normalized_rewrite',
  byteBudget: null,
  owner: 'packages/contracts/sslbl-snapshot.mts',
  note: 'Checked-in certificate fingerprint snapshot parsed only at its exact current contract.',
});

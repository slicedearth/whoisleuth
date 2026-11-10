import { defineSchemaCompatibility } from './schema-compatibility.mts';

export const RETAINED_SOURCE_EDITION_SCHEMA = 'whoisleuth.retained-source-edition';
export const RETAINED_SOURCE_EDITION_VERSION = 1;
export const MAX_RETAINED_SOURCE_EDITION_BYTES = 3 * 1024 * 1024;
export const HOSTED_SOURCE_IDS = ['sslbl', 'kev', 'registrar'] as const;
export type HostedSourceId = typeof HOSTED_SOURCE_IDS[number];
export const RETAINED_SOURCE_IDS = [...HOSTED_SOURCE_IDS, 'infrastructure'] as const;
export type RetainedSourceId = typeof RETAINED_SOURCE_IDS[number];

export const RETAINED_SOURCE_EDITION_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.retained-source-edition',
  kind: 'export',
  schema: RETAINED_SOURCE_EDITION_SCHEMA,
  currentVersion: RETAINED_SOURCE_EDITION_VERSION,
  supportedVersions: [RETAINED_SOURCE_EDITION_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'normalized_rewrite',
  byteBudget: MAX_RETAINED_SOURCE_EDITION_BYTES,
  owner: 'packages/contracts/retained-source-edition.mts',
  note: 'One bounded data-only edition bound to a separately supplied exact byte digest. Each source retains its existing projection validator.',
});

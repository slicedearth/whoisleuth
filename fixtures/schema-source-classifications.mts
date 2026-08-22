export const SCHEMA_SOURCE_CLASSIFICATIONS = Object.freeze([
  Object.freeze({
    identifier: 'whoisleuth.case-review-calendar',
    kind: 'exempt',
    reason: 'serialised_unversioned',
    owner: 'frontend/src/lib/analysis/case-lifecycle-calendar.ts',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'frontend/src/lib/analysis/case-lifecycle-calendar.ts', literalOccurrences: 1, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze([]),
    note: 'The iCalendar output carries a schema marker on events but no application-version marker or local import contract.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.com',
    kind: 'non_schema',
    reason: 'public_site_hostname',
    owner: 'lib/project-metadata.mts',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'lib/project-metadata.mts', literalOccurrences: 1, dynamicConstructions: 0 }),
      Object.freeze({ file: 'packages/cli/package.template.json', literalOccurrences: 1, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze([]),
    note: 'Public project hostname found inside URLs and infrastructure metadata.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.desired-posture-baseline',
    kind: 'exempt',
    reason: 'legacy_unsupported',
    owner: 'lib/interchange-fidelity-registry.mts',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'lib/interchange-fidelity-registry.mts', literalOccurrences: 1, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze([]),
    note: 'The legacy document is deliberately unsupported by every interchange reader and writer.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.git',
    kind: 'non_schema',
    reason: 'repository_filename',
    owner: 'packages/cli/package.template.json',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'packages/cli/package.template.json', literalOccurrences: 1, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze([]),
    note: 'Repository filename suffix in package metadata.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.invalid',
    kind: 'non_schema',
    reason: 'reserved_protocol_hostname',
    owner: 'lib/smtp-transport-review.mts',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'lib/smtp-transport-review.mts', literalOccurrences: 1, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze([]),
    note: 'Reserved EHLO hostname used by the bounded mail transport review.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.investigation-recipe',
    kind: 'exempt',
    reason: 'identifier_only',
    owner: 'packages/workspace/investigation-guide.mts',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'packages/workspace/investigation-guide.mts', literalOccurrences: 1, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze(['tab.investigation-guide']),
    note: 'The identifier labels the versioned tab-local model rather than its serialised contract; its portable summary has a separate inventoried schema.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.local',
    kind: 'non_schema',
    reason: 'reserved_local_uid_host',
    owner: 'frontend/src/lib/analysis/case-lifecycle-calendar.ts',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'frontend/src/lib/analysis/case-lifecycle-calendar.ts', literalOccurrences: 0, dynamicConstructions: 1 }),
    ]),
    relatedEntryIds: Object.freeze([]),
    note: 'Reserved local UID hostname embedded in generated calendar events.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.local-geoip-evidence',
    kind: 'exempt',
    reason: 'identifier_only',
    owner: 'lib/local-geoip-evidence.mts',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'lib/local-geoip-evidence.mts', literalOccurrences: 1, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze([]),
    note: 'Stable source-facade constants label the local GeoIP evidence family but are not emitted or read as a document contract.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.mjs',
    kind: 'non_schema',
    reason: 'packaged_executable_filename',
    owner: 'packages/cli/package.template.json',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'packages/cli/package.template.json', literalOccurrences: 1, dynamicConstructions: 0 }),
      Object.freeze({ file: 'tools/cli-package.mts', literalOccurrences: 4, dynamicConstructions: 0 }),
      Object.freeze({ file: 'tools/published-cli-check.mts', literalOccurrences: 1, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze([]),
    note: 'Installed CLI executable filename.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.mts',
    kind: 'non_schema',
    reason: 'source_entry_filename',
    owner: 'tools/cli-package.mts',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'tools/cli-package.mts', literalOccurrences: 2, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze([]),
    note: 'Source entry filename used during bounded package assembly.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.registry-idn-policy',
    kind: 'exempt',
    reason: 'transient_projection',
    owner: 'frontend/src/lib/analysis/idn-registry-policy.ts',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'frontend/src/lib/analysis/idn-registry-policy.ts', literalOccurrences: 1, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze([]),
    note: 'The parsed registry policy is transient and is not persisted, downloaded, or read back as a document.',
  }),
  Object.freeze({
    identifier: 'whoisleuth.relationship-evidence',
    kind: 'member',
    reason: 'provenance_marker',
    owner: 'packages/contracts/offline-comparison.mts',
    sourceUses: Object.freeze([
      Object.freeze({ file: 'packages/contracts/offline-comparison.mts', literalOccurrences: 1, dynamicConstructions: 0 }),
    ]),
    relatedEntryIds: Object.freeze(['derived.observation-envelope']),
    note: 'The marker identifies nested upstream provenance inside the common observation envelope rather than a standalone document.',
  }),
].sort((left, right) => left.identifier < right.identifier ? -1 : left.identifier > right.identifier ? 1 : 0));

export type SchemaSourceClassification = typeof SCHEMA_SOURCE_CLASSIFICATIONS[number];

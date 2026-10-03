import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
import { buildExtractedLifecycleFamily } from './extracted-domain-lifecycle.mts';
import { MAX_WATCHLIST_IMPORT_BYTES } from './workspace-portability.mts';

export const CANDIDATE_WATCH_INPUT_SCHEMA = 'whoisleuth.candidate-watch-input';
export const CANDIDATE_WATCH_INPUT_VERSION = 1;
export const CANDIDATE_WATCH_INPUT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.candidate-watch-input',
  kind: 'cli_document',
  schema: CANDIDATE_WATCH_INPUT_SCHEMA,
  currentVersion: 1,
  supportedVersions: [1],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'read_only',
  byteBudget: MAX_WATCHLIST_IMPORT_BYTES,
  owner: 'packages/contracts/candidate-watch-review.mts',
  note: 'Bounded offline analyst selection and optional portable Watchlist document; no collection or schedule authority.',
});
export const CANDIDATE_WATCH_REVIEW_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily(
  buildExtractedLifecycleFamily({
    id: 'candidate-watch-review',
    owner: 'packages/contracts/candidate-watch-review.mts',
    plane: 'node',
    projection: 'review_output',
    retention: 'transient_report',
    serializerModule: 'cli/formatters/json.mts',
    serializerExportName: 'formatJsonDocument',
    includedCategories: ['candidate-provenance', 'analyst-watch-reasons', 'review-priorities'],
    excludedCategories: ['raw-upstream-payloads', 'credentials', 'cookies', 'query-bearing-urls'],
    formats: [
      {
        descriptor: CANDIDATE_WATCH_INPUT_COMPATIBILITY,
        lifecycleSchema: CANDIDATE_WATCH_INPUT_SCHEMA,
        requiredKeys: ['schema', 'version', 'watchlists', 'selection'],
        optionalKeys: [],
        hook: {
          module: 'cli/watchlist-review.mts',
          exportName: 'parseCandidateWatchInput',
          role: 'structure_validator',
          runtime: 'node',
        },
        fixtures: [
          {
            id: 'candidate-watch-input-v1',
            path: 'test/fixtures/brand-candidate-workflow/candidate-watch-input-v1.json',
            bytes: 895,
            sha256: '40a0d73e5aa3afc3b6836bb289c79cf9556dd755a5086a9666506b31468b5d3d',
            version: 1,
          },
        ],
      },
    ],
  }),
);

import {
  MAX_BULK_SESSION_ROWS,
  normalizeBulkSessionResult,
} from '../workspace/bulk-session-model.mts';
import {
  BULK_REVIEW_STATES,
  type BulkReviewPresetView,
  type BulkReviewState,
} from '../workspace/bulk-review-model.mts';
import { SORTED_JSON_V2, sha256ArtifactDigestV2 } from '../evidence/artifact-integrity.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import {
  BULK_REVIEW_MANIFEST_SCHEMA,
  BULK_REVIEW_MANIFEST_VERSION,
} from '../contracts/investigation-portability.mts';

export { BULK_REVIEW_MANIFEST_SCHEMA, BULK_REVIEW_MANIFEST_VERSION };
const REVIEW_STATE_SET = new Set<string>(BULK_REVIEW_STATES);

type ReviewStateInput = Readonly<{ domain: string; state: string }>;

function reviewStateMap(values: readonly ReviewStateInput[]): Map<string, BulkReviewState> {
  return new Map(values.slice(0, MAX_BULK_SESSION_ROWS * 2).flatMap((item) => (
    REVIEW_STATE_SET.has(item.state)
      ? [[item.domain, item.state as BulkReviewState] as const]
      : []
  )));
}

export async function buildBulkReviewManifest(input: Readonly<{
  rows: readonly unknown[];
  reviewStates: readonly ReviewStateInput[];
  view: BulkReviewPresetView;
  lookupProfile: 'deep' | 'fast';
  observedAt?: unknown;
  generatedAt?: unknown;
}>) {
  if (!Array.isArray(input.rows) || input.rows.length > MAX_BULK_SESSION_ROWS) {
    throw new TypeError('The selected Bulk rows exceed the supported manifest capacity. No rows were exported.');
  }
  const generatedAt = normalizeExplicitIsoTimestamp(input.generatedAt) ?? new Date().toISOString();
  const observedAt = normalizeExplicitIsoTimestamp(input.observedAt);
  const states = reviewStateMap(input.reviewStates);
  const rows = input.rows.map((row) => {
    const item = normalizeBulkSessionResult(row);
    if (!item) throw new TypeError('A selected Bulk row could not be verified. No rows were exported.');
    return {
      domain: item.domain,
      reviewState: states.get(item.domain) || 'unreviewed',
      resultState: item.status,
      scanDepth: item.scanDepth,
      observedAt: item.observedAt,
      sourceCoverage: item.sourceCoverage.map(({ source, state, observedAt }) => ({ source, state, observedAt })),
      profileContext: { ...item.profileContext },
    };
  });
  const unsigned = {
    schema: BULK_REVIEW_MANIFEST_SCHEMA,
    version: BULK_REVIEW_MANIFEST_VERSION,
    generatedAt,
    observedAt,
    lookupProfile: input.lookupProfile,
    selection: {
      count: rows.length,
      domains: rows.map((item) => item.domain),
    },
    view: input.view,
    rows,
    limitations: [
      'This manifest records the explicit review selection and view context for a separate CSV export.',
      'It contains compact source states, observation times and bounded row-level Brand Profile provenance only, and excludes raw payloads, Profile contents, contact records, notes, and transient request state.',
      'The batch observation time is separate from each retained row and source time; null means the observation time is unknown, not the export time.',
      'Reproducing the filters does not reproduce upstream responses or imply that evidence remains current.',
    ],
  };
  const digestSha256 = await sha256ArtifactDigestV2(unsigned);
  const document = {
    ...unsigned,
    integrity: { algorithm: 'SHA-256' as const, canonicalization: SORTED_JSON_V2, digestSha256 },
  };
  return {
    document,
    content: `${JSON.stringify(document, null, 2)}\n`,
    filename: `whoisleuth-bulk-review-${generatedAt.slice(0, 10)}.manifest.json`,
  };
}

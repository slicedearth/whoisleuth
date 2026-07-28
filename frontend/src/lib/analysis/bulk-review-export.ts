import {
  normalizeBulkSessionResult,
  type BulkSessionResult,
} from './bulk-session-model.ts';
import {
  BULK_REVIEW_STATES,
  type BulkReviewPresetView,
  type BulkReviewState,
} from './bulk-review-model.ts';
import { sha256ArtifactDigest } from './artifact-integrity.ts';

export const BULK_REVIEW_MANIFEST_SCHEMA = 'whoisleuth.bulk-review-manifest';
export const BULK_REVIEW_MANIFEST_VERSION = 1;
const MAX_MANIFEST_ROWS = 2_000;
const REVIEW_STATE_SET = new Set<string>(BULK_REVIEW_STATES);

type ReviewStateInput = Readonly<{ domain: string; state: string }>;

function timestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

function reviewStateMap(values: readonly ReviewStateInput[]): Map<string, BulkReviewState> {
  return new Map(values.slice(0, MAX_MANIFEST_ROWS * 2).flatMap((item) => (
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
  const now = new Date().toISOString();
  const generatedAt = timestamp(input.generatedAt, now);
  const observedAt = timestamp(input.observedAt, generatedAt);
  const states = reviewStateMap(input.reviewStates);
  const rows = input.rows
    .map(normalizeBulkSessionResult)
    .filter((item): item is BulkSessionResult => Boolean(item))
    .slice(0, MAX_MANIFEST_ROWS)
    .map((item) => ({
      domain: item.domain,
      reviewState: states.get(item.domain) || 'unreviewed',
      resultState: item.status,
      scanDepth: item.scanDepth,
      sourceCoverage: item.sourceCoverage,
    }));
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
      'It contains compact source states only and excludes raw payloads, contact records, notes, and transient request state.',
      'Reproducing the filters does not reproduce upstream responses or imply that evidence remains current.',
    ],
  };
  const digestSha256 = await sha256ArtifactDigest(unsigned);
  const document = {
    ...unsigned,
    integrity: { algorithm: 'SHA-256' as const, digestSha256 },
  };
  return {
    document,
    content: `${JSON.stringify(document, null, 2)}\n`,
    filename: `whoisleuth-bulk-review-${generatedAt.slice(0, 10)}.manifest.json`,
  };
}

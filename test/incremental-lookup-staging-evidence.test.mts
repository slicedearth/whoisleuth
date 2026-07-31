import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LOOKUP_PROGRESS_STAGING_EVIDENCE_SCHEMA,
  qualifyLookupProgressStagingEvidence,
  parseLookupProgressStagingEvidence,
} from '../lib/lookup-progress-staging-evidence.mts';

const NOW = new Date('2026-07-31T02:00:00.000Z');
const DIGEST = 'a'.repeat(64);

function evidence(adapter: 'express' | 'netlify', overrides: Record<string, unknown> = {}) {
  return {
    schema: LOOKUP_PROGRESS_STAGING_EVIDENCE_SCHEMA,
    version: 1,
    adapter,
    environment: 'authenticated_staging',
    buildRevision: 'abc1234',
    capturedAt: '2026-07-31T01:00:00.000Z',
    checks: {
      progressiveDelivery: true,
      proxyBufferingAbsent: true,
      slowConsumerCompleted: true,
      authenticationExpiryHandled: true,
      duplicateEventsRejected: true,
      timeoutCancelled: true,
      abortReachedCollector: true,
      finalEnvelopeEquivalent: true,
      ordinaryFallbackPassed: true,
      cacheControlsSafe: true,
    },
    runs: [
      { client: 'desktop', path: 'direct', firstEventAfterMs: 50, eventSpanMs: 500, captureDigestSha256: DIGEST },
      { client: 'desktop', path: 'production_proxy', firstEventAfterMs: 70, eventSpanMs: 520, captureDigestSha256: DIGEST },
      { client: 'mobile', path: 'direct', firstEventAfterMs: 60, eventSpanMs: 510, captureDigestSha256: DIGEST },
      { client: 'mobile', path: 'production_proxy', firstEventAfterMs: 80, eventSpanMs: 530, captureDigestSha256: DIGEST },
    ],
    ...overrides,
  };
}

describe('incremental Lookup staging evidence', () => {
  test('qualifies fresh same-build evidence without enabling a production route', () => {
    const result = qualifyLookupProgressStagingEvidence(
      [evidence('express'), evidence('netlify')],
      { now: () => NOW },
    );
    assert.equal(result.stagingEvidenceComplete, true);
    assert.equal(result.productionRouteEnabled, false);
    assert.deepEqual(result.adapters.map((adapter) => adapter.id), ['express', 'netlify']);
    assert.ok(result.adapters.every((adapter) => adapter.runs === 4 && adapter.qualified));
  });

  test('rejects failed checks, incomplete profiles, stale captures, and mixed builds', () => {
    assert.throws(
      () => parseLookupProgressStagingEvidence(evidence('express', {
        checks: { ...evidence('express').checks, abortReachedCollector: false },
      })),
      /abortReachedCollector did not pass/,
    );
    assert.throws(
      () => parseLookupProgressStagingEvidence(evidence('express', {
        runs: evidence('express').runs.slice(0, 3),
      })),
      /desktop and mobile runs/,
    );
    assert.throws(
      () => qualifyLookupProgressStagingEvidence([
        evidence('express', { capturedAt: '2026-07-01T00:00:00.000Z' }),
        evidence('netlify'),
      ], { now: () => NOW }),
      /stale/,
    );
    assert.throws(
      () => qualifyLookupProgressStagingEvidence([
        evidence('express'),
        evidence('netlify', { buildRevision: 'def5678' }),
      ], { now: () => NOW }),
      /same build revision/,
    );
  });

  test('rejects target-bearing or otherwise unsupported fields', () => {
    assert.throws(
      () => parseLookupProgressStagingEvidence(evidence('express', {
        target: 'private.example',
      })),
      /invalid field set/,
    );
    const firstRun = evidence('express').runs[0];
    assert.ok(firstRun);
    assert.throws(
      () => parseLookupProgressStagingEvidence(evidence('express', {
        runs: [
          { ...firstRun, query: 'private.example' },
          ...evidence('express').runs.slice(1),
        ],
      })),
      /invalid field set/,
    );
  });
});

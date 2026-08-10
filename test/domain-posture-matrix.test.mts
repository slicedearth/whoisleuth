import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeBrandProfile } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import {
  buildDomainPostureMatrix,
  retainedPostureObservationId,
} from '../frontend/src/lib/analysis/domain-posture-matrix.ts';
import { requiredValue } from './value-assertions.mts';

const NOW = '2026-08-10T00:00:00.000Z';
const OBSERVED = '2026-08-09T00:30:00.000Z';

function profile() {
  return requiredValue(normalizeBrandProfile({
    id: 'portfolio-profile',
    name: 'Portfolio fixture',
    officialDomains: ['no-baseline.example', 'unavailable.example', 'review.example', 'aligned.example'],
    desiredPostureBaselines: [
      {
        domain: 'review.example',
        nameservers: ['ns1.example'],
        ds: ['12345 13 2 abcdef'],
        mx: ['10 mail.example'],
        caa: ['0 issue "ca.example"'],
        tlsIssuer: 'Fixture issuer',
        tlsSpkiSha256: '',
        registrarLock: 'not_required',
        renewalReviewAt: '2026-08-01T00:00:00.000Z',
        approvedChangeWindows: [{
          startsAt: '2026-08-09T00:00:00.000Z',
          endsAt: '2026-08-09T01:00:00.000Z',
          summary: 'Reviewed delegation change',
        }],
        suppressions: [{ field: 'mx', reason: 'Reviewed mail migration', expiresAt: null }],
        observationHistory: [{
          observedAt: OBSERVED,
          checks: [
            { id: 'nameservers', status: 'pass', records: ['ns2.example'] },
            { id: 'mx', status: 'pass', records: ['20 mail2.example'] },
            { id: 'caa', status: 'warning', records: ['0 issue "ca.example"'] },
            { id: 'registration_lock', status: 'warning', records: [] },
          ],
        }],
        updatedAt: '2026-08-09T01:00:00.000Z',
      },
      {
        domain: 'aligned.example',
        nameservers: ['ns1.example'],
        mx: ['10 mail.example'],
        observationHistory: [{
          observedAt: OBSERVED,
          checks: [
            { id: 'nameservers', status: 'pass', records: ['ns1.example'] },
            { id: 'mx', status: 'info', records: [] },
          ],
        }],
        updatedAt: '2026-08-09T01:00:00.000Z',
      },
      {
        domain: 'unavailable.example',
        nameservers: ['ns1.example'],
        updatedAt: '2026-08-09T01:00:00.000Z',
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  }, { nowIso: NOW }));
}

describe('cross-domain posture matrix', () => {
  test('projects every required state from exact baselines and retained observations', () => {
    const matrix = buildDomainPostureMatrix(profile(), NOW);
    const review = requiredValue(matrix.rows.find((row) => row.domain === 'review.example'));
    const aligned = requiredValue(matrix.rows.find((row) => row.domain === 'aligned.example'));
    const unavailable = requiredValue(matrix.rows.find((row) => row.domain === 'unavailable.example'));
    const missing = requiredValue(matrix.rows.find((row) => row.domain === 'no-baseline.example'));

    assert.equal(review.cells.find((cell) => cell.field === 'nameservers')?.state, 'approved_window');
    assert.equal(review.cells.find((cell) => cell.field === 'mx')?.state, 'suppressed');
    assert.equal(review.cells.find((cell) => cell.field === 'caa')?.state, 'review');
    assert.equal(review.cells.find((cell) => cell.field === 'ds')?.state, 'unsupported');
    assert.equal(review.cells.find((cell) => cell.field === 'renewalReviewAt')?.state, 'drift');
    assert.equal(aligned.cells.find((cell) => cell.field === 'nameservers')?.state, 'aligned');
    assert.equal(aligned.cells.find((cell) => cell.field === 'mx')?.state, 'unknown');
    assert.equal(unavailable.cells.find((cell) => cell.field === 'nameservers')?.state, 'unavailable');
    assert.ok(missing.cells.every((cell) => cell.state === 'not_configured'));
    assert.equal(matrix.stateCounts.approved_window, 1);
    assert.equal(matrix.stateCounts.suppressed, 1);
    assert.equal(matrix.incomplete, true);
  });

  test('links each cell to its exact local baseline and only retained observations', () => {
    const matrix = buildDomainPostureMatrix(profile(), NOW);
    const observed = requiredValue(matrix.rows.find((row) => row.domain === 'review.example'));
    const unavailable = requiredValue(matrix.rows.find((row) => row.domain === 'unavailable.example'));

    assert.equal(observed.observationId, retainedPostureObservationId('review.example'));
    assert.ok(observed.cells.every((cell) => cell.baselineHref === '/brands?baseline=review.example#desired-posture-baseline'));
    assert.ok(observed.cells.every((cell) => cell.observationHref === '#retained-posture-observation-review.example'));
    assert.ok(unavailable.cells.every((cell) => cell.observationHref === null));
    assert.match(matrix.limitations.join(' '), /no uptime, ownership, control, or continuous-monitoring claim/iu);
  });

  test('bounds official-domain projection and orders it deterministically', () => {
    const raw = profile();
    const matrix = buildDomainPostureMatrix({
      ...raw,
      officialDomains: Array.from({ length: 30 }, (_, index) => `d${String(29 - index).padStart(2, '0')}.example`),
    }, NOW);
    assert.equal(matrix.rows.length, 20);
    assert.equal(matrix.rows[0]?.domain, 'd10.example');
    assert.equal(matrix.rows.at(-1)?.domain, 'd29.example');
  });
});

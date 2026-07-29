import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCampaignReviewSummary,
} from '../frontend/src/lib/analysis/campaign-review-summary.ts';
import { openOrCreateCase } from '../frontend/src/lib/analysis/case-model.ts';

function record(domain: string, evidence: Record<string, unknown>, disposition = 'unreviewed') {
  return openOrCreateCase([], {
    domain,
    disposition,
    evidence: { scanDepth: 'deep', ...evidence },
  }, '2026-07-29T00:00:00.000Z').record;
}

describe('campaign review summary', () => {
  test('counts bounded latest-case cues without producing an aggregate score', () => {
    const summary = buildCampaignReviewSummary(
      ['first.example', 'second.example', 'missing.example', 'first.example'],
      [
        record('first.example', {
          availability: 'registered',
          confidence: 'high',
          hasPasswordField: true,
          hasMx: true,
          faviconNearMatch: true,
        }),
        record('second.example', {
          availability: 'registered',
          confidence: 'medium',
          httpSummaryVersion: 1,
          httpEvidenceStatus: 'success',
          httpResponseStatus: 302,
          httpCrossOriginRedirect: true,
          hasMx: false,
        }, 'suspicious'),
      ],
    );

    assert.equal(summary.memberCount, 3);
    assert.equal(summary.linkedCaseCount, 2);
    assert.equal(summary.unavailableCaseCount, 1);
    assert.equal(summary.unreviewedCaseCount, 1);
    assert.equal(summary.cues.find((cue) => cue.id === 'credential_surface')?.caseCount, 1);
    assert.equal(summary.cues.find((cue) => cue.id === 'identity_relationship')?.caseCount, 1);
    assert.equal(summary.cues.find((cue) => cue.id === 'redirect_review')?.caseCount, 1);
    assert.equal(summary.cues.find((cue) => cue.id === 'mail_surface')?.caseCount, 1);
    assert.match(summary.limitations.join(' '), /not a score/u);
  });

  test('keeps missing and inconclusive evidence visible', () => {
    const summary = buildCampaignReviewSummary(
      ['limited.example', 'missing.example'],
      [record('limited.example', { availability: 'unknown', confidence: null })],
    );

    assert.equal(summary.linkedCaseCount, 1);
    assert.equal(summary.unavailableCaseCount, 1);
    assert.equal(summary.limitedEvidenceCount, 1);
    assert.ok(summary.cues.every((cue) => cue.caseCount === 0));
  });

  test('bounds hostile collection shapes', () => {
    const domains = Array.from({ length: 1_200 }, (_, index) => `case-${index}.example`);
    const summary = buildCampaignReviewSummary(domains, 'invalid');
    assert.equal(summary.memberCount, 500);
    assert.equal(summary.unavailableCaseCount, 500);
  });
});

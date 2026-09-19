import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { buildInterchangeFidelityReport } from '../cli/interchange-report.mts';
import { buildSharingReview } from '../cli/sharing-review.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import { richBulkSessionStore } from './bulk-session-fixture.mts';

test('all offline review commands admit the same rich, valid workspace without a smaller generic traversal cap', async () => {
  const now = '2026-09-09T00:00:00.000Z';
  const archive = await buildWorkspaceArchive({ bulkSessions: richBulkSessionStore().sessions }, { generatedAt: now });
  const raw = JSON.stringify(archive);
  assert.throws(() => scanBoundedJson(raw), /key limit|value limit/u, 'Fixture must cross the generic JSON workload ceiling');
  const verified = await verifyOfflineArtifact(raw);
  assert.equal(verified.state, 'integrity_valid');
  const interchange = await buildInterchangeFidelityReport(raw, { generatedAt: now });
  assert.equal(interchange.verification.state, 'integrity_valid');
  assert.equal(interchange.verification.assuranceSatisfied, true);
  const sharing = await buildSharingReview(raw, {
    marking: 'amber', recipientScope: 'organization', purpose: 'Reviewed fixture handoff',
    humanReviewed: true, personalDataReviewed: true, redactionsConfirmed: true,
  }, now);
  assert.equal(sharing.artifact.integrity, 'projection_integrity');
  assert.notEqual(sharing.summary.status, 'blocked');
  assert.equal(sharing.privacy.contentValuesEmitted, 0);
  assert.doesNotMatch(JSON.stringify({ interchange, sharing }), /item\d{4}\.example|Reviewed fixture handoff/u);
});

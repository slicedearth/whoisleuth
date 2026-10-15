import assert from 'node:assert/strict';
import { test } from 'node:test';
import { casePacketApprovalState, readinessAllowsPacketAuthorisation } from '../frontend/src/lib/analysis/case-packet-approval.ts';
import type { CaseResponseReadinessRow } from '../packages/cases/case-response-packet-types.mts';

const authority: CaseResponseReadinessRow = { id: 'authority_review', label: 'Authority review', state: 'complete', requiredForAuthorisation: true, detail: '', limitations: [] };
const ready = { preflight: { canExport: true, checks: [] }, readiness: { rows: [authority] },
  reviewPresent: true, reviewCurrent: true, confirmationsComplete: true, confirmed: false, interrupted: false };

test('approval projects the next consequential action without making a decision', () => {
  assert.equal(casePacketApprovalState(ready).target, 'authorise');
  assert.equal(casePacketApprovalState(ready).authorised, false);
  const approved = casePacketApprovalState({ ...ready, confirmed: true });
  assert.equal(approved.target, 'export');
  assert.equal(approved.stageStatus, 'complete');
  assert.equal(approved.authorised, true);
  for (const [change, target] of [
    [{ reviewPresent: false, reviewCurrent: false }, 'review'],
    [{ reviewCurrent: false }, 'review'],
    [{ confirmationsComplete: false }, 'confirmations'],
  ] as const) {
    const result = casePacketApprovalState({ ...ready, confirmed: true, ...change });
    assert.equal(result.target, target);
    assert.equal(result.authorised, false);
    assert.equal(result.canAuthorise, false);
  }
  assert.match(casePacketApprovalState({ ...ready, reviewCurrent: false }).message, /Material inputs changed/u);
});

test('readiness maps missing evidence and authority to their existing controls', () => {
  for (const [id, target] of [['selected_evidence', 'evidence'], ['capture_provenance', 'evidence'],
    ['exact_url', 'incident'], ['recipient_route', 'recipient'], ['source_limitations', 'readiness']] as const) {
    const row = { ...authority, id, state: 'unavailable' as const };
    const result = casePacketApprovalState({ ...ready, confirmed: true, readiness: { rows: [authority, row] } });
    assert.equal(result.target, target);
    assert.equal(result.authorised, false);
    assert.equal(result.readinessRow, id);
  }
  for (const state of ['partial', 'stale', 'not_provided', 'unavailable'] as const) {
    assert.equal(readinessAllowsPacketAuthorisation({ rows: [{ ...authority, state }] }), false);
  }
  assert.equal(readinessAllowsPacketAuthorisation({ rows: [] }), false);
  assert.equal(readinessAllowsPacketAuthorisation({ rows: [authority, { ...authority, id: 'capture_provenance', state: 'partial' }] }), true);
  const result = casePacketApprovalState({ ...ready, readiness: { rows: [] } });
  assert.equal(result.target, 'readiness');
  assert.match(result.message, /analyst authority review/u);
});

test('blocked input and lost-operation explanations remain separate from confirmation and material state', () => {
  for (const [id, target] of [['required_incident_fields', 'incident'], ['packet_action', 'recipient']] as const) {
    const state = casePacketApprovalState({ ...ready, preflight: { canExport: false, checks: [{ id, state: 'block', label: 'Required', detail: 'Review this input.' }] } });
    assert.equal(state.target, target);
    assert.equal(state.message, 'Review this input.');
    assert.equal(state.stageStatus, 'not_started');
  }
  const interrupted = casePacketApprovalState({ ...ready, interrupted: true });
  assert.equal(interrupted.target, 'authorise');
  assert.equal(interrupted.authorised, false);
  assert.match(interrupted.contextNotice, /stopped when its review context changed/u);
  assert.equal(casePacketApprovalState(ready).contextNotice, '');
});

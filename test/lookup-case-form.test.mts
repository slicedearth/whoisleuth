import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createLookupCaseDraft,
  resetLookupCaseDraft,
  hasLookupCaseDraftEdits,
} from '../frontend/src/lib/controllers/lookup-case-form.ts';
import { currentCaseFixture } from './support/current-case.mts';

const cleanState = { record: null, note: '', disposition: 'unreviewed', reviewReason: '' };

test('Case form reset creates detached defaults while preserving only the new-incident title', () => {
  const draft = createLookupCaseDraft();
  draft.incidentTitle = 'Separate report';
  draft.conclusionRationale = 'Pending review';
  draft.conclusionEvidence.push({ field: 'page.title', stance: 'supports' });
  draft.contextObjective = 'Check the report';
  draft.retainExactIncidentUrl = true;
  draft.appliedContextKey = 'case-example';
  draft.recheckDraftEdited = true;
  assert.deepEqual(resetLookupCaseDraft(draft), {
    conclusionRationale: '',
    conclusionEvidence: [],
    contextObjective: '',
    retainExactIncidentUrl: false,
    appliedContextKey: '',
    incidentTitle: 'Separate report',
    recheckDraftEdited: false,
  });
  assert.equal(draft.conclusionEvidence.length, 1);
  assert.deepEqual(createLookupCaseDraft().conclusionEvidence, []);
});

test('unsaved Case edits include notes, conclusions, context, recheck and changed decisions', () => {
  assert.equal(hasLookupCaseDraftEdits(createLookupCaseDraft(), cleanState, null), false);
  for (const patch of [
    { conclusionRationale: 'Pending review' },
    { conclusionEvidence: [{ field: 'page.title', stance: 'supports' as const }] },
    { contextObjective: 'Changed objective' },
    { retainExactIncidentUrl: true },
    { recheckDraftEdited: true },
  ])
    assert.equal(
      hasLookupCaseDraftEdits({ ...createLookupCaseDraft(), ...patch }, cleanState, null),
      true,
    );
  assert.equal(
    hasLookupCaseDraftEdits(createLookupCaseDraft(), { ...cleanState, note: 'Pending note' }, null),
    true,
  );
  const record = currentCaseFixture();
  const state = {
    ...cleanState,
    record,
    disposition: record.disposition,
    reviewReason: record.reviewReasonCode ?? '',
  };
  assert.equal(hasLookupCaseDraftEdits(createLookupCaseDraft(), state, null), false);
  assert.equal(
    hasLookupCaseDraftEdits(createLookupCaseDraft(), { ...state, disposition: 'changed' }, null),
    true,
  );
  assert.equal(
    hasLookupCaseDraftEdits(createLookupCaseDraft(), { ...state, reviewReason: 'changed' }, null),
    true,
  );
  assert.equal(
    hasLookupCaseDraftEdits(
      { ...createLookupCaseDraft(), incidentTitle: 'Independent title' },
      state,
      null,
    ),
    false,
  );
});

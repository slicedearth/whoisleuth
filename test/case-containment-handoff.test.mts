import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase, updateCase } from '../packages/cases/case-record-operations.mts';
import {
  appendCaseAction,
  appendCaseActionTransition,
} from '../packages/cases/case-response-actions.mts';
import {
  previewCaseContainmentHandoff,
  buildCaseContainmentHandoff,
  readCaseContainmentInput,
  formatCaseContainmentHandoff,
  CASE_CONTAINMENT_INPUT_SCHEMA,
  MAX_CONTAINMENT_ASSERTIONS,
  type ContainmentSelection,
} from '../packages/cases/case-containment-handoff.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import {
  buildOfflineEvidenceReview,
  formatOfflineEvidenceReview,
} from '../cli/offline-evidence-review.mts';
import { runCli } from '../cli/runner.mts';

const NOW = '2026-01-02T03:04:05.000Z';
function retained() {
  let record = createCase({ domain: 'example.test', title: 'private-case-title' }, NOW);
  record = updateCase(
    [record],
    record.id,
    {
      evidencePin: {
        label: 'Selected account-context evidence',
        value: 'selected-private-observation',
        source: 'Analyst-selected record',
        observedAt: NOW,
        completeness: 'complete',
        limitations: [],
      },
    },
    NOW,
  ).record;
  const firstPin = record.evidencePins[0]!.id;
  record = updateCase(
    [record],
    record.id,
    {
      evidencePin: {
        label: 'Unselected source',
        value: 'unselected-private-value',
        source: 'Unselected record',
        observedAt: NOW,
        completeness: 'partial',
      },
    },
    NOW,
  ).record;
  record = updateCase(
    [record],
    record.id,
    {
      assertion: {
        kind: 'next_step',
        statement: 'Review selected session and grant scope',
        rationale: 'selected-private-rationale',
        state: 'open',
        evidenceRelations: [{ evidencePinId: firstPin, stance: 'unresolved' }],
      },
    },
    NOW,
  ).record;
  record = updateCase(
    [record],
    record.id,
    {
      assertion: {
        kind: 'next_step',
        statement: 'unselected-private-request',
        state: 'resolved',
        evidenceRelations: [],
      },
    },
    NOW,
  ).record;
  const selection: ContainmentSelection = {
    audience: 'internal',
    recipientRole: 'identity_response',
    assertionIds: [record.assertions.find((item) => item.state === 'open')!.id],
    evidencePinIds: [firstPin],
  };
  return { record, selection };
}

test('containment selects existing assertions and exact supporting pins without leaking unrelated Case material', () => {
  const { record, selection } = retained(),
    original = structuredClone(record);
  const report = buildCaseContainmentHandoff(record, selection, NOW, true);
  assert.equal(report.assertions.length, 1);
  assert.equal(report.evidencePins.length, 1);
  assert.deepEqual(
    report.evidencePins[0],
    record.evidencePins.find((pin) => pin.id === selection.evidencePinIds[0]),
  );
  assert.equal(report.assertions[0]!.evidence[0]!.stance, 'unresolved');
  assert.equal(report.assertions[0]!.evidence[0]!.state, 'included');
  assert.doesNotMatch(JSON.stringify(report), /private-case-title|unselected-private/u);
  assert.equal(report.actionsPerformed, false);
  assert.equal(report.reviewRequired, true);
  assert.match(
    formatCaseContainmentHandoff(report),
    /authorised account, session and application-grant evidence/u,
  );
  assert.deepEqual(record, original);
});

test('audience preview applies canonical policy and public output excludes internal statements and pin values', () => {
  const { record, selection } = retained();
  const trusted = previewCaseContainmentHandoff(record, { ...selection, audience: 'trusted' }, NOW);
  assert.equal(trusted.assertions.length, 1);
  assert.doesNotMatch(JSON.stringify(trusted), /private-case-title|unselected-private/u);
  const publicPreview = previewCaseContainmentHandoff(
    record,
    { ...selection, audience: 'public' },
    NOW,
  );
  assert.deepEqual(publicPreview.assertions, []);
  assert.deepEqual(publicPreview.evidencePins, []);
  assert.doesNotMatch(
    JSON.stringify(publicPreview),
    /selected-private|unselected-private|Review selected session/u,
  );
  assert.equal(publicPreview.disclosure.exportAllowed, false);
  assert.throws(
    () => buildCaseContainmentHandoff(record, { ...selection, audience: 'public' }, NOW, true),
    /audience disclosure/u,
  );
  assert.throws(
    () => buildCaseContainmentHandoff(record, selection, NOW, false),
    /audience disclosure/u,
  );
});

test('missing and deliberately unselected supporting evidence stay distinct rather than becoming assertions of absence', () => {
  const { record, selection } = retained();
  const omitted = previewCaseContainmentHandoff(record, { ...selection, evidencePinIds: [] }, NOW);
  assert.equal(omitted.state, 'partial');
  assert.equal(omitted.assertions[0]!.evidence[0]!.state, 'not_selected');
  const missing = previewCaseContainmentHandoff(
    { ...record, evidencePins: [] },
    { ...selection, evidencePinIds: [] },
    NOW,
  );
  assert.equal(missing.assertions[0]!.evidence[0]!.state, 'unavailable');
  assert.equal(missing.state, 'partial');
  assert.throws(
    () =>
      previewCaseContainmentHandoff(
        record,
        {
          ...selection,
          evidencePinIds: [
            record.evidencePins.find((pin) => !selection.evidencePinIds.includes(pin.id))!.id,
          ],
        },
        NOW,
      ),
    /linked/u,
  );
});

test('provider resolution and a resolved Case never close an open internal follow-up in the handoff', () => {
  const { record, selection } = retained();
  let actions = appendCaseAction(
    [],
    { type: 'platform_report', recipient: 'private-recipient', contactSource: 'Supplied route' },
    NOW,
  );
  const id = actions[0]!.id;
  for (const nextState of [
    'ready_for_review',
    'reviewed',
    'authorised',
    'submitted',
    'acknowledged',
    'terminal',
  ] as const)
    actions = appendCaseActionTransition(
      actions,
      id,
      {
        nextState,
        sourceClass: nextState === 'terminal' ? 'provider' : 'analyst',
        ...(nextState === 'terminal' ? { providerOutcome: 'provider_reports_resolved' } : {}),
      },
      NOW,
    );
  const resolved = { ...record, status: 'resolved' as const, actions },
    before = JSON.stringify(resolved);
  const report = buildCaseContainmentHandoff(resolved, selection, NOW, true);
  assert.equal(report.case.status, 'resolved');
  assert.equal(report.assertions[0]!.state, 'open');
  assert.ok(
    report.limitations.some((value) => value.includes('do not resolve open internal requests')),
  );
  assert.doesNotMatch(JSON.stringify(report), /private-recipient/u);
  assert.equal(JSON.stringify(resolved), before);
});

test('scope, identifiers, duplication, future input and unsupported audiences fail closed', () => {
  const { record, selection } = retained();
  for (const patch of [
    { audience: 'worldwide' },
    { recipientRole: 'automatic_enforcement' },
    { assertionIds: ['absent'] },
    { assertionIds: [selection.assertionIds[0], selection.assertionIds[0]] },
    { assertionIds: Array(MAX_CONTAINMENT_ASSERTIONS + 1).fill('x') },
    { extra: true },
  ])
    assert.throws(() => previewCaseContainmentHandoff(record, { ...selection, ...patch }, NOW));
  const input = {
    schema: CASE_CONTAINMENT_INPUT_SCHEMA,
    version: 1,
    caseExport: { version: CASE_SCHEMA_VERSION, cases: [record] },
    caseId: record.id,
    selection,
    disclosureReviewed: true,
  };
  assert.throws(() => readCaseContainmentInput({ ...input, version: 2 }, NOW), /Unsupported/u);
  assert.throws(
    () => readCaseContainmentInput({ ...input, disclosureReviewed: false }, NOW),
    /explicit/u,
  );
});

test('CLI and browser projection share exact selected evidence and strict partial policy without collection', async () => {
  const { record, selection } = retained();
  const input = {
    schema: CASE_CONTAINMENT_INPUT_SCHEMA,
    version: 1,
    caseExport: { version: CASE_SCHEMA_VERSION, cases: [record] },
    caseId: record.id,
    selection: { ...selection, evidencePinIds: [] },
    disclosureReviewed: true,
  };
  const expected = buildCaseContainmentHandoff(record, input.selection, NOW, true),
    cli = buildOfflineEvidenceReview(JSON.stringify(input), NOW);
  assert.deepEqual(cli.result, expected);
  assert.equal(formatOfflineEvidenceReview(cli), formatCaseContainmentHandoff(expected));
  let output = '',
    requests = 0;
  const code = await runCli(['review-evidence', 'selection.json', '--json', '--strict-exit'], {
    readArtifactInput: () => JSON.stringify(input),
    now: () => NOW,
    stdout: {
      write: (value: string) => {
        output += value;
      },
    },
    stderr: { write: () => {} },
    runUnifiedLookup: async () => {
      requests++;
      throw new Error('No collection');
    },
  });
  assert.equal(code, 4);
  assert.equal(requests, 0);
  assert.deepEqual(JSON.parse(output).result, expected);
});

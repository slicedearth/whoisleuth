import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyCase, CONTEXT_NOW as NOW, contextInputs } from './context-review-fixtures.mts';
import {
  reviewDomainHistory,
  readDomainHistoryDeclarations,
  MAX_REGISTRATION_BOUNDARIES,
} from '../packages/investigation/domain-history-review.mts';
import { reviewContextInput } from '../packages/investigation/context-review.mts';
import {
  buildOfflineEvidenceReview,
  formatOfflineEvidenceReview,
} from '../cli/offline-evidence-review.mts';

function input() {
  const legacy = contextInputs()[0]!,
    record = historyCase();
  const boundary = {
    kind: 'reregistration_reported',
    occurredAt: '2026-09-21T00:00:00.000Z',
    source: 'Selected registry publication',
    rationale: 'Review earlier relevance against the reported date.',
    snapshotIds: record.evidenceHistory.map((item) => item.id),
    evidencePinIds: [],
  };
  return {
    ...legacy,
    version: 2,
    evidence: {
      ...(legacy.evidence as object),
      declarations: {
        expectedChanges: [],
        retiredDependencies: [],
        registrationBoundaries: [boundary],
      },
    },
  };
}

test('declared lifecycle boundaries qualify retained history without changing evidence or decisions', () => {
  const record = historyCase(),
    original = structuredClone(record),
    declarations = input().evidence.declarations;
  const report = reviewDomainHistory(record, declarations, NOW, 2);
  const row = report.observations.find((item) => item.label.includes('registration boundary'))!;
  assert.equal(row.state, 'reported');
  assert.equal(row.hostname, record.domain);
  assert.match(row.detail, /before.*1; at or after: 1/u);
  assert.match(row.detail, /not verified ownership/u);
  for (const id of record.evidenceHistory.map((item) => item.id))
    assert.ok(row.source.includes(id));
  assert.ok(
    report.nextSteps.some((value) =>
      value.includes('Earlier evidence and open follow-ups remain unchanged'),
    ),
  );
  assert.deepEqual(record, original);
});

test('v1 domain-history inputs preserve their exact output and reject v2 fields', () => {
  const legacy = contextInputs()[0]!;
  const report = reviewContextInput(legacy, NOW);
  assert.deepEqual(buildOfflineEvidenceReview(JSON.stringify(legacy), NOW).result, report);
  assert.doesNotMatch(JSON.stringify(report), /registration boundaries|registration boundary/u);
  assert.throws(() => reviewContextInput({ ...input(), version: 1 }, NOW), /structure/u);
  assert.throws(() => reviewContextInput({ ...input(), version: 3 }, NOW), /Unsupported/u);
});

test('boundary references, counts and declared times fail closed', () => {
  const declarations = input().evidence.declarations,
    boundary = declarations.registrationBoundaries[0]!;
  for (const patch of [
    { snapshotIds: [], evidencePinIds: [] },
    { occurredAt: '2026-09-21' },
    { snapshotIds: [boundary.snapshotIds[0], boundary.snapshotIds[0]] },
    { kind: 'confirmed_new_owner' },
    { extra: true },
  ]) {
    assert.throws(() =>
      readDomainHistoryDeclarations(
        { ...declarations, registrationBoundaries: [{ ...boundary, ...patch }] },
        2,
      ),
    );
  }
  assert.throws(
    () =>
      reviewDomainHistory(
        historyCase(),
        { ...declarations, registrationBoundaries: [{ ...boundary, snapshotIds: ['absent'] }] },
        NOW,
        2,
      ),
    /not uniquely retained/u,
  );
  const record = historyCase();
  assert.throws(
    () =>
      reviewDomainHistory(
        { ...record, evidenceHistory: [...record.evidenceHistory, record.evidenceHistory[0]!] },
        declarations,
        NOW,
        2,
      ),
    /not uniquely retained/u,
  );
  assert.throws(() =>
    readDomainHistoryDeclarations(
      {
        ...declarations,
        registrationBoundaries: Array(MAX_REGISTRATION_BOUNDARIES + 1).fill(boundary),
      },
      2,
    ),
  );
});

test('v2 browser owner and CLI review produce identical declared boundaries', () => {
  const supplied = input(),
    original = structuredClone(supplied);
  const cli = buildOfflineEvidenceReview(JSON.stringify(supplied), NOW);
  assert.deepEqual(cli.result, reviewContextInput(supplied, NOW));
  assert.match(formatOfflineEvidenceReview(cli), /reregistration reported/u);
  assert.deepEqual(supplied, original);
});

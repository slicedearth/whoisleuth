import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCaseIncidentCoverage } from '../packages/cases/case-object-coverage.mts';
import { correctionFixture } from './case-delivery-correction-fixture.mts';

test('packet preparation does not become delivery; repeated exact receipts retain their own identities and clocks', async () => {
  const fixture = correctionFixture();
  for (const state of ['ready_for_review', 'reviewed', 'authorised'])
    fixture.transition(fixture.originalId, state);
  await fixture.preparePacket(fixture.originalId);
  const prepared = buildCaseIncidentCoverage(fixture.record)[0]!;
  assert.equal(prepared.responseContexts[0]!.reviewEvents.length, 2);
  assert.deepEqual(prepared.responseContexts[0]!.deliveryEvents, []);
  const first = await fixture.deliver(),
    second = await fixture.deliver();
  const before = JSON.stringify(fixture.record);
  for (const row of buildCaseIncidentCoverage(fixture.record)) {
    assert.equal(row.responseContexts.length, 1);
    assert.deepEqual(
      row.responseContexts[0]!.deliveryEvents.map((event) => [
        event.id,
        event.occurredAt,
        event.packetReceipt?.packetDigestSha256,
        event.packetReceipt?.packetGeneratedAt,
        event.packetReceipt?.recipient,
      ]),
      [
        [
          first.event.id,
          first.event.occurredAt,
          first.receipt.packetDigestSha256,
          first.receipt.packetGeneratedAt,
          'Example review desk',
        ],
        [
          second.event.id,
          second.event.occurredAt,
          second.receipt.packetDigestSha256,
          second.receipt.packetGeneratedAt,
          'Example review desk',
        ],
      ],
    );
    assert.equal(row.providerEvents.length, 0);
    assert.equal(row.observationCoverage, 'unknown');
  }
  assert.equal(JSON.stringify(fixture.record), before);
});

test('current recipient edits do not retarget exact historical reviews or imply a historical route snapshot', () => {
  const fixture = correctionFixture();
  fixture.transition(fixture.originalId, 'ready_for_review');
  fixture.transition(fixture.originalId, 'reviewed');
  const review = structuredClone(fixture.record.actions[0]!.history.at(-1)!);
  fixture.change({
    actionUpdate: {
      id: fixture.originalId,
      recipient: 'Replacement review desk',
      responseObjects: [fixture.objects[0]!],
    },
  });
  const [first, second] = buildCaseIncidentCoverage(fixture.record);
  assert.equal(first!.actionCoverage, 'bound');
  assert.equal(second!.actionCoverage, 'unknown');
  assert.equal(second!.responseContexts[0]!.currentlyBound, false);
  assert.equal(second!.responseContexts[0]!.recipient, 'Replacement review desk');
  assert.equal(second!.responseContexts[0]!.currentState, 'drafting');
  assert.deepEqual(second!.responseContexts[0]!.reviewEvents, [review]);
  assert.equal(Object.hasOwn(second!.responseContexts[0]!.reviewEvents[0]!, 'recipient'), false);
  assert.deepEqual(second!.responseContexts[0]!.deliveryEvents, []);
});

test('multiple recipient actions stay separated by exact object, not shared hostname', async () => {
  const fixture = correctionFixture();
  await fixture.deliver();
  fixture.change({
    action: {
      type: 'internal_review',
      recipient: 'Second review desk',
      contactSource: 'Another declared route',
      responseObjects: [fixture.objects[1]!],
    },
  });
  const [first, second] = buildCaseIncidentCoverage(fixture.record);
  assert.deepEqual(
    first!.responseContexts.map((context) => context.recipient),
    ['Example review desk'],
  );
  assert.deepEqual(
    second!.responseContexts.map((context) => context.recipient),
    ['Example review desk', 'Second review desk'],
  );
  assert.equal(second!.responseContexts[1]!.deliveryEvents.length, 0);
  assert.equal(second!.responseContexts[1]!.reviewEvents.length, 0);
});

test('corrections retain the exact original delivery version and affected subset without inheriting delivery', async () => {
  const fixture = correctionFixture(),
    first = await fixture.deliver(),
    second = await fixture.deliver();
  fixture.change({ action: fixture.correctionInput(first.event.id) });
  const [one, two] = buildCaseIncidentCoverage(fixture.record);
  const correction = one!.responseContexts.find((context) => context.correction)!;
  assert.deepEqual(correction.correction, {
    purpose: 'correction',
    originActionId: fixture.originalId,
    deliveryEventId: first.event.id,
    packetDigestSha256: first.receipt.packetDigestSha256,
    packetVersion: first.receipt.packetVersion,
    linkAvailable: true,
  });
  assert.notEqual(correction.correction!.packetDigestSha256, second.receipt.packetDigestSha256);
  assert.deepEqual(correction.deliveryEvents, []);
  assert.equal(
    two!.responseContexts.some((context) => context.correction),
    false,
  );
  const missing = structuredClone(fixture.record);
  missing.actions[0]!.history = missing.actions[0]!.history.filter(
    (event) => event.id !== first.event.id,
  );
  assert.equal(
    buildCaseIncidentCoverage(missing)[0]!.responseContexts.find((context) => context.correction)!
      .correction!.linkAvailable,
    false,
  );
});

test('legacy unscoped or incomplete histories do not inherit current bindings, packet details or preparation', () => {
  const fixture = correctionFixture();
  for (const state of ['ready_for_review', 'reviewed', 'authorised', 'submitted'])
    fixture.transition(fixture.originalId, state);
  let row = buildCaseIncidentCoverage(fixture.record)[0]!;
  assert.equal(row.responseContexts[0]!.deliveryEvents.length, 1);
  assert.equal(row.responseContexts[0]!.deliveryEvents[0]!.packetReceipt, undefined);
  fixture.transition(fixture.originalId, 'submitted', {
    reference: 'A later status note, not another delivery',
  });
  assert.equal(
    buildCaseIncidentCoverage(fixture.record)[0]!.responseContexts[0]!.deliveryEvents.length,
    1,
  );
  const legacy = structuredClone(fixture.record);
  legacy.actions[0]!.history = legacy.actions[0]!.history.map(
    ({ responseObjects: _scope, ...event }) => event,
  );
  legacy.actions[0]!.historyOmitted = 3;
  legacy.actions[0]!.historyLimitations = ['Earlier events were not retained.'];
  row = buildCaseIncidentCoverage(legacy)[0]!;
  assert.equal(row.actionCoverage, 'bound');
  assert.deepEqual(row.responseContexts[0]!.reviewEvents, []);
  assert.deepEqual(row.responseContexts[0]!.deliveryEvents, []);
  assert.equal(row.responseContexts[0]!.historyOmitted, 3);
  assert.deepEqual(row.responseContexts[0]!.historyLimitations, [
    'Earlier events were not retained.',
  ]);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCasePacketReviewSession, type CasePacketReviewState } from '../frontend/src/lib/controllers/case-packet-review.ts';
import { createCase, updateCase } from '../packages/cases/case-model.mts';
import { buildCaseResponseReviewDigest, buildCaseResponsePacket, RESPONSE_AUTHORISATION_CONFIRMATION_IDS,
  type CaseResponsePacketInput } from '../packages/cases/case-response-packet.mts';
import { deferred } from './deferred.mts';

const NOW = '2026-10-01T00:00:00.000Z';
function harness() {
  let record = createCase({ domain: 'packet.example' }, NOW);
  record = updateCase([record], record.id, { evidencePin: { label: 'Observation', value: 'A retained observation', observedAt: NOW } }, NOW).record;
  record = updateCase([record], record.id, { action: { type: 'internal_review', recipient: 'Internal review desk', contactSource: 'Analyst supplied', routeObservedAt: NOW } }, NOW).record;
  let input: CaseResponsePacketInput = { profile: 'internal_soc', category: 'Review', affectedParty: 'Example organisation',
    abusiveUrls: ['https://packet.example/page'], observedHarm: 'A source-qualified observation.', observedAt: NOW,
    actionId: record.actions[0]!.id, selectedEvidencePinIds: [record.evidencePins[0]!.id],
    readiness: Object.fromEntries(['infrastructureResponsibility', 'authorityReview', 'contradictionsReview', 'sourceLimitations']
      .map(id => [id, { state: 'complete', detail: 'Reviewed for this recipient and scope.', limitations: [] }])) };
  let active: { kind: string; id: number } | null = null, serial = 0, allowed = true;
  let gate: ReturnType<typeof deferred<void>> | null = null, entered: ReturnType<typeof deferred<void>> | null = null;
  let fail = false, digestChanged = false, fixedSignature: string | null = null;
  const messages: string[] = [], phases: number[] = [], snapshots: CasePacketReviewState[] = [];
  const session = createCasePacketReviewSession({
    context: () => ({ record, input, signature: fixedSignature ?? JSON.stringify({ record, input }) }),
    canAuthorise: () => allowed,
    operations: {
      begin: kind => active ? null : (active = { kind, id: ++serial }),
      current: operation => active === operation,
      finish: operation => { if (active === operation) active = null; },
    },
    changed: state => snapshots.push(state), message: message => messages.push(message),
    phase: async phase => { phases.push(phase); }, now: () => NOW,
    digest: async (...args) => {
      const waiting = gate, started = entered; gate = null; entered = null;
      const value = await buildCaseResponseReviewDigest(...args);
      started?.resolve(); await waiting?.promise;
      if (fail) { fail = false; throw new Error('Fixture digest failure'); }
      return digestChanged ? 'f'.repeat(64) : value;
    },
  });
  return { session, messages, phases, snapshots, record, input: () => input,
    allow: (value: boolean) => { allowed = value; }, active: () => active,
    change: (value: Partial<CaseResponsePacketInput>) => { input = { ...input, ...value }; },
    freezeSignature: () => { fixedSignature = JSON.stringify({ record, input }); },
    fail: () => { fail = true; }, changeDigest: () => { digestChanged = true; },
    close: () => { if (active?.kind === 'authorisation') session.interrupt(); active = null; },
    hold: () => { gate = deferred<void>(); entered = deferred<void>(); return { entered: entered.promise, release: gate.resolve }; },
    confirm: () => { for (const id of RESPONSE_AUTHORISATION_CONFIRMATION_IDS) session.confirm(id, true); },
  };
}

test('packet review owns immutable confirmations and produces a canonically authorised packet', async () => {
  const h = harness();
  h.allow(false); await h.session.authorise(); assert.equal(h.active(), null); assert.deepEqual(h.phases, []);
  h.allow(true); await h.session.review();
  const reviewed = h.session.snapshot();
  assert.match(reviewed.digest, /^[a-f0-9]{64}$/u);
  assert.equal(reviewed.confirmedAt, null); assert.ok(Object.values(reviewed.confirmations).every(value => !value));
  h.confirm(); await h.session.authorise();
  assert.equal(h.session.snapshot().confirmedAt, NOW); assert.deepEqual(h.phases, [2, 3]);
  assert.ok(Object.isFrozen(reviewed)); assert.ok(Object.isFrozen(reviewed.confirmations));
  assert.ok(Object.values(reviewed.confirmations).every(value => !value), 'Later decisions do not mutate an earlier snapshot.');
  const state = h.session.snapshot();
  const built = await buildCaseResponsePacket(h.record, { ...h.input(), authorisation: {
    reviewedInputDigestSha256: state.digest, confirmedAt: state.confirmedAt, confirmations: state.confirmations,
  } }, NOW);
  assert.equal(built.json.authorisation.status, 'authorised');
  await h.session.review(); assert.equal(h.session.snapshot().confirmedAt, null);
  assert.ok(Object.values(h.session.snapshot().confirmations).every(value => !value));
});

test('withdrawing and reselecting a confirmation cannot authorise a pending decision', async () => {
  for (const reselect of [false, true]) {
    const h = harness(); await h.session.review(); h.confirm();
    const held = h.hold(), pending = h.session.authorise(); await held.entered;
    h.session.confirm('selectedEvidence', false); if (reselect) h.session.confirm('selectedEvidence', true);
    await h.session.authorise(); assert.deepEqual(h.phases, [2], 'The operation owner rejects reentry.');
    held.release(); await pending;
    assert.equal(h.session.snapshot().confirmedAt, null); assert.match(h.messages.at(-1)!, /confirmation decision changed/u);
  }
});

test('changed material, digest or independently rechecked readiness cannot inherit authorisation', async () => {
  for (const change of ['material', 'digest', 'readiness'] as const) {
    const h = harness(); if (change === 'readiness') h.freezeSignature();
    await h.session.review(); h.confirm();
    const held = h.hold(), pending = h.session.authorise(); await held.entered;
    if (change === 'material') h.change({ observedHarm: 'Changed observation' });
    if (change === 'digest') h.changeDigest();
    if (change === 'readiness') h.change({ readiness: { ...(h.input().readiness as object), authorityReview: { state: 'unavailable' } } });
    held.release(); await pending;
    assert.equal(h.session.snapshot().confirmedAt, null); assert.deepEqual(h.phases, [2]);
    assert.match(h.messages.at(-1)!, change === 'readiness' ? /readiness inputs/u : /inputs or their freshness/u);
  }
});

test('late success or failure cannot change a replacement review or clear its operation', async () => {
  for (const oldFailure of [false, true]) {
    const h = harness(); await h.session.review(); h.confirm();
    const old = h.hold(), pending = h.session.authorise(); await old.entered;
    h.close(); assert.equal(h.session.snapshot().interrupted, true);
    const replacement = h.hold(), fresh = h.session.review(); await replacement.entered;
    const active = h.active(), state = h.session.snapshot(), messages = [...h.messages];
    if (oldFailure) h.fail(); old.release(); await pending;
    assert.equal(h.active(), active); assert.equal(h.session.snapshot(), state); assert.deepEqual(h.messages, messages);
    replacement.release(); await fresh;
    assert.equal(h.active(), null); assert.equal(h.session.snapshot().confirmedAt, null);
    assert.equal(h.session.snapshot().interrupted, false); assert.deepEqual(h.phases, [2, 2]);
    assert.match(h.messages.at(-1)!, /^Bound the current draft/u);
  }
});

test('review reports changed inputs or current failure without binding a stale digest', async () => {
  for (const failure of [false, true]) {
    const h = harness(), held = h.hold(), pending = h.session.review(); await held.entered;
    if (failure) h.fail(); else h.change({ category: 'Changed category' });
    held.release(); await pending;
    assert.equal(h.session.snapshot().digest, ''); assert.deepEqual(h.phases, []); assert.equal(h.active(), null);
    assert.match(h.messages.at(-1)!, failure ? /Fixture digest failure/u : /inputs changed/u);
  }
});

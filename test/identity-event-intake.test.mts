import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { identityEventExample, identityEventScope } from '../fixtures/identity-event-examples.mts';
import { reviewSelectedInput } from '../packages/investigation/selected-input-review.mts';
import { compareIdentityEvents } from '../packages/investigation/identity-event-intake.mts';
import { IDENTITY_EVENTS_INPUT_SCHEMA, MAX_IDENTITY_EVENTS } from '../packages/contracts/identity-events.mts';
import { runMessageIntakeOperation } from '../frontend/src/lib/message-intake-worker-model.ts';
import { reviewSelectedInputInWorker } from '../cli/selected-input-worker.mts';
import { formatMessageIntake } from '../cli/intake-command.mts';
import { messageCaseEvidence } from '../packages/investigation/message-case-evidence.mts';
const NOW = '2026-01-02T00:00:00Z', bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test('identity input retains an independent byte identity and only minimised source-scoped fields', async () => {
  const input = bytes(identityEventExample()), original = input.slice(), previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Identity intake must not request provider data'); };
  try {
    const { report, targets } = await reviewSelectedInput(input, 'identity', NOW), review = report.identityEventReview!;
    assert.equal(report.source.digestSha256, `sha256:${createHash('sha256').update(input).digest('hex')}`);
    assert.deepEqual(input, original); assert.deepEqual(targets, []); assert.deepEqual(report.links, []);
    assert.deepEqual(review.events.map(event => event.actorLabel), ['Actor 1', 'Actor 1', 'Actor 2']);
    assert.deepEqual(review.events.map(event => event.result), ['success', 'failure', 'unknown']);
    assert.deepEqual(review.events.map(event => event.protocol), ['device_code', 'unknown', 'unknown']);
    assert.equal(review.events[2]!.occurredAt, null); assert.equal(review.comparison, null);
    assert.doesNotMatch(JSON.stringify(report), /private-|192\.0\.2|userPrincipalName|clientAppUsed|token|failureReason/iu);
  } finally { globalThis.fetch = previousFetch; }
});

test('scoped comparisons distinguish matched, different and unavailable fields without treating unknown as absence', async () => {
  const review = (await reviewSelectedInput(bytes(identityEventExample()), 'identity', NOW)).report.identityEventReview!;
  const matched = compareIdentityEvents(review, identityEventScope());
  assert.deepEqual(matched.comparison!.events.map(event => event.state), ['matched', 'incomplete', 'different']);
  assert.equal(matched.comparison!.events[1]!.tenant, 'unavailable');
  assert.equal(matched.comparison!.events[2]!.time, 'unavailable');
  const unscoped = compareIdentityEvents(review, { ...identityEventScope(), tenantId: null, actorLabel: null });
  assert.deepEqual(unscoped.comparison!.events.map(event => event.state), ['matched', 'matched', 'incomplete']);
  assert.equal(unscoped.comparison!.events[1]!.tenant, 'not_selected');
  assert.equal(compareIdentityEvents(review, { ...identityEventScope(), endedAt: '2026-01-01T00:04:59Z' }).comparison!.events[0]!.time, 'different');
  for (const change of [{ startedAt: '2026-01-01' }, { endedAt: '2025-01-01T00:00:00Z' }, { applicationId: 'private-token' }, { tenantId: '' }, { actorLabel: 'person@example.test' }]) {
    assert.throws(() => compareIdentityEvents(review, { ...identityEventScope(), ...change }));
  }
  assert.equal(review.comparison, null);
});

test('provider event semantics do not turn a credential result into a session or pick an arbitrary application', async () => {
  const apps = ['0oa00000000000000000', '0oa11111111111111111'];
  const source = [{ eventType: 'user.authentication.verify', published: '2026-01-01T01:00:00+01:00', actor: { id: 'private-actor', displayName: 'private-name' },
    outcome: { result: 'SUCCESS', reason: 'private-reason' }, target: apps.map(id => ({ id, type: 'AppInstance', displayName: 'private-app' })), authenticationContext: { credentialType: 'JWT', externalSessionId: 'private-session' } }];
  const result = await reviewSelectedInput(bytes(source), 'identity', NOW), event = result.report.identityEventReview!.events[0]!;
  assert.equal(event.kind, 'credential_check'); assert.equal(event.result, 'success'); assert.equal(event.protocol, 'unknown');
  assert.equal(event.tenantId, null); assert.equal(event.occurredAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(event.applicationIds, apps); assert.doesNotMatch(JSON.stringify(result), /private-|JWT|externalSessionId/u);
});

test('unsupported inputs and exceeded bounds fail, while partial source pagination remains explicit without fetching', async () => {
  for (const value of [{ schema: IDENTITY_EVENTS_INPUT_SCHEMA, version: 2, provider: 'entra', events: [] }, { value: [null] }, { value: new Array(MAX_IDENTITY_EVENTS + 1).fill(null) }, { arbitrary: [] }]) {
    await assert.rejects(reviewSelectedInput(bytes(value), 'identity', NOW));
  }
  await assert.rejects(reviewSelectedInput(new TextEncoder().encode('{"value":[],"value":[]}'), 'identity', NOW));
  const partial = await reviewSelectedInput(bytes({ ...identityEventExample(), '@odata.nextLink': 'https://never-fetch.example/?token=private-next' }), 'identity', NOW);
  assert.equal(partial.report.coverage.state, 'partial'); assert.equal(partial.report.identityEventReview!.sourceHasMore, true);
  assert.doesNotMatch(JSON.stringify(partial), /never-fetch|private-next/u);
  const invalid = await reviewSelectedInput(bytes({ value: [identityEventExample().value[0], null] }), 'identity', NOW);
  assert.equal(invalid.report.identityEventReview!.invalidEvents, 1); assert.equal(invalid.report.coverage.state, 'partial');
});

test('selected identity comparisons use the same worker, CLI and Case report semantics', async () => {
  const input = bytes({ schema: IDENTITY_EVENTS_INPUT_SCHEMA, version: 1, provider: 'entra', events: identityEventExample().value, match: identityEventScope() });
  const expected = await reviewSelectedInput(input, 'identity', NOW);
  assert.deepEqual(await reviewSelectedInputInWorker(Buffer.from(input), 'identity', NOW), expected);
  const browser = await runMessageIntakeOperation({ kind: 'identity', file: new Blob([input]), reviewedAt: NOW });
  assert.deepEqual(browser, { kind: 'review', result: expected });
  assert.match(formatMessageIntake(expected.report), /comparison matched: application matched/u);
  assert.doesNotMatch(formatMessageIntake(expected.report), /private-/u);
  const summary = messageCaseEvidence(expected.report, 'sha256:' + 'a'.repeat(64));
  assert.match(summary.summary, /1 matches within the selected field\/time scope/u);
  assert.equal(summary.completeness, 'inconclusive');
});

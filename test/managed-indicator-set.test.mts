import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildManagedIndicatorRevision, compareManagedIndicatorRevisions, managedIndicatorState, parseManagedIndicatorJson, readManagedIndicatorSet, validateManagedIndicatorSet, MAX_MANAGED_INDICATORS, type ManagedIndicatorSet } from '../packages/interchange/managed-indicator-set.mts';
import { exportManagedIndicators } from '../packages/interchange/managed-indicator-export.mts';
import { sha256ArtifactDigestV2 } from '../packages/evidence/artifact-integrity.mts';
import { MAX_MANAGED_INDICATOR_SET_BYTES } from '../packages/contracts/analyst-interchange.mts';
import { validateStixBundle } from '../tools/stix-schema-conformance.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';

const NOW = '2026-09-23T00:00:00.000Z', NEXT = '2026-09-24T00:00:00.000Z', THIRD = '2026-09-25T00:00:00.000Z';
const EXPIRY = '2026-10-23T00:00:00.000Z', RENEWED = '2026-11-23T00:00:00.000Z';
function row(domain = 'candidate.example.test', extra = {}) {
  return { domain, availability: 'registered', status: 'complete', risk: 85, riskModelVersion: 7, scanDepth: 'deep', observedAt: '2026-09-22T01:00:00.000Z',
    profileContext: { sourceState: 'ready' }, analystDisposition: 'suspicious', ...extra };
}
async function initial(rows = [row(), row('second.example.test', { observedAt: null })]) {
  return (await buildManagedIndicatorRevision({ name: 'Reviewed candidates', basis: 'Reviewed the retained credential-form observation.', expiresAt: EXPIRY, rows, selectedDomains: rows.map(item => item.domain) }, NOW)).manifest;
}
async function redigest(value: ManagedIndicatorSet) {
  const { integrity: _integrity, ...unsigned } = value;
  return { ...value, integrity: { ...value.integrity, digestSha256: await sha256ArtifactDigestV2(unsigned) } };
}

test('managed revisions retain source observations and require explicit current eligibility and selection', async () => {
  const records = [row(), row('trusted.example.test', { trusted: 'official' }), row('allowlisted.example.test'), row('unknown.example.test', { profileContext: { sourceState: 'unavailable' } }), row('unreviewed.example.test', { analystDisposition: 'unreviewed' }), row('unselected.example.test')];
  const result = await buildManagedIndicatorRevision({ name: 'Review set', basis: 'Explicit review', expiresAt: EXPIRY, rows: records,
    selectedDomains: records.slice(0, -1).map(item => item.domain), allowlistedDomains: ['allowlisted.example.test'] }, NOW);
  assert.deepEqual(result.manifest.entries.map(entry => entry.domain), ['candidate.example.test']);
  assert.equal(result.manifest.entries[0]!.observation.observedAt, '2026-09-22T01:00:00.000Z');
  assert.equal(result.manifest.entries[0]!.createdAt, NOW);
  assert.deepEqual(result.exclusions.map(value => value.reason).sort(), ['allowlisted_domain', 'not_eligible', 'not_selected', 'profile_context_unavailable', 'unreviewed_disposition'].sort());
  assert.equal(result.changes[0]!.kind, 'added');
  assert.deepEqual(await readManagedIndicatorSet(result.manifest), result.manifest);
  await assert.rejects(buildManagedIndicatorRevision({ name: 'No selection', basis: 'Review', expiresAt: EXPIRY, rows: [row()] }, NOW), /No eligible/);
});

test('renewal is deliberate and cannot rewrite observations; omission and expiry do not revoke', async () => {
  const first = await initial(), [renew, retained] = first.entries;
  const second = (await buildManagedIndicatorRevision({ previous: first, basis: 'Reviewed the existing basis again.', expiresAt: RENEWED, renewIds: [renew!.id] }, NEXT)).manifest;
  assert.equal(second.id, first.id); assert.equal(second.producerId, first.producerId); assert.equal(second.createdAt, NOW);
  assert.equal(second.entries[0]!.id, renew!.id); assert.equal(second.entries[0]!.expiresAt, RENEWED);
  assert.deepEqual(second.entries[0]!.observation, renew!.observation); assert.equal(second.entries[0]!.basis, renew!.basis);
  assert.deepEqual(second.entries[1], retained);
  assert.equal(managedIndicatorState(retained!, RENEWED), 'expired'); assert.equal(retained!.withdrawal, null);
  assert.deepEqual(compareManagedIndicatorRevisions(first, second).map(change => change.kind), ['renewed']);
  await assert.rejects(buildManagedIndicatorRevision({ previous: first, basis: 'No change', rows: [row()], selectedDomains: ['candidate.example.test'] }, NEXT), /No eligible/);
  await assert.rejects(buildManagedIndicatorRevision({ previous: first, basis: 'Clock did not advance', renewIds: [renew!.id], expiresAt: RENEWED }, '2026-09-23T00:00:00.500Z'), /not the next revision/);
});

test('withdrawal is permanent and explicit reintroduction creates a new identity without removing the old one', async () => {
  const first = await initial(), original = first.entries[0]!;
  const withdrawn = (await buildManagedIndicatorRevision({ previous: first, basis: 'The attribution was corrected.', withdrawIds: [original.id] }, NEXT)).manifest;
  assert.equal(managedIndicatorState(withdrawn.entries[0]!, NEXT), 'withdrawn');
  assert.equal(withdrawn.entries[0]!.withdrawal?.reason, 'The attribution was corrected.');
  for (const field of ['renewIds', 'withdrawIds']) await assert.rejects(buildManagedIndicatorRevision({ previous: withdrawn, basis: 'Another review', [field]: [original.id], expiresAt: RENEWED }, THIRD), /non-withdrawn/);
  const plan = { previous: withdrawn, basis: 'A separate reviewed incident.', rows: [row()], selectedDomains: [original.domain], expiresAt: RENEWED };
  await assert.rejects(buildManagedIndicatorRevision(plan, THIRD), /new identity/);
  const restored = (await buildManagedIndicatorRevision({ ...plan, reintroduceDomains: [original.domain] }, THIRD)).manifest;
  assert.equal(restored.entries.length, 3); assert.deepEqual(restored.entries[0], withdrawn.entries[0]);
  assert.notEqual(restored.entries[2]!.id, original.id); assert.equal(restored.entries[2]!.withdrawal, null);
});

test('a known predecessor detects history removal, rewritten evidence, rollback and conflicting revision branches', async () => {
  const first = await initial();
  const second = (await buildManagedIndicatorRevision({ previous: first, basis: 'Renewed review.', renewIds: [first.entries[0]!.id], expiresAt: RENEWED }, NEXT)).manifest;
  const mutations = [
    (copy: ManagedIndicatorSet) => { copy.entries.pop(); },
    (copy: ManagedIndicatorSet) => { copy.entries[0]!.observation = { ...copy.entries[0]!.observation, riskScore: 99 }; },
    (copy: ManagedIndicatorSet) => { copy.entries[0]!.createdAt = NEXT; },
    (copy: ManagedIndicatorSet) => { copy.previous!.digestSha256 = `sha256:${'0'.repeat(64)}`; },
    (copy: ManagedIndicatorSet) => { copy.revision += 1; },
  ];
  for (const mutate of mutations) { const copy = structuredClone(second); mutate(copy); assert.throws(() => compareManagedIndicatorRevisions(first, copy)); }
  assert.throws(() => compareManagedIndicatorRevisions(second, first), /next revision/);
  await assert.rejects(readManagedIndicatorSet({ ...second, name: 'Edited without recalculating' }), /digest/);
  const invalidRenewal = structuredClone(second); invalidRenewal.entries[0]!.expiresAt = NEXT;
  assert.throws(() => validateManagedIndicatorSet(invalidRenewal), /times are inconsistent/);
});

test('asynchronous verification and revision preparation use isolated input snapshots', async () => {
  const first = await initial();
  const reading = readManagedIndicatorSet(first);
  first.entries[0]!.reviewBasis = 'Changed after verification started';
  const verified = await reading;
  assert.notEqual(verified.entries[0]!.reviewBasis, first.entries[0]!.reviewBasis);
  const plan = { previous: verified, basis: 'Reviewed again', renewIds: [verified.entries[0]!.id], expiresAt: RENEWED };
  const preparing = buildManagedIndicatorRevision(plan, NEXT);
  plan.basis = 'Changed after preparation started'; plan.renewIds.length = 0;
  const result = await preparing;
  assert.equal(result.manifest.entries[0]!.reviewBasis, 'Reviewed again');
  assert.equal(result.changes.length, 1);
});

test('managed writers preserve stable native identities, validity, unknown source times and permanent revocation', async () => {
  const first = await initial();
  const next = (await buildManagedIndicatorRevision({ previous: first, basis: 'Withdraw the first candidate.', withdrawIds: [first.entries[0]!.id] }, NEXT)).manifest;
  const later = (await buildManagedIndicatorRevision({ previous: next, basis: 'Renew the second candidate.', renewIds: [first.entries[1]!.id], expiresAt: RENEWED }, THIRD)).manifest;
  const bundle = async (value: ManagedIndicatorSet) => JSON.parse((await exportManagedIndicators(value, 'stix')).content) as { objects: Record<string, unknown>[] };
  const initialBundle = await bundle(first), nextBundle = await bundle(next), laterBundle = await bundle(later);
  const id = `indicator--${first.entries[0]!.id}`;
  const original = initialBundle.objects.find(item => item.id === id)!, revoked = nextBundle.objects.find(item => item.id === id)!;
  assert.equal(revoked.created, original.created); assert.equal(revoked.modified, NEXT); assert.equal(revoked.revoked, true); assert.equal(revoked.valid_until, EXPIRY);
  assert.deepEqual(laterBundle.objects.find(item => item.id === id), revoked);
  assert.deepEqual(nextBundle.objects.filter(item => item.type !== 'indicator'), initialBundle.objects.filter(item => item.type !== 'indicator'));
  assert.equal(initialBundle.objects.filter(item => item.type === 'note').length, 1);
  assert.equal(initialBundle.objects.filter(item => item.type === 'observed-data').length, 1);
  for (const value of [first, next, later]) await validateStixBundle((await exportManagedIndicators(value, 'stix')).content);
  const event = JSON.parse((await exportManagedIndicators(next, 'misp')).content).Event;
  assert.equal(event.uuid, first.id); assert.equal(event.published, false); assert.equal(event.distribution, '0');
  assert.equal(event.Attribute[0].uuid, first.entries[0]!.id); assert.equal(event.Attribute[0].deleted, true);
  assert.equal(event.Attribute[0].to_ids, false); assert.equal(event.Attribute[0].disable_correlation, true);
  assert.equal('first_seen' in event.Attribute[1], false); assert.equal('last_seen' in event.Attribute[1], false);
  assert.match(event.Attribute[1].comment, /expiry requires recipient review, not automatic deletion/);
  assert.equal((await exportManagedIndicators(next, 'manifest')).content, (await exportManagedIndicators(next, 'manifest')).content);
  const verified = await verifyOfflineArtifact(JSON.stringify(next)); assert.equal(verified.state, 'verified');
});

test('hostile or future manifests and revision plans fail closed without pruning retained identities', async () => {
  const first = await initial();
  for (const value of [{ ...first, version: 2 }, { ...first, extra: true }, { ...first, entries: [first.entries[0], first.entries[0]] },
    { ...first, modifiedAt: '2025-01-01T00:00:00.000Z' }, { ...first, get unexpected() { throw new Error('private sentinel'); } }]) {
    assert.throws(() => validateManagedIndicatorSet(value), error => !String(error).includes('private sentinel'));
  }
  assert.throws(() => parseManagedIndicatorJson('{"schema":1,"schema":2}'), /duplicate/);
  assert.throws(() => parseManagedIndicatorJson(' '.repeat(MAX_MANAGED_INDICATOR_SET_BYTES + 1)), /bytes/);
  const rows = Array.from({ length: MAX_MANAGED_INDICATORS }, (_, index) => row(`entry-${index}.example.test`));
  const maximum = await initial(rows); assert.equal((await readManagedIndicatorSet(maximum)).entries.length, MAX_MANAGED_INDICATORS);
  await assert.rejects(buildManagedIndicatorRevision({ previous: maximum, basis: 'One more', rows: [row('extra.example.test')], selectedDomains: ['extra.example.test'], expiresAt: RENEWED }, NEXT), /Managed indicators/);
  await assert.rejects(buildManagedIndicatorRevision({ previous: first, basis: 'Conflicting', renewIds: [first.entries[0]!.id], withdrawIds: [first.entries[0]!.id], expiresAt: RENEWED }, NEXT), /renewed and withdrawn/);
  const unsafe = await redigest({ ...first, entries: [{ ...first.entries[0]!, domain: "example.test' OR 'a'='a" }] });
  await assert.rejects(readManagedIndicatorSet(unsafe), /domain/);
});

test('retained managed manifest fixture remains independently readable and verifiable', async () => {
  const raw = await readFile(new URL('./fixtures/extracted-domain-lifecycle/managed-indicator-set-v1.json', import.meta.url), 'utf8');
  const value = await readManagedIndicatorSet(parseManagedIndicatorJson(raw));
  assert.equal(value.revision, 1); assert.equal(value.entries[0]!.domain, 'candidate.example.test');
  assert.equal(value.entries[0]!.observation.observedAt, null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DMARC_DISCOVERY_OWNERS, normalizeDmarcPolicyContext } from '../packages/evidence/dmarc-policy-context.mts';

const TIME = '2026-09-01T12:00:00.000Z';
function context() {
  return { version: 1, source: 'recursive_dns_txt', relation: 'inherited', complete: true,
    owner: 'example.test', observedAt: TIME, policy: 'none', subdomainPolicy: 'quarantine', nonexistentPolicy: 'reject', psd: 'n', testMode: false,
    discovery: [{ owner: 'mail.example.test', state: 'not_found', observedAt: TIME }, { owner: 'example.test', state: 'observed', observedAt: TIME }] };
}

test('bounded typed policy keeps exact scope, source and unknown clocks without mutating inputs', () => {
  const raw = context(), before = structuredClone(raw);
  const result = normalizeDmarcPolicyContext(raw, 'mail.example.test')!;
  assert.deepEqual(result, before); assert.deepEqual(raw, before);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.discovery)); assert.ok(Object.isFrozen(result.discovery[0]));
  assert.equal(normalizeDmarcPolicyContext(undefined), undefined);
  raw.observedAt = null as unknown as string; raw.discovery[1]!.observedAt = null as unknown as string;
  assert.equal(normalizeDmarcPolicyContext(raw)?.observedAt, null);
});

test('incomplete and completed-no-policy discovery stay separate without invented selection', () => {
  const raw = { ...context(), relation: 'undetermined', owner: null, observedAt: null, policy: null, subdomainPolicy: null,
    nonexistentPolicy: null, psd: null, testMode: null, discovery: [{ owner: 'mail.example.test', state: 'not_found', observedAt: null }] };
  assert.equal(normalizeDmarcPolicyContext(raw)!.complete, true);
  assert.equal(normalizeDmarcPolicyContext({ ...raw, complete: false, discovery: [{ ...raw.discovery[0]!, state: 'unavailable' }] })!.complete, false);
  assert.throws(() => normalizeDmarcPolicyContext({ ...raw, policy: 'none' }));
  assert.throws(() => normalizeDmarcPolicyContext({ ...raw, discovery: [{ ...raw.discovery[0]!, state: 'unavailable' }] }));
});

test('a DNS-declared suffix can supply policy without becoming a registration-domain identity', () => {
  const raw = { ...context(), owner: 'test', psd: 'y', discovery: [
    { owner: 'mail.example.test', state: 'not_found', observedAt: TIME },
    { owner: 'test', state: 'observed', observedAt: TIME },
  ] };
  assert.equal(normalizeDmarcPolicyContext(raw, 'mail.example.test')?.owner, 'test');
  assert.equal(normalizeDmarcPolicyContext(raw)?.relation, 'inherited');
});

test('malformed, future, foreign and contradictory context fails closed without coercing values', () => {
  const raw = context();
  const coercion = { toString: () => assert.fail('Must not coerce untrusted context') };
  for (const bad of [
    { ...raw, version: 2 }, { ...raw, source: 'registry_rdap' }, { ...raw, rawTxt: 'private reporting address' },
    { ...raw, relation: coercion }, { ...raw, policy: coercion }, { ...raw, psd: coercion },
    { ...raw, owner: 'EXAMPLE.TEST' }, { ...raw, owner: 'not-in-walk.example' },
    { ...raw, relation: 'exact' }, { ...raw, complete: false }, { ...raw, testMode: null },
    { ...raw, observedAt: 'private resolver detail' },
    { ...raw, discovery: [...raw.discovery, raw.discovery[1]!] },
    { ...raw, discovery: [{ ...raw.discovery[0]!, state: coercion }, raw.discovery[1]!] },
    { ...raw, discovery: [raw.discovery[0]!, { ...raw.discovery[1]!, owner: 'unrelated.test' }] },
    { ...raw, discovery: [raw.discovery[0]!, { ...raw.discovery[1]!, observedAt: '2026-09-02T12:00:00.000Z' }] },
  ]) assert.throws(() => normalizeDmarcPolicyContext(bad), TypeError);
  assert.throws(() => normalizeDmarcPolicyContext(raw, 'other.example.test'));
});

test('resource and ordinary-field bounds are enforced before entry or accessor evaluation', () => {
  const raw = context();
  const large = Array(MAX_DMARC_DISCOVERY_OWNERS + 1);
  Object.defineProperty(large, 0, { get: () => assert.fail('Must reject count before reading') });
  assert.throws(() => normalizeDmarcPolicyContext({ ...raw, discovery: large }));
  const access = { ...raw }; Object.defineProperty(access, 'policy', { enumerable: true, get: () => assert.fail('Must not invoke a field getter') });
  assert.throws(() => normalizeDmarcPolicyContext(access));
  const entries = [...raw.discovery]; Object.defineProperty(entries, 0, { enumerable: true, get: () => assert.fail('Must not invoke an entry getter') });
  assert.throws(() => normalizeDmarcPolicyContext({ ...raw, discovery: entries }));
});

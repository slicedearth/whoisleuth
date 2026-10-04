import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWhoisChain } from '../lib/whois-chain.mts';
import { deferred } from './deferred.mts';

test('signalled WHOIS calls reuse completed data without sharing caller mutation', async () => {
  let calls = 0;
  const whoisQuery = async () => { calls += 1; return 'Domain Name: CACHE.EXAMPLE.COM'; };
  const first = await buildWhoisChain('cache.example.com', { signal: new AbortController().signal, whoisQuery });
  const expected = structuredClone(first);
  first[0]!.response = 'caller edit';
  const second = await buildWhoisChain('CACHE.EXAMPLE.COM', { signal: new AbortController().signal, whoisQuery });
  assert.equal(calls, 1);
  assert.deepEqual(second, expected);
});

test('cancellable WHOIS misses own their work and drain before releasing the caller', async () => {
  const controller = new AbortController(), entered = deferred<void>(), response = deferred<string>();
  let settled = false;
  const pending = buildWhoisChain('peer.example.com', { signal: controller.signal,
    whoisQuery: async () => { entered.resolve(); return response.promise; } });
  void pending.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(pending, /cancelled fixture/);
  await entered.promise;
  const peer = await buildWhoisChain('peer.example.com', { signal: new AbortController().signal,
    whoisQuery: async () => 'independent peer response' });
  controller.abort(new Error('cancelled fixture'));
  await Promise.resolve();
  assert.equal(settled, false);
  response.resolve('late cancelled response');
  await rejected;
  const retained = await buildWhoisChain('peer.example.com', { signal: new AbortController().signal,
    whoisQuery: async () => assert.fail('completed peer result should be retained') });
  assert.deepEqual(retained, peer);
  assert.equal(retained[0]?.response, 'independent peer response');
});

test('a cancelled WHOIS miss cannot populate the cache after its response arrives', async () => {
  const controller = new AbortController(), entered = deferred<void>(), response = deferred<string>();
  const pending = buildWhoisChain('cancel-cache.example.com', { signal: controller.signal,
    whoisQuery: async () => { entered.resolve(); return response.promise; } });
  const rejected = assert.rejects(pending, /cancelled fixture/);
  await entered.promise;
  controller.abort(new Error('cancelled fixture'));
  response.resolve('cancelled response');
  await rejected;
  let calls = 0;
  const fresh = await buildWhoisChain('cancel-cache.example.com', { signal: new AbortController().signal,
    whoisQuery: async () => { calls += 1; return 'fresh response'; } });
  assert.equal(calls, 1);
  assert.equal(fresh[0]?.response, 'fresh response');
});

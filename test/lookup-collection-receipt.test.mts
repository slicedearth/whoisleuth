import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOOKUP_SOURCE_IDS, lookupCollectionChoices, lookupCollectionReceiptIdentity, parseLookupCollectionReceipt,
  bindLookupCollectionChoices,
  type LookupCollectionReceipt,
} from '../packages/evidence/lookup-collection-receipt.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import { networkFeaturePolicy } from '../lib/feature-policy.mts';
import { classifyQuery } from '../lib/classify.mts';
import { deferred } from './deferred.mts';
import { collectObservedNetworkContext } from '../lib/observed-network-context.mts';
import { prepareLookupHttpOperation } from '../lib/lookup-http-operation.mts';
import { createLookupHttpResponse, parseLookupHttpResponse } from '../lib/lookup-response-contract.mts';
import { lookupCollectionReceiptReview, lookupSourceStateExplanation } from '../packages/evidence/lookup-collection-review.mts';

test('source explanations preserve recorded selection, policy, uncertainty and retry boundaries', () => {
  const value = receipt();
  const before = structuredClone(value);
  const review = lookupCollectionReceiptReview(value)!;
  assert.equal(review.sources.length, value.sources.length);
  assert.match(review.sources[0]!.explanation, /incomplete or inconclusive.*remain unknown.*may help/u);
  assert.deepEqual(value, before);
  const row = value.sources[0]!;
  const pending = { ...row, attempt: 'not_started' as const, settlement: 'unknown' as const, complete: null, truncated: null };
  assert.match(lookupSourceStateExplanation('unknown', row.source, { ...pending, intent: 'not_requested' }), /Not requested/u);
  assert.match(lookupSourceStateExplanation('unknown', row.source, { ...pending, admission: 'disabled' }), /disabled by policy.*does not change/u);
  assert.match(lookupSourceStateExplanation('unknown', row.source, { ...pending, admission: 'prerequisite_unavailable' }), /earlier evidence.*did not start/u);
  assert.match(lookupSourceStateExplanation('unknown', row.source, { ...pending, admission: 'not_applicable' }), /did not apply/u);
  assert.match(lookupSourceStateExplanation('unknown', row.source, { ...pending, admission: 'unsupported' }), /not supported/u);
  assert.match(lookupSourceStateExplanation('unknown', 'whois', { ...pending, admission: 'disabled' }), /unknown/u, 'An unrelated receipt cannot supply the reason.');
  assert.match(lookupSourceStateExplanation('unsupported', 'whois'), /registry policy or discovery/u);
  assert.doesNotMatch(lookupSourceStateExplanation('unsupported', 'security_txt'), /registry/u);
  assert.match(lookupSourceStateExplanation('skipped', 'whois'), /mode or access policy/u);
  assert.doesNotMatch(lookupSourceStateExplanation('skipped', 'whois'), /failed|unregistered|retry may help/u);
  assert.match(lookupSourceStateExplanation('error'), /not an absence finding/u);
  assert.match(lookupSourceStateExplanation('rate_limited'), /permitted retry window.*no reset time/u);
  assert.match(lookupSourceStateExplanation('not_found'), /source.*authority and search scope/u);
  assert.match(lookupSourceStateExplanation('complete'), /source’s scope/u);
  assert.match(lookupSourceStateExplanation('stale'), /out of date.*deliberate refresh/u);
  for (const state of [null, 'private-untrusted-state']) {
    const message = lookupSourceStateExplanation(state);
    assert.match(message, /not retained.*unknown/u);
    assert.doesNotMatch(message, /private-untrusted-state/u);
  }
});

function receipt(): LookupCollectionReceipt {
  return {
    version: 1, requestedDepth: 'deep', targetClass: 'domain', webSelection: 'hostname',
    originalChoices: lookupCollectionChoices({ securityTxt: true, externalIntelligence: true, malwareHostIntelligence: true, malwareIocIntelligence: true }),
    sources: LOOKUP_SOURCE_IDS.map(source => ({ source, intent: 'requested', admission: 'admitted', attempt: 'started',
      settlement: 'partial', complete: false, truncated: null })),
  };
}

test('receipt parsing retains only the closed account and compares independently of object/source order', () => {
  const value = receipt();
  const parsed = parseLookupCollectionReceipt(value)!;
  assert.deepEqual(parsed, value);
  assert.notEqual(parsed, value);
  assert.notEqual(parsed.sources, value.sources);
  assert.equal(lookupCollectionReceiptIdentity({ ...value, sources: [...value.sources].reverse() }), lookupCollectionReceiptIdentity(value));
  assert.equal(parseLookupCollectionReceipt(undefined), null);
  assert.equal(lookupCollectionReceiptIdentity(undefined), null);
  assert.notEqual(lookupCollectionReceiptIdentity(value), lookupCollectionReceiptIdentity({ ...value, sources: value.sources.map(row => ({ ...row, truncated: true })) }));
});

test('receipt boundary rejects future, malformed, duplicated and private fields without echoing their values', () => {
  const original = receipt();
  const sentinel = 'private-path-and-contact-sentinel';
  for (const value of [
    null, { ...original, version: 2 }, { ...original, target: sentinel },
    { ...original, sources: [...original.sources, original.sources[0]] },
    { ...original, sources: original.sources.map(() => original.sources[0]) },
    { ...original, sources: original.sources.map(row => ({ ...row, error: sentinel })) },
    { ...original, sources: original.sources.map(row => ({ ...row, source: sentinel })) },
    { ...original, originalChoices: { ...original.originalChoices, securityTxt: sentinel } },
    { ...original, originalChoices: { ...original.originalChoices, endpoint: sentinel } },
    { ...original, requestedDepth: 'fast', webSelection: 'selected_url' },
    { ...original, targetClass: 'ipv6' },
    { ...original, sources: original.sources.map(row => ({ ...row, complete: true, truncated: true })) },
    { ...original, sources: original.sources.map(row => ({ ...row, attempt: 'not_started', complete: false })) },
    { ...original, sources: original.sources.map(row => ({ ...row, admission: 'disabled' })) },
  ]) {
    assert.throws(() => parseLookupCollectionReceipt(value), error => error instanceof TypeError && !error.message.includes(sentinel));
  }
  let reads = 0;
  const getter = { ...original };
  Object.defineProperty(getter, 'sources', { enumerable: true, get() { reads++; return original.sources; } });
  assert.throws(() => parseLookupCollectionReceipt(getter));
  assert.equal(reads, 0);
  const rows = [...original.sources];
  Object.defineProperty(rows, '0', { enumerable: true, get() { reads++; return original.sources[0]; } });
  assert.throws(() => parseLookupCollectionReceipt({ ...original, sources: rows }));
  assert.equal(reads, 0);
  assert.throws(() => parseLookupCollectionReceipt({ ...original, sources: Object.assign([...original.sources], { extra: sentinel }) }));
});

test('binding submitted choices never invents server admission or changes completed execution', () => {
  const original = receipt();
  const filtered = { ...original, originalChoices: { ...original.originalChoices, securityTxt: false },
    sources: original.sources.map(row => row.source !== 'security_txt' ? row : {
      ...row, intent: 'not_requested', admission: 'not_applicable', attempt: 'not_started', settlement: 'unknown', complete: null, truncated: null,
    }),
  };
  const bound = bindLookupCollectionChoices(filtered, original.originalChoices)!;
  assert.deepEqual(bound.sources.find(row => row.source === 'security_txt'), {
    source: 'security_txt', intent: 'requested', admission: 'unknown', attempt: 'not_started', settlement: 'unknown', complete: null, truncated: null,
  });
  assert.deepEqual(bound.sources.filter(row => row.source !== 'security_txt'), original.sources.filter(row => row.source !== 'security_txt'));
  assert.throws(() => bindLookupCollectionChoices(original, lookupCollectionChoices({})));
  assert.equal(bindLookupCollectionChoices(undefined, original.originalChoices), null);
});

test('real orchestration records disabled, failed, unsupported and prerequisite outcomes without additional calls', async () => {
  const captures: LookupCollectionReceipt[] = [];
  const calls: string[] = [];
  const query = classifyQuery('receipt.example');
  const result = await runUnifiedLookup(query, {
    featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_WHOIS: '1', WHOISLEUTH_DISABLE_WEBSITE_PROBE: '1' }),
    securityTxt: true,
    fetchRdapRecord: async () => { calls.push('rdap'); return null; },
    buildWhoisChain: async () => { throw new Error('must not collect'); },
    checkDomainAvailability: async () => { calls.push('domain'); throw new Error('private-error-sentinel'); },
    collectObservedNetworkContext: async () => {
      calls.push('network');
      const empty = await collectObservedNetworkContext({}, { observedAt: () => '2026-10-01T00:00:00.000Z',
        fetchRdapRecord: async () => { throw new Error('No address was supplied; collection must not run.'); } });
      return { ...empty, status: 'error', complete: false, truncated: false };
    },
    onCollectionReceipt: value => captures.push(value),
  });
  assert.equal(captures.length, 1);
  assert.deepEqual(calls.sort(), ['domain', 'network', 'rdap']);
  const rows = new Map(captures[0]!.sources.map(row => [row.source, row]));
  assert.deepEqual(rows.get('rdap'), { source: 'rdap', intent: 'requested', admission: 'admitted', attempt: 'started', settlement: 'unsupported', complete: null, truncated: null });
  assert.equal(rows.get('whois')?.admission, 'disabled');
  assert.equal(rows.get('whois')?.attempt, 'not_started');
  assert.equal(rows.get('security_txt')?.intent, 'requested');
  assert.equal(rows.get('security_txt')?.admission, 'disabled');
  assert.equal(rows.get('security_txt')?.attempt, 'not_started');
  assert.equal(rows.get('registrar_rdap')?.admission, 'prerequisite_unavailable');
  assert.equal(rows.get('registrar_rdap')?.attempt, 'not_started');
  assert.equal(rows.get('domain_evidence')?.settlement, 'error');
  assert.equal(rows.get('domain_evidence')?.complete, false);
  assert.equal(rows.get('domain_evidence')?.truncated, null, 'A rejected collector cannot establish that its result was not truncated.');
  assert.equal(rows.get('network_context')?.settlement, 'error');
  assert.equal(rows.get('network_context')?.complete, false);
  assert.equal(rows.get('external_intelligence')?.intent, 'not_requested');
  assert.equal('collectionReceipt' in result, false, 'The observer does not silently add fields to every consumer.');
  const serialized = JSON.stringify(captures);
  assert.equal(serialized.includes('receipt.example'), false);
  assert.equal(serialized.includes('private-error-sentinel'), false);
});

test('Fast and Compact use existing collection only; Compact cannot acquire a constituent receipt', async () => {
  for (const compact of [false, true]) {
    const captures: LookupCollectionReceipt[] = [];
    let calls = 0;
    await runUnifiedLookup(classifyQuery('fast.example'), {
      fast: true, compact, onCollectionReceipt: value => captures.push(value),
      fetchRdapRecord: async () => { calls++; return null; },
      checkDomainAvailability: async () => { calls++; return { state: 'unknown', confidence: 'low', detail: 'Fixture registration sources were inconclusive.' }; },
      buildWhoisChain: async () => { throw new Error('must not collect'); },
    });
    assert.equal(calls, 2);
    assert.equal(captures.length, compact ? 0 : 1);
    if (!compact) {
      assert.equal(captures[0]!.requestedDepth, 'fast');
      assert.equal(captures[0]!.sources.find(row => row.source === 'whois')?.attempt, 'not_started');
      assert.equal(captures[0]!.sources.find(row => row.source === 'domain_evidence')?.complete, false);
    }
  }
});

test('cancelled final delivery cannot produce a completed receipt even after an admitted collector resolves', async () => {
  const controller = new AbortController();
  const entered = deferred<void>(), held = deferred<null>();
  const captures: LookupCollectionReceipt[] = [];
  const operation = runUnifiedLookup(classifyQuery('192.0.2.8'), {
    fast: true, signal: controller.signal,
    fetchRdapRecord: async () => { entered.resolve(); return held.promise; },
    onCollectionReceipt: value => captures.push(value),
  });
  await entered.promise;
  controller.abort(); held.resolve(null);
  await assert.rejects(operation, { name: 'AbortError' });
  assert.deepEqual(captures, []);
});

test('HTTP final response owns the receipt, validates its target and excludes it from Compact', async () => {
  for (const compact of [false, true]) {
    const prepared = prepareLookupHttpOperation({ params: { q: '192.0.2.8', fast: '1', ...(compact ? { compact: '1' } : {}) },
      method: 'GET', featurePolicy: networkFeaturePolicy({}) });
    assert.ok(prepared.ok);
    let calls = 0;
    const result = await prepared.run({ createLookupHttpResponse,
      runUnifiedLookup: (target, options) => runUnifiedLookup(target, { ...options,
        fetchRdapRecord: async () => { calls++; return null; },
      }),
    }, new AbortController().signal);
    assert.equal(calls, 1);
    if (compact) assert.equal(Object.hasOwn(result, 'collectionReceipt'), false);
    else {
      const response = JSON.parse(JSON.stringify(result));
      assert.equal(parseLookupHttpResponse(response).ok, true);
      assert.equal(parseLookupCollectionReceipt(response.collectionReceipt)?.targetClass, 'ipv4');
      assert.equal(parseLookupHttpResponse({ ...response, collectionReceipt: { ...response.collectionReceipt, targetClass: 'asn' } }).ok, false);
      assert.equal(parseLookupHttpResponse({ ...response, collectionReceipt: { ...response.collectionReceipt, version: 2 } }).ok, false);
    }
  }
});

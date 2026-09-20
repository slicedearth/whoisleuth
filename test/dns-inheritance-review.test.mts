import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { describe, test } from 'node:test';
import {
  collectDnsInheritanceChecks, parseInheritedDnsSelection, reviewInheritedDmarc, reviewParentDelegation,
  type InheritanceDnsDependencies,
} from '../lib/dns-inheritance-review.mts';
import { defaultTcpExchange } from '../lib/service-binding-dns.mts';

const TIME = '2026-09-19T01:00:00.000Z';
const empty = { records: [], error: null, observedAt: TIME };
const observation = (...records: string[]) => ({ ...empty, records });
function dnsName(name: string): Buffer {
  return Buffer.concat([...name.split('.').map(label => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])), Buffer.from([0])]);
}
function referral(query: Buffer, options: { owner?: string; question?: string; servers?: string[]; answer?: boolean; flags?: number } = {}): Buffer {
  const header = Buffer.alloc(12), question = Buffer.alloc(4);
  header.writeUInt16BE(query.readUInt16BE(0)); header.writeUInt16BE(options.flags ?? 0x8000, 2); header.writeUInt16BE(1, 4);
  const servers = options.servers ?? ['ns1.child.example'];
  header.writeUInt16BE(servers.length, options.answer ? 6 : 8);
  question.writeUInt16BE(2); question.writeUInt16BE(1, 2);
  const records = servers.map(server => {
    const data = dnsName(server), fixed = Buffer.alloc(10);
    fixed.writeUInt16BE(2); fixed.writeUInt16BE(1, 2); fixed.writeUInt32BE(300, 4); fixed.writeUInt16BE(data.length, 8);
    return Buffer.concat([dnsName(options.owner ?? 'example.test'), fixed, data]);
  });
  return Buffer.concat([header, dnsName(options.question ?? 'example.test'), question, ...records]);
}
function dependencies(overrides: Partial<InheritanceDnsDependencies> = {}): InheritanceDnsDependencies {
  return {
    resolveTxt: async () => [], resolveNs: async () => ['ns2.parent.example', 'ns1.parent.example'],
    resolve4: async () => ['1.1.1.1'], resolve6: async () => [],
    exchange: async query => referral(query), now: () => new Date(TIME), ...overrides,
  };
}
async function dmarc(domain: string, exact: Parameters<typeof reviewInheritedDmarc>[1], records: Record<string, Parameters<typeof reviewInheritedDmarc>[1]>) {
  const calls: string[] = [];
  const result = await reviewInheritedDmarc(domain, exact, async owner => { calls.push(owner); return records[owner] ?? empty; });
  return { result, calls };
}

describe('explicit inherited DNS admission', () => {
  test('requires the exact opt-in and rejects ambiguous values', () => {
    assert.equal(parseInheritedDnsSelection(undefined), undefined);
    assert.equal(parseInheritedDnsSelection(''), undefined);
    assert.equal(parseInheritedDnsSelection('1'), true);
    for (const value of ['0', 'true', 'false', 1, true, null, ['1'], {}, ' 1']) assert.throws(() => parseInheritedDnsSelection(value));
  });
  test('rejects malformed targets before any dependency runs', async () => {
    const fail = async () => assert.fail('No DNS operation is permitted');
    for (const target of ['bad name.test', 'EXAMPLE.TEST', 'example.test/path', `${'x'.repeat(64)}.test`]) {
      await assert.rejects(collectDnsInheritanceChecks(target, empty, empty, {}, dependencies({ resolveTxt: fail, resolveNs: fail })), /normalised domain/);
    }
  });
  test('pre-cancellation starts no DNS operation', async () => {
    await assert.rejects(collectDnsInheritanceChecks('example.test', empty, empty, { signal: AbortSignal.abort(new Error('cancelled')) }, dependencies({
      resolveNs: async () => assert.fail('No parent discovery'), resolveTxt: async () => assert.fail('No tree walk'),
    })), /cancelled/);
  });
  test('combines both evidence sources without retaining raw policy contacts', async () => {
    const queries: string[] = [];
    const results = await collectDnsInheritanceChecks('mail.example.test', empty, empty, {}, dependencies({
      resolveTxt: async owner => { queries.push(owner); return ['v=DMARC1; p=reject; psd=n; rua=mailto:private@example.test']; },
    }));
    assert.deepEqual(queries, ['_dmarc.example.test']);
    assert.deepEqual(results.map(result => result.id), ['dmarc_inheritance', 'parent_delegation']);
    assert.equal(results[0]?.status, 'info'); assert.equal(results[1]?.status, 'info');
    assert.doesNotMatch(JSON.stringify(results), /private@/);
  });
  test('propagates cancellation during a direct query and does not start a second server', async () => {
    const controller = new AbortController(); let calls = 0;
    const result = collectDnsInheritanceChecks('example.test', observation('v=DMARC1; p=reject'), empty, { signal: controller.signal }, dependencies({
      exchange: async (_query, _endpoint, options) => { calls++; assert.ok(options.signal); controller.abort(new Error('cancelled during exchange')); options.signal.throwIfAborted(); return Buffer.alloc(0); },
    }));
    await assert.rejects(result, /cancelled during exchange/); assert.equal(calls, 1);
  });
});

describe('inherited DMARC publication', () => {
  test('uses an exact-name policy without making ancestor requests or retaining reporting addresses', async () => {
    const { result, calls } = await dmarc('mail.example.test', observation('v=DMARC1; p=reject; t=y; rua=mailto:private@example.test'), {});
    assert.deepEqual(calls, []); assert.equal(result.status, 'info'); assert.match(result.summary, /Exact-name/);
    assert.match(result.detail, /Published policy: reject\. Test mode: yes/);
    assert.doesNotMatch(JSON.stringify(result), /private@|rua=/);
  });
  test('keeps existing and nonexistent-name policies distinct at an explicit organisational boundary', async () => {
    const { result, calls } = await dmarc('mail.example.test', empty, {
      '_dmarc.example.test': observation('v=DMARC1; p=none; sp=quarantine; np=reject; psd=n'),
    });
    assert.deepEqual(calls, ['_dmarc.example.test']); assert.match(result.summary, /Inherited.*_dmarc.example.test/);
    assert.match(result.detail, /existing name: quarantine.*nonexistent name: reject.*existence is not inferred/);
    assert.equal(result.status, 'info');
  });
  test('chooses the shortest valid owner without an explicit boundary', async () => {
    const { result, calls } = await dmarc('a.mail.example.test', empty, {
      '_dmarc.mail.example.test': observation('v=DMARC1; p=none'),
      '_dmarc.example.test': observation('v=DMARC1; p=reject'),
    });
    assert.deepEqual(calls, ['_dmarc.mail.example.test', '_dmarc.example.test', '_dmarc.test']);
    assert.match(result.summary, /_dmarc.example.test/); assert.match(result.detail, /existing name: reject/);
  });
  test('uses an organisational record ahead of a PSD record, or the PSD if none was published', async () => {
    const psd = { '_dmarc.test': observation('v=DMARC1; p=reject; psd=y') };
    const own = await dmarc('a.example.test', empty, { ...psd, '_dmarc.example.test': observation('v=DMARC1; p=quarantine') });
    assert.match(own.result.summary, /_dmarc.example.test/); assert.match(own.result.detail, /existing name: quarantine/);
    const inherited = await dmarc('a.example.test', empty, psd);
    assert.match(inherited.result.summary, /_dmarc.test/); assert.match(inherited.result.detail, /existing name: reject/);
  });
  test('bounds long names to eight owners and skips no required short-name ancestor', async () => {
    const { result, calls } = await dmarc('a.b.c.d.e.f.g.h.example.test', empty, {});
    assert.deepEqual(calls, ['_dmarc.d.e.f.g.h.example.test', '_dmarc.e.f.g.h.example.test', '_dmarc.f.g.h.example.test', '_dmarc.g.h.example.test', '_dmarc.h.example.test', '_dmarc.example.test', '_dmarc.test']);
    assert.equal(result.records.length, 8); assert.match(result.summary, /No applicable.*completed tree walk/);
  });
  test('discards multiple policies but keeps an invalid single policy inconclusive', async () => {
    const parent = { '_dmarc.example.test': observation('v=DMARC1; p=reject; psd=n') };
    const multiple = await dmarc('mail.example.test', observation('v=DMARC1; p=none', 'v=DMARC1; p=reject'), parent);
    assert.match(multiple.result.summary, /Inherited policy published/);
    const invalid = await dmarc('mail.example.test', observation('v=DMARC1; p=future'), parent);
    assert.equal(invalid.result.status, 'warning'); assert.match(invalid.result.summary, /could not be determined/);
    assert.doesNotMatch(invalid.result.detail, /For an existing name/);
  });
  test('unavailable observations never become absence or a policy from another source', async () => {
    const calls: string[] = [];
    const result = await reviewInheritedDmarc('mail.example.test', { ...empty, error: 'private resolver detail' }, async owner => { calls.push(owner); return empty; });
    assert.deepEqual(calls, []); assert.match(result.summary, /could not be determined/); assert.doesNotMatch(JSON.stringify(result), /private resolver/);
    const parent = await dmarc('a.example.test', empty, { '_dmarc.example.test': { ...empty, error: 'timeout' } });
    assert.deepEqual(parent.calls, ['_dmarc.example.test']); assert.match(parent.result.summary, /could not be determined/);
  });
  test('rejects oversized TXT arrays before reading entries and sanitises observation time', async () => {
    const records = Array<string>(65); Object.defineProperty(records, 0, { get: () => assert.fail('Must check count first') });
    const result = await reviewInheritedDmarc('example.test', { records, error: null, observedAt: 'private\ntime' }, async () => assert.fail('Must not continue'));
    assert.match(result.summary, /could not be determined/); assert.match(result.records[0]!, /time unavailable/);
    assert.doesNotMatch(JSON.stringify(result), /private/);
  });
});

describe('direct parent referrals', () => {
  test('pins two public addresses, clears recursion, and retains separately attributed referrals', async () => {
    const calls: string[] = [];
    const result = await reviewParentDelegation('example.test', observation('ns1.child.example'), dependencies({
      resolveNs: async parent => { assert.equal(parent, 'test'); return ['ns3.parent.example', 'ns1.parent.example', 'ns2.parent.example']; },
      resolve4: async server => { calls.push(server); return ['1.1.1.1']; },
      exchange: async (query, endpoint, options) => {
        assert.equal(query.readUInt16BE(2), 0); assert.deepEqual(endpoint, { address: '1.1.1.1', family: 4, port: 53 });
        assert.equal(options.timeoutMs, 2200); return referral(query);
      },
    }));
    assert.deepEqual(calls, ['ns1.parent.example', 'ns2.parent.example']); assert.equal(result.status, 'info');
    assert.match(result.summary, /^2 parent servers/); assert.match(result.detail, /not full delegation or DNSSEC validation/);
    assert.ok(result.records.some(record => record.includes(TIME) && record.includes('Direct DNS/TCP')));
  });
  test('compares only same-scope recursive records and reports disagreement between parent samples', async () => {
    const different = await reviewParentDelegation('example.test', observation('ns2.child.example'), dependencies());
    assert.equal(different.status, 'warning'); assert.match(different.summary, /recursive.*differ/);
    let index = 0;
    const subdomain = await reviewParentDelegation('mail.example.test', observation('ns.sub.example'), dependencies({ exchange: async query => referral(query, { servers: [`ns${++index}.child.example`] }) }));
    assert.equal(subdomain.status, 'warning'); assert.match(subdomain.summary, /parent servers returned different/);
    assert.match(subdomain.detail, /No complete same-scope recursive comparison/);
  });
  test('rejects private, mixed, malformed or oversized address sets before opening a socket', async () => {
    const oversized = Array<string>(17); Object.defineProperty(oversized, 0, { get: () => assert.fail('Must check count first') });
    for (const addresses of [['127.0.0.1'], ['1.1.1.1', '10.0.0.1'], ['not-an-address'], oversized]) {
      const result = await reviewParentDelegation('example.test', empty, dependencies({ resolve4: async () => addresses, exchange: async () => assert.fail('Must not connect') }));
      assert.equal(result.status, 'warning'); assert.match(result.summary, /No direct parent referral/);
    }
  });
  test('does not turn discovery failures, empty responses or excess server counts into absent delegation', async () => {
    for (const resolveNs of [async () => [], async () => { throw new Error('private path'); }, async () => Array<string>(17)]) {
      const result = await reviewParentDelegation('example.test', empty, dependencies({ resolveNs, exchange: async () => assert.fail('Must not connect') }));
      assert.equal(result.status, 'warning'); assert.match(result.detail, /unavailable or incomplete/); assert.doesNotMatch(JSON.stringify(result), /private path/);
    }
  });
  test('requires matching authority referrals, not answers, wrong owners, truncation or error replies', async () => {
    for (const options of [{ answer: true }, { owner: 'other.test' }, { question: 'other.test' }, { flags: 0x8200 }, { flags: 0x8003 }, { servers: [] }]) {
      const result = await reviewParentDelegation('example.test', empty, dependencies({ exchange: async query => referral(query, options) }));
      assert.equal(result.status, 'warning'); assert.match(result.summary, /No direct parent referral/);
    }
  });
  test('does not retry a failed server and preserves a successful partial sample', async () => {
    let calls = 0;
    const result = await reviewParentDelegation('example.test', observation('ns1.child.example'), dependencies({ exchange: async query => { if (++calls === 1) throw new Error('private transport'); return referral(query); } }));
    assert.equal(calls, 2); assert.equal(result.status, 'warning'); assert.match(result.summary, /^1 parent server/);
    assert.doesNotMatch(JSON.stringify(result), /private transport/);
  });
});

test('TCP cancellation closes an in-flight query and pre-cancellation opens nothing', async t => {
  let connections = 0;
  const server = net.createServer(socket => { connections++; socket.resume(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const endpoint = { address: '127.0.0.1', family: 4 as const, port: address.port };
  await assert.rejects(defaultTcpExchange(Buffer.from([0, 1]), endpoint, { timeoutMs: 1000, signal: AbortSignal.abort(new Error('cancelled')) }), /cancelled/);
  assert.equal(connections, 0);
  const controller = new AbortController(), connected = once(server, 'connection');
  const rejected = assert.rejects(defaultTcpExchange(Buffer.from([0, 1]), endpoint, { timeoutMs: 1000, signal: controller.signal }), /cancelled/);
  const [socket] = await connected; const closed = once(socket, 'close');
  controller.abort(new Error('cancelled')); await rejected; await closed;
  assert.equal(connections, 1);
});

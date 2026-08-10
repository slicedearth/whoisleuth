import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import * as crypto from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { describe, test } from 'node:test';

import {
  DNSSEC_TRUST_ANCHOR_SCHEMA,
  DNS_TYPE_DNSKEY,
  DNS_TYPE_DS,
  DNS_TYPE_NS,
  DNS_TYPE_NSEC,
  DNS_TYPE_NSEC3,
  DNS_TYPE_RRSIG,
  dnskeyTag,
  signedRrsetData,
  validateDnssecChain,
  type DnsWireRecord,
  type DnskeyData,
  type RrsigData,
} from '../lib/dnssec-chain-validation.mts';
import { defaultTcpExchange } from '../lib/service-binding-dns.mts';

const OBSERVED_AT = '2026-08-11T00:00:00.000Z';
const NOW_SECONDS = Math.floor(Date.parse(OBSERVED_AT) / 1000);
const RESOLVER = '93.184.216.34';

function wireName(name: string): Buffer {
  if (name === '.') return Buffer.from([0]);
  return Buffer.concat([...name.split('.').flatMap((label) => {
    const bytes = Buffer.from(label, 'ascii');
    return [Buffer.from([bytes.length]), bytes];
  }), Buffer.from([0])]);
}

function record(owner: string, type: number, canonicalRdata: Buffer, data: DnsWireRecord['data'], section: DnsWireRecord['section'] = 'answer'): DnsWireRecord {
  return { owner, type, class: 1, ttl: 300, canonicalRdata, data, section };
}

function keyFixture(owner: string) {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([
    Buffer.from(String(jwk.x), 'base64url'),
    Buffer.from(String(jwk.y), 'base64url'),
  ]);
  const rdata = Buffer.concat([Buffer.from([0x01, 0x01, 0x03, 0x0d]), publicKey]);
  const data: DnskeyData = { kind: 'DNSKEY', flags: 257, protocol: 3, algorithm: 13, publicKey };
  return { owner, privateKey: pair.privateKey, record: record(owner, DNS_TYPE_DNSKEY, rdata, data) };
}

function dsRecord(owner: string, key: DnsWireRecord): DnsWireRecord {
  const digest = crypto.createHash('sha256').update(wireName(owner)).update(key.canonicalRdata).digest();
  const rdata = Buffer.alloc(4 + digest.length);
  rdata.writeUInt16BE(dnskeyTag(key.canonicalRdata), 0);
  rdata[2] = 13;
  rdata[3] = 2;
  digest.copy(rdata, 4);
  return record(owner, DNS_TYPE_DS, rdata, {
    kind: 'DS', keyTag: dnskeyTag(key.canonicalRdata), algorithm: 13, digestType: 2, digest,
  });
}

function signatureRecord(
  owner: string,
  type: number,
  signer: string,
  key: DnsWireRecord,
  privateKey: crypto.KeyObject,
  rrset: DnsWireRecord[],
  corrupt = false,
  section: DnsWireRecord['section'] = 'answer',
): DnsWireRecord {
  const prefix = Buffer.alloc(18);
  prefix.writeUInt16BE(type, 0);
  prefix[2] = 13;
  prefix[3] = owner === '.' ? 0 : owner.split('.').length;
  prefix.writeUInt32BE(300, 4);
  prefix.writeUInt32BE(NOW_SECONDS + 3_600, 8);
  prefix.writeUInt32BE(NOW_SECONDS - 60, 12);
  prefix.writeUInt16BE(dnskeyTag(key.canonicalRdata), 16);
  const signedPrefix = Buffer.concat([prefix, wireName(signer)]);
  const unsigned: RrsigData = {
    kind: 'RRSIG', typeCovered: type, algorithm: 13,
    labels: owner === '.' ? 0 : owner.split('.').length,
    originalTtl: 300, expiration: NOW_SECONDS + 3_600, inception: NOW_SECONDS - 60,
    keyTag: dnskeyTag(key.canonicalRdata), signerName: signer,
    signature: Buffer.alloc(0), signedPrefix,
  };
  const dataToSign = signedRrsetData(owner, type, rrset, unsigned);
  assert.ok(dataToSign);
  const signature = crypto.sign('sha256', dataToSign, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  if (corrupt) signature[0] = (signature[0] as number) ^ 0xff;
  return record(owner, DNS_TYPE_RRSIG, Buffer.concat([signedPrefix, signature]), { ...unsigned, signature }, section);
}

function rrWire(value: DnsWireRecord): Buffer {
  const owner = wireName(value.owner);
  const header = Buffer.alloc(10);
  header.writeUInt16BE(value.type, 0);
  header.writeUInt16BE(value.class, 2);
  header.writeUInt32BE(value.ttl, 4);
  header.writeUInt16BE(value.canonicalRdata.length, 8);
  return Buffer.concat([owner, header, value.canonicalRdata]);
}

function response(query: Buffer, name: string, type: number, answer: DnsWireRecord[], authority: DnsWireRecord[] = []): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(query.readUInt16BE(0), 0);
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answer.length, 6);
  header.writeUInt16BE(authority.length, 8);
  const question = Buffer.concat([wireName(name), Buffer.from([type >> 8, type & 0xff, 0, 1])]);
  return Buffer.concat([header, question, ...answer.map(rrWire), ...authority.map(rrWire)]);
}

function secureFixture(corruptExampleSignature = false) {
  const root = keyFixture('.');
  const tld = keyFixture('test');
  const child = keyFixture('example.test');
  const rootSignature = signatureRecord('.', DNS_TYPE_DNSKEY, '.', root.record, root.privateKey, [root.record]);
  const tldDs = dsRecord('test', tld.record);
  const tldDsSignature = signatureRecord('test', DNS_TYPE_DS, '.', root.record, root.privateKey, [tldDs]);
  const tldKeySignature = signatureRecord('test', DNS_TYPE_DNSKEY, 'test', tld.record, tld.privateKey, [tld.record]);
  const childDs = dsRecord('example.test', child.record);
  const childDsSignature = signatureRecord('example.test', DNS_TYPE_DS, 'test', tld.record, tld.privateKey, [childDs]);
  const childKeySignature = signatureRecord('example.test', DNS_TYPE_DNSKEY, 'example.test', child.record, child.privateKey, [child.record], corruptExampleSignature);
  const steps = [
    { name: '.', type: DNS_TYPE_DNSKEY, answer: [root.record, rootSignature] },
    { name: 'test', type: DNS_TYPE_DS, answer: [tldDs, tldDsSignature] },
    { name: 'test', type: DNS_TYPE_DNSKEY, answer: [tld.record, tldKeySignature] },
    { name: 'example.test', type: DNS_TYPE_DS, answer: [childDs, childDsSignature] },
    { name: 'example.test', type: DNS_TYPE_DNSKEY, answer: [child.record, childKeySignature] },
  ];
  let index = 0;
  return {
    anchor: {
      schema: DNSSEC_TRUST_ANCHOR_SCHEMA,
      version: 1,
      zone: '.',
      source: 'Fixture root anchor',
      reviewedAt: OBSERVED_AT,
      dsRecords: [{
        keyTag: dnskeyTag(root.record.canonicalRdata), algorithm: 13, digestType: 2,
        digest: crypto.createHash('sha256').update(wireName('.')).update(root.record.canonicalRdata).digest('hex'),
      }],
    },
    exchange: async (query: Buffer) => {
      const step = steps[index++];
      assert.ok(step, 'Unexpected DNS query');
      return response(query, step.name, step.type, step.answer);
    },
  };
}

describe('isolated cryptographic DNSSEC validation', () => {
  test('enforces the DNS-over-TCP wall-clock deadline against a slow-drip response', async (context) => {
    const serverSockets = new Set<Socket>();
    const server = createServer((socket) => {
      serverSockets.add(socket);
      socket.once('close', () => serverSockets.delete(socket));
      socket.write(Buffer.from([0x01, 0x00]));
      const drip = setInterval(() => {
        if (!socket.destroyed) socket.write(Buffer.from([0x01]));
      }, 10);
      drip.unref();
      socket.once('close', () => clearInterval(drip));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    context.after(async () => {
      for (const socket of serverSockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const started = Date.now();
    await assert.rejects(
      defaultTcpExchange(
        Buffer.from([0x00]),
        { address: '127.0.0.1', port: address.port, family: 4 },
        { timeoutMs: 60 },
      ),
      (error: unknown) => error instanceof Error
        && error.message === 'DNS TCP query timed out'
        && (error as NodeJS.ErrnoException).code === 'ETIMEOUT',
    );
    assert.ok(Date.now() - started < 1_000, 'The hard deadline should not wait for the drip response to finish.');
  });

  test('validates a bounded DS and DNSKEY chain from the configured trust anchor', async () => {
    const fixture = secureFixture();
    const report = await validateDnssecChain({
      ownedOrAuthorized: true,
      target: 'example.test', resolver: RESOLVER, trustAnchor: fixture.anchor,
      observedAt: OBSERVED_AT, sessionOptions: { exchange: fixture.exchange, now: () => 0 },
    });
    assert.equal(report.state, 'secure');
    assert.equal(report.validatedZone, 'example.test');
    assert.deepEqual(report.delegations.map((item) => item.state), ['secure', 'secure', 'secure']);
    assert.equal(report.transport.queryCount, 5);
    assert.equal(report.completeness, 'complete');
    assert.equal(report.failure, null);
    assert.doesNotMatch(JSON.stringify(report), /"(?:publicKey|signature|transactionId)"/u);
  });

  test('distinguishes a cryptographic validation failure from transport and timeout states', async () => {
    const corrupted = secureFixture(true);
    const bogus = await validateDnssecChain({
      ownedOrAuthorized: true,
      target: 'example.test', resolver: RESOLVER, trustAnchor: corrupted.anchor,
      observedAt: OBSERVED_AT, sessionOptions: { exchange: corrupted.exchange, now: () => 0 },
    });
    assert.equal(bogus.state, 'bogus');
    assert.equal(bogus.failure?.kind, 'validation');
    assert.equal(bogus.failure?.stage, 'dnskey:example.test');

    const timed = secureFixture();
    const timedOut = await validateDnssecChain({
      ownedOrAuthorized: true,
      target: 'example.test', resolver: RESOLVER, trustAnchor: timed.anchor,
      observedAt: OBSERVED_AT,
      sessionOptions: {
        exchange: async () => { throw Object.assign(new Error('Fixture DNS query timed out'), { code: 'ETIMEOUT' }); },
        now: () => 0,
      },
    });
    assert.equal(timedOut.state, 'timed_out');
    assert.equal(timedOut.failure?.kind, 'transport');
    assert.equal(timedOut.transport.state, 'timed_out');
  });

  test('accepts a signed denial of DS only as an insecure delegation', async () => {
    const root = keyFixture('.');
    const rootSignature = signatureRecord('.', DNS_TYPE_DNSKEY, '.', root.record, root.privateKey, [root.record]);
    const nsecRdata = Buffer.concat([wireName('next.test'), Buffer.from([0, 1, 0x20])]);
    const nsec = record('test', DNS_TYPE_NSEC, nsecRdata, { kind: 'NSEC', nextName: 'next.test', types: new Set([DNS_TYPE_NS]) }, 'authority');
    const nsecSignature = signatureRecord('test', DNS_TYPE_NSEC, '.', root.record, root.privateKey, [nsec], false, 'authority');
    const steps = [
      { name: '.', type: DNS_TYPE_DNSKEY, answer: [root.record, rootSignature], authority: [] },
      { name: 'test', type: DNS_TYPE_DS, answer: [], authority: [nsec, nsecSignature] },
    ];
    let index = 0;
    const anchor = {
      schema: DNSSEC_TRUST_ANCHOR_SCHEMA, version: 1, zone: '.', source: 'Fixture root anchor', reviewedAt: OBSERVED_AT,
      dsRecords: [{ keyTag: dnskeyTag(root.record.canonicalRdata), algorithm: 13, digestType: 2, digest: crypto.createHash('sha256').update(wireName('.')).update(root.record.canonicalRdata).digest('hex') }],
    };
    const report = await validateDnssecChain({
      ownedOrAuthorized: true,
      target: 'example.test', resolver: RESOLVER, trustAnchor: anchor, observedAt: OBSERVED_AT,
      sessionOptions: {
        now: () => 0,
        exchange: async (query) => {
          const step = steps[index++];
          assert.ok(step);
          return response(query, step.name, step.type, step.answer, step.authority);
        },
      },
    });
    assert.equal(report.state, 'insecure');
    assert.equal(report.delegations.at(-1)?.state, 'insecure');
    assert.equal(report.completeness, 'complete');
    assert.equal(report.transport.queryCount, 2);
  });

  test('continues past an authenticated non-delegation without trusting a separate NS answer', async () => {
    const root = keyFixture('.');
    const child = keyFixture('example.test');
    const rootSignature = signatureRecord('.', DNS_TYPE_DNSKEY, '.', root.record, root.privateKey, [root.record]);
    const noDelegationRdata = Buffer.concat([wireName('next.test'), Buffer.from([0, 1, 0x22])]);
    const noDelegation = record('test', DNS_TYPE_NSEC, noDelegationRdata, { kind: 'NSEC', nextName: 'next.test', types: new Set([DNS_TYPE_NS, 6]) }, 'authority');
    const noDelegationSignature = signatureRecord('test', DNS_TYPE_NSEC, '.', root.record, root.privateKey, [noDelegation], false, 'authority');
    const childDs = dsRecord('example.test', child.record);
    const childDsSignature = signatureRecord('example.test', DNS_TYPE_DS, '.', root.record, root.privateKey, [childDs]);
    const childKeySignature = signatureRecord('example.test', DNS_TYPE_DNSKEY, 'example.test', child.record, child.privateKey, [child.record]);
    const steps = [
      { name: '.', type: DNS_TYPE_DNSKEY, answer: [root.record, rootSignature], authority: [] },
      { name: 'test', type: DNS_TYPE_DS, answer: [], authority: [noDelegation, noDelegationSignature] },
      { name: 'example.test', type: DNS_TYPE_DS, answer: [childDs, childDsSignature], authority: [] },
      { name: 'example.test', type: DNS_TYPE_DNSKEY, answer: [child.record, childKeySignature], authority: [] },
    ];
    let index = 0;
    const anchor = {
      schema: DNSSEC_TRUST_ANCHOR_SCHEMA, version: 1, zone: '.', source: 'Fixture root anchor', reviewedAt: OBSERVED_AT,
      dsRecords: [{ keyTag: dnskeyTag(root.record.canonicalRdata), algorithm: 13, digestType: 2, digest: crypto.createHash('sha256').update(wireName('.')).update(root.record.canonicalRdata).digest('hex') }],
    };
    const report = await validateDnssecChain({
      ownedOrAuthorized: true,
      target: 'example.test', resolver: RESOLVER, trustAnchor: anchor, observedAt: OBSERVED_AT,
      sessionOptions: {
        now: () => 0,
        exchange: async (query) => {
          const step = steps[index++];
          assert.ok(step, 'Unexpected DNS query');
          return response(query, step.name, step.type, step.answer, step.authority);
        },
      },
    });
    assert.equal(report.state, 'secure');
    assert.deepEqual(report.delegations.map((item) => item.zone), ['.', 'example.test']);
    assert.equal(report.transport.queryCount, 4);
  });

  test('does not skip missing authenticated denial evidence or accept NSEC3 opt-out spans', async () => {
    const root = keyFixture('.');
    const rootSignature = signatureRecord('.', DNS_TYPE_DNSKEY, '.', root.record, root.privateKey, [root.record]);
    const anchor = {
      schema: DNSSEC_TRUST_ANCHOR_SCHEMA, version: 1, zone: '.', source: 'Fixture root anchor', reviewedAt: OBSERVED_AT,
      dsRecords: [{ keyTag: dnskeyTag(root.record.canonicalRdata), algorithm: 13, digestType: 2, digest: crypto.createHash('sha256').update(wireName('.')).update(root.record.canonicalRdata).digest('hex') }],
    };
    const missingSteps = [
      { name: '.', type: DNS_TYPE_DNSKEY, answer: [root.record, rootSignature], authority: [] },
      { name: 'test', type: DNS_TYPE_DS, answer: [], authority: [] },
    ];
    let missingIndex = 0;
    const missing = await validateDnssecChain({
      ownedOrAuthorized: true,
      target: 'example.test', resolver: RESOLVER, trustAnchor: anchor, observedAt: OBSERVED_AT,
      sessionOptions: {
        now: () => 0,
        exchange: async (query) => {
          const step = missingSteps[missingIndex++];
          assert.ok(step, 'Unexpected DNS query');
          return response(query, step.name, step.type, step.answer, step.authority);
        },
      },
    });
    assert.equal(missing.state, 'indeterminate');
    assert.equal(missing.failure?.stage, 'delegation:test');
    assert.equal(missing.transport.queryCount, 2);

    const nsec3Rdata = Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 20]), Buffer.alloc(20, 0xff), Buffer.from([0, 1, 0x20])]);
    const nsec3Owner = '00000000000000000000000000000000';
    const nsec3 = record(nsec3Owner, DNS_TYPE_NSEC3, nsec3Rdata, {
      kind: 'NSEC3', hashAlgorithm: 1, flags: 1, iterations: 0, salt: Buffer.alloc(0), nextHash: 'V'.repeat(32), types: new Set([DNS_TYPE_NS]),
    }, 'authority');
    const nsec3Signature = signatureRecord(nsec3Owner, DNS_TYPE_NSEC3, '.', root.record, root.privateKey, [nsec3], false, 'authority');
    const optOutSteps = [
      { name: '.', type: DNS_TYPE_DNSKEY, answer: [root.record, rootSignature], authority: [] },
      { name: 'test', type: DNS_TYPE_DS, answer: [], authority: [nsec3, nsec3Signature] },
    ];
    let optOutIndex = 0;
    const optOut = await validateDnssecChain({
      ownedOrAuthorized: true,
      target: 'example.test', resolver: RESOLVER, trustAnchor: anchor, observedAt: OBSERVED_AT,
      sessionOptions: {
        now: () => 0,
        exchange: async (query) => {
          const step = optOutSteps[optOutIndex++];
          assert.ok(step, 'Unexpected DNS query');
          return response(query, step.name, step.type, step.answer, step.authority);
        },
      },
    });
    assert.equal(optOut.state, 'unsupported', JSON.stringify(optOut));
    assert.equal(optOut.failure?.stage, 'delegation:test');
    assert.match(optOut.failure?.detail ?? '', /opt-out/u);
  });

  test('rejects malformed anchors, private resolvers, and targets outside the anchor', async () => {
    const fixture = secureFixture();
    assert.equal((await validateDnssecChain({ target: 'example.test', resolver: '127.0.0.1', trustAnchor: fixture.anchor, observedAt: OBSERVED_AT, ownedOrAuthorized: true })).state, 'invalid');
    assert.equal((await validateDnssecChain({ target: 'example.test', resolver: RESOLVER, trustAnchor: { ...fixture.anchor, dsRecords: [] }, observedAt: OBSERVED_AT, ownedOrAuthorized: true })).state, 'invalid');
    assert.equal((await validateDnssecChain({ target: 'outside.test', resolver: RESOLVER, trustAnchor: { ...fixture.anchor, zone: 'example.test' }, observedAt: OBSERVED_AT, ownedOrAuthorized: true })).state, 'invalid');
    assert.equal((await validateDnssecChain({ target: 'example.test', resolver: RESOLVER, trustAnchor: fixture.anchor, observedAt: OBSERVED_AT, ownedOrAuthorized: false })).failure?.stage, 'authorization');
    assert.equal((await validateDnssecChain({ target: 'example.test', resolver: RESOLVER, trustAnchor: fixture.anchor, observedAt: 'not-a-time', ownedOrAuthorized: true })).failure?.stage, 'observed_at');
  });
});

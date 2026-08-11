import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import * as crypto from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { describe, test } from 'node:test';

import {
  DNSSEC_TRUST_ANCHOR_SCHEMA,
  DNS_TYPE_A,
  DNS_TYPE_DNSKEY,
  DNS_TYPE_DS,
  DNS_TYPE_NS,
  DNS_TYPE_NSEC,
  DNS_TYPE_NSEC3,
  DNS_TYPE_RRSIG,
  DNS_TYPE_TLSA,
  buildDnssecQuery,
  dnskeyTag,
  parseDnssecResponse,
  signedRrsetData,
  validateDnssecChain,
  verifyRrset,
  type DnsWireRecord,
  type DnsWireResponse,
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
  return dsRecordWithDigest(owner, key, 2);
}

function dsRecordWithDigest(owner: string, key: DnsWireRecord, digestType: 1 | 2 | 4, corrupt = false): DnsWireRecord {
  const hash = digestType === 1 ? 'sha1' : digestType === 2 ? 'sha256' : 'sha384';
  const digest = crypto.createHash(hash).update(wireName(owner)).update(key.canonicalRdata).digest();
  if (corrupt) digest[0] = (digest[0] as number) ^ 0xff;
  const rdata = Buffer.alloc(4 + digest.length);
  rdata.writeUInt16BE(dnskeyTag(key.canonicalRdata), 0);
  rdata[2] = 13;
  rdata[3] = digestType;
  digest.copy(rdata, 4);
  return record(owner, DNS_TYPE_DS, rdata, {
    kind: 'DS', keyTag: dnskeyTag(key.canonicalRdata), algorithm: 13, digestType, digest,
  });
}

function independentSignedRrsetData(owner: string, type: number, rrset: readonly DnsWireRecord[], signature: RrsigData): Buffer {
  const ownerLabels = owner === '.' ? [] : owner.split('.');
  assert.ok(signature.labels <= ownerLabels.length);
  const signedOwner = signature.labels === ownerLabels.length
    ? owner
    : signature.labels
      ? `*.${ownerLabels.slice(ownerLabels.length - signature.labels).join('.')}`
      : '*';
  const ownerWire = wireName(signedOwner);
  const canonicalRdata = [...new Map(rrset.map((item) => [item.canonicalRdata.toString('hex'), item.canonicalRdata])).values()]
    .sort(Buffer.compare);
  const records = canonicalRdata.map((rdata) => {
    const header = Buffer.alloc(ownerWire.length + 10);
    ownerWire.copy(header);
    header.writeUInt16BE(type, ownerWire.length);
    header.writeUInt16BE(1, ownerWire.length + 2);
    header.writeUInt32BE(signature.originalTtl, ownerWire.length + 4);
    header.writeUInt16BE(rdata.length, ownerWire.length + 8);
    return Buffer.concat([header, rdata]);
  });
  return Buffer.concat([signature.signedPrefix, ...records]);
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
  options: Readonly<{ labels?: number; wireSigner?: string }> = {},
): DnsWireRecord {
  const labels = options.labels ?? (owner === '.' ? 0 : owner.split('.').length);
  const canonicalSigner = signer.toLowerCase();
  const prefix = Buffer.alloc(18);
  prefix.writeUInt16BE(type, 0);
  prefix[2] = 13;
  prefix[3] = labels;
  prefix.writeUInt32BE(300, 4);
  prefix.writeUInt32BE(NOW_SECONDS + 3_600, 8);
  prefix.writeUInt32BE(NOW_SECONDS - 60, 12);
  prefix.writeUInt16BE(dnskeyTag(key.canonicalRdata), 16);
  const signedPrefix = Buffer.concat([prefix, wireName(canonicalSigner)]);
  const unsigned: RrsigData = {
    kind: 'RRSIG', typeCovered: type, algorithm: 13,
    labels,
    originalTtl: 300, expiration: NOW_SECONDS + 3_600, inception: NOW_SECONDS - 60,
    keyTag: dnskeyTag(key.canonicalRdata), signerName: canonicalSigner,
    signature: Buffer.alloc(0), signedPrefix,
  };
  const dataToSign = independentSignedRrsetData(owner, type, rrset, unsigned);
  assert.deepEqual(signedRrsetData(owner, type, rrset, unsigned), dataToSign);
  const signature = crypto.sign('sha256', dataToSign, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  if (corrupt) signature[0] = (signature[0] as number) ^ 0xff;
  const wirePrefix = Buffer.concat([prefix, wireName(options.wireSigner ?? signer)]);
  return record(owner, DNS_TYPE_RRSIG, Buffer.concat([wirePrefix, signature]), { ...unsigned, signature }, section);
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

function responseObject(name: string, type: number, records: readonly DnsWireRecord[]): DnsWireResponse {
  return { name, type, rcode: 0, authenticatedData: false, records, byteLength: 0 };
}

function unsignedSignatureRecord(owner: string, type: number, signer: string, key: DnsWireRecord, algorithm: number): DnsWireRecord {
  const prefix = Buffer.alloc(18);
  prefix.writeUInt16BE(type, 0);
  prefix[2] = algorithm;
  prefix[3] = owner === '.' ? 0 : owner.split('.').length;
  prefix.writeUInt32BE(300, 4);
  prefix.writeUInt32BE(NOW_SECONDS + 3_600, 8);
  prefix.writeUInt32BE(NOW_SECONDS - 60, 12);
  prefix.writeUInt16BE(dnskeyTag(key.canonicalRdata), 16);
  const signedPrefix = Buffer.concat([prefix, wireName(signer.toLowerCase())]);
  const signature = Buffer.alloc(64, 0xa5);
  return record(owner, DNS_TYPE_RRSIG, Buffer.concat([signedPrefix, signature]), {
    kind: 'RRSIG', typeCovered: type, algorithm, labels: prefix[3] as number,
    originalTtl: 300, expiration: NOW_SECONDS + 3_600, inception: NOW_SECONDS - 60,
    keyTag: dnskeyTag(key.canonicalRdata), signerName: signer.toLowerCase(), signature, signedPrefix,
  });
}

function secureFixture(
  corruptExampleSignature = false,
  childDsFactory?: (owner: string, key: DnsWireRecord) => DnsWireRecord[],
) {
  const root = keyFixture('.');
  const tld = keyFixture('test');
  const child = keyFixture('example.test');
  const rootSignature = signatureRecord('.', DNS_TYPE_DNSKEY, '.', root.record, root.privateKey, [root.record]);
  const tldDs = dsRecord('test', tld.record);
  const tldDsSignature = signatureRecord('test', DNS_TYPE_DS, '.', root.record, root.privateKey, [tldDs]);
  const tldKeySignature = signatureRecord('test', DNS_TYPE_DNSKEY, 'test', tld.record, tld.privateKey, [tld.record]);
  const childDs = childDsFactory?.('example.test', child.record) ?? [dsRecord('example.test', child.record)];
  const childDsSignature = signatureRecord('example.test', DNS_TYPE_DS, 'test', tld.record, tld.privateKey, childDs);
  const childKeySignature = signatureRecord('example.test', DNS_TYPE_DNSKEY, 'example.test', child.record, child.privateKey, [child.record], corruptExampleSignature, 'answer', { wireSigner: 'ExAmPlE.TeSt' });
  const steps = [
    { name: '.', type: DNS_TYPE_DNSKEY, answer: [root.record, rootSignature] },
    { name: 'test', type: DNS_TYPE_DS, answer: [tldDs, tldDsSignature] },
    { name: 'test', type: DNS_TYPE_DNSKEY, answer: [tld.record, tldKeySignature] },
    { name: 'example.test', type: DNS_TYPE_DS, answer: [...childDs, childDsSignature] },
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
  test('sets RD, CD, and EDNS DO without requesting resolver AD trust, and rejects TCP truncation', () => {
    const query = buildDnssecQuery('example.test', DNS_TYPE_A, 0x1234);
    const flags = query.readUInt16BE(2);
    assert.notEqual(flags & 0x0100, 0, 'RD must be set for the selected recursive resolver.');
    assert.notEqual(flags & 0x0010, 0, 'CD must be set so local validation receives unfiltered DNSSEC evidence.');
    assert.equal(flags & 0x0020, 0, 'AD is a response signal and must not be requested or trusted as validation.');
    assert.notEqual(query.readUInt32BE(query.length - 6) & 0x0000_8000, 0, 'EDNS DO must request DNSSEC records.');

    const truncated = response(query, 'example.test', DNS_TYPE_A, []);
    truncated.writeUInt16BE(truncated.readUInt16BE(2) | 0x0200, 2);
    assert.throws(
      () => parseDnssecResponse(truncated, { transactionId: 0x1234, name: 'example.test', type: DNS_TYPE_A }),
      /remained truncated over TCP/u,
    );
  });

  test('orders unique canonical RDATA independently of RDLENGTH for supported RRset types', () => {
    const owner = 'example.test';
    const key = keyFixture(owner);
    for (const [type, minimumLength] of [[DNS_TYPE_DNSKEY, 5], [DNS_TYPE_DS, 5], [DNS_TYPE_TLSA, 4]] as const) {
      const shortHigh = Buffer.concat([Buffer.from([0xff]), Buffer.alloc(minimumLength - 1)]);
      const longLow = Buffer.alloc(minimumLength + 1);
      const first = record(owner, type, shortHigh, { kind: 'opaque' });
      const second = record(owner, type, longLow, { kind: 'opaque' });
      const duplicate = record(owner, type, Buffer.from(shortHigh), { kind: 'opaque' });
      const signature = signatureRecord(owner, type, owner, key.record, key.privateKey, [first, second, duplicate]);
      assert.equal(signature.data.kind, 'RRSIG');
      const expected = independentSignedRrsetData(owner, type, [first, second, duplicate], signature.data);
      assert.deepEqual(signedRrsetData(owner, type, [first, second, duplicate], signature.data), expected);
      assert.equal(verifyRrset(responseObject(owner, type, [first, second, duplicate, signature]), owner, type, [key.record], owner, new Date(OBSERVED_AT)).state, 'valid');
    }
  });

  test('keeps malformed supported keys bogus, unsupported algorithms separate, and wildcard expansion fail closed', () => {
    const owner = 'mail.example.test';
    const rrset = [record(owner, DNS_TYPE_A, Buffer.from([192, 0, 2, 1]), { kind: 'A', address: '192.0.2.1' })];

    const unsupportedRdata = Buffer.concat([Buffer.from([0x01, 0x01, 0x03, 0xfd]), Buffer.alloc(32, 1)]);
    const unsupportedKey = record('example.test', DNS_TYPE_DNSKEY, unsupportedRdata, {
      kind: 'DNSKEY', flags: 257, protocol: 3, algorithm: 253, publicKey: Buffer.alloc(32, 1),
    });
    const unsupportedSignature = unsignedSignatureRecord(owner, DNS_TYPE_A, 'example.test', unsupportedKey, 253);
    assert.equal(verifyRrset(responseObject(owner, DNS_TYPE_A, [...rrset, unsupportedSignature]), owner, DNS_TYPE_A, [unsupportedKey], 'example.test', new Date(OBSERVED_AT)).state, 'unsupported');

    const malformedRdata = Buffer.from([0x01, 0x01, 0x03, 0x0d, 0x01]);
    const malformedKey = record('example.test', DNS_TYPE_DNSKEY, malformedRdata, {
      kind: 'DNSKEY', flags: 257, protocol: 3, algorithm: 13, publicKey: Buffer.from([1]),
    });
    const malformedSignature = unsignedSignatureRecord(owner, DNS_TYPE_A, 'example.test', malformedKey, 13);
    assert.equal(verifyRrset(responseObject(owner, DNS_TYPE_A, [...rrset, malformedSignature]), owner, DNS_TYPE_A, [malformedKey], 'example.test', new Date(OBSERVED_AT)).state, 'bogus');

    const validKey = keyFixture('example.test');
    const wildcardSignature = signatureRecord(owner, DNS_TYPE_A, 'example.test', validKey.record, validKey.privateKey, rrset, false, 'answer', { labels: 2 });
    const wildcard = verifyRrset(responseObject(owner, DNS_TYPE_A, [...rrset, wildcardSignature]), owner, DNS_TYPE_A, [validKey.record], 'example.test', new Date(OBSERVED_AT));
    assert.equal(wildcard.state, 'unsupported');
    assert.match(wildcard.detail, /wildcard-expanded/u);
  });

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

  test('ignores SHA-1 DS when an authenticated SHA-256 DS is also present', async () => {
    const validate = async (fixture: ReturnType<typeof secureFixture>) => validateDnssecChain({
      ownedOrAuthorized: true,
      target: 'example.test',
      resolver: RESOLVER,
      trustAnchor: fixture.anchor,
      observedAt: OBSERVED_AT,
      sessionOptions: { exchange: fixture.exchange, now: () => 0 },
    });

    const mixed = secureFixture(false, (owner, key) => [
      dsRecordWithDigest(owner, key, 1),
      dsRecordWithDigest(owner, key, 2, true),
    ]);
    const mixedReport = await validate(mixed);
    assert.equal(mixedReport.state, 'bogus');
    assert.equal(mixedReport.failure?.stage, 'dnskey:example.test');

    const sha1Only = secureFixture(false, (owner, key) => [dsRecordWithDigest(owner, key, 1)]);
    assert.equal((await validate(sha1Only)).state, 'secure');

    const sha256 = secureFixture(false, (owner, key) => [dsRecordWithDigest(owner, key, 2)]);
    assert.equal((await validate(sha256)).state, 'secure');
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
    const nsecRdata = Buffer.concat([wireName('NeXt.TeSt'), Buffer.from([0, 1, 0x20])]);
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

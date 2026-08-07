import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fc from 'fast-check';
import {
  MAX_SERVICE_BINDING_RECORDS,
  ServiceBindingDnsError,
  buildServiceBindingDnsQuery,
  formatIpv6,
  parseResolverEndpoint,
  parseServiceBindingDnsResponse,
  resolveServiceBindingRecords,
} from '../lib/service-binding-dns.mts';
import type {
  ResolverEndpoint,
  ServiceBindingRecordType,
} from '../lib/service-binding-dns.mts';
import { fastCheckParameters } from './helpers/fast-check-config.mts';
import { requiredValue } from './value-assertions.mts';

type WireAnswer = {
  rdata: Buffer;
  type?: number;
  ttl?: number;
  owner?: string;
};
type WireResponseOptions = {
  id?: number;
  name?: string;
  type?: number;
  flags?: number;
  answers?: WireAnswer[];
};

function dnsName(name: string): Buffer {
  if (name === '.') return Buffer.from([0]);
  return Buffer.concat([
    ...name.split('.').map((label) => {
      const bytes = Buffer.from(label, 'ascii');
      return Buffer.concat([Buffer.from([bytes.length]), bytes]);
    }),
    Buffer.from([0]),
  ]);
}

function serviceParameter(key: number, value: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(key, 0);
  header.writeUInt16BE(value.length, 2);
  return Buffer.concat([header, value]);
}

function u16(...values: number[]): Buffer {
  const output = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => output.writeUInt16BE(value, index * 2));
  return output;
}

function serviceRdata(priority: number, target: string, parameters: Buffer[] = []): Buffer {
  const header = Buffer.alloc(2);
  header.writeUInt16BE(priority, 0);
  return Buffer.concat([header, dnsName(target), ...parameters]);
}

function response({
  id = 0x1234,
  name = 'example.test',
  type = 65,
  flags = 0x8180,
  answers = [],
}: WireResponseOptions): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answers.length, 6);
  const question = Buffer.concat([dnsName(name), u16(type, 1)]);
  const records = answers.map((answer) => {
    const rdata = answer.rdata;
    const fixed = Buffer.alloc(10);
    fixed.writeUInt16BE(answer.type || type, 0);
    fixed.writeUInt16BE(1, 2);
    fixed.writeUInt32BE(answer.ttl ?? 300, 4);
    fixed.writeUInt16BE(rdata.length, 8);
    return Buffer.concat([
      answer.owner ? dnsName(answer.owner) : Buffer.from([0xc0, 0x0c]),
      fixed,
      rdata,
    ]);
  });
  return Buffer.concat([header, question, ...records]);
}

test('builds deterministic HTTPS and SVCB DNS wire questions', () => {
  const https = buildServiceBindingDnsQuery('Example.Test.', 'HTTPS', 0x1234);
  const svcb = buildServiceBindingDnsQuery('_8443._fixture.example.test', 'SVCB', 0xabcd);
  assert.equal(https.readUInt16BE(0), 0x1234);
  assert.equal(https.readUInt16BE(2), 0x0100);
  assert.equal(https.readUInt16BE(https.length - 4), 65);
  assert.equal(svcb.readUInt16BE(0), 0xabcd);
  assert.equal(svcb.readUInt16BE(svcb.length - 4), 64);
  assert.throws(
    () => buildServiceBindingDnsQuery('bad name.example', 'HTTPS', 1),
    /invalid dns service-binding query name/i,
  );
});

test('parses bounded service-mode HTTPS parameters without retaining opaque values', () => {
  const alpn = Buffer.from([2, 0x68, 0x32, 2, 0x68, 0x33]);
  const ipv4 = Buffer.from([192, 0, 2, 10]);
  const ipv6 = Buffer.from('20010db8000000000000000000000010', 'hex');
  const message = response({
    answers: [{
      rdata: serviceRdata(1, '.', [
        serviceParameter(0, u16(1, 3)),
        serviceParameter(1, alpn),
        serviceParameter(3, u16(8443)),
        serviceParameter(4, ipv4),
        serviceParameter(5, Buffer.from('private-ech-material')),
        serviceParameter(6, ipv6),
      ]),
    }],
  });
  const result = parseServiceBindingDnsResponse(message, {
    transactionId: 0x1234,
    name: 'example.test',
    type: 'HTTPS',
  });
  assert.equal(result.rcode, 0);
  assert.equal(result.truncated, false);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], {
    type: 'HTTPS',
    owner: 'example.test',
    ttl: 300,
    priority: 1,
    mode: 'service',
    target: 'example.test',
    targetIsOwner: true,
    serviceUnavailable: false,
    compatible: true,
    parametersIgnored: false,
    parameters: {
      mandatory: [1, 3],
      alpn: ['h2', 'h3'],
      noDefaultAlpn: false,
      port: 8443,
      ipv4hint: ['192.0.2.10'],
      ipv6hint: ['2001:db8::10'],
      opaque: [{ key: 5, name: 'ech', length: 20 }],
      unknownKeys: [],
      unsupportedMandatoryKeys: [],
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /private-ech-material/);
});

test('preserves alias mode and advisory unavailable state without following either', () => {
  const alias = response({
    answers: [{
      rdata: serviceRdata(0, 'service.example.test', [
        serviceParameter(3, u16(9443)),
      ]),
    }, {
      rdata: serviceRdata(0, '.'),
    }],
  });
  const result = parseServiceBindingDnsResponse(alias, {
    transactionId: 0x1234,
    name: 'example.test',
    type: 'HTTPS',
  });
  assert.equal(requiredValue(result.records[0]).target, null);
  assert.equal(requiredValue(result.records[0]).serviceUnavailable, true);
  assert.equal(requiredValue(result.records[1]).target, 'service.example.test');
  assert.equal(requiredValue(result.records[1]).parametersIgnored, true);
  assert.equal(requiredValue(result.records[1]).parameters.port, null);
});

test('rejects malformed parameter ordering, values, and inconsistent requirements', () => {
  const cases = [
    serviceRdata(1, '.', [
      serviceParameter(3, u16(443)),
      serviceParameter(1, Buffer.from([2, 0x68, 0x32])),
    ]),
    serviceRdata(1, '.', [serviceParameter(2, Buffer.alloc(0))]),
    serviceRdata(1, '.', [serviceParameter(3, Buffer.from([1]))]),
    serviceRdata(1, '.', [
      serviceParameter(0, u16(4)),
      serviceParameter(1, Buffer.from([2, 0x68, 0x32])),
    ]),
  ];
  for (const rdata of cases) {
    assert.throws(() => parseServiceBindingDnsResponse(response({
      answers: [{ rdata }],
    }), {
      transactionId: 0x1234,
      name: 'example.test',
      type: 'HTTPS',
    }), ServiceBindingDnsError);
  }
});

test('caps service-binding records and reports the retained inventory as truncated', () => {
  const answers = Array.from({ length: MAX_SERVICE_BINDING_RECORDS + 2 }, (_, index) => ({
    rdata: serviceRdata(index + 1, `target-${index}.example.test`),
  }));
  const result = parseServiceBindingDnsResponse(response({ answers }), {
    transactionId: 0x1234,
    name: 'example.test',
    type: 'HTTPS',
  });
  assert.equal(result.records.length, MAX_SERVICE_BINDING_RECORDS);
  assert.equal(result.truncated, true);
});

test('uses only normalized system resolver endpoints and retries bounded failures', async () => {
  const fixture = response({
    answers: [{ rdata: serviceRdata(1, '.', [serviceParameter(1, Buffer.from([2, 0x68, 0x32]))]) }],
  });
  const seen: ResolverEndpoint[] = [];
  const result = await resolveServiceBindingRecords('example.test', 'HTTPS', {
    transactionId: 0x1234,
    servers: ['not-a-resolver', '192.0.2.53', '[2001:db8::53]:5353'],
    exchange: async (query, resolver) => {
      seen.push(resolver);
      assert.equal(query.readUInt16BE(0), 0x1234);
      if (seen.length === 1) throw new Error('first resolver unavailable');
      return fixture;
    },
  });
  assert.deepEqual(seen, [
    { address: '192.0.2.53', port: 53, family: 4 },
    { address: '2001:db8::53', port: 5353, family: 6 },
  ]);
  assert.equal(requiredValue(result.records[0]).parameters.alpn[0], 'h2');
  assert.deepEqual(parseResolverEndpoint('resolver.example.test'), null);
});

test('uses injected TCP fallback only for a truncated response from the same resolver', async () => {
  const truncated = response({ flags: 0x8380 });
  const complete = response({ answers: [{ rdata: serviceRdata(1, '.') }] });
  let tcpCalls = 0;
  const result = await resolveServiceBindingRecords('example.test', 'HTTPS', {
    transactionId: 0x1234,
    servers: ['192.0.2.53'],
    exchange: async () => truncated,
    tcpExchange: async (_query, resolver) => {
      tcpCalls += 1;
      assert.equal(resolver.address, '192.0.2.53');
      return complete;
    },
  });
  assert.equal(tcpCalls, 1);
  assert.equal(result.records.length, 1);
});

test('maps authoritative no-data and NXDOMAIN responses to stable missing states', async () => {
  await assert.rejects(
    resolveServiceBindingRecords('example.test', 'HTTPS', {
      transactionId: 0x1234,
      servers: ['192.0.2.53'],
      exchange: async () => response({}),
    }),
    (error: unknown) => error instanceof ServiceBindingDnsError && error.code === 'ENODATA',
  );
  await assert.rejects(
    resolveServiceBindingRecords('example.test', 'HTTPS', {
      transactionId: 0x1234,
      servers: ['192.0.2.53'],
      exchange: async () => response({ flags: 0x8183 }),
    }),
    (error: unknown) => error instanceof ServiceBindingDnsError && error.code === 'ENOTFOUND',
  );
});

test('property checks keep arbitrary DNS input deterministic, bounded, and terminating', () => {
  fc.assert(fc.property(
    fc.uint8Array({ maxLength: 2048 }),
    (bytes: Uint8Array) => {
      const expected: { transactionId: number; name: string; type: ServiceBindingRecordType } = {
        transactionId: 0x1234,
        name: 'example.test',
        type: 'HTTPS',
      };
      let first;
      let second;
      try {
        first = parseServiceBindingDnsResponse(bytes, expected);
        second = parseServiceBindingDnsResponse(bytes, expected);
        assert.deepEqual(first, second);
        assert.ok(first.records.length <= MAX_SERVICE_BINDING_RECORDS);
      } catch (error) {
        assert.ok(error instanceof ServiceBindingDnsError);
        assert.ok(error.message.length <= 180);
      }
    },
  ), fastCheckParameters(600));
});

test('property checks format all 16-byte IPv6 hints as valid addresses', () => {
  fc.assert(fc.property(
    fc.uint8Array({ minLength: 16, maxLength: 16 }),
    (bytes: Uint8Array) => assert.equal(net.isIP(formatIpv6(Buffer.from(bytes))), 6),
  ), fastCheckParameters(600));
});

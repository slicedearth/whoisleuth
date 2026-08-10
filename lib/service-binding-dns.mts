// Bounded DNS wire support for RFC 9460 HTTPS and SVCB records.
//
// Node's DNS resolver does not expose RR types 64 or 65. This module sends one
// ordinary recursive query to a system-configured DNS server, retries only
// across that bounded trusted resolver list, and falls back to DNS-over-TCP
// only when the same resolver sets the truncated bit. Published service
// parameters are evidence only; they are never used as connection targets.

import { randomInt } from 'node:crypto';
import { getServers } from 'node:dns';
import { createSocket } from 'node:dgram';
import { createConnection, isIP } from 'node:net';

type ServiceBindingRecordType = 'SVCB' | 'HTTPS';
type ResolverEndpoint = {
  address: string;
  port: number;
  family: 4 | 6;
};
type DnsExchangeOptions = {
  timeoutMs: number;
};
type DnsExchange = (
  query: Buffer,
  resolver: ResolverEndpoint,
  options: DnsExchangeOptions,
) => Promise<Buffer>;
type ResolveServiceBindingOptions = {
  exchange?: DnsExchange;
  tcpExchange?: DnsExchange;
  servers?: string[];
  timeoutMs?: number;
  transactionId?: number;
};
type ServiceBindingParameters = {
  mandatory: number[];
  alpn: string[];
  noDefaultAlpn: boolean;
  port: number | null;
  ipv4hint: string[];
  ipv6hint: string[];
  opaque: Array<{ key: number; name: string | null; length: number }>;
  unknownKeys: number[];
  unsupportedMandatoryKeys: number[];
};
type ServiceBindingRecord = {
  type: ServiceBindingRecordType;
  owner: string;
  ttl: number;
  priority: number;
  mode: 'alias' | 'service';
  target: string | null;
  targetIsOwner: boolean;
  serviceUnavailable: boolean;
  compatible: boolean;
  parametersIgnored: boolean;
  parameters: ServiceBindingParameters;
};
type ServiceBindingResolution = {
  records: ServiceBindingRecord[];
  truncated: boolean;
};
type NameRead = { name: string; nextOffset: number };
type ParsedParameterResult = {
  parameters: ServiceBindingParameters;
  truncated: boolean;
  keys: Set<number>;
};

const SVCB_TYPE = 64;
const HTTPS_TYPE = 65;
const DNS_CLASS_IN = 1;
const DNS_HEADER_BYTES = 12;
const DNS_TIMEOUT_MS = 3500;
const MAX_DNS_MESSAGE_BYTES = 65_535;
const MAX_DNS_RESOLVERS = 3;
const MAX_DNS_RECORDS = 96;
const MAX_SERVICE_BINDING_RECORDS = 16;
const MAX_SERVICE_PARAMETERS = 24;
const MAX_MANDATORY_KEYS = 16;
const MAX_ALPN_IDS = 16;
const MAX_ALPN_DISPLAY_BYTES = 64;
const MAX_ADDRESS_HINTS = 8;
const MAX_NAME_POINTERS = 32;
const MAX_DNS_NAME_BYTES = 253;
const MAX_ERROR_LENGTH = 180;
const KNOWN_PARAMETER_NAMES = new Map<number, string>([
  [0, 'mandatory'],
  [1, 'alpn'],
  [2, 'no-default-alpn'],
  [3, 'port'],
  [4, 'ipv4hint'],
  [5, 'ech'],
  [6, 'ipv6hint'],
  [7, 'dohpath'],
  [8, 'ohttp'],
  [9, 'tls-supported-groups'],
  [10, 'docpath'],
  [11, 'pvd'],
  [12, 'oots'],
]);
const INTERPRETED_PARAMETER_KEYS = new Set([0, 1, 2, 3, 4, 6]);

class ServiceBindingDnsError extends Error {
  code: string;

  constructor(message: string, code = 'EBADRESP') {
    super(message.slice(0, MAX_ERROR_LENGTH));
    this.name = 'ServiceBindingDnsError';
    this.code = code;
  }
}

function assertRange(buffer: Buffer, offset: number, length: number, boundary = buffer.length): void {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > boundary) {
    throw new ServiceBindingDnsError('DNS response ended inside a field');
  }
}

function recordTypeCode(type: ServiceBindingRecordType): number {
  return type === 'SVCB' ? SVCB_TYPE : HTTPS_TYPE;
}

function normalizeQueryName(value: string): string {
  const name = String(value || '').trim().toLowerCase().replace(/\.+$/u, '');
  const labels = name.split('.');
  if (
    !name
    || Buffer.byteLength(name, 'ascii') > MAX_DNS_NAME_BYTES
    || labels.some((label) => !label || label.length > 63 || !/^[a-z0-9_-]+$/u.test(label))
  ) {
    throw new ServiceBindingDnsError('Invalid DNS service-binding query name', 'EINVAL');
  }
  return name;
}

function encodeDnsName(value: string): Buffer {
  const name = normalizeQueryName(value);
  const parts: Buffer[] = [];
  for (const label of name.split('.')) {
    const bytes = Buffer.from(label, 'ascii');
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function buildServiceBindingDnsQuery(
  name: string,
  type: ServiceBindingRecordType,
  transactionId = randomInt(0x1_0000),
): Buffer {
  if (!Number.isInteger(transactionId) || transactionId < 0 || transactionId > 0xffff) {
    throw new ServiceBindingDnsError('Invalid DNS transaction identifier', 'EINVAL');
  }
  const qname = encodeDnsName(name);
  const message = Buffer.alloc(DNS_HEADER_BYTES + qname.length + 4);
  message.writeUInt16BE(transactionId, 0);
  message.writeUInt16BE(0x0100, 2);
  message.writeUInt16BE(1, 4);
  qname.copy(message, DNS_HEADER_BYTES);
  message.writeUInt16BE(recordTypeCode(type), DNS_HEADER_BYTES + qname.length);
  message.writeUInt16BE(DNS_CLASS_IN, DNS_HEADER_BYTES + qname.length + 2);
  return message;
}

function decodeDnsName(
  message: Buffer,
  startOffset: number,
  boundary = message.length,
  allowCompression = true,
): NameRead {
  const labels: string[] = [];
  const pointers = new Set<number>();
  let offset = startOffset;
  let nextOffset: number | null = null;
  let encodedBytes = 0;

  while (true) {
    assertRange(message, offset, 1, boundary);
    const length = message[offset] as number;
    if ((length & 0xc0) === 0xc0) {
      if (!allowCompression) throw new ServiceBindingDnsError('Compressed SVCB target name is malformed');
      assertRange(message, offset, 2, boundary);
      const pointer = ((length & 0x3f) << 8) | (message[offset + 1] as number);
      if (pointer >= message.length || pointers.has(pointer) || pointers.size >= MAX_NAME_POINTERS) {
        throw new ServiceBindingDnsError('DNS name compression loop or invalid pointer');
      }
      pointers.add(pointer);
      if (nextOffset === null) nextOffset = offset + 2;
      offset = pointer;
      continue;
    }
    if ((length & 0xc0) !== 0) throw new ServiceBindingDnsError('DNS name label uses an unsupported encoding');
    offset += 1;
    if (length === 0) {
      if (nextOffset === null) nextOffset = offset;
      break;
    }
    if (length > 63) throw new ServiceBindingDnsError('DNS name label is too long');
    assertRange(message, offset, length, boundary);
    encodedBytes += length + 1;
    if (encodedBytes > MAX_DNS_NAME_BYTES + 1) throw new ServiceBindingDnsError('DNS name is too long');
    const bytes = message.subarray(offset, offset + length);
    if ([...bytes].some((byte) => byte < 0x21 || byte > 0x7e)) {
      throw new ServiceBindingDnsError('DNS name contains an unsafe label byte');
    }
    const label = bytes.toString('ascii').toLowerCase();
    if (!/^[a-z0-9_-]+$/u.test(label)) {
      throw new ServiceBindingDnsError('DNS name contains an unsupported label');
    }
    labels.push(label);
    offset += length;
  }

  return { name: labels.length ? labels.join('.') : '.', nextOffset: nextOffset as number };
}

function formatIpv4(bytes: Buffer): string {
  return [...bytes].join('.');
}

function formatIpv6(bytes: Buffer): string {
  if (bytes.length !== 16) throw new ServiceBindingDnsError('Invalid IPv6 hint length');
  const groups = Array.from({ length: 8 }, (_, index) => bytes.readUInt16BE(index * 2));
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestStart === -1) return groups.map((group) => group.toString(16)).join(':');
  const left = groups.slice(0, bestStart).map((group) => group.toString(16)).join(':');
  const right = groups.slice(bestStart + bestLength).map((group) => group.toString(16)).join(':');
  return `${left}::${right}`;
}

function boundedPush<T>(target: T[], value: T, limit: number): boolean {
  if (target.length >= limit) return true;
  target.push(value);
  return false;
}

function displayAlpn(value: Buffer): string | null {
  if (!value.length || value.length > MAX_ALPN_DISPLAY_BYTES) return null;
  if ([...value].every((byte) => byte >= 0x21 && byte <= 0x7e)) return value.toString('ascii');
  return `hex:${value.toString('hex')}`;
}

function parseServiceParameters(
  message: Buffer,
  startOffset: number,
  endOffset: number,
): ParsedParameterResult {
  const parameters: ServiceBindingParameters = {
    mandatory: [],
    alpn: [],
    noDefaultAlpn: false,
    port: null,
    ipv4hint: [],
    ipv6hint: [],
    opaque: [],
    unknownKeys: [],
    unsupportedMandatoryKeys: [],
  };
  const keys = new Set<number>();
  let offset = startOffset;
  let previousKey = -1;
  let truncated = false;
  let parameterCount = 0;

  while (offset < endOffset) {
    assertRange(message, offset, 4, endOffset);
    const key = message.readUInt16BE(offset);
    const length = message.readUInt16BE(offset + 2);
    offset += 4;
    assertRange(message, offset, length, endOffset);
    if (key <= previousKey) throw new ServiceBindingDnsError('SVCB parameter keys are not strictly increasing');
    previousKey = key;
    keys.add(key);
    parameterCount += 1;
    if (parameterCount > MAX_SERVICE_PARAMETERS) truncated = true;
    const value = message.subarray(offset, offset + length);
    offset += length;

    if (key === 0) {
      if (!length || length % 2 !== 0) throw new ServiceBindingDnsError('Invalid mandatory SVCB parameter');
      let priorMandatory = -1;
      for (let index = 0; index < length; index += 2) {
        const mandatoryKey = value.readUInt16BE(index);
        if (mandatoryKey === 0 || mandatoryKey <= priorMandatory) {
          throw new ServiceBindingDnsError('Invalid mandatory SVCB key list');
        }
        priorMandatory = mandatoryKey;
        truncated = boundedPush(parameters.mandatory, mandatoryKey, MAX_MANDATORY_KEYS) || truncated;
      }
      continue;
    }
    if (key === 1) {
      if (!length) throw new ServiceBindingDnsError('Invalid empty ALPN SVCB parameter');
      let alpnOffset = 0;
      while (alpnOffset < value.length) {
        const alpnLength = value[alpnOffset] as number;
        alpnOffset += 1;
        if (!alpnLength || alpnOffset + alpnLength > value.length) {
          throw new ServiceBindingDnsError('Invalid ALPN SVCB parameter');
        }
        const alpn = displayAlpn(value.subarray(alpnOffset, alpnOffset + alpnLength));
        if (alpn) truncated = boundedPush(parameters.alpn, alpn, MAX_ALPN_IDS) || truncated;
        else truncated = true;
        alpnOffset += alpnLength;
      }
      continue;
    }
    if (key === 2) {
      if (length !== 0) throw new ServiceBindingDnsError('Invalid no-default-alpn SVCB parameter');
      parameters.noDefaultAlpn = true;
      continue;
    }
    if (key === 3) {
      if (length !== 2) throw new ServiceBindingDnsError('Invalid port SVCB parameter');
      parameters.port = value.readUInt16BE(0);
      continue;
    }
    if (key === 4) {
      if (!length || length % 4 !== 0) throw new ServiceBindingDnsError('Invalid IPv4 hint SVCB parameter');
      for (let index = 0; index < length; index += 4) {
        truncated = boundedPush(
          parameters.ipv4hint,
          formatIpv4(value.subarray(index, index + 4)),
          MAX_ADDRESS_HINTS,
        ) || truncated;
      }
      continue;
    }
    if (key === 6) {
      if (!length || length % 16 !== 0) throw new ServiceBindingDnsError('Invalid IPv6 hint SVCB parameter');
      for (let index = 0; index < length; index += 16) {
        truncated = boundedPush(
          parameters.ipv6hint,
          formatIpv6(value.subarray(index, index + 16)),
          MAX_ADDRESS_HINTS,
        ) || truncated;
      }
      continue;
    }

    const opaque = {
      key,
      name: KNOWN_PARAMETER_NAMES.get(key) || null,
      length,
    };
    if (KNOWN_PARAMETER_NAMES.has(key)) {
      truncated = boundedPush(parameters.opaque, opaque, MAX_SERVICE_PARAMETERS) || truncated;
    } else {
      truncated = boundedPush(parameters.unknownKeys, key, MAX_SERVICE_PARAMETERS) || truncated;
    }
  }

  if (parameters.noDefaultAlpn && !keys.has(1)) {
    throw new ServiceBindingDnsError('SVCB no-default-alpn parameter requires alpn');
  }
  for (const mandatoryKey of parameters.mandatory) {
    if (!keys.has(mandatoryKey)) throw new ServiceBindingDnsError('SVCB mandatory key is absent from the record');
    if (!INTERPRETED_PARAMETER_KEYS.has(mandatoryKey)) {
      parameters.unsupportedMandatoryKeys.push(mandatoryKey);
    }
  }
  return { parameters, truncated, keys };
}

function emptyParameters(): ServiceBindingParameters {
  return {
    mandatory: [],
    alpn: [],
    noDefaultAlpn: false,
    port: null,
    ipv4hint: [],
    ipv6hint: [],
    opaque: [],
    unknownKeys: [],
    unsupportedMandatoryKeys: [],
  };
}

function parseServiceBindingRecord(
  message: Buffer,
  owner: string,
  type: ServiceBindingRecordType,
  ttl: number,
  rdataOffset: number,
  rdataEnd: number,
): { record: ServiceBindingRecord; truncated: boolean } {
  assertRange(message, rdataOffset, 3, rdataEnd);
  const priority = message.readUInt16BE(rdataOffset);
  const targetResult = decodeDnsName(message, rdataOffset + 2, rdataEnd, false);
  if (targetResult.nextOffset > rdataEnd) throw new ServiceBindingDnsError('SVCB target exceeds its record');
  const parsed = parseServiceParameters(message, targetResult.nextOffset, rdataEnd);
  const mode = priority === 0 ? 'alias' : 'service';
  const targetIsRoot = targetResult.name === '.';
  const parametersIgnored = mode === 'alias' && parsed.keys.size > 0;
  const parameters = parametersIgnored ? emptyParameters() : parsed.parameters;
  const target = targetIsRoot
    ? mode === 'service' ? owner : null
    : targetResult.name;

  return {
    record: {
      type,
      owner,
      ttl,
      priority,
      mode,
      target,
      targetIsOwner: mode === 'service' && targetIsRoot,
      serviceUnavailable: mode === 'alias' && targetIsRoot,
      compatible: mode === 'alias' || parameters.unsupportedMandatoryKeys.length === 0,
      parametersIgnored,
      parameters,
    },
    truncated: parsed.truncated,
  };
}

function parseServiceBindingDnsResponse(
  messageValue: Uint8Array,
  expected: {
    transactionId: number;
    name: string;
    type: ServiceBindingRecordType;
  },
): ServiceBindingResolution & { truncatedResponse: boolean; rcode: number } {
  const message = Buffer.from(messageValue);
  if (message.length < DNS_HEADER_BYTES || message.length > MAX_DNS_MESSAGE_BYTES) {
    throw new ServiceBindingDnsError('DNS response size is invalid');
  }
  const transactionId = message.readUInt16BE(0);
  const flags = message.readUInt16BE(2);
  const questionCount = message.readUInt16BE(4);
  const answerCount = message.readUInt16BE(6);
  const authorityCount = message.readUInt16BE(8);
  const additionalCount = message.readUInt16BE(10);
  const recordCount = answerCount + authorityCount + additionalCount;
  if (transactionId !== expected.transactionId || (flags & 0x8000) === 0 || (flags & 0x7800) !== 0) {
    throw new ServiceBindingDnsError('DNS response header does not match the query');
  }
  if (questionCount !== 1 || recordCount > MAX_DNS_RECORDS) {
    throw new ServiceBindingDnsError('DNS response record count is invalid');
  }

  let offset = DNS_HEADER_BYTES;
  const question = decodeDnsName(message, offset);
  offset = question.nextOffset;
  assertRange(message, offset, 4);
  const questionType = message.readUInt16BE(offset);
  const questionClass = message.readUInt16BE(offset + 2);
  offset += 4;
  if (
    question.name !== normalizeQueryName(expected.name)
    || questionType !== recordTypeCode(expected.type)
    || questionClass !== DNS_CLASS_IN
  ) {
    throw new ServiceBindingDnsError('DNS response question does not match the query');
  }

  const records: ServiceBindingRecord[] = [];
  let truncated = false;
  for (let index = 0; index < recordCount; index += 1) {
    const ownerResult = decodeDnsName(message, offset);
    offset = ownerResult.nextOffset;
    assertRange(message, offset, 10);
    const rrType = message.readUInt16BE(offset);
    const rrClass = message.readUInt16BE(offset + 2);
    const ttl = message.readUInt32BE(offset + 4);
    const rdataLength = message.readUInt16BE(offset + 8);
    offset += 10;
    const rdataEnd = offset + rdataLength;
    assertRange(message, offset, rdataLength);

    if (
      index < answerCount
      && rrType === recordTypeCode(expected.type)
      && rrClass === DNS_CLASS_IN
    ) {
      const parsed = parseServiceBindingRecord(
        message,
        ownerResult.name,
        expected.type,
        ttl,
        offset,
        rdataEnd,
      );
      truncated = parsed.truncated || truncated;
      if (records.length < MAX_SERVICE_BINDING_RECORDS) records.push(parsed.record);
      else truncated = true;
    }
    offset = rdataEnd;
  }
  if (offset !== message.length) throw new ServiceBindingDnsError('DNS response has trailing bytes');

  const unique = new Map<string, ServiceBindingRecord>();
  for (const record of records) unique.set(JSON.stringify(record), record);
  const sorted = [...unique.values()].sort((left, right) => (
    left.priority - right.priority
    || left.owner.localeCompare(right.owner)
    || String(left.target).localeCompare(String(right.target))
    || left.ttl - right.ttl
  ));
  return {
    records: sorted,
    truncated,
    truncatedResponse: (flags & 0x0200) !== 0,
    rcode: flags & 0x000f,
  };
}

function parseResolverEndpoint(value: string): ResolverEndpoint | null {
  const server = String(value || '').trim();
  if (!server) return null;
  const directFamily = isIP(server);
  if (directFamily === 4 || directFamily === 6) {
    return { address: server, port: 53, family: directFamily };
  }
  const bracketed = server.match(/^\[([^\]]+)\]:(\d{1,5})$/u);
  if (bracketed && isIP(bracketed[1] as string) === 6) {
    const port = Number(bracketed[2]);
    return port >= 1 && port <= 65535
      ? { address: bracketed[1] as string, port, family: 6 }
      : null;
  }
  const ipv4Port = server.match(/^([^:]+):(\d{1,5})$/u);
  if (ipv4Port && isIP(ipv4Port[1] as string) === 4) {
    const port = Number(ipv4Port[2]);
    return port >= 1 && port <= 65535
      ? { address: ipv4Port[1] as string, port, family: 4 }
      : null;
  }
  return null;
}

function defaultTcpExchange(
  query: Buffer,
  resolver: ResolverEndpoint,
  options: DnsExchangeOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: resolver.address,
      port: resolver.port,
      family: resolver.family,
    });
    const chunks: Buffer[] = [];
    let totalLength = 0;
    let settled = false;
    let hardDeadline: NodeJS.Timeout | null = null;
    const finish = (error?: unknown, response?: Buffer) => {
      if (settled) return;
      settled = true;
      if (hardDeadline) clearTimeout(hardDeadline);
      socket.destroy();
      if (error) reject(error);
      else resolve(response as Buffer);
    };
    hardDeadline = setTimeout(
      () => finish(new ServiceBindingDnsError('DNS TCP query timed out', 'ETIMEOUT')),
      options.timeoutMs,
    );
    hardDeadline.unref();
    socket.setTimeout(options.timeoutMs, () => finish(new ServiceBindingDnsError('DNS TCP query timed out', 'ETIMEOUT')));
    socket.once('error', (error) => finish(error));
    socket.on('data', (chunk: Buffer) => {
      totalLength += chunk.length;
      if (totalLength > MAX_DNS_MESSAGE_BYTES + 2) {
        finish(new ServiceBindingDnsError('DNS TCP response exceeds the size limit'));
        return;
      }
      chunks.push(chunk);
      const buffered = Buffer.concat(chunks, totalLength);
      if (buffered.length < 2) return;
      const expectedLength = buffered.readUInt16BE(0);
      if (!expectedLength || expectedLength > MAX_DNS_MESSAGE_BYTES) {
        finish(new ServiceBindingDnsError('DNS TCP response length is invalid'));
        return;
      }
      if (buffered.length >= expectedLength + 2) {
        if (buffered.length !== expectedLength + 2) {
          finish(new ServiceBindingDnsError('DNS TCP response has trailing bytes'));
          return;
        }
        finish(undefined, buffered.subarray(2));
      }
    });
    socket.once('connect', () => {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(query.length, 0);
      socket.write(Buffer.concat([length, query]));
    });
  });
}

function defaultDnsExchange(
  query: Buffer,
  resolver: ResolverEndpoint,
  options: DnsExchangeOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(resolver.family === 6 ? 'udp6' : 'udp4');
    let settled = false;
    const timer = setTimeout(() => {
      finish(new ServiceBindingDnsError('DNS UDP query timed out', 'ETIMEOUT'));
    }, options.timeoutMs);
    const finish = (error?: unknown, response?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // A synchronous send failure can occur before the UDP socket binds.
      }
      if (error) reject(error);
      else resolve(response as Buffer);
    };
    socket.once('error', (error) => finish(error));
    socket.once('message', (message) => {
      if (message.length > MAX_DNS_MESSAGE_BYTES) {
        finish(new ServiceBindingDnsError('DNS UDP response exceeds the size limit'));
      } else {
        finish(undefined, Buffer.from(message));
      }
    });
    socket.connect(resolver.port, resolver.address, () => {
      socket.send(query, (error) => {
        if (error) finish(error);
      });
    });
  });
}

function isTruncatedDnsResponse(message: Buffer, transactionId: number): boolean {
  return message.length >= DNS_HEADER_BYTES
    && message.length <= MAX_DNS_MESSAGE_BYTES
    && message.readUInt16BE(0) === transactionId
    && (message.readUInt16BE(2) & 0x8200) === 0x8200;
}

function missingResponseError(rcode: number): ServiceBindingDnsError | null {
  if (rcode === 0) return null;
  if (rcode === 3) return new ServiceBindingDnsError('DNS name does not exist', 'ENOTFOUND');
  const names: Record<number, string> = {
    1: 'format error',
    2: 'server failure',
    4: 'not implemented',
    5: 'query refused',
  };
  return new ServiceBindingDnsError(`DNS resolver returned ${names[rcode] || `rcode ${rcode}`}`, 'EDNSFAIL');
}

async function resolveServiceBindingRecords(
  nameValue: string,
  type: ServiceBindingRecordType,
  options: ResolveServiceBindingOptions = {},
): Promise<ServiceBindingResolution> {
  const name = normalizeQueryName(nameValue);
  const transactionId = options.transactionId ?? randomInt(0x1_0000);
  const query = buildServiceBindingDnsQuery(name, type, transactionId);
  const timeoutMs = Math.max(250, Math.min(10_000, Number(options.timeoutMs) || DNS_TIMEOUT_MS));
  const resolvers = [...new Set((options.servers || getServers())
    .map(parseResolverEndpoint)
    .filter((value): value is ResolverEndpoint => value !== null)
    .map((value) => JSON.stringify(value)))]
    .slice(0, MAX_DNS_RESOLVERS)
    .map((value) => JSON.parse(value) as ResolverEndpoint);
  if (!resolvers.length) throw new ServiceBindingDnsError('No eligible system DNS resolver is configured', 'ENODATA');

  const exchange = options.exchange || defaultDnsExchange;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (const resolver of resolvers) {
    const udpTimeoutMs = deadline - Date.now();
    if (udpTimeoutMs <= 0) break;
    try {
      let response = await exchange(query, resolver, { timeoutMs: udpTimeoutMs });
      if (isTruncatedDnsResponse(response, transactionId)) {
        const tcpTimeoutMs = deadline - Date.now();
        if (tcpTimeoutMs <= 0) {
          throw new ServiceBindingDnsError('DNS service-binding query timed out', 'ETIMEOUT');
        }
        response = await (options.tcpExchange || defaultTcpExchange)(
          query,
          resolver,
          { timeoutMs: tcpTimeoutMs },
        );
      }
      const parsed = parseServiceBindingDnsResponse(response, { transactionId, name, type });
      if (parsed.truncatedResponse) throw new ServiceBindingDnsError('DNS TCP response is still truncated');
      const responseError = missingResponseError(parsed.rcode);
      if (responseError) throw responseError;
      if (!parsed.records.length) throw new ServiceBindingDnsError('No service-binding records were returned', 'ENODATA');
      return { records: parsed.records, truncated: parsed.truncated };
    } catch (error) {
      lastError = error;
      const code = error && typeof error === 'object' ? String((error as { code?: unknown }).code || '') : '';
      if (code === 'ENODATA' || code === 'ENOTFOUND') throw error;
    }
  }
  if (Date.now() >= deadline) {
    throw new ServiceBindingDnsError('DNS service-binding query timed out', 'ETIMEOUT');
  }
  const detail = String(lastError instanceof Error ? lastError.message : lastError || 'DNS query failed')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .slice(0, MAX_ERROR_LENGTH);
  throw new ServiceBindingDnsError(detail || 'DNS query failed', 'EDNSFAIL');
}

export {
  DNS_TIMEOUT_MS as SERVICE_BINDING_DNS_TIMEOUT_MS,
  HTTPS_TYPE,
  MAX_DNS_MESSAGE_BYTES,
  MAX_SERVICE_BINDING_RECORDS,
  SVCB_TYPE,
  ServiceBindingDnsError,
  buildServiceBindingDnsQuery,
  defaultTcpExchange,
  formatIpv6,
  parseResolverEndpoint,
  parseServiceBindingDnsResponse,
  resolveServiceBindingRecords,
};

export type {
  DnsExchange,
  ResolveServiceBindingOptions,
  ResolverEndpoint,
  ServiceBindingRecord,
  ServiceBindingRecordType,
  ServiceBindingResolution,
};

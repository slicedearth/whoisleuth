import net from 'node:net';
import { domainToASCII } from 'node:url';

import { ipv4ToLong, ipv6ToBigInt } from './rdap-bootstrap.mts';
import type { NormalizedRdapRecord } from './rdap-types.mts';

export function canonicalRdapDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ascii = domainToASCII(value.trim().replace(/\.+$/, ''));
  return ascii ? ascii.toLowerCase() : null;
}

function ipv6ToComparableBigInt(ip: string): bigint | null {
  let normalized = ip;
  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':');
    const embedded = ip.slice(lastColon + 1);
    if (net.isIP(embedded) !== 4) return null;
    const value = ipv4ToLong(embedded);
    normalized = `${ip.slice(0, lastColon)}:${(value >>> 16).toString(16)}:${(
      value & 0xffff
    ).toString(16)}`;
  }
  try {
    return ipv6ToBigInt(normalized);
  } catch {
    return null;
  }
}

export function validateRdapResponse(
  type: string,
  requestedValue: string,
  parsed: NormalizedRdapRecord | null,
) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, detail: 'The response did not contain a usable RDAP object.' };
  }

  const expectedClass = type === 'domain' ? 'domain' : type === 'asn' ? 'autnum' : 'ip network';
  if (parsed.objectClassName && parsed.objectClassName !== expectedClass) {
    return {
      valid: false,
      detail: `Expected object class ${expectedClass}, received ${parsed.objectClassName}.`,
    };
  }

  if (type === 'domain') {
    if (!('domain' in parsed)) {
      return { valid: false, detail: 'The response did not contain a domain RDAP object.' };
    }
    const requested = canonicalRdapDomain(requestedValue);
    const returned = canonicalRdapDomain(parsed.domain);
    if (!requested || !returned || requested !== returned) {
      return { valid: false, detail: 'The response domain did not match the requested domain.' };
    }
    return { valid: true, detail: null };
  }

  if (type === 'asn') {
    if (!('startAutnum' in parsed)) {
      return { valid: false, detail: 'The response did not contain an autnum RDAP object.' };
    }
    const requested = Number(String(requestedValue).replace(/^AS/i, ''));
    const startAutnum = parsed.startAutnum;
    const endAutnum = parsed.endAutnum;
    if (
      !Number.isSafeInteger(requested) ||
      typeof startAutnum !== 'number' ||
      !Number.isSafeInteger(startAutnum) ||
      typeof endAutnum !== 'number' ||
      !Number.isSafeInteger(endAutnum) ||
      startAutnum > endAutnum ||
      requested < startAutnum ||
      requested > endAutnum
    ) {
      return { valid: false, detail: 'The response AS range did not cover the requested ASN.' };
    }
    return { valid: true, detail: null };
  }

  if (!('startAddress' in parsed)) {
    return { valid: false, detail: 'The response did not contain an IP network RDAP object.' };
  }
  const version = type === 'ipv4' ? 4 : 6;
  const startAddress = parsed.startAddress;
  const endAddress = parsed.endAddress;
  if (
    net.isIP(requestedValue) !== version ||
    typeof startAddress !== 'string' ||
    net.isIP(startAddress) !== version ||
    typeof endAddress !== 'string' ||
    net.isIP(endAddress) !== version
  ) {
    return { valid: false, detail: 'The response did not contain a compatible IP range.' };
  }
  const convert = version === 4 ? ipv4ToLong : ipv6ToComparableBigInt;
  const requested = convert(requestedValue);
  const start = convert(startAddress);
  const end = convert(endAddress);
  if (
    requested === null ||
    start === null ||
    end === null ||
    start > end ||
    requested < start ||
    requested > end
  ) {
    return { valid: false, detail: 'The response IP range did not cover the requested address.' };
  }
  return { valid: true, detail: null };
}

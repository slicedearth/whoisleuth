import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

import { admitRdapEndpoint, ipv4ToLong, ipv6ToBigInt } from './rdap-bootstrap.mts';
import type { NormalizedRdapRecord } from './rdap-types.mts';

export function canonicalRdapDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ascii = domainToASCII(value.trim().replace(/\.+$/, ''));
  return ascii ? ascii.toLowerCase() : null;
}

function decodedTerminalPathParts(value: string): readonly [string, string] | null {
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const objectType = decodeURIComponent(parts.at(-2) ?? '');
    const objectValue = decodeURIComponent(parts.at(-1) ?? '');
    return objectType && objectValue ? [objectType, objectValue] : null;
  } catch {
    return null;
  }
}

/**
 * Admit final RDAP provenance only when its terminal path still identifies the
 * requested object. Safe redirect transport proves where bytes came from; this
 * binding separately prevents a redirected response for another object from
 * deciding a lookup, especially when a bodyless 404 is otherwise authoritative.
 */
export function admitRdapObjectEndpoint(
  type: string,
  requestedValue: string,
  value: unknown,
): string | null {
  const admitted = admitRdapEndpoint(value);
  if (!admitted) return null;
  const terminal = decodedTerminalPathParts(admitted);
  if (!terminal) return null;
  const [objectType, objectValue] = terminal;

  if (type === 'domain') {
    const requested = canonicalRdapDomain(requestedValue);
    const selected = canonicalRdapDomain(objectValue);
    return objectType === 'domain' && requested && selected === requested ? admitted : null;
  }

  if (type === 'ipv4' || type === 'ipv6') {
    const version = type === 'ipv4' ? 4 : 6;
    if (objectType !== 'ip' || isIP(requestedValue) !== version || isIP(objectValue) !== version) return null;
    try {
      const convert = version === 4 ? ipv4ToLong : ipv6ToBigInt;
      return convert(requestedValue) === convert(objectValue) ? admitted : null;
    } catch {
      return null;
    }
  }

  if (type === 'asn') {
    const requestedMatch = /^(?:AS)?([0-9]{1,10})$/iu.exec(requestedValue);
    if (objectType !== 'autnum' || !requestedMatch || !/^[0-9]{1,10}$/u.test(objectValue)) return null;
    const requested = Number(requestedMatch[1]);
    const selected = Number(objectValue);
    return Number.isSafeInteger(requested)
      && requested >= 0
      && requested <= 4_294_967_295
      && selected === requested
      && objectValue === String(selected)
      ? admitted
      : null;
  }

  return null;
}

function ipv6ToComparableBigInt(ip: string): bigint | null {
  try {
    return ipv6ToBigInt(ip);
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
    isIP(requestedValue) !== version ||
    typeof startAddress !== 'string' ||
    isIP(startAddress) !== version ||
    typeof endAddress !== 'string' ||
    isIP(endAddress) !== version
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

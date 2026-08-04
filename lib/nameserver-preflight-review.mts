import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

import { exactKeys } from './bounded-contract-normalizers.mts';
import { isPrivateAddress } from './safe-fetch.mts';

export const NAMESERVER_PREFLIGHT_INPUT_SCHEMA = 'whoisleuth.nameserver-preflight.input';
export const NAMESERVER_PREFLIGHT_REVIEW_SCHEMA = 'whoisleuth.nameserver-preflight.review';
export const NAMESERVER_PREFLIGHT_REVIEW_VERSION = 1;
export const MAX_PREFLIGHT_NAMESERVERS = 8;
export const MAX_PREFLIGHT_ADDRESSES = 4;

type UnknownRecord = Record<string, unknown>;
type ObservationState = 'observed' | 'partial' | 'unavailable';

const ROOT_KEYS = new Set(['schema', 'version', 'domain', 'intendedNameservers', 'observations']);
const OBSERVATION_KEYS = new Set(['nameserver', 'state', 'source', 'observedAt', 'addresses', 'authoritative', 'servedNameservers', 'soaPrimary', 'soaSerial']);

function object(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as UnknownRecord;
}

function text(value: unknown, label: string, maximum = 240): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded text without control characters.`);
  }
  const normalised = value.replace(/\s+/gu, ' ').trim();
  if (!normalised || normalised.length > maximum) throw new TypeError(`${label} must contain from 1 to ${maximum} characters.`);
  return normalised;
}

function hostname(value: unknown, label: string): string {
  const ascii = domainToASCII(text(value, label, 253).toLowerCase().replace(/\.$/u, ''));
  if (!ascii || !ascii.includes('.') || ascii.length > 253 || ascii.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part))) {
    throw new TypeError(`${label} must be a valid hostname.`);
  }
  return ascii;
}

function timestamp(value: unknown, label: string): string {
  const parsed = Date.parse(text(value, label, 64));
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid timestamp.`);
  return new Date(parsed).toISOString();
}

function state(value: unknown, label: string): ObservationState {
  if (value !== 'observed' && value !== 'partial' && value !== 'unavailable') throw new TypeError(`${label} is unsupported.`);
  return value;
}

function uniqueHostnames(value: unknown, label: string, minimum = 1): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_PREFLIGHT_NAMESERVERS) {
    throw new TypeError(`${label} must contain from ${minimum} to ${MAX_PREFLIGHT_NAMESERVERS} hostnames.`);
  }
  const names = value.map((item, index) => hostname(item, `${label}[${index}]`));
  if (new Set(names).size !== names.length) throw new TypeError(`${label} must not contain duplicate hostnames.`);
  return Object.freeze(names.sort());
}

function addresses(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_PREFLIGHT_ADDRESSES) throw new TypeError(`${label} must contain no more than ${MAX_PREFLIGHT_ADDRESSES} addresses.`);
  const normalised = value.map((item, index) => {
    const supplied = text(item, `${label}[${index}]`, 80).toLowerCase();
    if (!isIP(supplied) || supplied.includes('%')) throw new TypeError(`${label}[${index}] must be an IPv4 or IPv6 address without a zone identifier.`);
    return supplied;
  });
  return Object.freeze([...new Set(normalised)].sort());
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function reviewNameserverPreflight(inputRaw: unknown, generatedAtValue = new Date().toISOString()) {
  const input = object(inputRaw, 'Nameserver preflight input');
  if (input.schema !== NAMESERVER_PREFLIGHT_INPUT_SCHEMA || input.version !== 1) {
    throw new TypeError(`Nameserver preflight input must use ${NAMESERVER_PREFLIGHT_INPUT_SCHEMA} version 1.`);
  }
  exactKeys(input, ROOT_KEYS, 'Nameserver preflight input');
  const domain = hostname(input.domain, 'domain');
  const intendedNameservers = uniqueHostnames(input.intendedNameservers, 'intendedNameservers');
  if (!Array.isArray(input.observations) || input.observations.length > MAX_PREFLIGHT_NAMESERVERS) {
    throw new TypeError(`observations must contain no more than ${MAX_PREFLIGHT_NAMESERVERS} entries.`);
  }
  const observations = input.observations.map((raw, index) => {
    const item = object(raw, `observations[${index}]`);
    exactKeys(item, OBSERVATION_KEYS, `observations[${index}]`);
    const observationState = state(item.state, `observations[${index}].state`);
    const nameserver = hostname(item.nameserver, `observations[${index}].nameserver`);
    const observedAddresses = addresses(item.addresses ?? [], `observations[${index}].addresses`);
    const servedNameservers = item.servedNameservers === undefined || item.servedNameservers === null
      ? Object.freeze([] as string[])
      : uniqueHostnames(item.servedNameservers, `observations[${index}].servedNameservers`, 0);
    const authoritative = item.authoritative === null || item.authoritative === undefined
      ? null
      : typeof item.authoritative === 'boolean'
        ? item.authoritative
        : (() => { throw new TypeError(`observations[${index}].authoritative must be true, false, or null.`); })();
    const soaPrimary = item.soaPrimary === null || item.soaPrimary === undefined ? null : hostname(item.soaPrimary, `observations[${index}].soaPrimary`);
    const soaSerial = item.soaSerial === null || item.soaSerial === undefined
      ? null
      : Number.isSafeInteger(item.soaSerial) && Number(item.soaSerial) >= 0 && Number(item.soaSerial) <= 0xffff_ffff
        ? Number(item.soaSerial)
        : (() => { throw new TypeError(`observations[${index}].soaSerial is outside its supported range.`); })();
    if (observationState === 'unavailable' && (observedAddresses.length || servedNameservers.length || authoritative !== null || soaPrimary !== null || soaSerial !== null)) {
      throw new TypeError(`observations[${index}] cannot contain observed values when unavailable.`);
    }
    return Object.freeze({
      nameserver,
      state: observationState,
      source: text(item.source, `observations[${index}].source`, 240),
      observedAt: timestamp(item.observedAt, `observations[${index}].observedAt`),
      addresses: observedAddresses,
      authoritative,
      servedNameservers,
      soaPrimary,
      soaSerial,
    });
  });
  if (new Set(observations.map((item) => item.nameserver)).size !== observations.length) throw new TypeError('observations must use unique nameservers.');
  if (observations.some((item) => !intendedNameservers.includes(item.nameserver))) throw new TypeError('observations can describe only intended nameservers.');

  const rows = intendedNameservers.map((nameserver) => {
    const observation = observations.find((item) => item.nameserver === nameserver) ?? null;
    const inBailiwick = nameserver === domain || nameserver.endsWith(`.${domain}`);
    const publicAddresses = observation?.addresses.filter((address) => !isPrivateAddress(address)) ?? [];
    const addressState = !observation || observation.state === 'unavailable'
      ? 'unknown' as const
      : !observation.addresses.length
        ? inBailiwick ? 'missing' as const : 'not_supplied' as const
        : publicAddresses.length ? 'ready' as const : 'non_public' as const;
    const authorityState = !observation || observation.state !== 'observed' || observation.authoritative === null
      ? 'unknown' as const
      : observation.authoritative ? 'authoritative' as const : 'not_authoritative' as const;
    const servedSetState = !observation || observation.state !== 'observed' || !observation.servedNameservers.length
      ? 'unknown' as const
      : sameSet(observation.servedNameservers, intendedNameservers) ? 'aligned' as const : 'different' as const;
    const soaState = !observation || observation.state !== 'observed' || !observation.soaPrimary || observation.soaSerial === null
      ? 'unknown' as const : 'observed' as const;
    const ready = observation?.state === 'observed'
      && authorityState === 'authoritative'
      && servedSetState === 'aligned'
      && soaState === 'observed'
      && (!inBailiwick || addressState === 'ready');
    return Object.freeze({
      nameserver,
      inBailiwick,
      observationState: observation?.state ?? 'not_supplied' as const,
      addressState,
      authorityState,
      servedSetState,
      soaState,
      publicAddresses: Object.freeze(publicAddresses),
      ready,
      source: observation?.source ?? null,
      observedAt: observation?.observedAt ?? null,
    });
  });
  const reasons = rows.flatMap((row) => [
    ...(!row.ready && row.observationState !== 'observed' ? [`${row.nameserver} evidence is ${row.observationState}.`] : []),
    ...(row.addressState === 'missing' ? [`${row.nameserver} is in-bailiwick but no glue address was supplied.`] : []),
    ...(row.addressState === 'non_public' ? [`${row.nameserver} has no observed public address suitable for delegation.`] : []),
    ...(row.authorityState !== 'authoritative' ? [`${row.nameserver} authoritative service is ${row.authorityState}.`] : []),
    ...(row.servedSetState !== 'aligned' ? [`${row.nameserver} served NS set is ${row.servedSetState}.`] : []),
    ...(row.soaState !== 'observed' ? [`${row.nameserver} SOA evidence is ${row.soaState}.`] : []),
  ]);
  const pass = rows.every((row) => row.ready);
  return Object.freeze({
    schema: NAMESERVER_PREFLIGHT_REVIEW_SCHEMA,
    version: NAMESERVER_PREFLIGHT_REVIEW_VERSION,
    generatedAt: timestamp(generatedAtValue, 'generatedAt'),
    domain,
    state: pass ? 'ready' as const : 'review' as const,
    intendedNameservers,
    rows: Object.freeze(rows),
    gate: Object.freeze({ pass, reasons: Object.freeze(reasons) }),
    limitations: Object.freeze([
      'This local preflight uses only analyst-supplied observations and makes no DNS or registry request.',
      'A ready result describes the supplied collection moment; it does not apply a delegation, publish glue, or prove continued reachability.',
      'Partial, unavailable, and omitted observations remain unknown and cannot satisfy the preflight gate.',
      'Only in-bailiwick nameservers require supplied public glue evidence in this review; registry-specific policy must be checked separately.',
    ]),
  });
}

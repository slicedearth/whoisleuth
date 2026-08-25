// Authority-aware interpretation of WHOIS referral chains. Only the first
// registry response referred by IANA can decide existence; later registrar
// output is diagnostic and cannot replace an inconclusive registry result.

import type { WhoisHop } from './whois-chain.mts';
import type { WhoisAuthority } from './whois-contracts.mts';
import { normalizeWhoisChain } from './whois-normalization.mts';
import {
  parseIndentedWhoisValue,
  whoisFieldLimit,
} from './whois-values.mts';

const LINE_NOT_FOUND_PATTERNS = Object.freeze([
  /^[ \t]*(?:%{1,2}[ \t]*)?(?:error(?::\d+)?[ \t:.-]*)?no match(?:[ \t]+for(?:[ \t]+domain)?(?:[ \t]+["']?[a-z0-9.-]{1,253}["']?)?)?[.!]?[ \t]*$/im,
  /^[ \t]*(?:%{1,2}[ \t]*)?(?:error(?::\d+)?[ \t:.-]*)?no entries found(?:[ \t]+(?:for(?:[ \t]+(?:the[ \t]+)?(?:selected source\(s\)|this query|query[ \t]+["']?[a-z0-9.-]{1,253}["']?))|in[ \t]+the[ \t]+\.[a-z0-9-]{1,63}[ \t]+database))?[.!]?[ \t]*$/im,
  /^[ \t]*[a-z0-9.-]{1,253}[ \t]*:[ \t]*no entries found\.?[ \t]*$/im,
  /^[ \t]*(?:%{1,2}[ \t]*)?(?:domain[ \t]+)?not found(?::[ \t]*[a-z0-9.-]{1,253})?[.!]?[ \t]*$/im,
  /^[ \t]*(?:the[ \t]+)?domain[ \t]+["']?[a-z0-9.-]{1,253}["']?[ \t]+(?:was[ \t]+)?not found\.?[ \t]*$/im,
  /^[ \t]*(?:domain[ \t]+status|the queried object does not exist)[ \t]*:[ \t]*(?:domain[ \t]+not found|no object found)[.!]?[ \t]*$/im,
  /^[ \t]*no object found!?[ \t]*$/im,
  /^[ \t]*(?:%{1,2}[ \t]*)?(?:error(?::\d+)?[ \t:.-]*)?(?:the[ \t]+)?domain(?:[ \t]+is|[ \t]+has)?[ \t]+not[ \t]+(?:been[ \t]+)?registered\.?[ \t]*$/im,
  /^[ \t]*(?:domain[ \t]+)?status[ \t]*:[ \t]*(?:available|free)[ \t]*$/im,
  /^[ \t]*registration[ \t]+status[ \t]*:[ \t]*available[ \t]*$/im,
  /^[ \t]*registered[ \t]*:[ \t]*(?:no|false)[ \t]*$/im,
  /^[ \t]*[a-z0-9.-]{1,253}[ \t]+is[ \t]+(?:available[ \t]+for[ \t]+(?:purchase|registration)|free)[.!]?[ \t]*$/im,
  /^[ \t]*%[ \t]*nothing found[ \t]*$/im,
  /^[ \t]*[a-z0-9](?:[a-z0-9.-]{0,252})[ \t]+is free[ \t]*$/im,
  /^[ \t]*el dominio no se encuentra registrado en nic argentina[ \t]*$/im,
  /^[ \t]*the domain has not been registered\.?[ \t]*$/im,
  /^[ \t]*the queried object does not exist:[ \t]*no matching objects found[ \t]*$/im,
  /^[ \t]*no record found for[ \t]+'[a-z0-9.-]{1,253}'\.?[ \t]*$/im,
  /^[ \t]*no data found[ \t]*$/im,
  /^[ \t]*>>[ \t]*no data found for domain[ \t]*:[ \t]*[a-z0-9.-]{1,253}[ \t]*$/im,
  /^[ \t]*domain[ \t]+[a-z0-9.-]{1,253}[ \t]+is available for purchase[ \t]*$/im,
]);

const NZ_NOT_FOUND_RE = /^[ \t]*query_status[ \t]*:[ \t]*220(?:\s|$)/im;
const NZ_POSITIVE_RE = /^[ \t]*query_status[ \t]*:[ \t]*(?:200|210)(?:\s|$)/im;
const NZ_TEMPORARY_FAILURE_RE = /^[ \t]*query_status[ \t]*:[ \t]*4\d{2}(?:\s|$)/im;

const RATE_LIMIT_LINE_RE = /^[ \t]*(?:[%#*;>-]+[ \t]*)?(?:(?:error|status)[ \t:.-]+)?(?:whois[ \t]+limit[ \t]+exceeded|query[ \t]+(?:rate[ \t-]*)?limit[ \t]+exceeded|(?:request|query)[ \t]+limit[ \t]+(?:exceeded|reached)|rate[ \t-]*limit(?:[ \t]+exceeded)?|too[ \t]+many[ \t]+(?:requests|queries)|quota[ \t]+exceeded|number[ \t]+of[^\r\n]{0,120}[ \t]+exceeded|(?:requests?|queries?)[ \t]+(?:are[ \t]+)?throttled|throttled|(?:service[ \t]+)?temporarily[ \t]+unavailable|(?:please[ \t]+)?try[ \t]+again[ \t]+later|please[ \t]+wait)\b[^\r\n]{0,240}$/im;

const POSITIVE_REGISTRATION_RE = /^[ \t*]*(?:Domain(?:[ \t]+Name)?|domainname|Registrar|Registrar WHOIS Server|Creation Date|Created(?: On)?|Registry Expiry Date|Registered(?: On)?|Name Server|nserver|Sponsoring Registrar)[ \t.]*:[ \t]*\S/im;
const POSITIVE_BRACKET_RE = /\[(?:Domain Name|Registrant|Name Server)\][ \t]*\S/i;

function hasSectionedRegistrationEvidence(text: string): boolean {
  if (
    !/^[ \t]*Relevant dates[ \t]*:[ \t]*$/im.test(text)
    || !/^[ \t]*Registration status[ \t]*:[ \t]*$/im.test(text)
  ) {
    return false;
  }
  const domain = parseIndentedWhoisValue(
    text,
    /^[ \t]*Domain(?: name)?[ \t]*:[ \t]*$/im,
    whoisFieldLimit('domainName'),
  );
  const status = parseIndentedWhoisValue(
    text,
    /^[ \t]*Registration status[ \t]*:[ \t]*$/im,
    160,
  );
  return Boolean(domain?.value && status?.value);
}

export function hasNicKgRegistrationEvidence(text: string): boolean {
  return /^% This is the \.kg ccTLD Whois server[ \t]*$/im.test(text)
    && /^[ \t]*Domain[ \t]+[a-z0-9.-]+[ \t]+\([A-Z][A-Z0-9_-]*\)[ \t]*$/im.test(text)
    && /^[ \t]*Record created[ \t]*:[ \t]*\S/im.test(text)
    && /^[ \t]*Name servers in the listed order[ \t]*:[ \t]*$/im.test(text);
}

function classifyHopEvidence(hop: WhoisHop, index: number): string {
  if (hop.error) return 'error';
  const text = hop.response || '';
  if (!text.trim()) return 'inconclusive';
  if (RATE_LIMIT_LINE_RE.test(text)) return 'rate_limited';
  if (NZ_TEMPORARY_FAILURE_RE.test(text)) return 'rate_limited';
  if (NZ_NOT_FOUND_RE.test(text)) return 'negative';
  if (
    LINE_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return 'negative';
  }
  if (
    index > 0
    && (
      POSITIVE_REGISTRATION_RE.test(text)
      || POSITIVE_BRACKET_RE.test(text)
      || NZ_POSITIVE_RE.test(text)
      || hasSectionedRegistrationEvidence(text)
      || hasNicKgRegistrationEvidence(text)
    )
  ) {
    return 'positive';
  }
  return 'inconclusive';
}

function normalizedWhoisServer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\.+$/u, '');
  return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(normalized) ? normalized : null;
}

function ianaRegistryReferral(hop: WhoisHop | undefined): string | null {
  if (!hop || normalizedWhoisServer(hop.server) !== 'whois.iana.org' || typeof hop.response !== 'string') return null;
  for (const pattern of [
    /^[ \t]*refer:[ \t]*([a-zA-Z0-9.\-]+)/mi,
    /^[ \t]*ReferralServer:[ \t]*whois:\/\/([a-zA-Z0-9.\-]+)/mi,
    /^[ \t]*whois:[ \t]*([a-zA-Z0-9.\-]+)/mi,
  ]) {
    const referral = normalizedWhoisServer(hop.response.match(pattern)?.[1]);
    if (referral) return referral;
  }
  return null;
}

export function analyzeWhoisChainAuthority(chain: unknown): WhoisAuthority {
  const source = normalizeWhoisChain(chain);
  const evidence = source.map((hop, index) => ({
    server: hop.server,
    index,
    kind: classifyHopEvidence(hop, index),
  }));
  const failed = evidence.filter(
    (item) => item.kind === 'error' || item.kind === 'rate_limited',
  );
  const registryReferral = ianaRegistryReferral(source[0]);
  const registryServer = normalizedWhoisServer(source[1]?.server);
  const registryEvidence = registryReferral && registryServer === registryReferral ? evidence[1] : null;
  const authoritative = registryEvidence
    && (registryEvidence.kind === 'positive' || registryEvidence.kind === 'negative')
    ? registryEvidence
    : null;
  const conflict = authoritative
    ? evidence.find(
      (item) => item.index > authoritative.index
        && (item.kind === 'positive' || item.kind === 'negative')
        && item.kind !== authoritative.kind,
    )
    : null;
  const registrationStatus: WhoisAuthority['registrationStatus'] = !authoritative
    ? 'inconclusive'
    : authoritative.kind === 'positive'
      ? 'registered'
      : 'not_found';
  return {
    registrationStatus,
    notFound: registrationStatus === 'not_found',
    notFoundSource:
      registrationStatus === 'not_found' && authoritative
        ? authoritative.server
        : null,
    authoritativeHop: authoritative?.server ?? null,
    failedHop: failed[0]?.server ?? null,
    conflictingHop: conflict?.server ?? null,
    chainStatus:
      authoritative && failed.length === 0 && !conflict
        ? 'complete'
        : 'partial',
  };
}

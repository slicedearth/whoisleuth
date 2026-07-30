// Authority-aware interpretation of WHOIS referral chains. The first
// definitive non-root response decides existence; later registrar output is
// diagnostic and cannot override the registry.

import type { WhoisHop } from './whois-chain.mts';
import type { WhoisAuthority } from './whois-contracts.mts';
import { normalizeWhoisChain } from './whois-normalization.mts';
import {
  parseIndentedWhoisValue,
  whoisFieldLimit,
} from './whois-values.mts';

const NOT_FOUND_RE = /no match for|no match\b|not found|no entries found|domain not found|no object found|not registered|status\s*:\s*(?:available|free)\b|registered\s*:\s*(?:no|false)\b|is available for registration/i;

const LINE_NOT_FOUND_PATTERNS = Object.freeze([
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
    NOT_FOUND_RE.test(text)
    || LINE_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(text))
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
  const authoritative = evidence.find(
    (item) => item.index > 0
      && (item.kind === 'positive' || item.kind === 'negative'),
  );
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

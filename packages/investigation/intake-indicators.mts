import { canonicalIpAddress } from '../contracts/ip-address.mts';
import {
  MAX_INTAKE_INDICATORS,
  MAX_INTAKE_INDICATOR_CANDIDATES,
  type IntakeIndicator,
  type IntakeIndicatorLocation,
  type MessageIntakeReport,
} from '../contracts/message-intake.mts';

export const MAX_INTAKE_INDICATOR_TEXT = 2 * 1024 * 1024;

function minimiseIndicatorToken(token: string): string {
  if (token.includes('//') || token.includes('@')) return ' ';
  const unwrapped = token.replace(/^[([{,;]+|[)\]},;.!?]+$/gu, '');
  // A bare IPv6 address or explicit hash label is an observation, not a URI.
  // Other schemes include opaque forms such as data: and urn:, whose commas
  // and nested hash labels must not enter the later indicator scanners.
  if (unwrapped.length <= 98 && canonicalIpAddress(unwrapped)) return token;
  // Field prefixes such as value= must not conceal an opaque URI. Match at
  // token boundaries, not just the beginning, before any punctuation splitting.
  for (const match of unwrapped.matchAll(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*)(?::|\[:\])/giu)) {
    if (!/^(?:md5|sha-?1|sha-?256)$/iu.test(match[1]!)) return ' ';
  }
  return token;
}

/** Literal selected text only. A syntactic indicator is not a network target or threat verdict. */
export function createIndicatorIntake() {
  const indicators: IntakeIndicator[] = [],
    seen = new Set<string>();
  let candidatesReviewed = 0,
    textReviewed = 0,
    partial = false,
    reviewed = false;
  function admit(
    kind: IntakeIndicator['kind'],
    value: string,
    source: IntakeIndicator['source'],
    location: IntakeIndicatorLocation,
  ) {
    const key = JSON.stringify([kind, value, source, location]);
    if (seen.has(key)) return;
    if (indicators.length >= MAX_INTAKE_INDICATORS) {
      partial = true;
      return;
    }
    seen.add(key);
    indicators.push({
      id: `indicator-${indicators.length + 1}`,
      kind,
      value,
      source,
      location: { ...location },
      basis: 'literal_text',
    });
  }
  function candidate() {
    if (candidatesReviewed >= MAX_INTAKE_INDICATOR_CANDIDATES) {
      partial = true;
      return false;
    }
    candidatesReviewed++;
    return true;
  }
  return {
    markPartial() {
      reviewed = true;
      partial = true;
    },
    addText(value: string, source: IntakeIndicator['source'], location: IntakeIndicatorLocation) {
      reviewed = true;
      if (partial || value.length > MAX_INTAKE_INDICATOR_TEXT - textReviewed) {
        partial = true;
        return;
      }
      textReviewed += value.length;
      // Exclude complete URLs (including rejected/defanged URLs), addresses and
      // credential-bearing lines before either scanner. Never scan raw HAR or
      // identity-provider objects, message headers, script or style content.
      const minimised = value
        .replace(
          /^.*\b(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|access[_ -]?token|refresh[_ -]?token|session[_ -]?id|secret|api[_ -]?key|token)\s*[:=].*$/gimu,
          ' ',
        )
        .replace(/[^\s<>"'`]+/gu, minimiseIndicatorToken);
      // Hashes require an explicit algorithm label. Bare opaque hexadecimal
      // strings may be session material and are deliberately not interpreted.
      for (const match of minimised.matchAll(
        /\b(md5|sha-?1|sha-?256)[ \t]*(?::|=|[ \t])[ \t]*([a-f0-9]+)\b/giu,
      )) {
        if (!candidate()) return;
        const kind = match[1]!.toLowerCase().replace('-', '') as 'md5' | 'sha1' | 'sha256';
        const hash = match[2]!.toLowerCase();
        if (hash.length === { md5: 32, sha1: 40, sha256: 64 }[kind])
          admit(kind, hash, source, location);
      }
      for (const match of minimised.matchAll(/[^\s<>"'`()\[\]{},;]+/gu)) {
        const token = match[0];
        if (!token.includes('.') && !token.includes(':')) continue;
        if (!candidate()) return;
        if (token.length > 98) continue;
        const raw = token.replace(/[.!?]+$/u, '');
        const address = canonicalIpAddress(raw);
        if (address) admit(address.includes(':') ? 'ipv6' : 'ipv4', address, source, location);
      }
    },
    result() {
      return {
        indicators: [...indicators],
        indicatorCoverage: {
          state: partial
            ? ('partial' as const)
            : reviewed
              ? ('reviewed' as const)
              : ('not_reviewed' as const),
          candidatesReviewed,
        },
      };
    },
  };
}

/** Version-1 reports have no indicator coverage; absence is not reinterpreted. */
export function intakeIndicators(report: MessageIntakeReport): readonly IntakeIndicator[] {
  return report.schemaVersion === 2 ? report.indicators : [];
}

export function intakeIndicatorSource(
  report: MessageIntakeReport,
  indicator: IntakeIndicator,
): string {
  const document = report.documentReview?.parts.find(
    (part) => part.id === indicator.location.partId,
  );
  const message = report.messageParts.find(
    (part) => `message-${part.part}` === indicator.location.partId,
  );
  return document?.digestSha256 ?? message?.digestSha256 ?? report.source.digestSha256;
}

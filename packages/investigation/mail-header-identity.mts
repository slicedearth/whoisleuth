import { isValidAsciiDomainName } from '../contracts/domain-name.mts';
import { MAIL_AUTHENTICATION_METHODS } from '../contracts/mail-authentication.mts';

export const MAX_MAIL_REVIEW_DOMAINS = 128;
export const AUTHENTICATION_METHODS = MAIL_AUTHENTICATION_METHODS;
export type AuthenticationMethod = typeof AUTHENTICATION_METHODS[number];
export type AuthenticationState = 'fail' | 'mixed' | 'neutral' | 'none' | 'pass' | 'permerror' | 'softfail' | 'temperror' | 'unknown';

export function normalizeHeaderDomain(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  return isValidAsciiDomainName(normalized, { requireLowercase: true }) ? normalized : null;
}

export function lexicalSegments(value: string, delimiter: ',' | ';', trackAngles = false): string[] | null {
  const segments: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let commentDepth = 0;
  let angleDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && (quoted || commentDepth > 0)) {
      escaped = true;
      continue;
    }
    if (commentDepth > 0) {
      if (character === '(') commentDepth += 1;
      else if (character === ')') commentDepth -= 1;
      continue;
    }
    if (quoted) {
      if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '(') commentDepth = 1;
    else if (character === ')') return null;
    else if (trackAngles && character === '<') {
      if (angleDepth !== 0) return null;
      angleDepth = 1;
    } else if (trackAngles && character === '>') {
      if (angleDepth !== 1) return null;
      angleDepth = 0;
    } else if (character === delimiter && angleDepth === 0) {
      segments.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (escaped || quoted || commentDepth !== 0 || angleDepth !== 0) return null;
  segments.push(value.slice(start));
  return segments;
}

function angleAddress(value: string): string | null {
  let quoted = false;
  let escaped = false;
  let commentDepth = 0;
  let start = -1;
  let end = -1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (escaped) { escaped = false; continue; }
    if (character === '\\' && (quoted || commentDepth > 0)) { escaped = true; continue; }
    if (commentDepth > 0) {
      if (character === '(') commentDepth += 1;
      else if (character === ')') commentDepth -= 1;
      continue;
    }
    if (quoted) {
      if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '(') commentDepth = 1;
    else if (character === ')') return null;
    else if (character === '<') {
      if (start >= 0 || end >= 0) return null;
      start = index;
    } else if (character === '>') {
      if (start < 0 || end >= 0) return null;
      end = index;
    }
  }
  if (escaped || quoted || commentDepth !== 0 || (start >= 0) !== (end >= 0)) return null;
  return start >= 0 ? value.slice(start + 1, end) : value;
}

function addressDomain(value: string): string | null {
  let candidate = '';
  let quoted = false;
  let escaped = false;
  let commentDepth = 0;
  const separators: number[] = [];
  for (const character of value) {
    if (escaped) {
      candidate += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && (quoted || commentDepth > 0)) {
      if (quoted) candidate += character;
      escaped = true;
      continue;
    }
    if (commentDepth > 0) {
      if (character === '(') commentDepth += 1;
      else if (character === ')') commentDepth -= 1;
      continue;
    }
    if (quoted) {
      candidate += character;
      if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; candidate += character; }
    else if (character === '(') commentDepth = 1;
    else if (character === ')') return null;
    else {
      if (character === '@') separators.push(candidate.length);
      candidate += character;
    }
  }
  if (escaped || quoted || commentDepth !== 0 || separators.length !== 1) return null;
  const separator = separators[0] ?? -1;
  const local = candidate.slice(0, separator).trim();
  const domain = candidate.slice(separator + 1).trim();
  const validLocal = /^(?:[^\s"<>(),:;@]+|"(?:[^"\\]|\\.)+")$/u.test(local);
  if (!validLocal || !domain || /\s/u.test(domain)) return null;
  return normalizeHeaderDomain(domain);
}

export function addressDomains(values: readonly string[]): string[] {
  const domains = new Set<string>();
  for (const value of values) {
    const mailboxes = lexicalSegments(value, ',', true);
    if (!mailboxes) continue;
    for (const mailbox of mailboxes) {
      const selected = angleAddress(mailbox);
      const domain = selected === null ? null : addressDomain(selected);
      if (domain) domains.add(domain);
      if (domains.size >= MAX_MAIL_REVIEW_DOMAINS) return [...domains].sort();
    }
  }
  return [...domains].sort();
}

export function messageIdDomains(values: readonly string[]): string[] {
  return addressDomains(values.map((value) => value.replace(/[<>]/gu, '')));
}

export function authenticationServiceDomains(values: readonly string[]): string[] {
  const output = new Set<string>();
  for (const value of values) {
    const clauses = lexicalSegments(value, ';');
    const service = normalizeHeaderDomain((clauses?.[0] ?? '').trim().split(/\s/u, 1)[0] ?? '');
    if (service) output.add(service);
  }
  return [...output].sort().slice(0, MAX_MAIL_REVIEW_DOMAINS);
}

export function dkimSigningDomains(values: readonly string[]): string[] {
  const output = new Set<string>();
  for (const value of values) {
    for (const clause of lexicalSegments(value, ';') ?? []) {
      const match = /^\s*d\s*=\s*([^\s;]+)/iu.exec(clause);
      const domain = normalizeHeaderDomain(match?.[1] ?? '');
      if (domain) output.add(domain);
    }
  }
  return [...output].sort().slice(0, MAX_MAIL_REVIEW_DOMAINS);
}

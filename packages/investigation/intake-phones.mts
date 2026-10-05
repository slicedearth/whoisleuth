import { MAX_INTAKE_INDICATORS, MAX_INTAKE_INDICATOR_CANDIDATES, type IntakePhoneCandidate, type IntakePhoneReview, type MessageIntakeResult } from '../contracts/message-intake.mts';
import { exact, array, digest, integer, enumeration } from '../evidence/artifact-structure.mts';
import { MAX_INTAKE_INDICATOR_TEXT, minimiseIndicatorToken } from './intake-indicators.mts';

export const MAX_INTAKE_PHONE_CHARACTERS = 96;
export const MAX_SELECTED_INTAKE_PHONES = 64;
const CREDENTIAL_LINE = /\b(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|access[_ -]?token|refresh[_ -]?token|session[_ -]?id|secret|api[_ -]?key|token)\s*[:=]/iu;
const PHONE_LABEL = /\b(?:phone|telephone|tel|call|support|contact|fax)\s*[:=]?\s*$/iu;
const NOT_PHONE_LABEL = /\b(?:date|order|account|invoice|reference|id|md5|sha-?1|sha-?256)\s*[:=#]?\s*$/iu;
const SEPARATORS = /[ ()\t\u00a0\u202f\-\u2010-\u2014]/gu;
const UNSUPPORTED = /[^+0-9 ()\t\u00a0\u202f\-\u2010-\u2014]/u;

/** Bounded by the admitted text length; unterminated markup excludes the remainder. */
function excludeMarkup(value: string, mark: (start: number, end: number) => void): void {
  function tagEnd(start: number): number {
    let quote: string | null = null;
    for (let cursor = start + 1; cursor < value.length; cursor++) {
      const character = value[cursor];
      if (quote) { if (character === quote) quote = null; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') return cursor + 1;
    }
    return value.length;
  }
  let cursor = 0;
  for (;;) {
    const start = value.indexOf('<', cursor);
    if (start < 0) return;
    let end = tagEnd(start);
    const rawTag = /^<(script|style)(?=[\t\n\f\r />])/iu.exec(value.slice(start, start + 9))?.[1]?.toLowerCase();
    if (rawTag) {
      let closing = value.indexOf('</', end);
      while (closing >= 0) {
        const nameEnd: number = closing + 2 + rawTag.length;
        if (value.slice(closing + 2, nameEnd).toLowerCase() === rawTag && /[\t\n\f\r />]/u.test(value[nameEnd] ?? '')) {
          end = tagEnd(closing);
          break;
        }
        closing = value.indexOf('</', closing + 2);
      }
      if (closing < 0) end = value.length;
    }
    mark(start, end);
    cursor = end;
  }
}

/** Syntax only, not numbering-plan validation or ownership/reachability evidence. */
export function phoneCandidateValue(original: string): Pick<IntakePhoneCandidate, 'canonical' | 'extension' | 'state' | 'issues'> {
  let body = original;
  const suffix = /[ \t\u00a0\u202f]*(?:ext\.?|x)[ \t\u00a0\u202f]*([0-9]{1,6})$/iu.exec(body);
  const extension = suffix?.[1] ?? null;
  if (suffix) body = body.slice(0, suffix.index).trimEnd();
  const digits = body.replace(SEPARATORS, '');
  const issues: string[] = [];
  if (original.length > MAX_INTAKE_PHONE_CHARACTERS) issues.push('The candidate exceeds the supported character limit.');
  if (UNSUPPORTED.test(body)) issues.push('Unsupported digits, controls or punctuation were preserved, not normalised.');
  if (!/^\+?[0-9]{7,15}$/u.test(digits)) issues.push('Only seven to fifteen ASCII digits with supported separators are reviewable.');
  if ((body.match(/[0-9]{7,}/gu)?.length ?? 0) > 1) issues.push('Separate long digit runs are not joined into a phone number.');
  if (body.includes('(') !== body.includes(')') || (body.includes('(') && body.indexOf('(') > body.indexOf(')')) || (body.match(/\(/gu)?.length ?? 0) > 1 || (body.match(/\)/gu)?.length ?? 0) > 1)
    issues.push('Parentheses are unsupported or unbalanced.');
  if (/^\+0/u.test(digits)) issues.push('An international candidate cannot begin with zero.');
  if (issues.length) return { canonical: null, extension, state: 'unsupported', issues };
  return { canonical: digits.startsWith('+') ? digits : null, extension,
    state: digits.startsWith('+') ? 'international_candidate' : 'national_ambiguous', issues: [] };
}

/** Selected plaintext only. The original string is never normalised before indexing. */
export function reviewPhoneCandidates(value: string, sourceDigestSha256: string): IntakePhoneReview {
  digest(sourceDigestSha256, 'Phone input digest');
  const candidates: IntakePhoneCandidate[] = [];
  let candidatesReviewed = 0, partial = false;
  if (value.length > MAX_INTAKE_INDICATOR_TEXT) partial = true;
  else {
    // Mark excluded ranges without changing string lengths or source offsets.
    const excluded = new Uint8Array(value.length);
    const mark = (start: number, end: number) => excluded.fill(1, start, end);
    for (const line of value.matchAll(/[^\r\n]+/gu)) if (CREDENTIAL_LINE.test(line[0])) mark(line.index, line.index + line[0].length);
    for (const token of value.matchAll(/[^\s<>"'`]+/gu)) if (minimiseIndicatorToken(token[0]) === ' ') mark(token.index, token.index + token[0].length);
    // Pasted markup is not a request to inspect attributes or executable content.
    excludeMarkup(value, mark);
    for (const match of value.matchAll(/[+\uFF0B(]?[\p{Nd}][\p{Nd} ()\t\u00a0\u202f\-\u2010-\u2014\p{Cf}]{5,}(?:(?:ext\.?|x)[ \t\u00a0\u202f]*[\p{Nd}]+)?/giu)) {
      if (candidatesReviewed >= MAX_INTAKE_INDICATOR_CANDIDATES || candidates.length >= MAX_INTAKE_INDICATORS) { partial = true; break; }
      candidatesReviewed++;
      const original = match[0].trimEnd(), start = match.index, end = start + original.length;
      if (original.length > MAX_INTAKE_PHONE_CHARACTERS) { partial = true; continue; }
      if (excluded.subarray(start, end).some(Boolean)) continue;
      const before = value.slice(Math.max(0, start - 48), start);
      const after = value.slice(end, end + 2);
      // Sentence punctuation is outside the original span; embedded dots still reject.
      if (/[\p{L}\p{N}_./:@+-]$/u.test(before)
        || (/^[\p{L}\p{N}_./:@+-]/u.test(after) && !/^\.(?:\s|$)/u.test(after))) continue;
      if (NOT_PHONE_LABEL.test(before) || /^\d{4}[- ]\d{1,2}[- ]\d{1,2}$/u.test(original) || /^\d{1,2}[- ]\d{1,2}[- ]\d{2,4}$/u.test(original)) continue;
      if (!/^[+\uFF0B]/u.test(original) && !PHONE_LABEL.test(before)) continue;
      const parsed = phoneCandidateValue(original);
      candidates.push({ id: `phone-${candidates.length + 1}`, original, start, end, ...parsed });
    }
  }
  return { version: 1, sourceDigestSha256, sourceTextLength: value.length, offsetUnit: 'utf16_code_unit',
    state: partial ? 'partial' : 'reviewed', candidatesReviewed, candidates };
}

/** Validate transient worker data separately from serialisable report evidence. */
export function validatePhoneReview(result: MessageIntakeResult): void {
  if (result.phoneReview === undefined) return;
  if (result.report.source.kind !== 'text' || result.report.schemaVersion !== 2) throw new TypeError('Phone review requires selected plaintext.');
  const review = exact(result.phoneReview, ['version', 'sourceDigestSha256', 'sourceTextLength', 'offsetUnit', 'state', 'candidatesReviewed', 'candidates'], 'Phone review');
  if (review.version !== 1 || review.sourceDigestSha256 !== result.report.source.digestSha256 || review.offsetUnit !== 'utf16_code_unit') throw new TypeError('Phone review source identity is inconsistent.');
  const length = integer(review.sourceTextLength, 'Phone source length', 0, result.report.source.byteLength);
  enumeration(review.state, ['reviewed', 'partial'] as const, 'Phone review coverage');
  const reviewed = integer(review.candidatesReviewed, 'Phone candidate count', 0, MAX_INTAKE_INDICATOR_CANDIDATES);
  let previousEnd = 0;
  const candidates = array(review.candidates, 'Phone candidates', MAX_INTAKE_INDICATORS);
  if (reviewed < candidates.length) throw new TypeError('Phone review counts are inconsistent.');
  if (length > MAX_INTAKE_INDICATOR_TEXT && (review.state !== 'partial' || reviewed || candidates.length)) throw new TypeError('Overlong plaintext cannot claim phone extraction.');
  candidates.forEach((raw, index) => {
    const item = exact(raw, ['id', 'original', 'start', 'end', 'canonical', 'extension', 'state', 'issues'], 'Phone candidate');
    const start = integer(item.start, 'Phone span start', previousEnd, length), end = integer(item.end, 'Phone span end', start + 1, length);
    if (item.id !== `phone-${index + 1}` || typeof item.original !== 'string' || item.original.length !== end - start || item.original.length > MAX_INTAKE_PHONE_CHARACTERS) throw new TypeError('Phone candidate span is inconsistent.');
    const parsed = phoneCandidateValue(item.original);
    if (item.canonical !== parsed.canonical || item.extension !== parsed.extension || item.state !== parsed.state || JSON.stringify(item.issues) !== JSON.stringify(parsed.issues)) throw new TypeError('Phone candidate interpretation is inconsistent.');
    previousEnd = end;
  });
}

import { sha256ArtifactBytes } from '../evidence/artifact-integrity.mts';

export const TEXT_COMPARISON_BYTES = 1024 * 1024;
export const TEXT_COMPARISON_TOKENS = 65_536;
export const TEXT_COMPARISON_MIN_WORDS = 5;
export const TEXT_COMPARISON_PASSAGES = 256;
// Two excerpts per listed passage keep cloned/rendered text below 512 Ki code
// units even when one long reference passage matches hundreds of candidates.
export const TEXT_COMPARISON_EXCERPT_CHARACTERS = 1024;
type Token = Readonly<{ value: string; start: number; end: number }>;
type PassageExcerpt = Readonly<{ start: number; end: number; text: string; clipped: boolean }>;
export type MatchedTextPassage = Readonly<{
  reference: PassageExcerpt;
  candidate: PassageExcerpt;
  words: number;
}>;

function excerpt(text: string, start: number, end: number): PassageExcerpt {
  let shownEnd = Math.min(end, start + TEXT_COMPARISON_EXCERPT_CHARACTERS);
  if (shownEnd < end && /[\uD800-\uDBFF]/u.test(text[shownEnd - 1]!)) shownEnd--;
  return { start, end, text: text.slice(start, shownEnd), clipped: shownEnd < end };
}

function admit(bytes: Uint8Array) {
  if (
    !(bytes instanceof Uint8Array) ||
    !(bytes.buffer instanceof ArrayBuffer) ||
    !bytes.length ||
    bytes.length > TEXT_COMPARISON_BYTES
  )
    throw new TypeError('Each text source must contain 1 byte to 1 MiB of UTF-8 text.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
    throw new TypeError('Binary control characters are not supported in text comparison.');
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu)) {
    if (tokens.length >= TEXT_COMPARISON_TOKENS)
      throw new TypeError(
        'Text exceeds the 65,536-word comparison bound; no partial comparison was produced.',
      );
    tokens.push({
      value: match[0].normalize('NFC').toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return { text, tokens };
}

/** Linear indexed phrase matching. Digests cover the original bytes, never the tokens. */
export async function compareTextPassages(referenceBytes: Uint8Array, candidateBytes: Uint8Array) {
  const reference = admit(referenceBytes),
    candidate = admit(candidateBytes);
  const [referenceDigest, candidateDigest] = await Promise.all([
    sha256ArtifactBytes(referenceBytes),
    sha256ArtifactBytes(candidateBytes),
  ]);
  const key = (tokens: readonly Token[], position: number) =>
    JSON.stringify(
      tokens.slice(position, position + TEXT_COMPARISON_MIN_WORDS).map((token) => token.value),
    );
  const index = new Map<string, number>();
  for (
    let position = 0;
    position + TEXT_COMPARISON_MIN_WORDS <= reference.tokens.length;
    position++
  ) {
    const phrase = key(reference.tokens, position);
    if (!index.has(phrase)) index.set(phrase, position);
  }
  const referenceCovered = new Uint8Array(reference.tokens.length),
    passages: MatchedTextPassage[] = [];
  let matchedCandidateWords = 0,
    totalPassages = 0;
  for (let position = 0; position + TEXT_COMPARISON_MIN_WORDS <= candidate.tokens.length;) {
    const start = index.get(key(candidate.tokens, position));
    if (start === undefined) {
      position++;
      continue;
    }
    let words = TEXT_COMPARISON_MIN_WORDS;
    while (
      position + words < candidate.tokens.length &&
      start + words < reference.tokens.length &&
      candidate.tokens[position + words]!.value === reference.tokens[start + words]!.value
    )
      words++;
    referenceCovered.fill(1, start, start + words);
    matchedCandidateWords += words;
    totalPassages++;
    if (passages.length < TEXT_COMPARISON_PASSAGES) {
      const referenceStart = reference.tokens[start]!.start,
        referenceEnd = reference.tokens[start + words - 1]!.end;
      const candidateStart = candidate.tokens[position]!.start,
        candidateEnd = candidate.tokens[position + words - 1]!.end;
      passages.push({
        reference: excerpt(reference.text, referenceStart, referenceEnd),
        candidate: excerpt(candidate.text, candidateStart, candidateEnd),
        words,
      });
    }
    position += words;
  }
  return {
    method: 'normalised-word-runs-v1' as const,
    reference: {
      digestSha256: referenceDigest,
      bytes: referenceBytes.byteLength,
      words: reference.tokens.length,
    },
    candidate: {
      digestSha256: candidateDigest,
      bytes: candidateBytes.byteLength,
      words: candidate.tokens.length,
    },
    exactBytes: referenceDigest === candidateDigest,
    matchedCandidateWords,
    matchedReferenceWords: referenceCovered.reduce((sum, value) => sum + value, 0),
    totalPassages,
    passages,
    omittedPassages: totalPassages - passages.length,
    limitations: [
      'Matches contain at least five consecutive words after Unicode NFC normalisation and lowercasing; punctuation and whitespace do not distinguish words. Source digests identify the complete original bytes.',
      'Each candidate word is counted once. Repeated phrases use their first reference occurrence, with greedy non-overlapping runs; alternate and overlapping alignments are not exhaustive.',
      'Word counts describe the admitted files, not a percentage of copied website content. Common wording, templates and licensed material may match; copying, rights and infringement require separate review.',
      'No OCR, translation, web discovery or network collection is performed. Character offsets use JavaScript UTF-16 positions in the original decoded text.',
    ],
  };
}
export type TextPassageComparison = Awaited<ReturnType<typeof compareTextPassages>>;

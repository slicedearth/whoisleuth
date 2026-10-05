import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  compareTextPassages,
  TEXT_COMPARISON_BYTES,
  TEXT_COMPARISON_PASSAGES,
  TEXT_COMPARISON_EXCERPT_CHARACTERS,
} from '../packages/comparison/text-passages.mts';
import { runInvestigationPackageOperation } from '../frontend/src/lib/investigation-package-worker-model.ts';
const bytes = (value: string) => new TextEncoder().encode(value);

test('text passages identify complete original bytes and preserve source offsets after normalisation', async () => {
  const left = 'Before: Cafe\u0301 services provide clear local evidence. After.',
    right = 'CAFÉ services provide clear local evidence!';
  const compared = await compareTextPassages(bytes(left), bytes(right));
  assert.equal(compared.totalPassages, 1);
  assert.equal(compared.exactBytes, false);
  assert.equal(compared.passages[0]!.words, 6);
  assert.equal(
    compared.passages[0]!.reference.text,
    'Cafe\u0301 services provide clear local evidence',
  );
  assert.equal(
    left.slice(compared.passages[0]!.reference.start, compared.passages[0]!.reference.end),
    compared.passages[0]!.reference.text,
  );
  assert.equal(
    compared.reference.digestSha256,
    `sha256:${createHash('sha256').update(bytes(left)).digest('hex')}`,
  );
});
test('repeated candidate wording is non-overlapping while reference coverage counts each word once', async () => {
  const phrase = 'one two three four five six';
  const compared = await compareTextPassages(bytes(phrase), bytes(`${phrase} other ${phrase}`));
  assert.equal(compared.totalPassages, 2);
  assert.equal(compared.matchedCandidateWords, 12);
  assert.equal(compared.matchedReferenceWords, 6);
  assert.equal(compared.candidate.words, 13);
  assert.equal(compared.reference.words, 6);
});
test('short phrases are not presented as matches and same-byte sources remain explicit', async () => {
  const compared = await compareTextPassages(
    bytes('one two three four'),
    bytes('one two three four'),
  );
  assert.equal(compared.exactBytes, true);
  assert.equal(compared.totalPassages, 0);
  assert.equal(compared.matchedCandidateWords, 0);
});
test('passage listing is bounded without changing the full compared-word denominator', async () => {
  const phrase = 'one two three four five';
  const compared = await compareTextPassages(
    bytes(phrase),
    bytes(Array.from({ length: 300 }, () => `${phrase} separator`).join(' ')),
  );
  assert.equal(compared.totalPassages, 300);
  assert.equal(compared.passages.length, TEXT_COMPARISON_PASSAGES);
  assert.equal(compared.omittedPassages, 300 - TEXT_COMPARISON_PASSAGES);
  assert.equal(compared.matchedCandidateWords, 1500);
});
test('text byte, token and decoding bounds reject inputs rather than produce partial evidence', async () => {
  const source = bytes('one two three four five');
  for (const invalid of [
    new Uint8Array(),
    new Uint8Array([0xff]),
    bytes('binary\u0000'),
    bytes('a '.repeat(65_537)),
    new Uint8Array(TEXT_COMPARISON_BYTES + 1),
  ])
    await assert.rejects(compareTextPassages(source, invalid));
  const exact = new Uint8Array(TEXT_COMPARISON_BYTES).fill(32);
  exact[0] = 97;
  assert.equal((await compareTextPassages(exact, source)).reference.bytes, TEXT_COMPARISON_BYTES);
});
test('repeated long source ranges cannot amplify cloned excerpts while full counts and offsets survive', async () => {
  const tail = ' two three four five',
    prefix = 'one';
  const reference = prefix + '-'.repeat(TEXT_COMPARISON_BYTES - prefix.length - tail.length) + tail;
  const candidate = 'one two three four five separator '.repeat(300);
  const result = await compareTextPassages(bytes(reference), bytes(candidate));
  assert.equal(result.totalPassages, 300);
  assert.equal(result.matchedCandidateWords, 1500);
  assert.equal(result.passages.length, TEXT_COMPARISON_PASSAGES);
  assert.equal(result.passages[0]!.reference.end, TEXT_COMPARISON_BYTES);
  assert.equal(result.passages[0]!.reference.clipped, true);
  assert.equal(result.passages[0]!.candidate.clipped, false);
  const characters = result.passages.reduce(
    (total, item) => total + item.reference.text.length + item.candidate.text.length,
    0,
  );
  assert.ok(characters <= TEXT_COMPARISON_PASSAGES * 2 * TEXT_COMPARISON_EXCERPT_CHARACTERS);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024 * 1024);
  const supplementary = `one${'-'.repeat(TEXT_COMPARISON_EXCERPT_CHARACTERS - 4)}😀 two three four five`;
  const clipped = (
    await compareTextPassages(bytes(supplementary), bytes('one two three four five'))
  ).passages[0]!.reference;
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(clipped.text)), clipped.text);
  assert.equal(clipped.clipped, true);
});
test('the local worker admits both files before reading and sanitises unexpected failures', async () => {
  let reads = 0;
  const left = new Blob(['private content']);
  Object.defineProperty(left, 'arrayBuffer', {
    value: () => {
      reads++;
      throw new Error('private transport detail');
    },
  });
  const oversized = new Blob(['x']);
  Object.defineProperty(oversized, 'size', { value: TEXT_COMPARISON_BYTES + 1 });
  assert.equal(
    (
      await runInvestigationPackageOperation({
        kind: 'textCompare',
        input: { left, right: oversized },
      })
    ).kind,
    'error',
  );
  assert.equal(reads, 0);
  const failure = await runInvestigationPackageOperation({
    kind: 'textCompare',
    input: { left, right: new Blob(['x']) },
  });
  assert.equal(failure.kind, 'error');
  assert.doesNotMatch(JSON.stringify(failure), /private content|private transport/);
  const success = await runInvestigationPackageOperation({
    kind: 'textCompare',
    input: {
      left: new Blob(['one two three four five']),
      right: new Blob(['one two three four five']),
    },
  });
  assert.equal(success.kind, 'textCompare');
});

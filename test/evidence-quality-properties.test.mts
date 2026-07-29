import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';

import fc from 'fast-check';

import {
  createLookupProgressFinal,
  createLookupProgressNdjsonDecoder,
  createLookupProgressReducer,
  createLookupProgressSource,
  createLookupProgressStart,
  encodeLookupProgressEvent,
} from '../lib/lookup-progress.mts';
import { parseSslblCertificateCsv } from '../tools/sslbl-snapshot.mts';
import {
  FIRST_USE_STUDY_TASK_DIGEST_SHA256,
  buildFirstUseStudyReport,
  buildFirstUseStudySessionTemplate,
} from '../tools/first-use-analyst-study.mts';

function fingerprint(value: Uint8Array): string {
  return Buffer.from(value).toString('hex');
}

describe('evidence-quality contract properties', () => {
  test('normalizes every bounded unique SSLBL fingerprint set deterministically', () => {
    fc.assert(fc.property(
      fc.array(fc.uint8Array({ minLength: 20, maxLength: 20 }), {
        minLength: 1,
        maxLength: 40,
      }),
      (values) => {
        const fingerprints = [...new Set(values.map(fingerprint))];
        const rows = fingerprints.map((value, index) => (
          `2026-07-29 00:00:${String(index % 60).padStart(2, '0')},${value},omitted reason`
        ));
        const raw = [
          '# Last updated: 2026-07-29 00:01:00 UTC',
          ...rows,
          '',
        ].join('\n');
        const parsed = parseSslblCertificateCsv(raw);
        assert.deepEqual(parsed.fingerprints, [...fingerprints].sort());
        assert.equal(parsed.fingerprints.length, new Set(parsed.fingerprints).size);
        assert.match(parsed.entriesDigestSha256, /^[a-f0-9]{64}$/u);
      },
    ), { numRuns: 80 });
  });

  test('reconstructs a complete progress contract across arbitrary UTF-8 chunk boundaries', () => {
    fc.assert(fc.property(
      fc.string({ maxLength: 500 }),
      fc.array(fc.integer({ min: 1, max: 41 }), { minLength: 1, maxLength: 60 }),
      (label, chunkSizes) => {
        const sources = ['rdap'] as const;
        const final = { schema: 'fixture.lookup', version: 1, label };
        const encoded = [
          encodeLookupProgressEvent(createLookupProgressStart('deep', sources)),
          encodeLookupProgressEvent(createLookupProgressSource(
            1,
            'rdap',
            'success',
            { label },
            { complete: true },
          )),
          encodeLookupProgressEvent(createLookupProgressFinal(2, sources, final)),
        ].join('');
        const reducer = createLookupProgressReducer({
          validateFinalResult: (value) => JSON.stringify(value) === JSON.stringify(final),
        });
        const decoder = createLookupProgressNdjsonDecoder((event) => reducer.apply(event));
        const bytes = new TextEncoder().encode(encoded);
        let offset = 0;
        let chunkIndex = 0;
        while (offset < bytes.length) {
          const size = chunkSizes[chunkIndex % chunkSizes.length] as number;
          decoder.push(bytes.slice(offset, Math.min(bytes.length, offset + size)));
          offset += size;
          chunkIndex += 1;
        }
        decoder.finish();
        assert.deepEqual(reducer.finish(), final);
      },
    ), { numRuns: 100 });
  });

  test('rejects arbitrary undocumented first-use session fields', () => {
    fc.assert(fc.property(
      fc.constantFrom('participantId', 'target', 'query', 'notes', 'recording'),
      fc.string({ maxLength: 100 }),
      (field, value) => {
        const template = structuredClone(buildFirstUseStudySessionTemplate('desktop'));
        assert.equal(template.taskDigestSha256, FIRST_USE_STUDY_TASK_DIGEST_SHA256);
        assert.throws(
          () => buildFirstUseStudyReport([{ ...template, [field]: value }]),
          /documented fields/iu,
        );
      },
    ), { numRuns: 50 });
  });
});

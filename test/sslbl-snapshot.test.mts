import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_SSLBL_SOURCE_BYTES,
  MAX_SSLBL_SNAPSHOT_SHRINK_RATIO,
  assessSslblSnapshotUpdate,
  buildSslblSnapshotModule,
  parseSslblCertificateCsv,
  parseSslblSnapshotArguments,
} from '../tools/sslbl-snapshot.mts';

const HEADER = `################################################################
# abuse.ch SSLBL SSL Certificate Blacklist (SHA1 Fingerprints) #
# Last updated: 2026-07-29 08:12:44 UTC                        #
# Listingdate,SHA1,Listingreason
`;

function currentSnapshot(fingerprints: readonly string[], overrides: Record<string, unknown> = {}) {
  const sorted = [...fingerprints].sort();
  return {
    sourceUpdatedAt: '2026-07-28T08:12:44.000Z',
    sourceDigestSha256: 'd'.repeat(64),
    entriesDigestSha256: createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex'),
    entryCount: sorted.length,
    fingerprintChunks: [sorted.join('\n') + '\n'],
    ...overrides,
  };
}

describe('SSLBL snapshot generator', () => {
  test('normalizes a bounded operator-downloaded feed and omits reasons', () => {
    const raw = `${HEADER}2026-07-29 08:12:44,${'b'.repeat(40)},Fixture family C&C
2026-07-29 08:12:40,${'a'.repeat(40)},Another fixture reason
`;
    const parsed = parseSslblCertificateCsv(raw);
    assert.equal(parsed.sourceUpdatedAt, '2026-07-29T08:12:44.000Z');
    assert.deepEqual(parsed.fingerprints, ['a'.repeat(40), 'b'.repeat(40)]);
    assert.match(parsed.sourceDigestSha256, /^[a-f0-9]{64}$/u);
    const output = buildSslblSnapshotModule(parsed, '2026-07-29T09:00:00.000Z');
    assert.match(output, /entryCount: 2/u);
    assert.doesNotMatch(output, /Fixture family|Another fixture reason/u);
  });

  test('rejects malformed, duplicate, empty, and oversized feeds', () => {
    assert.throws(() => parseSslblCertificateCsv(''), /between 1 byte/iu);
    assert.throws(
      () => parseSslblCertificateCsv(`${HEADER}bad row\n`),
      /malformed row/iu,
    );
    const duplicate = `${HEADER}2026-07-29 08:12:44,${'a'.repeat(40)},One
2026-07-29 08:12:44,${'a'.repeat(40)},Two
`;
    assert.throws(() => parseSslblCertificateCsv(duplicate), /duplicate fingerprint/iu);
    assert.throws(
      () => parseSslblCertificateCsv('x'.repeat(MAX_SSLBL_SOURCE_BYTES + 1)),
      /between 1 byte/iu,
    );
  });

  test('requires an input path and bounds CLI options', () => {
    assert.deepEqual(
      parseSslblSnapshotArguments([
        '--input=/tmp/feed.csv',
        '--output=/tmp/snapshot.mts',
        '--generated-at=2026-07-29T09:00:00Z',
      ]),
      {
        input: '/tmp/feed.csv',
        output: '/tmp/snapshot.mts',
        generatedAt: '2026-07-29T09:00:00.000Z',
        checkOnly: false,
        allowLargeShrink: false,
      },
    );
    assert.deepEqual(
      parseSslblSnapshotArguments([
        '--input=/tmp/feed.csv',
        '--generated-at=2026-07-29T09:00:00Z',
        '--check-only',
        '--allow-large-shrink',
      ]),
      {
        input: '/tmp/feed.csv',
        output: 'lib/sslbl-certificates.generated.mts',
        generatedAt: '2026-07-29T09:00:00.000Z',
        checkOnly: true,
        allowLargeShrink: true,
      },
    );
    assert.throws(() => parseSslblSnapshotArguments([]), /input/iu);
    assert.throws(
      () => parseSslblSnapshotArguments(['--input=/tmp/feed.csv', '--unexpected=yes']),
      /unknown option/iu,
    );
  });

  test('reports update deltas and rejects rollback, future data, and implausible shrinkage', () => {
    const retained = Array.from({ length: 8 }, (_, index) => index.toString(16).padStart(40, '0'));
    const added = 'f'.repeat(40);
    const next = {
      sourceUpdatedAt: '2026-07-29T08:12:44.000Z',
      sourceDigestSha256: 'e'.repeat(64),
      entriesDigestSha256: createHash('sha256').update([...retained, added].sort().join('\n'), 'utf8').digest('hex'),
      fingerprints: [...retained, added].sort(),
    };
    const assessment = assessSslblSnapshotUpdate(next, '2026-07-29T09:00:00.000Z', {
      currentSnapshot: currentSnapshot(retained),
    });
    assert.deepEqual(
      { added: assessment.added, removed: assessment.removed, unchanged: assessment.unchanged },
      { added: 1, removed: 0, unchanged: 8 },
    );
    assert.throws(
      () => assessSslblSnapshotUpdate(
        { ...next, sourceUpdatedAt: '2026-07-27T08:12:44.000Z' },
        '2026-07-29T09:00:00.000Z',
        { currentSnapshot: currentSnapshot(retained) },
      ),
      /moved backwards/iu,
    );
    assert.throws(
      () => assessSslblSnapshotUpdate(next, '2026-07-29T07:00:00.000Z', {
        currentSnapshot: currentSnapshot(retained),
      }),
      /must not be later/iu,
    );
    const kept = retained.slice(0, Math.floor(retained.length * (1 - MAX_SSLBL_SNAPSHOT_SHRINK_RATIO)) - 1);
    const shrunk = {
      sourceUpdatedAt: '2026-07-29T08:12:44.000Z',
      sourceDigestSha256: 'e'.repeat(64),
      entriesDigestSha256: createHash('sha256').update(kept.join('\n'), 'utf8').digest('hex'),
      fingerprints: kept,
    };
    assert.throws(
      () => assessSslblSnapshotUpdate(shrunk, '2026-07-29T09:00:00.000Z', {
        currentSnapshot: currentSnapshot(retained),
      }),
      /allow-large-shrink/iu,
    );
    assert.equal(
      assessSslblSnapshotUpdate(shrunk, '2026-07-29T09:00:00.000Z', {
        currentSnapshot: currentSnapshot(retained),
        allowLargeShrink: true,
      }).largeShrink,
      true,
    );
  });
});

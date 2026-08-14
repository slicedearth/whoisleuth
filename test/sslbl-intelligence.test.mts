import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  SSLBL_SNAPSHOT_EXPIRED_AGE_MS,
  SSLBL_SNAPSHOT_MAX_AGE_MS,
  inspectSslblCertificate,
  sslblSnapshotHealth,
} from '../lib/sslbl-intelligence.mts';

const FINGERPRINT = 'a'.repeat(40);
const OTHER_FINGERPRINT = 'b'.repeat(40);
const SOURCE_UPDATED_AT = '2026-07-20T00:00:00.000Z';

function digest(entries: readonly string[]): string {
  return createHash('sha256').update([...entries].sort().join('\n'), 'utf8').digest('hex');
}

function snapshot(
  entries: readonly string[] = [FINGERPRINT],
  overrides: Record<string, unknown> = {},
) {
  return {
    schema: 'whoisleuth.sslbl-certificate-snapshot',
    version: 1,
    source: 'https://sslbl.abuse.ch/blacklist/sslblacklist.csv',
    sourceUpdatedAt: SOURCE_UPDATED_AT,
    generatedAt: '2026-07-20T00:05:00.000Z',
    sourceDigestSha256: 'c'.repeat(64),
    entriesDigestSha256: digest(entries),
    entryCount: entries.length,
    fingerprintChunks: [entries.join('\n') + '\n'],
    ...overrides,
  };
}

function tls(fingerprint = FINGERPRINT) {
  return { certificate: { fingerprintSha1: fingerprint } };
}

describe('local SSLBL certificate intelligence', () => {
  test('requires explicit snapshot timestamps and canonicalizes offsets', () => {
    assert.equal(sslblSnapshotHealth({
      snapshot: snapshot([FINGERPRINT], { sourceUpdatedAt: '2026-07-20T12:00:00.000' }),
      now: '2026-07-21T00:00:00.000Z',
    }).state, 'invalid');
    const offset = sslblSnapshotHealth({
      snapshot: snapshot([FINGERPRINT], {
        sourceUpdatedAt: '2026-07-20T12:00:00.000+01:00',
        generatedAt: '2026-07-20T12:05:00.000+01:00',
      }),
      now: '2026-07-21T11:00:00.000Z',
    });
    assert.equal(offset.sourceUpdatedAt, '2026-07-20T11:00:00.000Z');
    assert.equal(offset.generatedAt, '2026-07-20T11:05:00.000Z');
  });

  test('reports a current exact match without making a provider request', () => {
    const result = inspectSslblCertificate(tls(), {
      snapshot: snapshot(),
      now: '2026-07-21T00:00:00.000Z',
    });
    assert.equal(result.status, 'success');
    assert.equal(result.verdict, 'listed');
    assert.equal(result.complete, true);
    assert.equal(result.fingerprintSha1, FINGERPRINT);
    assert.equal(result.snapshot.entryCount, 1);
    assert.equal(result.snapshot.digestSha256, digest([FINGERPRINT]));
    assert.equal(
      result.referenceUrl,
      `https://sslbl.abuse.ch/ssl-certificates/sha1/${FINGERPRINT}/`,
    );
    assert.match(result.limitations.join(' '), /exact observed leaf-certificate/iu);
  });

  test('keeps a current miss bounded and explicitly non-exculpatory', () => {
    const result = inspectSslblCertificate(tls(OTHER_FINGERPRINT), {
      snapshot: snapshot(),
      now: '2026-07-21T00:00:00.000Z',
    });
    assert.equal(result.status, 'success');
    assert.equal(result.verdict, 'not_listed');
    assert.equal(result.complete, true);
    assert.equal(result.referenceUrl, null);
    assert.match(result.limitations.join(' '), /not evidence.*safe/iu);
  });

  test('preserves a stale positive but never turns a stale miss into absence', () => {
    const staleNow = new Date(Date.parse(SOURCE_UPDATED_AT) + SSLBL_SNAPSHOT_MAX_AGE_MS + 1);
    const listed = inspectSslblCertificate(tls(), { snapshot: snapshot(), now: staleNow });
    const missed = inspectSslblCertificate(tls(OTHER_FINGERPRINT), { snapshot: snapshot(), now: staleNow });
    assert.equal(listed.status, 'stale');
    assert.equal(listed.verdict, 'listed');
    assert.equal(listed.complete, false);
    assert.equal(missed.status, 'stale');
    assert.equal(missed.verdict, 'inconclusive');
    assert.equal(missed.complete, false);
  });

  test('fails closed for expired, internally inconsistent, or unavailable inputs', () => {
    const expiredNow = new Date(Date.parse(SOURCE_UPDATED_AT) + SSLBL_SNAPSHOT_EXPIRED_AGE_MS + 1);
    assert.equal(
      inspectSslblCertificate(tls(), { snapshot: snapshot(), now: expiredNow }).status,
      'unavailable',
    );
    assert.equal(
      inspectSslblCertificate(tls(), {
        snapshot: snapshot([FINGERPRINT], { entriesDigestSha256: 'd'.repeat(64) }),
        now: '2026-07-21T00:00:00.000Z',
      }).status,
      'unavailable',
    );
    const missing = inspectSslblCertificate({}, {
      snapshot: snapshot(),
      now: '2026-07-21T00:00:00.000Z',
    });
    assert.equal(missing.status, 'unavailable');
    assert.equal(missing.verdict, 'inconclusive');
  });

  test('reports bounded operator health and rejects future-dated source data', () => {
    assert.deepEqual(
      sslblSnapshotHealth({
        snapshot: snapshot(),
        now: '2026-07-21T00:00:00.000Z',
      }),
      {
        state: 'current',
        sourceUpdatedAt: SOURCE_UPDATED_AT,
        generatedAt: '2026-07-20T00:05:00.000Z',
        ageSeconds: 86_400,
        entryCount: 1,
        digestSha256: digest([FINGERPRINT]),
        detail: 'The local SSLBL certificate snapshot is current.',
      },
    );
    const future = snapshot([FINGERPRINT], {
      sourceUpdatedAt: '2026-07-22T00:00:00.000Z',
      generatedAt: '2026-07-22T00:05:00.000Z',
    });
    assert.equal(
      sslblSnapshotHealth({ snapshot: future, now: '2026-07-21T00:00:00.000Z' }).state,
      'invalid',
    );
    assert.equal(
      inspectSslblCertificate(tls(), {
        snapshot: future,
        now: '2026-07-21T00:00:00.000Z',
      }).status,
      'unavailable',
    );
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatSslblSnapshotHealth,
  sslblStatusMain,
} from '../tools/source-health.mts';
import {
  SSLBL_SNAPSHOT_EXPIRED_AGE_MS,
  SSLBL_SNAPSHOT_MAX_AGE_MS,
  sslblSnapshotHealth,
} from '../lib/sslbl-intelligence.mts';
import { SSLBL_CERTIFICATE_SNAPSHOT } from '../lib/sslbl-certificates.generated.mts';

function atAge(ageMs: number): string {
  return new Date(
    Date.parse(SSLBL_CERTIFICATE_SNAPSHOT.sourceUpdatedAt) + ageMs,
  ).toISOString();
}

describe('local SSLBL snapshot health command', () => {
  test('reports current, stale, and expired states with distinct exit codes', () => {
    for (const [age, state, exitCode] of [
      [SSLBL_SNAPSHOT_MAX_AGE_MS - 1, 'current', 0],
      [SSLBL_SNAPSHOT_MAX_AGE_MS + 1, 'stale', 1],
      [SSLBL_SNAPSHOT_EXPIRED_AGE_MS + 1, 'expired', 2],
    ] as const) {
      let stdout = '';
      let stderr = '';
      assert.equal(sslblStatusMain(['--json'], {
        now: atAge(age),
        stdout: { write(value) { stdout += value; } },
        stderr: { write(value) { stderr += value; } },
      }), exitCode);
      assert.equal(JSON.parse(stdout).state, state);
      assert.equal(stderr, '');
    }
  });

  test('formats bounded metadata and rejects unknown options', () => {
    const health = sslblSnapshotHealth({ now: atAge(1_000) });
    const output = formatSslblSnapshotHealth(health);
    assert.match(output, /Network requests: 0/u);
    assert.doesNotMatch(output, /fingerprintChunks|listing reason/iu);
    let stderr = '';
    assert.equal(sslblStatusMain(['--unknown'], {
      stdout: { write() {} },
      stderr: { write(value) { stderr += value; } },
    }), 2);
    assert.match(stderr, /Usage:/u);
  });
});

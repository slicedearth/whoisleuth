import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { CISA_KEV_CATALOG } from '../lib/generated/cisa-kev-catalog.mts';
import {
  SOURCE_RELEASED_AT,
  SOURCE_SHA256,
  SOURCE_VERSION,
  moduleDigest,
  parseArguments,
  projectCatalogue,
} from '../tools/cisa-kev-catalog.mts';

describe('pinned CISA KEV projection', () => {
  test('verifies generated provenance and digest', async () => {
    const [moduleText, expectedDigest] = await Promise.all([
      readFile(new URL('../lib/generated/cisa-kev-catalog.mts', import.meta.url), 'utf8'),
      readFile(new URL('../lib/generated/cisa-kev-catalog.sha256', import.meta.url), 'utf8'),
    ]);
    assert.equal(moduleDigest(moduleText), expectedDigest.trim());
    assert.equal(CISA_KEV_CATALOG.catalogVersion, SOURCE_VERSION);
    assert.equal(CISA_KEV_CATALOG.releasedAt, SOURCE_RELEASED_AT);
    assert.equal(CISA_KEV_CATALOG.sourceSha256, SOURCE_SHA256);
    assert.equal(CISA_KEV_CATALOG.identifiers.length, 1_657);
  });

  test('projects only unique valid identifiers in deterministic order', () => {
    const projected = projectCatalogue({
      catalogVersion: 'fixture-v1',
      dateReleased: '2026-08-01T00:00:00.000Z',
      count: 2,
      vulnerabilities: [{ cveID: 'CVE-2026-10001' }, { cveID: 'CVE-2025-9999' }],
    }, 'fixture-v1', '2026-08-01T00:00:00.000Z');
    assert.deepEqual(projected, ['CVE-2025-9999', 'CVE-2026-10001']);
    assert.throws(() => projectCatalogue({
      catalogVersion: 'fixture-v1',
      dateReleased: '2026-08-01T00:00:00.000Z',
      count: 1,
      vulnerabilities: [{ cveID: 'not-a-cve' }],
    }, 'fixture-v1', '2026-08-01T00:00:00.000Z'), /invalid CVE/);
  });

  test('requires an explicit source and exactly one mode', () => {
    assert.deepEqual(parseArguments(['--source', '/tmp/kev.json', '--check']), { mode: 'check', source: '/tmp/kev.json' });
    assert.throws(() => parseArguments([]), /Usage/);
    assert.throws(() => parseArguments(['--source', '/tmp/kev.json', '--check', '--write']), /Usage/);
  });
});

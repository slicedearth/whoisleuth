import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { RETIRE_BROWSER_CATALOG } from '../lib/generated/retire-browser-catalog.mts';
import {
  SOURCE_REVISION,
  SOURCE_SHA256,
  SOURCE_VERSION,
  moduleDigest,
  parseArguments,
  projectRepository,
  qualifyRepositoryExpressions,
  renderModule,
} from '../tools/retire-browser-catalog.mts';

function fixtureRepository(vulnerabilityCount = 1) {
  return {
    fixture: {
      extractors: {
        filename: ['fixture-([0-9][0-9.a-z_\\-]+)\\.js'],
      },
      vulnerabilities: Array.from({ length: vulnerabilityCount }, (_, index) => ({
        below: `2.${index}.0`,
        severity: 'medium',
        cwe: ['CWE-79'],
        identifiers: { CVE: [`CVE-2026-${String(index).padStart(4, '0')}`] },
      })),
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

describe('pinned browser-library catalogue projection', () => {
  test('automatically verifies the checked-in generated module digest', async () => {
    const [moduleText, expectedDigest] = await Promise.all([
      readFile(new URL('../lib/generated/retire-browser-catalog.mts', import.meta.url), 'utf8'),
      readFile(new URL('../lib/generated/retire-browser-catalog.sha256', import.meta.url), 'utf8'),
    ]);
    assert.match(expectedDigest.trim(), /^[a-f0-9]{64}$/u);
    assert.equal(moduleDigest(moduleText), expectedDigest.trim());
  });

  test('keeps generated provenance synchronized with the maintenance tool', () => {
    assert.equal(RETIRE_BROWSER_CATALOG.catalogVersion, `retire.js-${SOURCE_VERSION}`);
    assert.equal(RETIRE_BROWSER_CATALOG.sourceRevision, SOURCE_REVISION);
    assert.equal(RETIRE_BROWSER_CATALOG.sourceSha256, SOURCE_SHA256);
  });

  test('projects and renders deterministic bounded catalogue data', () => {
    const projected = projectRepository(fixtureRepository(130));
    const vulnerabilities = record(projected.fixture).vulnerabilities;

    assert.ok(Array.isArray(vulnerabilities));
    assert.equal(vulnerabilities.length, 128);
    assert.equal(renderModule(projected), renderModule(projectRepository(fixtureRepository(130))));
    assert.doesNotMatch(renderModule(projected), /129/);
  });

  test('qualifies retained expressions in an isolated bounded worker', () => {
    assert.doesNotThrow(() => qualifyRepositoryExpressions(projectRepository(fixtureRepository())));
    assert.throws(() => qualifyRepositoryExpressions(projectRepository({
      fixture: {
        extractors: { filecontent: ['^(a+)+$'] },
        vulnerabilities: [],
      },
    }), { timeoutMs: 100 }), /isolated time limit/iu);
  });

  test('requires one explicit source and either check or write mode', () => {
    assert.deepEqual(
      parseArguments(['--source', '/tmp/catalogue.json', '--check']),
      { mode: 'check', source: '/tmp/catalogue.json' },
    );
    assert.deepEqual(
      parseArguments(['--write', '--source', '/tmp/catalogue.json']),
      { mode: 'write', source: '/tmp/catalogue.json' },
    );
    assert.throws(() => parseArguments([]), /Usage/);
    assert.throws(() => parseArguments(['--source', '/tmp/catalogue.json', '--check', '--write']), /Usage/);
  });
});

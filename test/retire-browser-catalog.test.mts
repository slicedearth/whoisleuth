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

  test('retains every valid advisory through the component limit without changing order', () => {
    for (const count of [1, 128, 129, 159, 256]) {
      const source = fixtureRepository(count);
      const projected = projectRepository(source);

      assert.deepEqual(record(projected.fixture).vulnerabilities, source.fixture.vulnerabilities);
      assert.equal(renderModule(projected), renderModule(projectRepository(source)));
    }
  });

  test('rejects oversized advisory input before parsing its records or extractors', () => {
    const source = fixtureRepository(257);
    Object.defineProperty(source.fixture.vulnerabilities, 0, {
      get() { throw new Error('An oversized advisory record was read.'); },
    });
    Object.defineProperty(source.fixture, 'extractors', {
      get() { throw new Error('Oversized component extractors were read.'); },
    });

    assert.throws(() => projectRepository(source), {
      name: 'RangeError',
      message: /fixture.*257 advisories.*256.*without truncation/u,
    });
  });

  test('does not conceal oversized advisory input by filtering invalid records or missing extractors', () => {
    for (const extractors of [{}, fixtureRepository().fixture.extractors]) {
      assert.throws(() => projectRepository({
        fixture: { extractors, vulnerabilities: Array.from({ length: 257 }, () => null) },
      }), {
        name: 'RangeError',
        message: /fixture.*257 advisories.*256.*without truncation/u,
      });
    }
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

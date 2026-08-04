import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as coverage from '../frontend/src/lib/analysis/coverage.ts';
import { requiredValue } from './value-assertions.mts';

describe('defensive-registration coverage', () => {
  test('counts unique domains while retaining overlapping mutation groups', () => {
    const results = [
      { domain: 'open.com', availability: 'available', candidateTld: 'com', mutationTypes: ['character_omission'] },
      { domain: 'taken.com', availability: 'registered', candidateTld: 'com', mutationTypes: ['character_omission', 'bitsquatting'] },
      { domain: 'unknown.net', availability: 'error', candidateTld: 'net', mutationTypes: ['dictionary'] },
    ];
    const generated = [
      ...results,
      { domain: 'owned.net', source: 'brand.com', tld: 'net', mutationTypes: ['dictionary'] },
    ];
    const report = coverage.buildCoverageReport(
      results,
      generated,
      new Set(['owned.net']),
      { character_omission: 'Omission', bitsquatting: 'Bitsquatting', dictionary: 'Dictionary' }
    );

    assert.deepEqual(report.summary, {
      total: 4,
      protected: 1,
      registered: 1,
      available: 1,
      unknown: 1,
      coveragePercent: 25,
    });
    const omission = requiredValue(report.mutationGroups.find((group) => group.key === 'character_omission'));
    assert.equal(omission.total, 2);
    assert.equal(omission.available, 1);
    assert.equal(omission.registered, 1);
    const dictionary = requiredValue(report.mutationGroups.find((group) => group.key === 'dictionary'));
    assert.equal(dictionary.protected, 1);
    assert.equal(dictionary.unknown, 1);
    assert.equal(requiredValue(report.tldGroups.find((group) => group.key === 'net')).total, 2);
    assert.deepEqual(report.plan.map((row) => [row.domain, row.priority, row.action]), [
      ['open.com', 'P1', 'review_acquisition'],
      ['unknown.net', 'P1', 'resolve_evidence'],
      ['taken.com', 'P2', 'investigate_registration'],
      ['owned.net', 'P3', 'verify_protection'],
    ]);
  });

  test('does not add unscanned, unprotected generated domains to a report', () => {
    const report = coverage.buildCoverageReport(
      [{ domain: 'scanned.com', availability: 'available', mutationTypes: ['dictionary'] }],
      [{ domain: 'removed.com', tld: 'com', mutationTypes: ['dictionary'] }],
      new Set(),
      { dictionary: 'Dictionary' }
    );
    assert.equal(report.summary.total, 1);
    assert.equal(requiredValue(report.candidates[0]).domain, 'scanned.com');
  });
});

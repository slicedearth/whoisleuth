import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as coverage from '../frontend/src/lib/analysis/coverage.ts';
import * as provenance from '../frontend/src/lib/analysis/candidate-provenance.ts';
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

describe('candidate provenance context', () => {
  test('merges duplicate candidate metadata without losing mutation families', () => {
    provenance.setCandidateProvenance([
      { domain: 'EXAMPLE.com', source: 'brand.com', tld: 'com', mutationTypes: ['dictionary'] },
      { domain: 'example.com', source: 'brand.com', tld: 'com', mutationTypes: ['bitsquatting'] },
    ]);
    assert.deepEqual(
      requiredValue(provenance.getCandidateProvenance('example.com')).mutationTypes,
      ['dictionary', 'bitsquatting'],
    );
    assert.equal(provenance.listCandidateProvenance().length, 1);
  });

  test('restores provenance from stored bulk-result field names', () => {
    provenance.setCandidateProvenance([
      {
        domain: 'stored.example',
        sourceDomain: 'brand.example',
        candidateTld: 'example',
        mutationTypes: ['dictionary'],
      },
    ]);
    assert.deepEqual(provenance.getCandidateProvenance('stored.example'), {
      domain: 'stored.example',
      source: 'brand.example',
      tld: 'example',
      mutationTypes: ['dictionary'],
    });
  });
});

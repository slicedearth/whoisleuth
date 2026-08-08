import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as coverage from '../frontend/src/lib/analysis/coverage.ts';
import { requiredValue } from './value-assertions.mts';

describe('defensive-registration profile listing', () => {
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
      profileListed: 1,
      registered: 1,
      available: 1,
      unknown: 2,
      profileListedShare: 25,
    });
    const omission = requiredValue(report.mutationGroups.find((group) => group.key === 'character_omission'));
    assert.equal(omission.total, 2);
    assert.equal(omission.available, 1);
    assert.equal(omission.registered, 1);
    const dictionary = requiredValue(report.mutationGroups.find((group) => group.key === 'dictionary'));
    assert.equal(dictionary.profileListed, 1);
    assert.equal(dictionary.unknown, 2);
    assert.equal(requiredValue(report.tldGroups.find((group) => group.key === 'net')).total, 2);
    assert.deepEqual(report.plan.map((row) => [row.domain, row.priority, row.action]), [
      ['open.com', 'P1', 'review_acquisition'],
      ['owned.net', 'P1', 'resolve_evidence'],
      ['unknown.net', 'P1', 'resolve_evidence'],
      ['taken.com', 'P2', 'investigate_registration'],
    ]);
    assert.match(report.limitation, /separate from the retained registration outcome/iu);
    assert.equal(report.plan.find((row) => row.domain === 'owned.net')?.profileListed, true);
    assert.equal(report.summary.registered + report.summary.available + report.summary.unknown, report.summary.total);
  });

  test('keeps profile membership independent from authoritative registration outcomes and priorities', () => {
    const report = coverage.buildCoverageReport(
      [
        { domain: 'listed-available.example', availability: 'available', mutationTypes: ['dictionary'] },
        { domain: 'listed-registered.example', availability: 'registered', mutationTypes: ['dictionary'] },
      ],
      [],
      new Set(['listed-available.example', 'listed-registered.example']),
      { dictionary: 'Dictionary' },
    );

    assert.deepEqual(report.summary, {
      total: 2,
      profileListed: 2,
      registered: 1,
      available: 1,
      unknown: 0,
      profileListedShare: 100,
    });
    assert.deepEqual(report.plan.map((row) => [row.domain, row.status, row.profileListed, row.priority, row.action]), [
      ['listed-available.example', 'available', true, 'P1', 'review_acquisition'],
      ['listed-registered.example', 'registered', true, 'P2', 'investigate_registration'],
    ]);
  });

  test('does not add unscanned, profile-unlisted generated domains to a report', () => {
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

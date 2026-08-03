import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  classifyBulkSourceCoverage,
  describeBulkSourceCoverage,
  isExpectedUnsupportedBulkSource,
  limitedBulkSources,
} from '../frontend/src/lib/analysis/bulk-source-coverage.ts';

describe('authority-aware Bulk source coverage', () => {
  const unsupportedWhois = { source: 'whois', state: 'unsupported' };

  test('keeps a documented RDAP-only registry out of the limited classification', () => {
    const coverage = [
      { source: 'rdap', state: 'complete' },
      unsupportedWhois,
    ];
    assert.equal(isExpectedUnsupportedBulkSource('candidate.dev', unsupportedWhois), true);
    assert.equal(classifyBulkSourceCoverage('candidate.dev', coverage), 'complete');
    assert.deepEqual(limitedBulkSources('candidate.dev', coverage), []);
    assert.equal(
      describeBulkSourceCoverage('candidate.dev', unsupportedWhois),
      'whois: unsupported (no IANA-published service)',
    );
  });

  test('keeps an unexpected unsupported source limited when the service is published', () => {
    const coverage = [
      { source: 'rdap', state: 'complete' },
      unsupportedWhois,
    ];
    assert.equal(isExpectedUnsupportedBulkSource('candidate.com', unsupportedWhois), false);
    assert.equal(classifyBulkSourceCoverage('candidate.com', coverage), 'limited');
    assert.deepEqual(limitedBulkSources('candidate.com', coverage), ['whois']);
  });

  test('preserves unavailable, partial and skipped interpretation boundaries', () => {
    assert.equal(classifyBulkSourceCoverage('candidate.dev', []), 'unrecorded');
    assert.deepEqual(limitedBulkSources('candidate.dev', [
      { source: 'dns', state: 'unavailable' },
      { source: 'rdap', state: 'partial' },
      { source: 'whois', state: 'skipped' },
    ]), ['dns', 'rdap']);
    assert.deepEqual(limitedBulkSources('candidate.dev', [
      { source: 'whois', state: 'skipped' },
    ], { includeSkipped: true }), ['whois']);
  });

  test('fails closed for malformed domains and bounded source entries', () => {
    assert.equal(classifyBulkSourceCoverage('not a domain', [unsupportedWhois]), 'limited');
    assert.equal(classifyBulkSourceCoverage('candidate.dev', [{ source: 'whois', state: 'error' }]), 'limited');
    assert.equal(classifyBulkSourceCoverage('candidate.dev', [{ source: '\u0000whois', state: 'unsupported' }]), 'unrecorded');
  });
});

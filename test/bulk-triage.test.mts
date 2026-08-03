import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildBulkTriageGroups,
  bulkAdvancedFilterOptions,
  matchesBulkAdvancedFilters,
  type BulkAdvancedFilters,
  type BulkTriageRow,
} from '../frontend/src/lib/analysis/bulk-triage.ts';

const NOW = Date.parse('2026-07-28T00:00:00.000Z');
const CLEAR_FILTERS: BulkAdvancedFilters = {
  source: '',
  lifecycle: '',
  age: '',
  mail: '',
  registrar: '',
  caseDisposition: '',
};

function row(domain: string, overrides: Partial<BulkTriageRow> = {}): BulkTriageRow {
  return {
    domain,
    availability: 'registered',
    registrar: 'Example Registrar',
    mutationTypes: ['omission'],
    nameservers: ['ns1.example.invalid', 'ns2.example.invalid'],
    sourceCoverage: [{ source: 'rdap', state: 'complete' }, { source: 'whois', state: 'skipped' }],
    createdDate: '2026-07-20T00:00:00.000Z',
    hasMx: true,
    hasSpf: true,
    hasDmarc: true,
    caseDisposition: 'untracked',
    ...overrides,
  };
}

describe('Bulk triage filters and grouping', () => {
  test('keeps source limitations, unrecorded coverage, age, mail, and case states explicit', () => {
    const limited = row('limited.invalid', {
      sourceCoverage: [{ source: 'rdap', state: 'partial' }],
      createdDate: '2025-01-01T00:00:00.000Z',
      hasDmarc: false,
      caseDisposition: 'suspicious',
    });
    assert.equal(matchesBulkAdvancedFilters(limited, { ...CLEAR_FILTERS, source: 'limited' }, NOW), true);
    assert.equal(matchesBulkAdvancedFilters(limited, { ...CLEAR_FILTERS, age: 'older_365' }, NOW), true);
    assert.equal(matchesBulkAdvancedFilters(limited, { ...CLEAR_FILTERS, mail: 'auth_gap' }, NOW), true);
    assert.equal(matchesBulkAdvancedFilters(limited, { ...CLEAR_FILTERS, caseDisposition: 'suspicious' }, NOW), true);
    assert.equal(matchesBulkAdvancedFilters(limited, { ...CLEAR_FILTERS, source: 'complete' }, NOW), false);
    assert.equal(matchesBulkAdvancedFilters(
      row('candidate.dev', {
        sourceCoverage: [
          { source: 'rdap', state: 'complete' },
          { source: 'whois', state: 'unsupported' },
        ],
      }),
      { ...CLEAR_FILTERS, source: 'complete' },
      NOW,
    ), true);
    assert.equal(matchesBulkAdvancedFilters(
      row('candidate.com', {
        sourceCoverage: [
          { source: 'rdap', state: 'complete' },
          { source: 'whois', state: 'unsupported' },
        ],
      }),
      { ...CLEAR_FILTERS, source: 'limited' },
      NOW,
    ), true);
    assert.equal(matchesBulkAdvancedFilters(
      row('unrecorded.invalid', { sourceCoverage: [], createdDate: null, hasMx: null }),
      { ...CLEAR_FILTERS, source: 'unrecorded', age: 'unknown', mail: 'unknown' },
      NOW,
    ), true);
  });

  test('derives only observed lifecycle, registrar, and disposition options', () => {
    const options = bulkAdvancedFilterOptions([
      row('first.invalid'),
      row('second.invalid', { availability: 'available', registrar: 'Other Registrar', caseDisposition: 'benign' }),
      row('error.invalid', { registrar: '—' }),
    ]);
    assert.deepEqual(options.lifecycle, ['available', 'registered']);
    assert.deepEqual(options.registrars, ['Example Registrar', 'Other Registrar']);
    assert.deepEqual(options.caseDispositions, ['benign', 'untracked']);
  });

  test('groups observed dimensions without turning shared infrastructure into a conclusion', () => {
    const rows = [
      row('first.invalid', { mutationTypes: ['omission', 'hyphenation'] }),
      row('second.invalid', { mutationTypes: ['omission'] }),
      row('third.example', { registrar: 'Other Registrar', nameservers: [], mutationTypes: [] }),
    ];
    const mutations = buildBulkTriageGroups(rows, 'mutation');
    assert.equal(mutations.overlapping, true);
    assert.deepEqual(mutations.groups[0], {
      key: 'omission',
      label: 'omission',
      domains: ['first.invalid', 'second.invalid'],
    });
    const endings = buildBulkTriageGroups(rows, 'tld');
    assert.deepEqual(endings.groups.map((group) => group.label), ['.invalid', '.example']);
    const nameservers = buildBulkTriageGroups(rows, 'nameserver');
    assert.equal(nameservers.groups[0]?.domains.length, 2);
    assert.equal(nameservers.excluded, 1);
  });
});

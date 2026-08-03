import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_HELP_ENTRIES,
  normalizeRdapSearchHelp,
  planRdapReverseSearch,
} from '../lib/rdap-search-workbench.mts';

describe('RDAP reverse-search workbench', () => {
  test('normalizes supported RFC-style help declarations without executing a request', () => {
    const summary = normalizeRdapSearchHelp({
      reverse_search_properties: [
        { searchableResourceType: 'domains', relatedResourceType: 'entities', property: 'handle' },
        { searchableResourceType: 'ips', relatedResourceType: 'entities', property: 'email' },
      ],
    });

    assert.equal(summary.state, 'supported');
    assert.equal(summary.capabilities.length, 2);
    assert.equal(summary.capabilities[0]?.disclosure, 'identifier');
    assert.equal(summary.capabilities[1]?.disclosure, 'contact');
  });

  test('requires the exact advertised tuple before producing a bounded plan', () => {
    const help = normalizeRdapSearchHelp({
      reverse_search_properties: [
        { searchableResourceType: 'autnums', relatedResourceType: 'entities', property: 'handle' },
      ],
    });
    const ready = planRdapReverseSearch(help, {
      searchableResourceType: 'autnums',
      relatedResourceType: 'entities',
      property: 'handle',
      value: ' EXAMPLE-HANDLE ',
    });
    assert.deepEqual(ready, {
      schema: 'whoisleuth.rdap-search-workbench',
      version: 1,
      state: 'ready',
      requestPath: '/autnums',
      query: { entities_handle: 'EXAMPLE-HANDLE' },
      disclosure: {
        class: 'identifier',
        summary: 'Would disclose the supplied handle identifier to the selected RDAP server.',
        requiresApproval: true,
      },
      limitation: 'This is an offline request plan. It neither sends the query nor establishes result authority, completeness, or currentness.',
    });

    const unsupported = planRdapReverseSearch(help, {
      searchableResourceType: 'domains',
      relatedResourceType: 'entities',
      property: 'handle',
      value: 'EXAMPLE-HANDLE',
    });
    assert.equal(unsupported.state, 'unsupported');
    assert.equal(unsupported.requestPath, null);
  });

  test('keeps malformed, unknown, absent, and truncated declarations explicit', () => {
    assert.equal(normalizeRdapSearchHelp({}).state, 'unsupported');
    assert.equal(normalizeRdapSearchHelp([]).state, 'invalid');
    assert.equal(normalizeRdapSearchHelp({ reverse_search_properties: 'bad' }).state, 'invalid');

    const entries = Array.from({ length: MAX_HELP_ENTRIES + 2 }, (_, index) => ({
      searchableResourceType: index === 0 ? 'domains' : 'widgets',
      relatedResourceType: 'entities',
      property: index === 1 ? 'unknown_property' : 'handle',
    }));
    const summary = normalizeRdapSearchHelp({ reverse_search_properties: entries });
    assert.equal(summary.state, 'partial');
    assert.equal(summary.truncated, true);
    assert.equal(summary.rejectedCount, 2);
    assert.ok(summary.capabilities.some((entry) => entry.state === 'unsupported'));
  });

  test('rejects control-bearing or oversized query values', () => {
    const help = normalizeRdapSearchHelp({
      reverse_search_properties: [
        { searchableResourceType: 'domains', relatedResourceType: 'entities', property: 'email' },
      ],
    });
    assert.equal(planRdapReverseSearch(help, {
      searchableResourceType: 'domains',
      relatedResourceType: 'entities',
      property: 'email',
      value: 'bad\nvalue',
    }).state, 'invalid');
    assert.equal(planRdapReverseSearch(help, {
      searchableResourceType: 'domains',
      relatedResourceType: 'entities',
      property: 'email',
      value: 'x'.repeat(255),
    }).state, 'invalid');
  });
});

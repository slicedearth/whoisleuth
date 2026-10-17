import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  inspectRdapCapabilities,
  MAX_RDAP_CAPABILITY_DECLARATIONS,
  RDAP_CAPABILITY_INSPECTION_VERSION,
  RDAP_EXTENSION_CATALOG_REVIEWED_AT,
  resolveRdapCapabilityCatalogRevision,
} from '../lib/rdap-capabilities.mts';

describe('RDAP capability inspection', () => {
  test('classifies known, obsolete, and unknown declarations without executing them', () => {
    const result = inspectRdapCapabilities({
      conformance: [
        'rdap_level_0',
        'reverse_search',
        'paging',
        'icann_rdap_response_profile_0',
        'EXPERIMENTAL_EXAMPLE',
      ],
      conformanceTruncated: false,
    }, 'success');

    assert.equal(result.version, RDAP_CAPABILITY_INSPECTION_VERSION);
    assert.equal(result.catalogReviewedAt, RDAP_EXTENSION_CATALOG_REVIEWED_AT);
    assert.equal(result.state, 'complete');
    assert.equal(result.reverseSearch.state, 'advertised');
    assert.equal(result.reverseSearch.execution, 'not_attempted');
    assert.equal(result.reverseSearch.actionAvailable, false);
    assert.equal(
      result.declarations.find((entry) => entry.identifier === 'paging')?.category,
      'standard',
    );
    assert.equal(
      result.declarations.find((entry) => entry.identifier === 'icann_rdap_response_profile_0')?.status,
      'obsolete',
    );
    assert.deepEqual(result.unknownIdentifiers, ['experimental_example']);
  });

  test('does not turn omission from an individual complete response into unsupported', () => {
    const result = inspectRdapCapabilities({
      conformance: ['rdap_level_0'],
      conformanceTruncated: false,
    }, 'success');

    assert.equal(result.state, 'complete');
    assert.equal(result.reverseSearch.state, 'not_advertised');
    assert.match(result.reverseSearch.detail, /help response could still declare/iu);
  });

  test('recognises assessment metadata without treating it as a verified judgement', () => {
    const result = inspectRdapCapabilities({
      conformance: ['reliabilityAssessment'],
      reliabilityAssessment: { score: 100, verdict: 'trusted' },
    }, 'success');

    assert.deepEqual(result.declarations, [{
      identifier: 'reliabilityassessment',
      label: 'Reliability assessment metadata',
      category: 'operator',
      registered: true,
      status: 'current',
      capability: 'Operator-declared assessment metadata; no assessment is retrieved or verified.',
    }]);
    assert.equal(result.reverseSearch.execution, 'not_attempted');
    assert.equal(result.reverseSearch.actionAvailable, false);
    assert.doesNotMatch(JSON.stringify(result), /"score"|"verdict"|trusted/u);
  });

  test('replays the recorded semantic epoch without reclassifying old unknown declarations', () => {
    const input = { conformance: ['rdap_level_0', 'reliabilityAssessment', 'reverse_search'] };
    const before = structuredClone(input);
    for (const reviewedAt of ['2026-07-31', '2026-08-15', '2026-10-13']) {
      const historical = inspectRdapCapabilities(input, 'success', reviewedAt);
      assert.equal(historical.catalogReviewedAt, reviewedAt);
      assert.equal(resolveRdapCapabilityCatalogRevision(reviewedAt), '2026-07-31');
      assert.deepEqual(historical.declarations[1], {
        identifier: 'reliabilityassessment',
        label: 'Unclassified declaration',
        category: 'unknown',
        registered: null,
        status: 'unknown',
        capability: 'The identifier is retained for analyst review but is not interpreted by this catalogue.',
      });
      assert.deepEqual(historical.unknownIdentifiers, ['reliabilityassessment']);
      assert.equal(historical.reverseSearch.state, 'advertised');
      assert.equal(historical.reverseSearch.actionAvailable, false);
    }
    const current = inspectRdapCapabilities(input, 'success', '2026-10-14');
    assert.equal(resolveRdapCapabilityCatalogRevision('2026-10-14'), '2026-10-14');
    assert.equal(current.declarations[1]?.category, 'operator');
    assert.equal(current.declarations[1]?.registered, true);
    assert.deepEqual(current.unknownIdentifiers, []);
    assert.deepEqual(input, before);
  });

  test('rejects malformed, unsupported and unreviewed catalogue dates without fallback', () => {
    const unreviewedDate = new Date(Date.parse(`${RDAP_EXTENSION_CATALOG_REVIEWED_AT}T00:00:00.000Z`) + 86_400_000)
      .toISOString().slice(0, 10);
    for (const value of [null, 1, {}, 'constructor', '__proto__', '', '2026-07-30',
      '2026-09-31', '2026-10-14T00:00:00Z', unreviewedDate, '9999-12-31']) {
      assert.equal(resolveRdapCapabilityCatalogRevision(value), null);
      assert.throws(() => inspectRdapCapabilities(null, 'error', value as string), /Unsupported RDAP capability catalogue revision/u);
    }
  });

  test('keeps unavailable and partial declaration sets inconclusive', () => {
    const unavailable = inspectRdapCapabilities(undefined, 'error');
    assert.equal(unavailable.state, 'unavailable');
    assert.equal(unavailable.reverseSearch.state, 'unknown');

    const partial = inspectRdapCapabilities({
      conformance: ['rdap_level_0'],
      conformanceTruncated: true,
    }, 'success');
    assert.equal(partial.state, 'partial');
    assert.equal(partial.reverseSearch.state, 'unknown');
    assert.match(partial.limitations[0] ?? '', /incomplete|capped/iu);
  });

  test('bounds, normalizes, and de-duplicates untrusted declarations', () => {
    const declarations = Array.from(
      { length: MAX_RDAP_CAPABILITY_DECLARATIONS + 5 },
      (_, index) => `extension_${index}`,
    );
    const result = inspectRdapCapabilities({
      conformance: [' REDACTED ', 'redacted', '\u0000bad', ...declarations],
    }, 'complete');

    assert.equal(result.declarations.length, MAX_RDAP_CAPABILITY_DECLARATIONS);
    assert.equal(result.declarations.filter((entry) => entry.identifier === 'redacted').length, 1);
    assert.equal(result.omittedDeclarations, 8);
    assert.equal(result.state, 'complete');
    assert.equal(result.unknownIdentifiers.length, 20);
  });

  test('treats inherited object-property names as neutral unknown declarations', () => {
    const result = inspectRdapCapabilities({
      conformance: ['constructor', '__proto__', 'toString'],
      conformanceTruncated: false,
    }, 'success');
    assert.deepEqual(result.declarations.map((entry) => ({
      identifier: entry.identifier,
      category: entry.category,
      registered: entry.registered,
      status: entry.status,
    })), [
      { identifier: '__proto__', category: 'unknown', registered: null, status: 'unknown' },
      { identifier: 'constructor', category: 'unknown', registered: null, status: 'unknown' },
      { identifier: 'tostring', category: 'unknown', registered: null, status: 'unknown' },
    ]);
    assert.deepEqual(result.unknownIdentifiers, ['__proto__', 'constructor', 'tostring']);
  });

  test('does not mutate source records', () => {
    const input = {
      conformance: ['rdap_level_0', 'sorting'],
      conformanceTruncated: false,
    };
    const before = structuredClone(input);
    inspectRdapCapabilities(input, 'success');
    assert.deepEqual(input, before);
  });
});

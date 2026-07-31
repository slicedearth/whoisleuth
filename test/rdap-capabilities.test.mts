import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  inspectRdapCapabilities,
  MAX_RDAP_CAPABILITY_DECLARATIONS,
  RDAP_CAPABILITY_INSPECTION_VERSION,
  RDAP_EXTENSION_CATALOG_REVIEWED_AT,
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

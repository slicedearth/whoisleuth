'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  registryCapabilityFor,
  registryStandardsCoverageSnapshot,
} = require('../lib/registry-capabilities.mts');
const rdapFixtures = require('../fixtures/rdap-registry-fixtures');

describe('registry standards coverage snapshot', () => {
  test('keeps the official-source population and RDAP totals internally consistent', () => {
    const snapshot = registryStandardsCoverageSnapshot();
    const { counts } = snapshot;

    assert.equal(snapshot.schema, 'whoisleuth.registry-standards-coverage');
    assert.equal(snapshot.version, 1);
    assert.equal(counts.activeTlds, counts.countryCode + counts.nonCountryCode);
    assert.equal(
      counts.nonCountryCode,
      counts.generic + counts.genericRestricted + counts.sponsored + counts.infrastructure,
    );
    assert.equal(
      counts.genericAndRestrictedRdapCovered,
      counts.generic + counts.genericRestricted,
    );
    assert.equal(counts.sponsoredRdapCovered, counts.sponsored - 2);
    assert.equal(counts.infrastructureRdapCovered, 0);
    assert.equal(Number.isNaN(Date.parse(snapshot.verifiedAt)), false);
    assert.equal(Number.isNaN(Date.parse(snapshot.sources.rootZoneLastUpdatedAt)), false);
    assert.equal(Number.isNaN(Date.parse(snapshot.sources.rdapBootstrapPublication)), false);
    assert.ok(snapshot.sources.urls.every((value) => new URL(value).protocol === 'https:'));
  });

  test('returns a defensive copy of nested source and exception data', () => {
    const first = registryStandardsCoverageSnapshot();
    first.sources.urls[0] = 'https://changed.invalid/';
    first.counts.generic = 0;
    first.exceptions[0].suffix = 'changed';

    const second = registryStandardsCoverageSnapshot();
    assert.equal(second.sources.urls[0], 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt');
    assert.equal(second.counts.generic, 1110);
    assert.equal(second.exceptions[0].suffix, 'edu');
  });

  test('matches explicit exceptional suffix profiles without inferring availability', () => {
    const snapshot = registryStandardsCoverageSnapshot();

    for (const exception of snapshot.exceptions) {
      const capability = registryCapabilityFor(`example.${exception.suffix}`);
      assert.equal(capability.explicitSuffixProfile, true);
      assert.equal(capability.registryClass, exception.registryClass);
      assert.equal(capability.rdapAccessProfile, exception.rdapAccessProfile);
      assert.equal(capability.whoisAccessProfile, exception.whoisAccessProfile);
      assert.match(capability.limitation, /not evidence|not ordinary public registration/i);
    }
  });

  test('retains one fixture family for thick and thin domain-registry RDAP shapes', () => {
    const domainFamilies = rdapFixtures
      .filter((fixture) => fixture.type === 'domain')
      .map((fixture) => fixture.serviceFamily);

    assert.deepEqual(domainFamilies, [
      'thick-registry',
      'thin-registry-with-registrar-link',
    ]);
  });
});

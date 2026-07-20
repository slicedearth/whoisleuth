// The view consumes the shared static catalogue without making network requests.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_REGISTRY_SUPPORT_FILTER_LENGTH,
  MAX_REGISTRY_SUPPORT_LOOKUP_LENGTH,
  MAX_REGISTRY_SUPPORT_ROWS,
  filterRegistrySupportRows,
  inspectRegistrySupport,
  registryAccessLabel,
  registryCoverageLabel,
  registrySupportCatalogue,
  registrySupportLabel,
} from '../frontend/src/lib/analysis/registry-support.js';
import { registryCompatibilityMatrix } from '../lib/registry-capabilities.mts';

test('builds the bounded registry-support catalogue from the shared capability matrix', () => {
  const catalogue = registrySupportCatalogue();

  assert.equal(catalogue.version, 26);
  assert.equal(catalogue.rows.length, 312);
  assert.equal(catalogue.truncated, false);
  assert.deepEqual(catalogue.summary, {
    profiles: 312,
    fixtureVerified: 218,
    accessDocumented: 94,
    fallbacks: 1,
  });
  assert.deepEqual(catalogue.standardsCoverage.counts, {
    activeTlds: 1437,
    countryCode: 309,
    nonCountryCode: 1128,
    generic: 1110,
    genericRestricted: 3,
    sponsored: 14,
    infrastructure: 1,
    rdapBootstrapServiceGroups: 589,
    genericAndRestrictedRdapCovered: 1113,
    sponsoredRdapCovered: 12,
    infrastructureRdapCovered: 0,
  });
  assert.deepEqual(
    catalogue.rows.map((row) => row.suffixes),
    registryCompatibilityMatrix().map((row) => row.suffixes),
  );
});

test('returns independent catalogue rows rather than exposing shared mutable arrays', () => {
  const first = registrySupportCatalogue();
  first.rows[0].suffixes[0] = 'changed';
  first.rows[0].fixtureScenarios.push('changed');
  first.standardsCoverage.counts.generic = 0;

  const second = registrySupportCatalogue();
  assert.equal(second.rows[0].suffixes[0], 'ac');
  assert.equal(second.rows[0].fixtureScenarios.includes('changed'), false);
  assert.equal(second.standardsCoverage.counts.generic, 1110);
});

test('inspects explicit and generic suffix support through the shared catalogue', () => {
  const explicit = inspectRegistrySupport('portal.example.uk');
  assert.equal(explicit.state, 'resolved');
  assert.equal(explicit.profile.explicitSuffixProfile, true);
  assert.deepEqual(explicit.profile.suffixes, ['uk']);

  const generic = inspectRegistrySupport('.com');
  assert.equal(generic.state, 'resolved');
  assert.equal(generic.profile.explicitSuffixProfile, false);
  assert.deepEqual(generic.profile.suffixes, ['com']);
  assert.equal(generic.profile.coverageState, 'discovery_only');
  assert.equal(generic.profile.rdapDiscovery, 'iana-bootstrap');
  assert.equal(generic.profile.whoisDiscovery, 'iana-referral');

  const education = inspectRegistrySupport('.edu');
  assert.equal(education.profile.registryClass, 'sponsored');
  assert.equal(education.profile.rdapAccessProfile, 'no-iana-service');

  const military = inspectRegistrySupport('.mil');
  assert.equal(military.profile.registryClass, 'sponsored');
  assert.equal(military.profile.coverageState, 'access_documented');

  const infrastructure = inspectRegistrySupport('.arpa');
  assert.equal(infrastructure.profile.registryClass, 'infrastructure');
  assert.equal(infrastructure.profile.coverageState, 'access_documented');
});

test('normalizes IDN suffixes while keeping malformed and empty inspection states explicit', () => {
  const explicitIdn = inspectRegistrySupport('example.சிங்கப்பூர்');
  assert.equal(explicitIdn.state, 'resolved');
  assert.deepEqual(explicitIdn.profile.suffixes, ['xn--clchc0ea0b2g2a9gcd']);
  assert.equal(explicitIdn.profile.id, 'sgnic-colon');
  assert.equal(explicitIdn.profile.explicitSuffixProfile, true);

  const idn = inspectRegistrySupport('example.测试');
  assert.equal(idn.state, 'resolved');
  assert.deepEqual(idn.profile.suffixes, ['xn--0zwm56d']);
  assert.equal(idn.profile.explicitSuffixProfile, false);

  assert.deepEqual(inspectRegistrySupport('   '), { state: 'empty', profile: null });
  for (const value of [null, 'https://example.invalid/path', 'example.invalid:443', 'bad\n.invalid', 'a'.repeat(MAX_REGISTRY_SUPPORT_LOOKUP_LENGTH + 1)]) {
    assert.deepEqual(inspectRegistrySupport(value), { state: 'invalid', profile: null });
  }
});

test('returns a defensive inspection profile rather than shared mutable catalogue data', () => {
  const first = inspectRegistrySupport('.uk');
  first.profile.suffixes[0] = 'changed';
  first.profile.fixtureScenarios.push('changed');

  const second = inspectRegistrySupport('.uk');
  assert.deepEqual(second.profile.suffixes, ['uk']);
  assert.equal(second.profile.fixtureScenarios.includes('changed'), false);
});

test('filters registry profiles by suffix, capability text, and explicit coverage state', () => {
  const { rows } = registrySupportCatalogue();

  assert.deepEqual(filterRegistrySupportRows(rows, '.vn', 'all').map((row) => row.suffixes[0]), ['vn']);
  assert.deepEqual(filterRegistrySupportRows(rows, 'bracketed', 'all').map((row) => row.suffixes[0]), ['jp']);
  assert.deepEqual(filterRegistrySupportRows(rows, 'structured underscore', 'all').map((row) => row.suffixes[0]), ['nz']);
  assert.deepEqual(
    filterRegistrySupportRows(rows, 'tci colon', 'all').map((row) => row.suffixes[0]),
    ['ru', 'su', 'xn--p1ai'],
  );
  assert.deepEqual(filterRegistrySupportRows(rows, 'norid handle', 'all').map((row) => row.suffixes[0]), ['no']);
  assert.deepEqual(filterRegistrySupportRows(rows, 'punktum domain', 'all').map((row) => row.suffixes[0]), ['dk']);
  assert.deepEqual(filterRegistrySupportRows(rows, '', 'access_documented').map((row) => row.suffixes[0]), [
    'al', 'ao', 'aq', 'arpa', 'az', 'ba', 'bb', 'bd', 'bo', 'bs', 'bt', 'bv', 'bw', 'bz', 'cd', 'cf', 'cg',
    'ch', 'ck', 'cu', 'cw', 'cy', 'dj', 'eg', 'er', 'es', 'et', 'fk', 'ga', 'gb', 'ge',
    'gm', 'gp', 'gq', 'gr', 'gu', 'gw', 'hm', 'iq', 'jm', 'jo', 'kh', 'km', 'kp', 'kw', 'lc', 'li', 'lk',
    'lr', 'mh', 'mil', 'mp', 'mt', 'mv', 'na', 'ne', 'ni', 'np', 'nr', 'pa', 'pf', 'ph', 'pn', 'ps', 'py',
    'sb', 'sj', 'sl', 'sm', 'sv', 'sz', 'tj', 'tk', 'tl', 'tt', 'uy', 'va', 'vi', 'vn', 'xn--54b7fta0cc',
    'xn--fzc2c9e2c', 'xn--mgbai9azgqp6j', 'xn--mgbayh7gpa', 'xn--mgbc0a9azcg',
    'xn--mgbcpq6gpa1a', 'xn--mgbpl2fh', 'xn--mgbtx2b', 'xn--node', 'xn--qxam', 'xn--wgbh1c',
    'xn--xkc2al3hye2a', 'xn--ygbi2ammx', 'za', 'zw',
  ]);
  assert.deepEqual(filterRegistrySupportRows(rows, 'access', 'fixture_verified'), []);
});

test('bounds and sanitizes untrusted filter input without mutating the rows', () => {
  const { rows } = registrySupportCatalogue();
  const before = structuredClone(rows);
  const overlong = `\u0000\u0007${'x'.repeat(MAX_REGISTRY_SUPPORT_FILTER_LENGTH + 20)}vn`;

  assert.deepEqual(filterRegistrySupportRows(rows, overlong, 'unexpected'), []);
  assert.deepEqual(filterRegistrySupportRows(null, 'vn', 'all'), []);
  assert.deepEqual(rows, before);
});

test('caps injected catalogue rows before filtering', () => {
  const template = registrySupportCatalogue().rows[0];
  const rows = Array.from({ length: MAX_REGISTRY_SUPPORT_ROWS + 5 }, (_, index) => ({
    ...template,
    suffixes: [`suffix-${index}`],
  }));

  assert.equal(filterRegistrySupportRows(rows, '', 'all').length, MAX_REGISTRY_SUPPORT_ROWS);
  assert.deepEqual(filterRegistrySupportRows(rows, `suffix-${MAX_REGISTRY_SUPPORT_ROWS + 1}`, 'all'), []);
});

test('renders stable human-readable labels for known and unknown catalogue values', () => {
  assert.equal(registryCoverageLabel('fixture_verified'), 'Fixture verified');
  assert.equal(registryCoverageLabel('other'), 'Unknown');
  assert.equal(registryAccessLabel('iana-bootstrap'), 'IANA bootstrap discovery');
  assert.equal(registryAccessLabel('registry-policy-restricted'), 'Registry policy restricted');
  assert.equal(registryAccessLabel(null), 'Unknown');
  assert.equal(registrySupportLabel('jprs-domain-english'), 'Jprs Domain English');
  assert.equal(registrySupportLabel('\u0000'), 'Unknown');
});

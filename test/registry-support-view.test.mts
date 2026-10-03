import { requiredValue } from './value-assertions.mts';
// The view consumes the shared static catalogue without making network requests.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_REGISTRY_SUPPORT_FILTER_LENGTH,
  MAX_REGISTRY_SUPPORT_LOOKUP_LENGTH,
  MAX_REGISTRY_SUPPORT_ROWS,
  REGISTRY_SUPPORT_SORT_KEYS,
  filterRegistrySupportRows,
  inspectRegistrySupport,
  officialRegistryLookupFor,
  registryAccessLabel,
  registryCoverageLabel,
  registryServiceCoverage,
  registryServiceCoverageLabel,
  registrySupportCatalogue,
  registrySupportLabel,
  safeOfficialRegistryLookupUrl,
  sortRegistrySupportRows,
} from '../frontend/src/lib/analysis/registry-support.ts';
import {
  REGISTRY_CAPABILITIES_VERSION,
  registryCompatibilityMatrix,
  registryStandardsCoverageSnapshot,
  type RegistryCompatibilityRow,
} from '../lib/registry-capabilities.mts';

test('builds the bounded registry-support catalogue from the shared capability matrix', () => {
  const catalogue = registrySupportCatalogue();
  const source = registryCompatibilityMatrix();
  const retained = source.slice(0, MAX_REGISTRY_SUPPORT_ROWS);

  assert.equal(catalogue.version, REGISTRY_CAPABILITIES_VERSION);
  assert.ok(retained.length > 0);
  assert.deepEqual(catalogue.rows, retained);
  assert.equal(catalogue.truncated, source.length > MAX_REGISTRY_SUPPORT_ROWS);
  assert.deepEqual(catalogue.summary, {
    profiles: retained.length,
    fixtureVerified: retained.filter(row => row.coverageState === 'fixture_verified').length,
    accessDocumented: retained.filter(row => row.coverageState === 'access_documented').length,
    serviceCoverage: {
      both: retained.filter(row => row.rdapAccessProfile !== 'no-iana-service' && row.whoisAccessProfile !== 'no-iana-service').length,
      rdapOnly: retained.filter(row => row.rdapAccessProfile !== 'no-iana-service' && row.whoisAccessProfile === 'no-iana-service').length,
      whoisOnly: retained.filter(row => row.rdapAccessProfile === 'no-iana-service' && row.whoisAccessProfile !== 'no-iana-service').length,
      neither: retained.filter(row => row.rdapAccessProfile === 'no-iana-service' && row.whoisAccessProfile === 'no-iana-service').length,
    },
  });
  assert.deepEqual(catalogue.standardsCoverage, registryStandardsCoverageSnapshot());
});

test('returns independent catalogue rows rather than exposing shared mutable arrays', () => {
  const first = registrySupportCatalogue();
  const before = structuredClone(first);
  requiredValue(first.rows[0]).suffixes[0] = 'changed';
  requiredValue(first.rows[0]).fixtureScenarios.push('changed');
  first.standardsCoverage.counts.generic = 0;

  const second = registrySupportCatalogue();
  assert.deepEqual(second, before);
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

  const rdapOnly = inspectRegistrySupport('.dev');
  assert.ok(rdapOnly.profile);
  assert.equal(registryServiceCoverage(rdapOnly.profile), 'rdap_only');
  assert.deepEqual(rdapOnly.profile.documentationUrls, ['https://www.iana.org/domains/root/db/dev.html']);

  const education = inspectRegistrySupport('.edu');
  assert.ok(education.profile);
  assert.equal(education.profile.registryClass, 'sponsored');
  assert.equal(education.profile.rdapAccessProfile, 'no-iana-service');

  const military = inspectRegistrySupport('.mil');
  assert.ok(military.profile);
  assert.equal(military.profile.registryClass, 'sponsored');
  assert.equal(military.profile.coverageState, 'access_documented');

  const infrastructure = inspectRegistrySupport('.arpa');
  assert.ok(infrastructure.profile);
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
  assert.ok(first.profile);
  first.profile.suffixes[0] = 'changed';
  first.profile.fixtureScenarios.push('changed');

  const second = inspectRegistrySupport('.uk');
  assert.ok(second.profile);
  assert.deepEqual(second.profile.suffixes, ['uk']);
  assert.equal(second.profile.fixtureScenarios.includes('changed'), false);
});

test('filters registry profiles by suffix, capability text, and explicit coverage state', () => {
  const { rows } = registrySupportCatalogue();

  assert.deepEqual(filterRegistrySupportRows(rows, '.vn', 'all').map((row) => row.suffixes[0]), ['vn']);
  assert.deepEqual(filterRegistrySupportRows(rows, 'bracketed', 'all').map((row) => row.suffixes[0]), ['jp']);
  assert.deepEqual(filterRegistrySupportRows(rows, 'structured underscore', 'all').map((row) => row.suffixes[0]), ['nz']);
  assert.deepEqual(
    filterRegistrySupportRows(rows, 'official manual lookup', 'all').map((row) => row.suffixes[0]),
    ['ch', 'es', 'gt', 'li', 'vn'],
  );
  assert.deepEqual(
    filterRegistrySupportRows(rows, 'tci colon', 'all').map((row) => row.suffixes[0]),
    ['ru', 'su', 'xn--p1ai'],
  );
  assert.deepEqual(filterRegistrySupportRows(rows, 'norid handle', 'all').map((row) => row.suffixes[0]), ['no']);
  assert.deepEqual(filterRegistrySupportRows(rows, 'punktum domain', 'all').map((row) => row.suffixes[0]), ['dk']);
  assert.deepEqual(filterRegistrySupportRows(rows, '', 'access_documented'), rows.filter(row => row.coverageState === 'access_documented'));
  assert.deepEqual(filterRegistrySupportRows(rows, 'access', 'fixture_verified'), []);
  for (const [kind, rdap, whois] of [
    ['both', true, true], ['rdap_only', true, false], ['whois_only', false, true], ['neither', false, false],
  ] as const) {
    const expected = rows.filter(row => (row.rdapAccessProfile !== 'no-iana-service') === rdap
      && (row.whoisAccessProfile !== 'no-iana-service') === whois);
    assert.ok(expected.length > 0, kind);
    assert.deepEqual(filterRegistrySupportRows(rows, '', 'all', kind), expected);
  }
  assert.equal(filterRegistrySupportRows(rows, '', 'all', 'unexpected').length, rows.length);
});

test('service filtering preserves all four paths and does not treat access restrictions as missing services', () => {
  const template = requiredValue(registryCompatibilityMatrix()[0]);
  const fixture = (id: string, rdapAccessProfile: RegistryCompatibilityRow['rdapAccessProfile'], whoisAccessProfile: RegistryCompatibilityRow['whoisAccessProfile']): RegistryCompatibilityRow => ({
    ...template, id, suffixes: [id], rdapAccessProfile, whoisAccessProfile,
  });
  const rows = [
    fixture('both', 'iana-bootstrap', 'iana-referral'),
    fixture('rdap', 'iana-bootstrap', 'no-iana-service'),
    fixture('whois', 'no-iana-service', 'iana-referral'),
    fixture('neither', 'no-iana-service', 'no-iana-service'),
    fixture('restricted', 'iana-bootstrap', 'registry-policy-restricted'),
    fixture('authorised', 'iana-bootstrap', 'source-ip-authorization-required'),
  ];
  assert.deepEqual(rows.map(registryServiceCoverage), ['both', 'rdap_only', 'whois_only', 'neither', 'both', 'both']);
  for (const [kind, ids] of [
    ['both', ['both', 'restricted', 'authorised']], ['rdap_only', ['rdap']], ['whois_only', ['whois']], ['neither', ['neither']],
  ] as const) assert.deepEqual(filterRegistrySupportRows(rows, '', 'all', kind).map(row => row.id), ids);
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
  const template = requiredValue(registrySupportCatalogue().rows[0]);
  const rows = Array.from({ length: MAX_REGISTRY_SUPPORT_ROWS + 5 }, (_, index) => ({
    ...template,
    suffixes: [`suffix-${index}`],
  }));

  assert.equal(filterRegistrySupportRows(rows, '', 'all').length, MAX_REGISTRY_SUPPORT_ROWS);
  assert.deepEqual(filterRegistrySupportRows(rows, `suffix-${MAX_REGISTRY_SUPPORT_ROWS + 1}`, 'all'), []);
});

test('sorts bounded filtered rows deterministically without mutating catalogue order', () => {
  const { rows } = registrySupportCatalogue();
  const before = rows.map((row) => row.id);

  assert.deepEqual(REGISTRY_SUPPORT_SORT_KEYS, [
    'suffix', 'coverage', 'registry_class', 'service_path', 'rdap_access', 'whois_access', 'whois_query',
  ]);
  assert.equal(requiredValue(sortRegistrySupportRows(rows, 'suffix', 'desc')[0]).suffixes[0], 'zw');
  assert.equal(requiredValue(sortRegistrySupportRows(rows, 'unexpected', 'asc')[0]).suffixes[0], 'ac');
  assert.deepEqual(rows.map((row) => row.id), before);

  const byCoverage = sortRegistrySupportRows(rows, 'coverage', 'asc');
  assert.equal(byCoverage[0]?.coverageState, 'access_documented');
  assert.equal(byCoverage.at(-1)?.coverageState, 'fixture_verified');
  const byServicePath = sortRegistrySupportRows(rows, 'service_path', 'asc');
  assert.equal(registryServiceCoverage(requiredValue(byServicePath[0])), 'both');
  assert.equal(registryServiceCoverage(requiredValue(byServicePath.at(-1))), 'whois_only');
  const byRdapAccess = sortRegistrySupportRows(rows, 'rdap_access', 'asc');
  assert.equal(requiredValue(byRdapAccess[0]).rdapAccessProfile, 'iana-bootstrap');
  assert.equal(requiredValue(byRdapAccess.at(-1)).rdapAccessProfile, 'no-iana-service');
  assert.equal(sortRegistrySupportRows(null, 'suffix', 'asc').length, 0);
});

test('renders stable human-readable labels for known and unknown catalogue values', () => {
  assert.equal(registryCoverageLabel('fixture_verified'), 'Fixture verified');
  assert.equal(registryCoverageLabel('other'), 'Unknown');
  assert.equal(registryAccessLabel('iana-bootstrap'), 'IANA bootstrap discovery');
  assert.equal(registryAccessLabel('registry-policy-restricted'), 'Registry policy restricted');
  assert.equal(registryAccessLabel(null), 'Unknown');
  assert.equal(registryServiceCoverageLabel('rdap_only'), 'RDAP only');
  assert.equal(registryServiceCoverageLabel('whois_only'), 'WHOIS path only');
  assert.equal(registryServiceCoverageLabel('unexpected'), 'Unknown');
  assert.equal(registrySupportLabel('jprs-domain-english'), 'Jprs Domain English');
  assert.equal(registrySupportLabel('\u0000'), 'Unknown');
});

test('accepts only bounded credential-free HTTPS registry lookup links', () => {
  assert.equal(safeOfficialRegistryLookupUrl('https://registry.example.test/lookup'), 'https://registry.example.test/lookup');
  for (const value of [
    'http://registry.example.test/lookup',
    'javascript:alert(1)',
    'https://user:secret@registry.example.test/lookup',
    `https://registry.example.test/${'x'.repeat(301)}`,
    'https://registry.example.test/lookup\nnext',
    null,
  ]) assert.equal(safeOfficialRegistryLookupUrl(value), null);
  assert.equal(officialRegistryLookupFor('example.gt'), 'https://www.gt/sitio/');
  assert.equal(officialRegistryLookupFor('example.dev'), null);
  assert.equal(officialRegistryLookupFor('bad\n.invalid'), null);
});

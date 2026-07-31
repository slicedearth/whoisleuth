import { requiredValue } from './value-assertions.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertBrandProfileStoreBudget,
  BRAND_PROFILE_SCHEMA_VERSION,
  brandProfileStoreVersion,
  buildBrandProfileExport,
  MAX_DKIM_SELECTORS,
  MAX_PROFILE_NAME_LENGTH,
  MAX_PROFILE_STORE_BYTES,
  MAX_PROFILE_TEXT_LENGTH,
  MAX_PROFILE_VALUE_INPUTS,
  MAX_PROFILE_VALUES,
  mergeBrandProfiles,
  normalizeBrandProfile,
  normalizeBrandProfileStore,
  normalizeDkimSelectors,
  normalizeProtectionAttestations,
  normalizeProfileDomains,
  normalizeProfileTextValues,
  normalizeProfileTlds,
  serializeBrandProfileStore,
} from '../frontend/src/lib/analysis/brand-profile-model.ts';

const NOW = '2026-07-14T08:00:00.000Z';

function profile(overrides = {}) {
  return {
    id: 'profile-1',
    name: 'Example Brand',
    officialDomains: ['example.invalid'],
    productNames: ['Example Account'],
    tlds: ['invalid'],
    approvedPartnerDomains: [],
    allowlistedDomains: [],
    allowlistedRegistrars: [],
    dkimSelectors: ['selector1'],
    retiredDkimSelectors: [],
    mailProtectionProfile: 'standard',
    protectionAttestations: [],
    desiredPostureBaselines: [],
    trademarkOwner: '',
    trademarkRegistration: '',
    officialFaviconHash: '',
    officialFaviconPHash: '',
    pageBaseline: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test('normalizes semantic list fields and drops unusable values', () => {
  const result = normalizeBrandProfile(profile({
    officialDomains: ['HTTPS://Example.INVALID/path', 'example.invalid.', 'bad value'],
    productNames: ['  Account   Centre  ', 'account centre', 'bad\nvalue'],
    tlds: ['.COM', 'co.uk', '-bad'],
    approvedPartnerDomains: ['Partner.INVALID'],
    allowlistedDomains: ['Allow.INVALID'],
    allowlistedRegistrars: ['  Example   Registrar  ', 'bad\tregistrar'],
    dkimSelectors: [' MAIL.ONE ', '.mail.one.', 'bad_selector'],
  }));
  assert.ok(result);
  assert.deepEqual(result.officialDomains, ['example.invalid']);
  assert.deepEqual(result.productNames, ['Account Centre']);
  assert.deepEqual(result.tlds, ['com']);
  assert.deepEqual(result.approvedPartnerDomains, ['partner.invalid']);
  assert.deepEqual(result.allowlistedDomains, ['allow.invalid']);
  assert.deepEqual(result.allowlistedRegistrars, ['Example Registrar']);
  assert.deepEqual(result.dkimSelectors, ['mail.one']);
});

test('bounds names and free-text values without retaining controls', () => {
  const result = normalizeBrandProfile(profile({
    name: `  ${'N'.repeat(MAX_PROFILE_NAME_LENGTH + 20)}  `,
    productNames: ['P'.repeat(MAX_PROFILE_TEXT_LENGTH + 20)],
    trademarkOwner: 'Owner\u0000hidden',
    trademarkRegistration: 'R'.repeat(MAX_PROFILE_TEXT_LENGTH + 20),
  }));
  assert.ok(result);
  assert.equal(result.name.length, MAX_PROFILE_NAME_LENGTH);
  assert.equal(requiredValue(result.productNames[0]).length, MAX_PROFILE_TEXT_LENGTH);
  assert.equal(result.trademarkOwner, '');
  assert.equal(result.trademarkRegistration.length, MAX_PROFILE_TEXT_LENGTH);
});

test('caps each general list and DKIM selectors at their effective limits', () => {
  const values = Array.from({ length: MAX_PROFILE_VALUES + 10 }, (_, index) => `Product ${index}`);
  const selectors = Array.from({ length: MAX_PROFILE_VALUES }, (_, index) => `selector-${index}`);
  assert.equal(normalizeProfileTextValues(values).length, MAX_PROFILE_VALUES);
  assert.equal(normalizeDkimSelectors(selectors).length, MAX_DKIM_SELECTORS);
});

test('normalizes defensive mail profiles, retired selectors, and expiring analyst attestations', () => {
  const result = normalizeBrandProfile(profile({
    dkimSelectors: ['active'],
    retiredDkimSelectors: ['retired', 'active'],
    mailProtectionProfile: 'defensive_no_mail',
    protectionAttestations: [
      { control: 'registrar_mfa', state: 'observed', assertedAt: NOW, expiresAt: '2026-10-01', note: 'Reviewed with owner.' },
      { control: 'registrar_mfa', state: 'not_observed', assertedAt: NOW },
      { control: 'future_control', state: 'observed', assertedAt: NOW },
    ],
  }));
  assert.ok(result);
  assert.deepEqual(result.retiredDkimSelectors, ['retired']);
  assert.equal(result.mailProtectionProfile, 'defensive_no_mail');
  assert.deepEqual(result.protectionAttestations, [{
    control: 'registrar_mfa',
    state: 'observed',
    assertedAt: NOW,
    expiresAt: '2026-10-01T00:00:00.000Z',
    note: 'Reviewed with owner.',
  }]);
  assert.deepEqual(normalizeProtectionAttestations([{ control: 'registry_lock', state: 'future', assertedAt: NOW }]), []);
});

test('normalizes bounded desired posture baselines and retained observations', () => {
  const result = normalizeBrandProfile(profile({
    desiredPostureBaselines: [{
      version: 1,
      domain: 'EXAMPLE.INVALID.',
      nameservers: ['NS2.EXAMPLE.INVALID.', 'ns1.example.invalid', 'ns1.example.invalid'],
      ds: ['12345 13 2 abcdef'],
      mx: ['10 mail.example.invalid'],
      caa: ['0 issue "ca.invalid"'],
      tlsIssuer: 'Reviewed issuer',
      tlsSanPatterns: ['EXAMPLE.INVALID.', '*.EXAMPLE.INVALID', '*.*.invalid', '*.example.invalid'],
      tlsSpkiSha256: 'A'.repeat(64),
      registrarLock: 'required',
      renewalReviewAt: '2026-12-01',
      suppressions: [
        { field: 'mx', reason: 'Reviewed transition.', expiresAt: '2026-10-01' },
        { field: 'future', reason: 'Discard me.' },
      ],
      note: 'Reviewed with the domain owner.',
      previousObservation: {
        observedAt: NOW,
        checks: [
          { id: 'mx', status: 'pass', records: ['10 mail.example.invalid'] },
          { id: 'mx', status: 'danger', records: [] },
          { id: 'future', status: 'invalid', records: [] },
        ],
      },
      updatedAt: NOW,
    }, {
      version: 1,
      domain: 'not-official.invalid',
    }],
  }));
  assert.ok(result);
  assert.equal(result.desiredPostureBaselines.length, 1);
  const baseline = requiredValue(result.desiredPostureBaselines[0]);
  assert.equal(baseline.domain, 'example.invalid');
  assert.deepEqual(baseline.nameservers, ['ns1.example.invalid', 'ns2.example.invalid']);
  assert.deepEqual(baseline.tlsSanPatterns, ['*.example.invalid', 'example.invalid']);
  assert.equal(baseline.tlsSpkiSha256, 'a'.repeat(64));
  assert.deepEqual(baseline.suppressions, [{
    field: 'mx',
    reason: 'Reviewed transition.',
    expiresAt: '2026-10-01T00:00:00.000Z',
  }]);
  assert.deepEqual(baseline.previousObservation?.checks, [{
    id: 'mx',
    status: 'pass',
    records: ['10 mail.example.invalid'],
  }]);
});

test('bounds attacker-controlled list input before searching for usable values', () => {
  const values = [...Array.from({ length: MAX_PROFILE_VALUE_INPUTS }, () => ''), 'late valid value'];
  assert.deepEqual(normalizeProfileTextValues(values), []);
});

test('rejects overlong and syntactically invalid domains, TLDs, and selectors', () => {
  assert.deepEqual(normalizeProfileDomains(['a'.repeat(254), 'valid.invalid']), ['valid.invalid']);
  assert.deepEqual(normalizeProfileTlds(['a'.repeat(64), 'valid']), ['valid']);
  assert.deepEqual(normalizeDkimSelectors(['a'.repeat(254), 'valid.selector']), ['valid.selector']);
});

test('normalizes hash fields and discards degenerate perceptual hashes', () => {
  const result = normalizeBrandProfile(profile({
    officialFaviconHash: 'A'.repeat(64),
    officialFaviconPHash: '0000000000000000',
  }));
  assert.ok(result);
  assert.equal(result.officialFaviconHash, 'a'.repeat(64));
  assert.equal(result.officialFaviconPHash, '');
});

test('retains a bounded page baseline only while its domain remains official', () => {
  const baseline = {
    baselineVersion: 1,
    domain: 'example.invalid',
    lookupDomain: 'example.invalid',
    observedAt: NOW,
    pageIdentityVersion: 3,
    fingerprintVersion: 1,
    pageTitle: null,
    canonicalHost: null,
    faviconHash: null,
    faviconPHash: null,
    normalizedHtml: { algorithm: 'sha256', value: 'a'.repeat(64), tokenCount: 1, truncated: false },
    visibleText: null,
    domStructure: { algorithm: 'sha256', value: 'b'.repeat(64), nodeCount: 1, parser: 'static-tag-sequence-v1', truncated: false },
    formStructure: null,
    resourceHosts: { algorithm: 'set-sha256', value: null, values: [], truncated: false },
    trackingIdentifiers: { algorithm: 'set-sha256', value: null, values: [], truncated: false },
    complete: true,
    truncated: false,
  };
  const retained = normalizeBrandProfile(profile({ pageBaseline: baseline }));
  const discarded = normalizeBrandProfile(profile({ officialDomains: ['other.invalid'], pageBaseline: baseline }));
  assert.ok(retained);
  assert.ok(discarded);
  assert.ok(retained.pageBaseline);
  assert.equal(discarded.pageBaseline, null);
});

test('requires a bounded safe id and usable name', () => {
  assert.equal(normalizeBrandProfile(profile({ id: '../bad' })), null);
  assert.equal(normalizeBrandProfile(profile({ name: ' ' })), null);
  const generated = normalizeBrandProfile(profile({ id: '../bad' }), { makeId: () => 'generated-id' });
  assert.ok(generated);
  assert.equal(generated.id, 'generated-id');
});

test('preserves existing identity and creation time while touching updates', () => {
  const existing = profile({ id: 'existing-id', createdAt: '2026-07-01T00:00:00.000Z' });
  const result = normalizeBrandProfile(profile({ id: 'replacement-id', name: 'Updated' }), { existing, touch: true, nowIso: NOW });
  assert.ok(result);
  assert.equal(result.id, 'existing-id');
  assert.equal(result.createdAt, '2026-07-01T00:00:00.000Z');
  assert.equal(result.updatedAt, NOW);
});

test('internal profile collections normalize to the current envelope', () => {
  const result = normalizeBrandProfileStore([profile()]);
  assert.equal(result.version, BRAND_PROFILE_SCHEMA_VERSION);
  assert.equal(result.profiles.length, 1);
});

test('store normalization drops unknown fields and does not mutate input', () => {
  const source = [{ ...profile(), unknown: { secret: true } }];
  const before = structuredClone(source);
  const parsed = JSON.parse(serializeBrandProfileStore(source));
  assert.deepEqual(source, before);
  assert.equal(parsed.version, BRAND_PROFILE_SCHEMA_VERSION);
  assert.equal(parsed.profiles[0].unknown, undefined);
});

test('duplicate ids retain the most recently updated bounded record', () => {
  const result = normalizeBrandProfileStore([
    profile({ name: 'Older', updatedAt: '2026-07-01T00:00:00.000Z' }),
    profile({ name: 'Newer', updatedAt: '2026-07-02T00:00:00.000Z' }),
  ]);
  assert.equal(result.profiles.length, 1);
  assert.equal(requiredValue(result.profiles[0]).name, 'Newer');
});

test('structured imports merge by case-insensitive profile name', () => {
  const local = profile({ id: 'local', name: 'Example Brand' });
  const imported = profile({ id: 'imported', name: 'example brand', productNames: ['Updated'] });
  const result = mergeBrandProfiles([local], { schema: 'whoisleuth.brand-profiles', version: 2, profiles: [imported] }, { nowIso: NOW, makeId: () => 'new-id' });
  assert.deepEqual({ added: result.added, updated: result.updated, skipped: result.skipped }, { added: 0, updated: 1, skipped: 0 });
  assert.equal(requiredValue(result.profiles[0]).id, 'local');
  assert.deepEqual(requiredValue(result.profiles[0]).productNames, ['Updated']);
});

test('imports report malformed records as skipped', () => {
  const result = mergeBrandProfiles([], {
    schema: 'whoisleuth.brand-profiles',
    version: BRAND_PROFILE_SCHEMA_VERSION,
    profiles: [profile({ id: '../bad', name: 'Valid' }), { name: '' }],
  }, { nowIso: NOW, makeId: () => 'generated' });
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
});

test('imports reject unrelated and future schemas', () => {
  assert.throws(() => mergeBrandProfiles([], {}), /not a WHOISleuth Brand Profile export/i);
  assert.throws(() => mergeBrandProfiles([], [profile()]), /not a WHOISleuth Brand Profile export/i);
  assert.throws(() => mergeBrandProfiles([], { schema: 'whoisleuth.cases', version: 2, profiles: [] }), /not a WHOISleuth Brand Profile export/);
  assert.throws(() => mergeBrandProfiles([], { schema: 'whoisleuth.brand-profiles', version: 1, profiles: [] }), /using schema 2, 3, 4, or 5/);
  assert.throws(() => mergeBrandProfiles([], { schema: 'whoisleuth.brand-profiles', version: BRAND_PROFILE_SCHEMA_VERSION + 1, profiles: [] }), /newer schema 6/);
});

test('serialized stores stay within a dedicated UTF-8 byte budget', () => {
  const store = assertBrandProfileStoreBudget([profile({ name: '界'.repeat(MAX_PROFILE_NAME_LENGTH) })]);
  const bytes = new TextEncoder().encode(JSON.stringify(store)).byteLength;
  assert.ok(bytes <= MAX_PROFILE_STORE_BYTES);
});

test('oversized normalized stores fail before browser storage is touched', () => {
  const profiles = Array.from({ length: 100 }, (_, profileIndex) => profile({
    id: `profile-${profileIndex}`,
    name: `Profile ${profileIndex}`,
    productNames: Array.from({ length: MAX_PROFILE_VALUES }, (_, valueIndex) => `${profileIndex}-${valueIndex}-${'x'.repeat(MAX_PROFILE_TEXT_LENGTH)}`),
  }));
  assert.throws(() => assertBrandProfileStoreBudget(profiles), /Brand profile storage is full/);
});

test('fractional future store versions remain visible to downgrade guards', () => {
  assert.equal(brandProfileStoreVersion({ version: 2.5, profiles: [] }), 2.5);
});

test('portable exports carry schema identity and only normalized profiles', () => {
  const result = buildBrandProfileExport([{ ...profile(), private: 'drop me' }], NOW);
  assert.equal(result.schema, 'whoisleuth.brand-profiles');
  assert.equal(result.version, BRAND_PROFILE_SCHEMA_VERSION);
  assert.equal(result.exportedAt, NOW);
  assert.equal(Reflect.get(requiredValue(result.profiles[0]), 'private'), undefined);
});

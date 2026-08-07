import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyDomainControlPassport,
  buildBrandProfilePassportInput,
  buildDomainControlPassport,
  passportConfiguredFields,
  verifyDomainControlPassport,
} from '../frontend/src/lib/analysis/domain-control-passport.ts';
import type { BrandProfile, DesiredPostureBaseline } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { buildDomainControlManifest, verifyDomainControlManifest } from '../lib/domain-control-manifest.mts';

const generatedAt = '2026-08-07T00:00:00.000Z';
const expiresAt = '2026-09-07T00:00:00.000Z';

function baseline(domain = 'example.test'): DesiredPostureBaseline {
  return {
    version: 1,
    domain,
    nameservers: ['ns1.example.test'],
    ds: ['12345 13 2 ABCDEF'],
    mx: ['10 mail.example.test'],
    caa: ['0 issue "ca.example"'],
    tlsIssuer: 'Example Issuer',
    tlsSanPatterns: ['*.example.test'],
    tlsSpkiSha256: 'a'.repeat(64),
    registrarLock: 'required',
    renewalReviewAt: '2026-08-20T00:00:00.000Z',
    zoneIntent: 'active_service',
    lifecycle: 'change_planned',
    recoveryDependency: 'private recovery detail',
    approvedChangeWindows: [{ startsAt: generatedAt, endsAt: '2026-08-07T01:00:00.000Z', summary: 'Private change' }],
    suppressions: [{ field: 'mx', reason: 'Private exception', expiresAt: null }],
    note: 'Private analyst note',
    previousObservation: { observedAt: generatedAt, checks: [{ id: 'mx', status: 'pass', records: ['private observation'] }] },
    observationHistory: [],
    updatedAt: generatedAt,
  };
}

function profile(): BrandProfile {
  return {
    id: 'profile-1',
    name: 'Private profile name',
    officialDomains: ['example.test'],
    productNames: ['Private product'],
    tlds: ['test'],
    approvedPartnerDomains: [],
    allowlistedDomains: [],
    allowlistedRegistrars: [],
    dkimSelectors: ['private-selector'],
    retiredDkimSelectors: [],
    mailProtectionProfile: 'standard',
    protectionAttestations: [],
    desiredPostureBaselines: [baseline()],
    trademarkOwner: 'Private owner',
    trademarkRegistration: 'Private registration',
    officialFaviconHash: '',
    officialFaviconPHash: '',
    pageBaseline: null,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

describe('browser domain-control passports', () => {
  it('produces the same canonical manifest and digest as the CLI', async () => {
    const input = buildBrandProfilePassportInput(profile(), ['example.test'], expiresAt);
    const browser = await buildDomainControlPassport(input, generatedAt);
    const cli = buildDomainControlManifest(input, generatedAt);

    assert.deepEqual(browser, cli);
    assert.equal(verifyDomainControlManifest(browser), browser);
    assert.equal(await verifyDomainControlPassport(cli, generatedAt), cli);
    assert.deepEqual(browser.entries[0]?.mx, ['10 mail.example.test']);
    assert.deepEqual(browser.entries[0]?.caa, ['0 issue ca.example']);
    assert.deepEqual(browser.entries[0]?.ds, ['12345 13 2 abcdef']);
  });

  it('excludes profile identity, planning, history, notes, and unrelated controls', async () => {
    const passport = await buildDomainControlPassport(
      buildBrandProfilePassportInput(profile(), ['example.test'], expiresAt),
      generatedAt,
    );
    const content = JSON.stringify(passport);
    assert.doesNotMatch(content, /Private|selector|profile-1|change_planned|active_service/iu);
    assert.equal(passport.entries[0]?.note, null);
    assert.deepEqual(passportConfiguredFields(passport.entries[0]!), [
      'nameservers', 'ds', 'mx', 'caa', 'tlsIssuer', 'tlsSpkiSha256', 'registrarLock', 'renewalReviewAt',
    ]);
  });

  it('rejects tampered, expired, future-version, and non-canonical documents', async () => {
    const passport = await buildDomainControlPassport(
      buildBrandProfilePassportInput(profile(), ['example.test'], expiresAt),
      generatedAt,
    );
    await assert.rejects(() => verifyDomainControlPassport({ ...passport, expiresAt: '2026-08-08T00:00:00.000Z' }, generatedAt), /integrity/iu);
    await assert.rejects(() => verifyDomainControlPassport(passport, expiresAt), /expired/iu);
    await assert.rejects(() => verifyDomainControlPassport({ ...passport, version: 2 }, generatedAt), /unsupported|malformed/iu);
    await assert.rejects(() => verifyDomainControlPassport({
      ...passport,
      entries: [{ ...passport.entries[0]!, nameservers: ['ns2.example.test', 'ns1.example.test'] }],
    }, generatedAt), /canonical|integrity/iu);
  });

  it('merges only explicitly selected configured fields without deleting browser-only state', async () => {
    const source = profile();
    source.desiredPostureBaselines[0] = { ...baseline(), nameservers: ['ns2.example.test'], mx: [] };
    const passport = await buildDomainControlPassport(
      buildBrandProfilePassportInput(source, ['example.test'], expiresAt),
      generatedAt,
    );
    const destination = profile();
    const merged = applyDomainControlPassport(destination, passport, [{
      domain: 'example.test',
      addOfficialDomain: false,
      fields: ['nameservers', 'mx'],
    }], '2026-08-08T00:00:00.000Z');
    const result = merged.desiredPostureBaselines[0]!;
    assert.deepEqual(result.nameservers, ['ns2.example.test']);
    assert.deepEqual(result.mx, ['10 mail.example.test']);
    assert.equal(result.note, 'Private analyst note');
    assert.equal(result.recoveryDependency, 'private recovery detail');
    assert.equal(result.lifecycle, 'change_planned');
  });

  it('adds a new official domain only with explicit confirmation', async () => {
    const source = profile();
    source.officialDomains = ['new.example.test'];
    source.desiredPostureBaselines = [baseline('new.example.test')];
    const passport = await buildDomainControlPassport(
      buildBrandProfilePassportInput(source, ['new.example.test'], expiresAt),
      generatedAt,
    );
    const skipped = applyDomainControlPassport(profile(), passport, [{ domain: 'new.example.test', addOfficialDomain: false, fields: ['mx'] }], generatedAt);
    assert.equal(skipped.officialDomains.includes('new.example.test'), false);
    const added = applyDomainControlPassport(profile(), passport, [{ domain: 'new.example.test', addOfficialDomain: true, fields: ['mx'] }], generatedAt);
    assert.equal(added.officialDomains.includes('new.example.test'), true);
    assert.deepEqual(added.desiredPostureBaselines.find((item) => item.domain === 'new.example.test')?.mx, ['10 mail.example.test']);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyDomainControlPassport,
  buildBrandProfilePassportInput,
  buildDomainControlPassport,
  MAX_DOMAIN_CONTROL_PASSPORT_BYTES,
  passportConfiguredFields,
  verifyDomainControlPassport,
} from '../frontend/src/lib/analysis/domain-control-passport.ts';
import {
  assertDomainControlPassportByteBudget,
  domainControlPassportSerialisedBytes,
} from '../frontend/src/lib/analysis/domain-control-manifest-core.ts';
import type { BrandProfile, DesiredPostureBaseline } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { buildDomainControlManifest, verifyDomainControlManifest } from '../lib/domain-control-manifest.mts';
import { DOMAIN_CONTROL_MANIFEST_INPUT_VERSION } from '../packages/contracts/domain-control-manifest.mts';

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
    assert.equal(input.version, DOMAIN_CONTROL_MANIFEST_INPUT_VERSION);
    const browser = await buildDomainControlPassport(input, generatedAt);
    const cli = buildDomainControlManifest(input, generatedAt);

    assert.deepEqual(browser, cli);
    assert.deepEqual(verifyDomainControlManifest(browser), browser);
    assert.deepEqual(await verifyDomainControlPassport(cli, generatedAt), cli);
    assert.deepEqual(browser.entries[0]?.mx, ['10 mail.example.test']);
    assert.deepEqual(browser.entries[0]?.caa, ['0 issue ca.example']);
    assert.deepEqual(browser.entries[0]?.ds, ['12345 13 2 abcdef']);
  });

  it('preserves the released structural envelope under one bounded cross-runtime ceiling', async () => {
    const largeValidInput = {
      schema: 'whoisleuth.domain-control-manifest-input',
      version: 1,
      expiresAt,
      entries: Array.from({ length: 100 }, (_, domainIndex) => ({
        domain: `d${domainIndex}.example.test`,
        nameservers: Array.from({ length: 32 }, (_, index) => `ns${index}.d${domainIndex}.example.test`),
        ds: Array.from({ length: 32 }, (_, index) => `12345 13 2 ${index.toString(16).padStart(64, '0')}`),
        mx: Array.from({ length: 32 }, (_, index) => `${index} mail${index}.d${domainIndex}.example.test`),
        caa: Array.from({ length: 32 }, (_, index) => `0 issue ca${index}.d${domainIndex}.example.test`),
        tlsIssuer: 'x'.repeat(300),
        tlsSpkiSha256: 'a'.repeat(64),
        registrarLock: 'required',
        renewalReviewAt: '2026-08-20T00:00:00.000Z',
        note: 'n'.repeat(500),
      })),
    };
    const largeInputBytes = new TextEncoder().encode(`${JSON.stringify(largeValidInput, null, 2)}\n`).byteLength;
    assert.ok(largeInputBytes > 256 * 1024);
    assert.ok(largeInputBytes < MAX_DOMAIN_CONTROL_PASSPORT_BYTES);
    const cli = buildDomainControlManifest(largeValidInput, generatedAt);
    const browser = await buildDomainControlPassport(largeValidInput, generatedAt);
    assert.deepEqual(browser, cli);
    assert.deepEqual(verifyDomainControlManifest(browser), browser);
    assert.deepEqual(await verifyDomainControlPassport(cli, generatedAt), cli);

    const overBudgetInput = {
      schema: 'whoisleuth.domain-control-manifest-input',
      version: 1,
      expiresAt,
      entries: [{ domain: 'example.test', note: 'n'.repeat(MAX_DOMAIN_CONTROL_PASSPORT_BYTES + 1) }],
    };
    assert.throws(
      () => buildDomainControlManifest(overBudgetInput, generatedAt),
      new RegExp(`exceeds ${MAX_DOMAIN_CONTROL_PASSPORT_BYTES} serialised bytes`, 'iu'),
    );
    await assert.rejects(
      buildDomainControlPassport(overBudgetInput, generatedAt),
      new RegExp(`exceeds ${MAX_DOMAIN_CONTROL_PASSPORT_BYTES} serialised bytes`, 'iu'),
    );

    let entrySerialisers = 0;
    const excessiveEntries = Array.from({ length: 101 }, (_, index) => ({
      domain: `d${index}.example.test`,
      get toJSON() {
        entrySerialisers += 1;
        return { domain: `d${index}.example.test` };
      },
    }));
    assert.throws(
      () => buildDomainControlManifest({
        schema: 'whoisleuth.domain-control-manifest-input',
        version: 1,
        expiresAt,
        entries: excessiveEntries,
      }, generatedAt),
      /between 1 and 100 entries/iu,
    );
    assert.equal(entrySerialisers, 0);

    assert.throws(
      () => buildDomainControlManifest({
        schema: 'whoisleuth.domain-control-manifest-input',
        version: 1,
        expiresAt,
        entries: [{
          domain: 'example.test',
          nameservers: Array.from({ length: 129 }, (_, index) => `ns${index}.example.test`),
        }],
      }, generatedAt),
      /nameservers exceeds 128 input records/iu,
    );

    let customIteratorCalls = 0;
    const customEntries = [{ domain: 'example.test' }];
    Object.defineProperty(customEntries, Symbol.iterator, {
      configurable: true,
      value: function* customIterator() {
        customIteratorCalls += 1;
        while (true) yield { domain: 'unexpected.example.test' };
      },
    });
    assert.throws(
      () => buildDomainControlManifest({
        schema: 'whoisleuth.domain-control-manifest-input',
        version: 1,
        expiresAt,
        entries: customEntries,
      }, generatedAt),
      /ordinary|between 1 and 100/iu,
    );
    assert.equal(customIteratorCalls, 0);

    let nameserverGetterCalls = 0;
    const accessorEntry: Record<string, unknown> = { domain: 'example.test' };
    Object.defineProperty(accessorEntry, 'nameservers', {
      enumerable: true,
      get() {
        nameserverGetterCalls += 1;
        return ['ns1.example.test'];
      },
    });
    assert.throws(
      () => buildDomainControlManifest({
        schema: 'whoisleuth.domain-control-manifest-input',
        version: 1,
        expiresAt,
        entries: [accessorEntry],
      }, generatedAt),
      /ordinary data fields/iu,
    );
    assert.equal(nameserverGetterCalls, 0);
  });

  it('matches pretty JSON byte accounting at every supported deep-indentation boundary', () => {
    const nested = (depth: number): unknown => {
      let value: unknown = 'fixture';
      for (let index = 0; index < depth; index += 1) value = [value];
      return value;
    };
    for (const depth of [10, 11, 16]) {
      const value = nested(depth);
      const actual = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`).byteLength;
      assert.equal(domainControlPassportSerialisedBytes(value), actual);
      assert.doesNotThrow(() => assertDomainControlPassportByteBudget(value));
    }

    const fixed = {
      nested: nested(15),
      note: '',
    };
    const fixedBytes = new TextEncoder().encode(`${JSON.stringify(fixed, null, 2)}\n`).byteLength;
    const overBudget = { ...fixed, note: 'x'.repeat(MAX_DOMAIN_CONTROL_PASSPORT_BYTES - fixedBytes + 1) };
    const actual = new TextEncoder().encode(`${JSON.stringify(overBudget, null, 2)}\n`).byteLength;
    assert.equal(actual, MAX_DOMAIN_CONTROL_PASSPORT_BYTES + 1);
    assert.throws(
      () => assertDomainControlPassportByteBudget(overBudget),
      new RegExp(`exceeds ${MAX_DOMAIN_CONTROL_PASSPORT_BYTES} serialised bytes`, 'iu'),
    );
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
    await assert.rejects(() => verifyDomainControlPassport({ ...passport, version: 3 }, generatedAt), /unsupported|malformed/iu);
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

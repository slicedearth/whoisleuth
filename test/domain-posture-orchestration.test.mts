import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  checkDomainPosture,
  type DomainPostureCollectorDependencies,
} from '../lib/domain-posture.mts';
import { requiredValue } from './value-assertions.mts';

const OBSERVED_AT = '2026-08-30T02:30:00.000Z';

type FixtureValue = unknown[] | Error | Promise<unknown[]>;
type FixtureOptions = Readonly<{
  txt?: Readonly<Record<string, FixtureValue>>;
  mx?: FixtureValue;
  ns?: FixtureValue;
  caa?: FixtureValue;
  rdap?: unknown | Error;
  mtaSts?: Readonly<{ text: string; contentType: string | null; error: string | null }>;
  now?: () => Date;
  setTimer?: DomainPostureCollectorDependencies['setTimer'];
  clearTimer?: DomainPostureCollectorDependencies['clearTimer'];
}>;

function registryRecord(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    parsed: {
      dnssec: 'Signed',
      statuses: ['client transfer prohibited'],
      nameservers: ['ns1.example.net', 'ns2.example.net'],
      dsData: [{ keyTag: 12345 }],
      dsDataTruncated: false,
      ...overrides,
    },
  };
}

function fixtureDependencies(options: FixtureOptions = {}) {
  const calls: string[] = [];
  const resolve = async (kind: string, name: string, value: FixtureValue | undefined): Promise<unknown[]> => {
    calls.push(`${kind} ${name}`);
    if (value instanceof Error) throw value;
    return await (value ?? []);
  };
  const dependencies: DomainPostureCollectorDependencies = {
    resolveTxt: (name) => resolve('TXT', name, options.txt?.[name]),
    resolveMx: (name) => resolve('MX', name, options.mx),
    resolveNs: (name) => resolve('NS', name, options.ns),
    resolveCaa: (name) => resolve('CAA', name, options.caa),
    fetchRdapRecord: (async (_type: string, name: string) => {
      calls.push(`RDAP ${name}`);
      if (options.rdap instanceof Error) throw options.rdap;
      return options.rdap === undefined ? registryRecord() : options.rdap;
    }) as DomainPostureCollectorDependencies['fetchRdapRecord'],
    fetchMtaStsPolicy: async (name) => {
      calls.push(`MTA-STS ${name}`);
      return options.mtaSts ?? {
        text: 'version: STSv1\nmode: enforce\nmx: mail.example.net\nmax_age: 86400\n',
        contentType: 'text/plain',
        error: null,
      };
    },
    now: options.now ?? (() => new Date(OBSERVED_AT)),
    setTimer: options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds)),
    clearTimer: options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
  };
  return { calls, dependencies };
}

function completeFixture(ns: unknown[] = ['ns2.example.net.', 'ns1.example.net.']) {
  return fixtureDependencies({
    txt: {
      'example.test': ['v=spf1 include:_spf.example.net -all'],
      '_spf.example.net': ['v=spf1 -all'],
      '_dmarc.example.test': ['v=DMARC1; p=reject; sp=reject; np=reject; rua=mailto:aggregate@reports.example.net'],
      'example.test._report._dmarc.reports.example.net': ['v=DMARC1'],
      '_mta-sts.example.test': ['v=STSv1; id=20260830'],
      '_smtp._tls.example.test': ['v=TLSRPTv1; rua=mailto:tls@example.test'],
      'default._bimi.example.test': [],
      'selector._domainkey.example.test': [],
    },
    mx: [{ priority: 10, exchange: 'mail.example.net' }],
    ns,
    caa: [{ critical: 0, issue: 'ca.example' }],
  });
}

function checkById(
  report: Awaited<ReturnType<typeof checkDomainPosture>>,
  id: string,
) {
  return requiredValue(report.checks.find((item) => item.id === id));
}

describe('domain-posture collection orchestration', () => {
  test('maps complete injected DNS, RDAP, MTA-STS and time evidence into stable source-attributed output', async () => {
    const first = completeFixture();
    const second = completeFixture(['ns1.example.net.', 'ns2.example.net.']);
    const options = { dkimSelectors: ['selector'] };
    const firstReport = await checkDomainPosture('EXAMPLE.TEST.', options, first.dependencies);
    const secondReport = await checkDomainPosture('example.test', options, second.dependencies);

    assert.deepEqual(firstReport, secondReport);
    assert.equal(firstReport.checkedAt, OBSERVED_AT);
    assert.equal(firstReport.domain, 'example.test');
    assert.equal(checkById(firstReport, 'dnssec').status, 'pass');
    assert.equal(checkById(firstReport, 'registration_lock').status, 'pass');
    assert.equal(checkById(firstReport, 'nameservers').status, 'pass');
    assert.equal(checkById(firstReport, 'mta_sts').status, 'pass');
    assert.equal(firstReport.spfExpansion.state, 'complete');
    assert.deepEqual(firstReport.dmarcAuthorizations.map((item) => ({
      recordName: item.recordName,
      state: item.state,
    })), [{
      recordName: 'example.test._report._dmarc.reports.example.net',
      state: 'authorized',
    }]);
    assert.deepEqual(firstReport.externalDependencies.map((item) => ({
      kind: item.kind,
      target: item.target,
      source: item.source,
    })), [
      { kind: 'nameserver', target: 'ns1.example.net', source: 'DNS NS' },
      { kind: 'nameserver', target: 'ns2.example.net', source: 'DNS NS' },
      { kind: 'mail_exchange', target: 'mail.example.net', source: 'DNS MX' },
      { kind: 'spf_include', target: '_spf.example.net', source: 'SPF include' },
      { kind: 'dmarc_reporting', target: 'reports.example.net', source: 'DMARC aggregate reporting' },
    ]);
    assert.deepEqual(first.calls, second.calls);
    assert.equal(first.calls.filter((call) => call === 'MTA-STS example.test').length, 1);
    assert.equal(first.calls.filter((call) => call === 'RDAP example.test').length, 1);
  });

  test('keeps resolver, registry and MTA-STS failures explicit instead of converting them into absence', async () => {
    const fixture = fixtureDependencies({
      txt: {
        'example.test': ['v=spf1 -all'],
        '_dmarc.example.test': new Error('DMARC resolver unavailable'),
        '_mta-sts.example.test': ['v=STSv1; id=20260830'],
      },
      mx: [{ priority: 10, exchange: 'mail.example.net' }],
      ns: ['ns1.example.net'],
      rdap: new Error('RDAP deadline expired'),
      mtaSts: { text: '', contentType: null, error: 'Policy fetch timed out.' },
    });
    const report = await checkDomainPosture('example.test', {}, fixture.dependencies);

    assert.equal(checkById(report, 'dmarc').status, 'info');
    assert.match(checkById(report, 'dmarc').detail, /resolver unavailable/u);
    assert.equal(checkById(report, 'dnssec').status, 'info');
    assert.match(checkById(report, 'dnssec').detail, /RDAP deadline expired/u);
    assert.equal(checkById(report, 'registration_lock').status, 'info');
    assert.equal(checkById(report, 'mta_sts').status, 'danger');
    assert.match(checkById(report, 'mta_sts').detail, /timed out/u);
  });

  test('applies the production DNS timeout at the injected resolver boundary', async () => {
    const scheduled: number[] = [];
    const fixture = fixtureDependencies({
      txt: {
        'example.test': new Promise<unknown[]>(() => {}),
      },
      setTimer(callback, milliseconds) {
        scheduled.push(milliseconds);
        return setTimeout(callback, 0);
      },
      clearTimer(handle) {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    });
    const report = await checkDomainPosture('example.test', {}, fixture.dependencies);

    assert.equal(checkById(report, 'spf').status, 'info');
    assert.match(checkById(report, 'spf').detail, /TXT example\.test timed out/u);
    assert.ok(scheduled.length >= 8);
    assert.ok(scheduled.every((milliseconds) => milliseconds === 6_000));
  });

  test('shares one enrichment deadline across SPF and DMARC follow-up work', async () => {
    const start = Date.parse(OBSERVED_AT);
    const times = [start, start + 6_501, start + 6_501, start + 7_000];
    const fixture = fixtureDependencies({
      txt: {
        'example.test': ['v=spf1 include:_spf.example.net -all'],
        '_dmarc.example.test': ['v=DMARC1; p=reject; rua=mailto:aggregate@reports.example.net'],
      },
      now: () => new Date(times.shift() ?? start + 7_000),
    });
    const report = await checkDomainPosture('example.test', {}, fixture.dependencies);

    assert.equal(report.spfExpansion.state, 'partial');
    assert.match(requiredValue(report.spfExpansion.branches.find((branch) => branch.domain === '_spf.example.net')).issues.join(' '), /deadline/u);
    assert.equal(report.dmarcAuthorizations[0]?.state, 'unavailable');
    assert.match(report.dmarcAuthorizations[0]?.error ?? '', /deadline/u);
    assert.ok(!fixture.calls.includes('TXT _spf.example.net'));
    assert.ok(!fixture.calls.includes('TXT example.test._report._dmarc.reports.example.net'));
    assert.equal(report.checkedAt, new Date(start + 7_000).toISOString());
  });

  test('bounds selectors, SPF policy expansion and DMARC reporting authorisations', async () => {
    const includes = Array.from({ length: 14 }, (_, index) => `_spf${index}.example.net`);
    const destinations = Array.from({ length: 14 }, (_, index) => `rua=mailto:r${index}@reports${index}.example.net`).join('; ');
    const txt: Record<string, FixtureValue> = {
      'example.test': [`v=spf1 ${includes.map((name) => `include:${name}`).join(' ')} -all`],
      '_dmarc.example.test': [`v=DMARC1; p=reject; ${destinations}`],
    };
    for (const include of includes) txt[include] = ['v=spf1 -all'];
    const fixture = fixtureDependencies({ txt });
    const selectors = Array.from({ length: 12 }, (_, index) => `s${index}`);
    const report = await checkDomainPosture('example.test', {
      dkimSelectors: selectors,
      retiredDkimSelectors: ['s0', 'retired-one', 'retired-two'],
    }, fixture.dependencies);

    assert.equal(report.dkimSelectors.length, 10);
    assert.deepEqual(report.retiredDkimSelectors, []);
    assert.equal(fixture.calls.filter((call) => /_domainkey/u.test(call)).length, 10);
    assert.equal(report.spfExpansion.lookupLimit, 10);
    assert.ok(report.spfExpansion.lookupsUsed <= report.spfExpansion.lookupLimit);
    assert.ok(report.spfExpansion.branches.length <= 32);
    assert.ok(report.dmarcAuthorizations.length <= 10);
  });

  test('does not start collection for an invalid target or fetch MTA-STS without a valid advertisement', async () => {
    const invalid = fixtureDependencies();
    await assert.rejects(
      checkDomainPosture('not-a-domain', {}, invalid.dependencies),
      /Invalid domain name/u,
    );
    assert.deepEqual(invalid.calls, []);

    const unadvertised = fixtureDependencies({
      txt: { '_mta-sts.example.test': [] },
    });
    await checkDomainPosture('example.test', {}, unadvertised.dependencies);
    assert.equal(unadvertised.calls.some((call) => call.startsWith('MTA-STS ')), false);
  });

  test('preserves DNS and RDAP nameserver disagreement as a review warning', async () => {
    const fixture = fixtureDependencies({
      ns: ['ns1.example.net'],
      rdap: registryRecord({ nameservers: ['ns2.example.net'] }),
    });
    const report = await checkDomainPosture('example.test', {}, fixture.dependencies);

    const nameservers = checkById(report, 'nameservers');
    assert.equal(nameservers.status, 'warning');
    assert.match(nameservers.summary, /sets differ/u);
    assert.match(nameservers.detail, /transient|publication-limited/u);
  });
});

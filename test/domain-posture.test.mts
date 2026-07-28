import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildPostureReport, matchesMtaPattern, normalizeAuditDomain, normalizeDkimSelectors } from '../lib/domain-posture.mts';
import { requiredValue } from './value-assertions.mts';

const RSA_2048_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoUwDmvRvwyuGHZ0vZBD3z+Zyusi3f+ccPP7s6IGnw5talY8ZpxC8SAB29A4zsGU8azxzEkhiiPeNlal0nBrVu5mfVeCJ8vUMIxiVZf3sSEpPRO9JM0KtF9FjujN2lR2c6pAFIUurSHR5zHsopgZUqzDIfy54PQ2UUMDgzy9avfmCqbStL+t7EHDPaydIw9PrKihG8pdhtiVEX0gbkmVnBSl3BLt5zmN/I7p6MnAJddRXZBQIljpGU4bQh2JpISKaewTpjicPVhmlYM09ssUWUkmIfI55Tf26HwO5N6z9hmEUpWbyVMe0hXTydNUgxJK+460H0f0QQdVHc8sDsgPEcwIDAQAB';

function query<T>(records: T[] = [], error: string | null = null): { records: T[]; error: string | null } {
  return { records, error };
}

function strongInput(): Parameters<typeof buildPostureReport>[1] {
  return {
    spf: query(['v=spf1 include:_spf.example.net -all']),
    dmarc: query(['v=DMARC1; p=reject; sp=reject; np=reject; rua=mailto:dmarc@example.com']),
    mx: query([{ priority: 10, exchange: 'mail.example.com' }]),
    dnssec: { value: 'Signed', error: null },
    caa: query([{ critical: 0, issue: 'letsencrypt.org' }]),
    mtaStsDns: query(['v=STSv1; id=20260710']),
    mtaStsPolicy: {
      text: 'version: STSv1\nmode: enforce\nmx: mail.example.com\nmax_age: 86400\n',
      contentType: 'text/plain; charset=utf-8',
      error: null,
    },
    tlsRpt: query(['v=TLSRPTv1; rua=mailto:tls@example.com']),
    bimi: query(['v=BIMI1; l=https://example.com/logo.svg']),
    dkim: [{ selector: 'selector1', records: [`v=DKIM1; p=${RSA_2048_PUBLIC_KEY}`], error: null }],
  };
}

function byId(report: ReturnType<typeof buildPostureReport>, id: string) {
  return requiredValue(report.checks.find((item) => item.id === id));
}

describe('selector and MTA-STS hostname normalization', () => {
  test('normalizes IDNs and rejects non-domain audit targets', () => {
    assert.equal(normalizeAuditDomain('BÜCHER.example.'), 'xn--bcher-kva.example');
    assert.equal(normalizeAuditDomain(`example.com${'.'.repeat(100_000)}`), 'example.com');
    assert.equal(normalizeAuditDomain('.example.com'), null);
    assert.equal(normalizeAuditDomain('localhost'), null);
    assert.equal(normalizeAuditDomain('bad label.example'), null);
  });

  test('keeps only unique, valid, bounded DKIM selectors', () => {
    assert.deepEqual(
      normalizeDkimSelectors([' Selector1 ', 'selector1', 'mail.2026', '-bad', '', ...Array(12).fill(0).map((_, i) => `s${i}`)]),
      ['selector1', 'mail.2026', 's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']
    );
    assert.deepEqual(
      normalizeDkimSelectors([`${'.'.repeat(100_000)}selector${'.'.repeat(100_000)}`]),
      ['selector']
    );
  });

  test('matches exact and wildcard MTA-STS MX patterns without matching the wildcard base', () => {
    assert.equal(matchesMtaPattern('mail.example.com.', 'mail.example.com'), true);
    assert.equal(matchesMtaPattern('mx1.mail.example.com', '*.mail.example.com'), true);
    assert.equal(matchesMtaPattern('mail.example.com', '*.mail.example.com'), false);
  });
});

describe('buildPostureReport', () => {
  test('reports a fully configured domain without warnings or dangers', () => {
    const report = buildPostureReport('example.com', strongInput());
    assert.equal(report.summary.danger, 0);
    assert.equal(report.summary.warning, 0);
    assert.equal(report.summary.pass, 9);
  });

  test('treats missing SPF and DMARC as actionable weaknesses', () => {
    const input = strongInput();
    input.spf = query([]);
    input.dmarc = query([]);
    const report = buildPostureReport('example.com', input);
    assert.equal(byId(report, 'spf').status, 'warning');
    assert.equal(byId(report, 'dmarc').status, 'danger');
    assert.equal(byId(report, 'bimi').status, 'warning');
  });

  test('flags an advertised MTA-STS policy that omits a live MX host', () => {
    const input = strongInput();
    input.mx = query([
      { priority: 10, exchange: 'mail.example.com' },
      { priority: 20, exchange: 'backup.example.com' },
    ]);
    const report = buildPostureReport('example.com', input);
    assert.equal(byId(report, 'mta_sts').status, 'danger');
    assert.match(byId(report, 'mta_sts').detail, /backup\.example\.com/);
  });

  test('does not claim a DNS policy is absent when its query failed', () => {
    const input = strongInput();
    input.caa = query([], 'resolver timed out');
    const report = buildPostureReport('example.com', input);
    assert.equal(byId(report, 'caa').status, 'info');
    assert.match(byId(report, 'caa').summary, /could not be completed/);
  });

  test('explains that DKIM was not checked when no selectors were supplied', () => {
    const input = strongInput();
    input.dkim = [];
    const report = buildPostureReport('example.com', input);
    assert.equal(byId(report, 'dkim').status, 'info');
    assert.match(byId(report, 'dkim').summary, /no selectors configured/);
  });

  test('accepts null MX as an explicit no-inbound-mail posture', () => {
    const input = strongInput();
    input.mx = query([{ priority: 0, exchange: '' }]);
    input.mtaStsDns = query([]);
    input.mtaStsPolicy = null;
    input.tlsRpt = query([]);
    const report = buildPostureReport('example.com', input);
    assert.equal(byId(report, 'mx').status, 'pass');
    assert.equal(byId(report, 'mta_sts').status, 'info');
    assert.equal(byId(report, 'tls_rpt').status, 'info');
  });

  test('keeps enforced DMARC actionable when aggregate reporting is absent', () => {
    const input = strongInput();
    input.dmarc = query(['v=DMARC1; p=reject; sp=reject; np=reject']);
    const report = buildPostureReport('example.com', input);
    assert.equal(byId(report, 'dmarc').status, 'warning');
    assert.match(byId(report, 'dmarc').summary, /reporting is not configured/);
  });

  test('evaluates defensive no-mail posture without treating it as an active-mail profile', () => {
    const input = strongInput();
    input.spf = query(['v=spf1 -all']);
    input.mx = query([{ priority: 0, exchange: '' }]);
    input.mailProtectionProfile = 'defensive_no_mail';
    const report = buildPostureReport('example.com', input);
    assert.equal(byId(report, 'defensive_mail_profile').status, 'pass');

    input.spf = query(['v=spf1 include:_spf.example.net -all']);
    assert.equal(byId(buildPostureReport('example.com', input), 'defensive_mail_profile').status, 'warning');
  });

  test('keeps retired DKIM selector publication separate from active key validation', () => {
    const input = strongInput();
    input.dkim.push({ selector: 'retired', retired: true, records: [`v=DKIM1; p=${RSA_2048_PUBLIC_KEY}`], error: null });
    const report = buildPostureReport('example.com', input);
    assert.equal(byId(report, 'dkim').status, 'pass');
    assert.equal(byId(report, 'dkim_retired').status, 'warning');
    assert.match(byId(report, 'dkim_retired').summary, /remain published/u);
  });

  test('reports registry transfer restrictions and delegation disagreement as separate evidence', () => {
    const input = strongInput();
    input.registry = {
      statuses: ['client transfer prohibited'],
      nameservers: ['ns1.example.net'],
      dsRecordCount: 1,
      error: null,
    };
    input.nameservers = query(['ns2.example.net']);
    const report = buildPostureReport('example.com', input);
    assert.equal(byId(report, 'registration_lock').status, 'pass');
    assert.equal(byId(report, 'nameservers').status, 'warning');
  });

  test('keeps DNSSEC delegation and retained DS consistency source-aware', () => {
    const input = strongInput();
    input.registry = {
      statuses: [],
      nameservers: [],
      dsRecordCount: 1,
      error: null,
    };
    assert.equal(byId(buildPostureReport('example.test', input), 'dnssec_delegation_consistency').status, 'pass');

    input.registry.dsRecordCount = 0;
    const missingDs = byId(buildPostureReport('example.test', input), 'dnssec_delegation_consistency');
    assert.equal(missingDs.status, 'warning');
    assert.match(missingDs.detail, /publication differences|incomplete upstream/iu);

    input.registry.dsDataTruncated = true;
    assert.equal(byId(buildPostureReport('example.test', input), 'dnssec_delegation_consistency').status, 'info');

    input.dnssec.value = 'Unsigned';
    input.registry.dsDataTruncated = false;
    input.registry.dsRecordCount = 1;
    assert.equal(byId(buildPostureReport('example.test', input), 'dnssec_delegation_consistency').status, 'warning');
  });
});

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  joinTxtRecords,
  parseTagList,
  parseSpfRecords,
  parseDmarcRecords,
  parseMtaStsDnsRecords,
  parseMtaStsPolicy,
  parseTlsRptRecords,
  parseBimiRecords,
  parseDkimRecords,
} = require('../lib/domain-posture-parsers.mts');

describe('TXT/tag parsing', () => {
  test('joins DNS TXT chunks without inserting spaces', () => {
    assert.deepEqual(joinTxtRecords([['v=spf1 include:', 'example.net -all']]), ['v=spf1 include:example.net -all']);
  });

  test('tracks duplicate and malformed semicolon fields', () => {
    const parsed = parseTagList('v=TEST1; p=one; p=two; broken');
    assert.equal(parsed.tags.p, 'one');
    assert.deepEqual(parsed.duplicates, ['p']);
    assert.deepEqual(parsed.malformed, ['broken']);
  });
});

describe('SPF', () => {
  test('recognizes a strong fail-all policy and counts top-level DNS terms', () => {
    const parsed = parseSpfRecords([['v=spf1 include:_spf.example.net mx -all']]);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.terminalPolicy, 'fail');
    assert.equal(parsed.dnsLookupTerms, 2);
  });

  test('classifies softfail, neutral, pass, redirect, and missing terminal policies', () => {
    assert.equal(parseSpfRecords(['v=spf1 ~all']).terminalPolicy, 'softfail');
    assert.equal(parseSpfRecords(['v=spf1 ?all']).terminalPolicy, 'neutral');
    assert.equal(parseSpfRecords(['v=spf1 +all']).terminalPolicy, 'pass');
    assert.equal(parseSpfRecords(['v=spf1 redirect=_spf.example.net']).terminalPolicy, 'redirect');
    assert.equal(parseSpfRecords(['v=spf1 ip4:192.0.2.0/24']).terminalPolicy, 'none');
  });

  test('rejects multiple SPF records', () => {
    const parsed = parseSpfRecords(['v=spf1 -all', 'v=spf1 include:example.net -all']);
    assert.equal(parsed.valid, false);
    assert.match(parsed.issues[0], /Multiple SPF/);
  });

  test('flags deprecated ptr and unreachable terms after all', () => {
    const parsed = parseSpfRecords(['v=spf1 ptr -all include:example.net']);
    assert.equal(parsed.valid, true);
    assert.ok(parsed.issues.some((issue) => /deprecated ptr/.test(issue)));
    assert.ok(parsed.issues.some((issue) => /after the all/.test(issue)));
  });
});

describe('DMARC', () => {
  test('parses enforced domain, subdomain, non-existent-subdomain, and reporting policy', () => {
    const parsed = parseDmarcRecords(['v=DMARC1; p=reject; sp=quarantine; np=reject; rua=mailto:dmarc@example.com; ruf=mailto:forensic@example.com']);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.enforced, true);
    assert.equal(parsed.policy, 'reject');
    assert.equal(parsed.subdomainPolicy, 'quarantine');
    assert.equal(parsed.nonexistentSubdomainPolicy, 'reject');
    assert.equal(parsed.aggregateReporting, true);
    assert.equal(parsed.failureReporting, true);
  });

  test('defaults a missing p tag to none and respects current t=y test mode', () => {
    assert.equal(parseDmarcRecords(['v=DMARC1; rua=mailto:dmarc@example.com']).policy, 'none');
    const testing = parseDmarcRecords(['v=DMARC1; p=reject; t=y']);
    assert.equal(testing.testMode, true);
    assert.equal(testing.enforced, false);
  });

  test('recognizes legacy pct without treating it as current enforcement', () => {
    const parsed = parseDmarcRecords(['v=DMARC1; p=reject; pct=25']);
    assert.equal(parsed.legacyPct, 25);
    assert.ok(parsed.issues.some((issue) => /historic/.test(issue)));
  });

  test('rejects duplicate records and unsupported policy values', () => {
    assert.equal(parseDmarcRecords(['v=DMARC1; p=none', 'v=DMARC1; p=reject']).valid, false);
    assert.equal(parseDmarcRecords(['v=DMARC1; p=drop']).valid, false);
  });
});

describe('MTA-STS', () => {
  test('requires one DNS record with an id', () => {
    assert.equal(parseMtaStsDnsRecords(['v=STSv1; id=20260710']).valid, true);
    assert.equal(parseMtaStsDnsRecords(['v=STSv1']).valid, false);
  });

  test('parses a valid enforcing HTTPS policy', () => {
    const parsed = parseMtaStsPolicy('version: STSv1\r\nmode: enforce\r\nmx: mail.example.com\r\nmx: *.mail.example.com\r\nmax_age: 86400\r\n');
    assert.equal(parsed.valid, true);
    assert.equal(parsed.mode, 'enforce');
    assert.deepEqual(parsed.mx, ['mail.example.com', '*.mail.example.com']);
    assert.equal(parsed.maxAge, 86400);
  });

  test('rejects missing mx patterns outside none mode and malformed max_age', () => {
    assert.equal(parseMtaStsPolicy('version: STSv1\nmode: enforce\nmax_age: nope').valid, false);
    assert.equal(parseMtaStsPolicy('version: STSv1\nmode: none\nmax_age: 0').valid, true);
  });
});

describe('TLS-RPT', () => {
  test('requires exactly one policy with at least one rua destination', () => {
    const parsed = parseTlsRptRecords(['v=TLSRPTv1; rua=mailto:tls@example.com,https://reports.example.com/tls']);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.rua, ['mailto:tls@example.com', 'https://reports.example.com/tls']);
    assert.equal(parseTlsRptRecords(['v=TLSRPTv1']).valid, false);
  });
});

describe('BIMI', () => {
  test('requires one record with an HTTPS logo location', () => {
    const parsed = parseBimiRecords(['v=BIMI1; l=https://example.com/logo.svg; a=https://example.com/vmc.pem']);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.logo, 'https://example.com/logo.svg');
    assert.equal(parseBimiRecords(['v=BIMI1; l=http://example.com/logo.svg']).valid, false);
  });
});

describe('DKIM', () => {
  test('validates a configured selector without guessing it', () => {
    const parsed = parseDkimRecords('selector1', ['v=DKIM1; k=rsa; p=abc123']);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.selector, 'selector1');
    assert.equal(parsed.keyType, 'rsa');
  });

  test('distinguishes missing and revoked selector records', () => {
    assert.equal(parseDkimRecords('missing', []).valid, false);
    const revoked = parseDkimRecords('old', ['v=DKIM1; p=']);
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.valid, false);
  });
});

import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  joinTxtRecords,
  parseTagList,
  parseSpfRecords,
  parseDmarcRecords,
  parseDmarcReportingAuthorization,
  parseReportingDestination,
  parseMtaStsDnsRecords,
  parseMtaStsPolicy,
  parseTlsRptRecords,
  parseBimiRecords,
  parseDkimRecords,
} from '../lib/domain-posture-parsers.mts';

const RSA_2048_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoUwDmvRvwyuGHZ0vZBD3z+Zyusi3f+ccPP7s6IGnw5talY8ZpxC8SAB29A4zsGU8azxzEkhiiPeNlal0nBrVu5mfVeCJ8vUMIxiVZf3sSEpPRO9JM0KtF9FjujN2lR2c6pAFIUurSHR5zHsopgZUqzDIfy54PQ2UUMDgzy9avfmCqbStL+t7EHDPaydIw9PrKihG8pdhtiVEX0gbkmVnBSl3BLt5zmN/I7p6MnAJddRXZBQIljpGU4bQh2JpISKaewTpjicPVhmlYM09ssUWUkmIfI55Tf26HwO5N6z9hmEUpWbyVMe0hXTydNUgxJK+460H0f0QQdVHc8sDsgPEcwIDAQAB';

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
    assert.deepEqual(parsed.includes, ['_spf.example.net']);
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
    assert.match(requiredValue(parsed.issues[0]), /Multiple SPF/);
  });

  test('flags deprecated ptr and unreachable terms after all', () => {
    const parsed = parseSpfRecords(['v=spf1 ptr -all include:example.net']);
    assert.equal(parsed.valid, true);
    assert.ok(parsed.issues.some((issue) => /deprecated ptr/.test(issue)));
    assert.ok(parsed.issues.some((issue) => /after the all/.test(issue)));
  });

  test('rejects malformed mechanisms, addresses, prefixes, and duplicate modifiers', () => {
    for (const policy of [
      'v=spf1 madeup:sender.example.test -all',
      'v=spf1 ip4:999.999.999.999 -all',
      'v=spf1 ip6:2001:db8::1/129 -all',
      'v=spf1 mx/33 -all',
      'v=spf1 redirect=one.example redirect=two.example',
    ]) {
      const parsed = parseSpfRecords([policy]);
      assert.equal(parsed.valid, false, policy);
      assert.ok(parsed.issues.length > 0, policy);
    }
  });

  test('distinguishes fail-qualified mechanisms from terms that can authorise a sender', () => {
    assert.deepEqual(parseSpfRecords(['v=spf1 -ip4:192.0.2.0/24 -all']).authorizingTerms, []);
    assert.deepEqual(parseSpfRecords(['v=spf1 ip4:192.0.2.0/24 -all']).authorizingTerms, ['ip4:192.0.2.0/24']);
    assert.deepEqual(parseSpfRecords(['v=spf1 ?ip6:2001:db8::/32 -all']).authorizingTerms, ['?ip6:2001:db8::/32']);
  });
});

describe('DMARC', () => {
  test('uses exact case-sensitive version values for policy and external authorisation', () => {
    for (const record of ['v=DMARC10', 'v=dmarc1', 'v=DMARC1extra', 'p=none;v=DMARC1']) {
      assert.equal(parseDmarcRecords([record]).valid, false, record);
      assert.equal(parseDmarcReportingAuthorization(record), null, record);
    }
    for (const record of ['v=DMARC1', 'v = DMARC1;', 'V=DMARC1; extension=known', ['v=DM', 'ARC1;']]) {
      assert.equal(parseDmarcReportingAuthorization(record)?.v, 'DMARC1');
    }
    for (const record of ['v=DMARC1;broken', 'v=DMARC1;;', 'v=DMARC1;v=DMARC1', 'v=DMARC1;extension=one\ntwo']) {
      assert.equal(parseDmarcReportingAuthorization(record), null, record);
    }
  });

  test('does not silently discard empty reporting destinations', () => {
    for (const list of ['', ',mailto:reports@example.test', 'mailto:reports@example.test,']) {
      const parsed = parseDmarcRecords(['v=DMARC1; p=reject; rua=' + list]);
      assert.equal(parsed.valid, false);
      assert.match(parsed.issues.join(' '), /empty destination/u);
    }
  });
  test('parses enforced domain, subdomain, non-existent-subdomain, and reporting policy', () => {
    const parsed = parseDmarcRecords(['v=DMARC1; p=reject; sp=quarantine; np=reject; rua=mailto:dmarc@example.com; ruf=mailto:forensic@example.com']);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.enforced, true);
    assert.equal(parsed.policy, 'reject');
    assert.equal(parsed.subdomainPolicy, 'quarantine');
    assert.equal(parsed.nonexistentSubdomainPolicy, 'reject');
    assert.equal(parsed.aggregateReporting, true);
    assert.equal(parsed.failureReporting, true);
    assert.deepEqual(parsed.aggregateDestinations, ['mailto:dmarc@example.com']);
    assert.deepEqual(parsed.failureDestinations, ['mailto:forensic@example.com']);
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
  test('rejects incomplete, unsupported or repaired destination spellings', () => {
    for (const destination of [
      'not-a-uri', 'https:reports.example.test', 'https:////reports.example.test',
      'http://reports.example.test', 'https://user:secret@reports.example.test', 'https://@reports.example.test',
      'https://reports.example.test/#', 'https://reports.example.test/%oops', 'https://reports.example.test/a b',
      'mailto:reports', 'mailto:@example.test', 'mailto:a..b@example.test', 'mailto:a%0Ab@example.test',
      'mailto:reports@example.test!10m', 'mailto:reports@example.test,', ',mailto:reports@example.test',
      'mailto:reports@example.test?subject', 'mailto:reports@bad_domain.example.test',
    ]) {
      const parsed = parseTlsRptRecords(['v=TLSRPTv1; rua=' + destination]);
      assert.equal(parsed.valid, false, destination);
      assert.ok(parsed.issues.length, destination);
    }
  });

  test('accepts complete encoded mailbox and HTTPS destinations without collecting them', () => {
    for (const destination of [
      'mailto:reports+tls@example.test', 'mailto:%22report%20box%22@example.test',
      'MAILTO:reports@EXAMPLE.test?subject=TLS%20report', 'mailto:reports@[IPv6:2001:db8::1]',
      'https://reports.example.test:8443/tls?format=json&key=a%21b%2Cc%3Bd',
    ]) {
      assert.ok(parseReportingDestination(destination), destination);
      assert.equal(parseTlsRptRecords(['v=TLSRPTv1; rua=' + destination]).valid, true, destination);
    }
  });

  test('requires exact TLS reporting tokens while accepting valid extensions and split TXT strings', () => {
    const destination = 'mailto:reports@example.test';
    for (const record of [
      'v=TLSRPTv10; rua=' + destination, 'v=tlsrptv1; rua=' + destination,
      'V=TLSRPTv1; rua=' + destination, 'v = TLSRPTv1; rua=' + destination,
      'v=TLSRPTv1; RUA=' + destination, 'v=TLSRPTv1; rua = ' + destination,
      'v=TLSRPTv1; rua=' + destination + ';;', 'v=TLSRPTv1; rua=' + destination + '; ext=two words',
    ]) assert.equal(parseTlsRptRecords([record]).valid, false, record);
    assert.equal(parseTlsRptRecords([['v=TLSRPTv1; rua=mailto:rep', 'orts@example.test; x-token=value;']]).valid, true);
  });
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
    const parsed = parseDkimRecords('selector1', [`v=DKIM1; k=rsa; p=${RSA_2048_PUBLIC_KEY}`]);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.selector, 'selector1');
    assert.equal(parsed.keyType, 'rsa');
    assert.equal(parsed.keyBits, 2048);
    assert.equal(parsed.keyParseState, 'parsed');
  });

  test('distinguishes missing and revoked selector records', () => {
    assert.equal(parseDkimRecords('missing', []).valid, false);
    const revoked = parseDkimRecords('old', ['v=DKIM1; p=']);
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.valid, false);
  });

  test('rejects unparseable and unsupported public keys', () => {
    const malformed = parseDkimRecords('broken', ['v=DKIM1; k=rsa; p=abc123']);
    assert.equal(malformed.valid, false);
    assert.equal(malformed.keyParseState, 'invalid');
    assert.equal(parseDkimRecords('future', [`v=DKIM1; k=future; p=${RSA_2048_PUBLIC_KEY}`]).valid, false);
  });

  test('accepts raw Ed25519 key bytes and rejects a SubjectPublicKeyInfo wrapper', () => {
    const raw = Buffer.alloc(32, 0x2a);
    const parsed = parseDkimRecords('ed', [`v=DKIM1; k=ed25519; p=${raw.toString('base64')}`]);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.keyType, 'ed25519');
    assert.equal(parsed.keyBits, 256);
    assert.equal(parsed.keyParseState, 'parsed');

    const wrapped = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    const rejected = parseDkimRecords('wrapped', [`v=DKIM1; k=ed25519; p=${wrapped.toString('base64')}`]);
    assert.equal(rejected.valid, false);
    assert.equal(rejected.keyParseState, 'invalid');
    assert.match(rejected.issues.join(' '), /32 raw bytes/iu);
  });
});

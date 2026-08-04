import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DOMAIN_CHANGE_INPUT_SCHEMA,
  MAX_DOMAIN_CHANGE_RECORDS,
  reviewDomainChange,
} from '../lib/domain-change-review.mts';
import { buildOfflineEvidenceReview } from '../cli/offline-evidence-review.mts';

const NOW = '2026-08-05T05:00:00.000Z';

function input() {
  return {
    schema: DOMAIN_CHANGE_INPUT_SCHEMA,
    version: 1,
    domain: 'example.test',
    authoritySnapshots: [
      {
        label: 'Authority A', source: 'direct authority fixture', state: 'observed', observedAt: NOW,
        records: [
          { owner: 'example.test', type: 'A', ttl: 300, value: '192.0.2.10' },
          { owner: 'example.test', type: 'CDS', ttl: 300, value: '12345 13 2 aabb' },
          { owner: '_submission._tcp.example.test', type: 'SRV', ttl: 300, value: '10 5 587 mail.example.test' },
          { owner: 'example.test', type: 'TXT', ttl: 300, value: 'sensitive fixture value' },
        ],
      },
      {
        label: 'Authority B', source: 'direct authority fixture', state: 'observed', observedAt: NOW,
        records: [
          { owner: 'example.test', type: 'A', ttl: 600, value: '192.0.2.10' },
          { owner: 'example.test', type: 'CDS', ttl: 600, value: '12345 13 2 aabb' },
        ],
      },
    ],
    resolverSnapshots: [
      { label: 'Resolver A', source: 'resolver fixture', state: 'observed', observedAt: NOW, records: [{ owner: 'example.test', type: 'A', value: '192.0.2.10' }] },
      { label: 'Resolver B', source: 'resolver fixture', state: 'observed', observedAt: NOW, records: [{ owner: 'example.test', type: 'A', value: '192.0.2.20' }] },
    ],
    acmeDependencies: [
      { method: 'dns-01', owner: '_acme-challenge.example.test', target: 'validation.example.net', provider: 'Fixture CA', state: 'partial' },
    ],
    certificate: {
      state: 'observed', observedAt: NOW,
      currentSpkiSha256: 'a'.repeat(64), plannedSpkiSha256: 'b'.repeat(64),
      mustStaple: true, ocspStapled: false, embeddedSctCount: 0,
    },
    hsts: {
      state: 'observed', observedAt: NOW, header: 'max-age=31536000; includeSubDomains',
      preloadState: 'not_listed', source: 'analyst-supplied pinned fixture',
    },
  };
}

describe('domain change review', () => {
  test('keeps authority, resolver, DNSSEC, ACME, TLS, service, and preload evidence explicit', () => {
    const result = reviewDomainChange(input(), NOW);
    assert.equal(result.schema, 'whoisleuth.domain-change.review');
    assert.equal(result.state, 'review');
    assert.equal(result.gate.pass, false);
    assert.equal(result.authoritativeRecordMatrix.find((row) => row.type === 'A')?.state, 'aligned');
    assert.equal(result.resolverDivergenceMatrix.find((row) => row.type === 'A')?.state, 'different');
    assert.equal(result.dnssecAutomation.state, 'review_ready');
    assert.equal(result.certificate.continuity, 'changes');
    assert.equal(result.certificate.findings.length, 2);
    assert.equal(result.services[0]?.owner, '_submission._tcp.example.test');
    assert.equal(result.hsts?.preloadState, 'not_listed');
    assert.match(result.gate.reasons.join(' '), /Resolver observations differ/iu);
  });

  test('hashes TXT data and never calls unavailable evidence an empty answer', () => {
    const value = input();
    value.authoritySnapshots[1]!.state = 'unavailable';
    value.authoritySnapshots[1]!.records = [];
    const result = reviewDomainChange(value, NOW);
    const txt = result.authoritativeRecordMatrix.find((row) => row.type === 'TXT');
    assert.match(txt?.observations[0]?.values[0] ?? '', /^sha256:[a-f0-9]{64}$/u);
    assert.equal(txt?.state, 'insufficient');
    assert.match(result.gate.reasons.join(' '), /Authority B evidence is unavailable/iu);
    assert.doesNotMatch(JSON.stringify(result), /sensitive fixture value/u);
  });

  test('preserves case-sensitive CDNSKEY public-key material', () => {
    const value = input();
    value.authoritySnapshots[0]!.records.push({
      owner: 'example.test',
      type: 'CDNSKEY',
      ttl: 300,
      value: '257 3 13 AbCdEf+/=',
    });
    const result = reviewDomainChange(value, NOW);
    const cdnskey = result.authoritativeRecordMatrix.find((row) => row.type === 'CDNSKEY');
    assert.deepEqual(cdnskey?.observations[0]?.values, ['257 3 13 AbCdEf+/=']);
  });

  test('canonicalises structured DNS data without changing case-sensitive service parameters', () => {
    const value = input();
    value.authoritySnapshots[0]!.records.push(
      {
        owner: 'example.test',
        type: 'HTTPS',
        ttl: 300,
        value: '1 service.example.test alpn=h2 ech=AbCdEf+/=',
      },
      {
        owner: 'example.test',
        type: 'CAA',
        ttl: 300,
        value: '0 ISSUE "ca.example"',
      },
      {
        owner: 'example.test',
        type: 'NS',
        ttl: 300,
        value: 'ns1.other.test',
      },
    );
    const result = reviewDomainChange(value, NOW);
    const https = result.authoritativeRecordMatrix.find((row) => row.type === 'HTTPS');
    const caa = result.authoritativeRecordMatrix.find((row) => row.type === 'CAA');
    const nameserver = result.authoritativeRecordMatrix.find((row) => row.type === 'NS');
    assert.deepEqual(https?.observations[0]?.values, ['1 service.example.test alpn=h2 ech=AbCdEf+/=']);
    assert.deepEqual(caa?.observations[0]?.values, ['0 issue ca.example']);
    assert.deepEqual(nameserver?.observations[0]?.values, ['ns1.other.test']);
  });

  test('dispatches through the offline review command contract', () => {
    const envelope = buildOfflineEvidenceReview(JSON.stringify(input()), NOW);
    assert.equal(envelope.kind, 'domain_change');
    assert.equal((envelope.result as { schema: string }).schema, 'whoisleuth.domain-change.review');
  });

  test('rejects unknown keys, invalid addresses, and record-count overflow', () => {
    assert.throws(() => reviewDomainChange({ ...input(), unexpected: true }, NOW), /unknown field/iu);
    const invalidAddress = input();
    invalidAddress.authoritySnapshots[0]!.records[0]!.value = 'not-an-address';
    assert.throws(() => reviewDomainChange(invalidAddress, NOW), /A data must contain one valid address/iu);
    const overflow = input();
    overflow.authoritySnapshots = [{
      label: 'Authority A', source: 'fixture', state: 'observed', observedAt: NOW,
      records: Array.from({ length: MAX_DOMAIN_CHANGE_RECORDS + 1 }, () => ({ owner: 'example.test', type: 'NS', ttl: 300, value: 'ns.example.test' })),
    }];
    assert.throws(() => reviewDomainChange(overflow, NOW), /limited to/iu);
  });
});

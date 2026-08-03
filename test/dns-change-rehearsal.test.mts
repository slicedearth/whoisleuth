import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DNS_CHANGE_REHEARSAL_EXPORT_SCHEMA,
  MAX_REHEARSAL_NAMESERVERS,
  buildDnsChangeRehearsal,
  buildDnsChangeRehearsalExport,
} from '../frontend/src/lib/analysis/dns-change-rehearsal.ts';

const BASE = {
  domain: 'example.test',
  currentNameservers: ['ns1.example.net', 'ns2.example.net'],
  registryNameservers: ['ns1.example.net', 'ns2.example.net'],
  currentGlue: [],
  currentDs: [{ keyTag: 12345, algorithm: 13, digestType: 2, digest: 'a'.repeat(64) }],
  currentMx: [{ priority: 10, exchange: 'mail.example.net' }],
  currentCaa: [{ critical: 0, tag: 'issue', value: 'ca.example' }],
  currentCriticalAddresses: [{ hostname: 'www.example.test', addresses: ['192.0.2.20'] }],
  currentRegistrationStatuses: ['clientTransferProhibited'],
  currentTlsSpkiSha256: 'b'.repeat(64),
  proposedNameservers: 'ns3.example.net\nns4.example.net',
  proposedGlue: '',
  proposedDs: `12345 13 2 ${'a'.repeat(64)}`,
  proposedMx: '10 mail.example.net',
  proposedCaa: '0 issue ca.example',
  proposedCriticalAddresses: 'www.example.test 192.0.2.20',
  dnssecChange: 'unchanged' as const,
  registrarLockChange: 'unchanged' as const,
  certificateKeyChange: 'unchanged' as const,
  proposedTlsSpkiSha256: '',
  certificateReplacementReady: false,
  ttlLowered: true,
  zonePrepublished: true,
  currentEvidenceComplete: true,
};

describe('DNS change rehearsal', () => {
  test('builds a ready local sequence without claiming a successful change', () => {
    const result = buildDnsChangeRehearsal(BASE);
    assert.equal(result.ready, true);
    assert.deepEqual(result.proposed.nameservers, ['ns3.example.net', 'ns4.example.net']);
    assert.match(result.sequence.join(' '), /submit the parent nameserver change/i);
    assert.match(result.limitations.join(' '), /does not change DNS/i);
    assert.match(result.limitations.join(' '), /does not guarantee/i);
  });

  test('keeps registrar controls and certificate-key assertions separate from observations', () => {
    const result = buildDnsChangeRehearsal({
      ...BASE,
      registrarLockChange: 'disable',
      certificateKeyChange: 'rotate',
      proposedTlsSpkiSha256: 'c'.repeat(64),
      certificateReplacementReady: true,
    });
    assert.equal(result.observed.registrarLock, 'observed');
    assert.equal(result.observed.tlsSpkiSha256, 'b'.repeat(64));
    assert.equal(result.proposed.registrarLockChange, 'disable');
    assert.equal(result.proposed.tlsSpkiSha256, 'c'.repeat(64));
    assert.equal(result.findings.find((item) => item.id === 'registrar_lock')?.state, 'review');
    assert.equal(result.findings.find((item) => item.id === 'certificate_key')?.state, 'review');
    assert.match(result.sequence.join(' '), /re-enable and verify/i);
  });

  test('blocks an unready or unchanged replacement certificate key', () => {
    const unchanged = buildDnsChangeRehearsal({
      ...BASE,
      certificateKeyChange: 'rotate',
      proposedTlsSpkiSha256: 'b'.repeat(64),
      certificateReplacementReady: true,
    });
    assert.equal(unchanged.findings.find((item) => item.id === 'certificate_key')?.state, 'blocked');

    const unready = buildDnsChangeRehearsal({
      ...BASE,
      certificateKeyChange: 'rotate',
      proposedTlsSpkiSha256: 'c'.repeat(64),
      certificateReplacementReady: false,
    });
    assert.equal(unready.findings.find((item) => item.id === 'certificate_key')?.state, 'blocked');
  });

  test('blocks missing in-bailiwick glue and unconfirmed authority readiness', () => {
    const result = buildDnsChangeRehearsal({
      ...BASE,
      proposedNameservers: 'ns1.example.test ns2.example.net',
      ttlLowered: false,
      zonePrepublished: false,
    });
    assert.equal(result.ready, false);
    assert.equal(result.findings.find((item) => item.id === 'glue')?.state, 'blocked');
    assert.equal(result.findings.find((item) => item.id === 'zone')?.state, 'blocked');
    assert.equal(result.findings.find((item) => item.id === 'ttl')?.state, 'review');
  });

  test('accepts bounded glue and explains DNSSEC sequencing', () => {
    const result = buildDnsChangeRehearsal({
      ...BASE,
      proposedNameservers: 'ns1.example.test ns2.example.net',
      proposedGlue: 'ns1.example.test 192.0.2.53 2001:db8::53',
      dnssecChange: 'rotate',
    });
    assert.equal(result.findings.find((item) => item.id === 'glue')?.state, 'ready');
    assert.match(result.findings.find((item) => item.id === 'dnssec')?.detail ?? '', /overlap/i);
  });

  test('bounds nameservers and keeps incomplete observed evidence unknown', () => {
    const proposedNameservers = Array.from(
      { length: MAX_REHEARSAL_NAMESERVERS + 8 },
      (_, index) => `ns${index}.example.net`,
    ).join(' ');
    const result = buildDnsChangeRehearsal({
      ...BASE,
      proposedNameservers,
      currentEvidenceComplete: false,
    });
    assert.equal(result.proposed.nameservers.length, MAX_REHEARSAL_NAMESERVERS);
    assert.equal(result.ready, false);
    assert.equal(result.findings.find((item) => item.id === 'current_evidence')?.state, 'unknown');
  });

  test('keeps desired records separate, reports contradictory sets, and exports a reviewed checklist', () => {
    const result = buildDnsChangeRehearsal({
      ...BASE,
      proposedMx: '20 replacement.example.net',
      proposedCaa: '',
    });
    assert.equal(result.observed.mx[0], '10 mail.example.net');
    assert.equal(result.proposed.mx[0], '20 replacement.example.net');
    assert.equal(result.findings.find((item) => item.id === 'mx')?.state, 'review');
    assert.equal(result.findings.find((item) => item.id === 'caa')?.state, 'unknown');
    assert.match(result.unknowns.join(' '), /CAA policy/i);

    const exported = buildDnsChangeRehearsalExport(result, {
      domain: 'example.test',
      generatedAt: '2026-07-30T00:00:00Z',
    });
    assert.equal(exported.schema, DNS_CHANGE_REHEARSAL_EXPORT_SCHEMA);
    assert.equal(exported.reviewState, 'unresolved');
    assert.notDeepEqual(exported.observed.mx, exported.analystProposed.mx);
    assert.equal(exported.generatedAt, '2026-07-30T00:00:00.000Z');
  });
});

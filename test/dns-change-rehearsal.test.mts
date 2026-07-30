import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_REHEARSAL_NAMESERVERS,
  buildDnsChangeRehearsal,
} from '../frontend/src/lib/analysis/dns-change-rehearsal.ts';

const BASE = {
  domain: 'example.test',
  currentNameservers: ['ns1.example.net', 'ns2.example.net'],
  registryNameservers: ['ns1.example.net', 'ns2.example.net'],
  proposedNameservers: 'ns3.example.net\nns4.example.net',
  proposedGlue: '',
  dnssecChange: 'unchanged' as const,
  ttlLowered: true,
  zonePrepublished: true,
  currentEvidenceComplete: true,
};

describe('DNS change rehearsal', () => {
  test('builds a ready local sequence without claiming a successful change', () => {
    const result = buildDnsChangeRehearsal(BASE);
    assert.equal(result.ready, true);
    assert.deepEqual(result.proposedNameservers, ['ns3.example.net', 'ns4.example.net']);
    assert.match(result.sequence.join(' '), /submit the parent nameserver change/i);
    assert.match(result.limitations.join(' '), /does not change DNS/i);
    assert.match(result.limitations.join(' '), /does not guarantee/i);
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
    assert.equal(result.proposedNameservers.length, MAX_REHEARSAL_NAMESERVERS);
    assert.equal(result.ready, false);
    assert.equal(result.findings.find((item) => item.id === 'current_evidence')?.state, 'unknown');
  });
});

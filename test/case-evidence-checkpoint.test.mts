import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildLookupCheckpointFacts,
  compareAcquisitionTransitionPins,
  checkpointPinInputs,
  compareCheckpointPins,
} from '../frontend/src/lib/analysis/case-evidence-checkpoint.ts';
import { normalizeCaseEvidencePins } from '../frontend/src/lib/analysis/case-response-model.ts';
import type { LookupHttpResponse } from '../lib/lookup-response-contract.mts';

const OBSERVED_AT = '2026-07-29T01:00:00.000Z';

function response(overrides: Partial<LookupHttpResponse> = {}): LookupHttpResponse {
  return {
    query: 'checkpoint.example',
    type: 'domain',
    inputHostname: 'checkpoint.example',
    registrableDomain: 'checkpoint.example',
    isSubdomain: false,
    rdap: {
      fetchedAt: OBSERVED_AT,
      parsed: {
        registrar: { name: 'Example Registrar' },
        lifecycle: {
          createdDateIso: '2025-01-01T00:00:00.000Z',
          expiryDateIso: '2030-01-01T00:00:00.000Z',
        },
        statuses: ['active'],
        nameservers: ['ns1.checkpoint.example'],
      },
    },
    whois: { parsed: {}, chain: [] },
    availability: {
      applicable: true,
      state: 'registered',
      confidence: 'high',
      nameservers: ['ns1.checkpoint.example'],
      hasSpf: true,
      hasDmarc: false,
      mxHosts: ['mx.checkpoint.example'],
      pageTitle: 'Checkpoint page',
      hasPasswordField: true,
      dns: {
        status: 'success',
        observedAt: OBSERVED_AT,
        records: {
          a: ['192.0.2.10'],
          aaaa: ['2001:db8::10'],
        },
      },
      http: {
        status: 'success',
        observedAt: OBSERVED_AT,
        finalUrl: 'https://checkpoint.example/login?secret=discard#fragment',
        response: { status: 200 },
      },
      tls: {
        status: 'partial',
        observedAt: OBSERVED_AT,
        protocol: 'TLSv1.3',
        certificate: {
          fingerprintSha256: 'a'.repeat(64),
          issuer: { name: 'Example CA' },
        },
        limitations: ['The certificate chain was incomplete.'],
      },
    },
    networkContext: {
      contextVersion: 1,
      version: 1,
      status: 'success',
      observedAt: OBSERVED_AT,
      complete: true,
      truncated: false,
      limitations: ['The observed endpoint may be an edge.'],
      endpoint: { address: '192.0.2.10' },
      network: {
        handle: 'NET-EXAMPLE',
        name: 'Example Network',
        cidrs: ['192.0.2.0/24'],
      },
    },
    diagnostics: {
      version: 8,
      rdap: { status: 'success' },
      whois: { status: 'partial' },
      availability: { status: 'complete' },
    },
    ...overrides,
  };
}

describe('case evidence checkpoints', () => {
  test('projects bounded normalized facts from every supported evidence family', () => {
    const facts = buildLookupCheckpointFacts(response(), {
      collectionDepth: 'deep',
      generatedAt: OBSERVED_AT,
    });
    const byField = new Map(facts.map((fact) => [fact.field, fact]));

    assert.equal(byField.get('registration.registrar')?.value, 'Example Registrar');
    assert.equal(byField.get('dns.addresses')?.value, '192.0.2.10 · 2001:db8::10');
    assert.equal(byField.get('tls.protocol')?.value, 'TLSv1.3');
    assert.equal(byField.get('network.cidrs')?.value, '192.0.2.0/24');
    assert.equal(byField.get('http.final_origin')?.value, 'https://checkpoint.example');
    assert.equal(byField.get('page.password_field')?.value, 'Observed');
    assert.equal(byField.get('tls.protocol')?.completeness, 'partial');
    assert.equal(byField.get('registration.registrar')?.sourceSchema.version, 22);
    assert.equal(JSON.stringify(facts).includes('secret=discard'), false);
  });

  test('creates pins only for explicit observed selections with one checkpoint identity', () => {
    const facts = buildLookupCheckpointFacts(response(), {
      collectionDepth: 'deep',
      generatedAt: OBSERVED_AT,
    });
    const inputs = checkpointPinInputs(facts, [
      'registration.registrar',
      'tls.protocol',
      'unknown.field',
    ], { checkpointId: 'checkpoint-one' });
    const pins = normalizeCaseEvidencePins(inputs.map((item, index) => ({
      ...item,
      id: `pin-${index}`,
      createdAt: OBSERVED_AT,
    })), OBSERVED_AT);

    assert.equal(pins.length, 2);
    assert.ok(pins.every((pin) => pin.checkpointId === 'checkpoint-one'));
    assert.ok(pins.every((pin) => pin.collectionDepth === 'deep'));
    assert.ok(pins.every((pin) => pin.sourceSchema?.schema === 'whoisleuth.lookup-evidence'));
  });

  test('keeps equal, changed, missing, unavailable, conflicting, and not-recorded distinct', () => {
    const sourceFacts = buildLookupCheckpointFacts(response(), {
      collectionDepth: 'deep',
      generatedAt: OBSERVED_AT,
    });
    const selected = [
      'registration.registrar',
      'dns.spf',
      'dns.dmarc',
      'tls.protocol',
      'network.cidrs',
      'http.final_origin',
    ];
    const pins = normalizeCaseEvidencePins(checkpointPinInputs(sourceFacts, selected, {
      checkpointId: 'checkpoint-two',
    }).map((item, index) => ({
      ...item,
      id: `pin-${index}`,
      createdAt: OBSERVED_AT,
    })), OBSERVED_AT);
    const current = sourceFacts
      .filter((fact) => fact.field !== 'http.final_origin')
      .map((fact) => {
        if (fact.field === 'dns.spf') return { ...fact, value: 'Not observed' };
        if (fact.field === 'dns.dmarc') return { ...fact, value: null };
        if (fact.field === 'tls.protocol') return { ...fact, sourceState: 'unavailable', value: null };
        if (fact.field === 'network.cidrs') return { ...fact, sourceState: 'conflicting', value: '198.51.100.0/24' };
        return fact;
      });
    const states = Object.fromEntries(compareCheckpointPins(pins, current).map((item) => [item.field, item.state]));

    assert.equal(states['registration.registrar'], 'equal');
    assert.equal(states['dns.spf'], 'changed');
    assert.equal(states['dns.dmarc'], 'missing');
    assert.equal(states['tls.protocol'], 'unavailable');
    assert.equal(states['network.cidrs'], 'conflicting');
    assert.equal(states['http.final_origin'], 'not_recorded');
  });

  test('does not offer domain checkpoints for IP or ASN lookups', () => {
    assert.deepEqual(buildLookupCheckpointFacts(response({ type: 'ipv4', query: '192.0.2.10' })), []);
    assert.deepEqual(buildLookupCheckpointFacts(response({ type: 'asn', query: 'AS64496' })), []);
  });

  test('verifies declared acquisition transition expectations without treating unavailable data as a change', () => {
    const sourceFacts = buildLookupCheckpointFacts(response(), {
      collectionDepth: 'deep',
      generatedAt: OBSERVED_AT,
    });
    const inputs = checkpointPinInputs(sourceFacts, [
      'dns.nameservers',
      'dns.mx',
      'tls.protocol',
      'http.final_origin',
    ], {
      checkpointId: 'transition-one',
      transitionExpectations: {
        'dns.nameservers': 'preserve',
        'dns.mx': 'change',
        'tls.protocol': 'review',
        'http.final_origin': 'preserve',
      },
    });
    const pins = normalizeCaseEvidencePins(inputs.map((item, index) => ({
      ...item,
      id: `transition-pin-${index}`,
      createdAt: OBSERVED_AT,
    })), OBSERVED_AT);
    const current = sourceFacts.map((fact) => {
      if (fact.field === 'dns.mx') return { ...fact, value: 'mx.changed.example' };
      if (fact.field === 'http.final_origin') return { ...fact, sourceState: 'unavailable', value: null };
      return fact;
    });
    const states = Object.fromEntries(compareAcquisitionTransitionPins(pins, current)
      .map((item) => [item.field, item.transitionState]));

    assert.equal(states['dns.nameservers'], 'verified_preserved');
    assert.equal(states['dns.mx'], 'verified_change');
    assert.equal(states['tls.protocol'], 'manual_review');
    assert.equal(states['http.final_origin'], 'indeterminate');
    assert.ok(pins.every((pin) => pin.transitionExpectation !== null));
  });
});

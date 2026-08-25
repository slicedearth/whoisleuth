// Covers lib/whois.mts's authority-aware chain analysis - the decision of
// whether a domain is genuinely unregistered. The bug this replaces was a
// global "any hop's text contained 'no match'" boolean, which turned every
// flaky registrar referral (a timeout, a rate-limit notice, or a misbehaving
// "no match") into a false "available" verdict even when the registry hop
// clearly showed the domain registered. Fixtures model the IANA -> registry
// -> registrar referral shape.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { analyzeWhoisChainAuthority, parseWhoisChain } from '../lib/whois.mts';
import { requiredValue } from './value-assertions.mts';

const IANA = 'whois.iana.org';
const REGISTRY = 'whois.verisign-grs.com';
const REGISTRAR = 'whois.exampleregistrar.com';

// IANA root hop: describes the TLD delegation, refers on to the registry.
const ianaHop = { server: IANA, response: 'domain: COM\norganisation: VeriSign Global Registry Services\nrefer: whois.verisign-grs.com\n' };

const registryPositive = {
  server: REGISTRY,
  response: [
    'Domain Name: EXAMPLE.COM',
    'Registrar: Example Registrar, LLC',
    'Registrar WHOIS Server: whois.exampleregistrar.com',
    'Creation Date: 1995-08-14T04:00:00Z',
    'Registry Expiry Date: 2026-08-13T04:00:00Z',
    'Name Server: NS1.EXAMPLE.COM',
    'Name Server: NS2.EXAMPLE.COM',
  ].join('\n'),
};

const registrarThick = {
  server: REGISTRAR,
  response: [
    'Domain Name: EXAMPLE.COM',
    'Registrar: Example Registrar, LLC',
    'Registrant Name: Jane Roe',
    'Registrant Email: jane@example.com',
  ].join('\n'),
};

const registryNoMatch = { server: REGISTRY, response: 'No match for "NX-UNREGISTERED-9f2b.COM".\n' };
const registrarNoMatch = { server: REGISTRAR, response: 'No match for EXAMPLE.COM.\n' };
const registrarError = { server: REGISTRAR, error: 'connect ETIMEDOUT' };
const registrarRateLimited = { server: REGISTRAR, response: 'WHOIS LIMIT EXCEEDED - please try again later.\n' };

describe('analyzeWhoisChainAuthority', () => {
  test('thin registry + registrar chain reads as registered', () => {
    const a = analyzeWhoisChainAuthority([ianaHop, registryPositive, registrarThick]);
    assert.equal(a.notFound, false);
    assert.equal(a.authoritativeHop, REGISTRY);
    assert.equal(a.failedHop, null);
    assert.equal(a.chainStatus, 'complete');
  });

  test('a failed registrar referral does not override positive registry evidence', () => {
    const a = analyzeWhoisChainAuthority([ianaHop, registryPositive, registrarError]);
    assert.equal(a.notFound, false);
    assert.equal(a.authoritativeHop, REGISTRY);
    assert.equal(a.failedHop, REGISTRAR);
    assert.equal(a.chainStatus, 'partial');
  });

  test('a contradictory registrar "no match" does not override the registry', () => {
    const a = analyzeWhoisChainAuthority([ianaHop, registryPositive, registrarNoMatch]);
    assert.equal(a.notFound, false); // positive registry evidence wins
    assert.equal(a.authoritativeHop, REGISTRY);
    assert.equal(a.conflictingHop, REGISTRAR);
    assert.equal(a.chainStatus, 'partial');
  });

  test('a rate-limited registrar hop is not read as "available"', () => {
    const a = analyzeWhoisChainAuthority([ianaHop, registryPositive, registrarRateLimited]);
    assert.equal(a.notFound, false);
    assert.equal(a.failedHop, REGISTRAR);
    assert.equal(a.chainStatus, 'partial');
  });

  test('a genuinely unregistered domain (registry no-match) is reported not-found', () => {
    const a = analyzeWhoisChainAuthority([ianaHop, registryNoMatch]);
    assert.equal(a.notFound, true);
    assert.equal(a.notFoundSource, REGISTRY);
    assert.equal(a.chainStatus, 'complete');
  });

  test('a rate-limited registry with no positive evidence is inconclusive, not available', () => {
    const a = analyzeWhoisChainAuthority([ianaHop, { server: REGISTRY, response: 'Query rate limit exceeded. Try again later.' }]);
    assert.equal(a.notFound, false); // must NOT claim available on a throttle
    assert.equal(a.failedHop, REGISTRY);
    assert.equal(a.chainStatus, 'partial');
  });

  test('an inconclusive registry cannot delegate the existence decision to a registrar', () => {
    const registryInconclusive = { server: REGISTRY, response: '% Registry terms and conditions only.\n' };
    for (const later of [registrarNoMatch, registrarThick]) {
      const authority = analyzeWhoisChainAuthority([ianaHop, registryInconclusive, later]);
      assert.equal(authority.registrationStatus, 'inconclusive');
      assert.equal(authority.authoritativeHop, null);
      assert.equal(authority.notFound, false);
      assert.equal(authority.chainStatus, 'partial');
    }
  });

  test('a malformed or mismatched root referral fails closed', () => {
    for (const chain of [
      [registryPositive, registrarNoMatch],
      [{ ...ianaHop, response: 'domain: COM\nrefer: whois.other-registry.example\n' }, registryPositive],
      [ianaHop, { ...registryPositive, server: 'whois.other-registry.example' }],
    ]) {
      const authority = analyzeWhoisChainAuthority(chain);
      assert.equal(authority.registrationStatus, 'inconclusive');
      assert.equal(authority.authoritativeHop, null);
      assert.equal(authority.notFound, false);
    }
  });

  test('the IANA root hop alone never determines existence', () => {
    const a = analyzeWhoisChainAuthority([ianaHop]);
    assert.equal(a.notFound, false);
    assert.equal(a.authoritativeHop, null);
  });

  test('root referral + registry positive (no registrar hop) reads as registered', () => {
    const a = analyzeWhoisChainAuthority([ianaHop, registryPositive]);
    assert.equal(a.notFound, false);
    assert.equal(a.authoritativeHop, REGISTRY);
    assert.equal(a.chainStatus, 'complete');
  });

  test('an echoed domain followed by Status: available is authoritative not-found', () => {
    const hop = { server: REGISTRY, response: 'Domain Name: FREE-NAME.COM\nStatus: available\n' };
    const a = analyzeWhoisChainAuthority([ianaHop, hop]);
    assert.equal(a.registrationStatus, 'not_found');
    assert.equal(a.notFound, true);
    assert.equal(a.authoritativeHop, REGISTRY);
  });

  test('Registered: no is negative even when the response echoes the domain', () => {
    const hop = { server: REGISTRY, response: 'Domain Name: FREE-NAME.COM\nRegistered: no\n' };
    const a = analyzeWhoisChainAuthority([ianaHop, hop]);
    assert.equal(a.registrationStatus, 'not_found');
    assert.equal(a.notFound, true);
    const parsed = parseWhoisChain([ianaHop, hop]);
    assert.equal(parsed.createdDate, undefined);
  });

  test('terse registry negatives require their complete documented line shape', () => {
    const prose = {
      server: REGISTRY,
      response: [
        'Domain Name: EXAMPLE.COM',
        'Registrar: Example Registrar',
        'The registry search is free for technical use.',
        '% Diagnostics: nothing found in the secondary cache.',
        'The domain has not been registered with the newsletter service.',
        'Note: El dominio no se encuentra registrado en NIC Argentina.',
      ].join('\n'),
    };
    const a = analyzeWhoisChainAuthority([ianaHop, prose]);
    assert.equal(a.registrationStatus, 'registered');
    assert.equal(a.notFound, false);
  });

  test('incidental negative phrases cannot override positive registry fields', () => {
    for (const notice of [
      'NOTICE: supplementary contact data not found in this response.',
      'NOTICE: the billing object is not registered with this service.',
      'NOTICE: no match for the optional registrar reference was returned.',
      'NOTICE: no entries found in the secondary contact cache.',
    ]) {
      const a = analyzeWhoisChainAuthority([ianaHop, {
        server: REGISTRY,
        response: `${registryPositive.response}\n${notice}\n`,
      }]);
      assert.equal(a.registrationStatus, 'registered', notice);
      assert.equal(a.notFound, false, notice);
    }
  });

  test('the first authoritative decision wins over a contradictory later hop', () => {
    const a = analyzeWhoisChainAuthority([ianaHop, registryNoMatch, registrarThick]);
    assert.equal(a.registrationStatus, 'not_found');
    assert.equal(a.notFound, true);
    assert.equal(a.authoritativeHop, REGISTRY);
    assert.equal(a.conflictingHop, REGISTRAR);
    assert.equal(a.chainStatus, 'partial');
  });

  test('a domain-only authoritative response is registered, not inconclusive', () => {
    const hop = { server: REGISTRY, response: 'Domain Name: MINIMAL-RECORD.COM\n' };
    const a = analyzeWhoisChainAuthority([ianaHop, hop]);
    assert.equal(a.registrationStatus, 'registered');
    assert.equal(a.notFound, false);
  });

  test('a rate-limit response that echoes Domain Name remains inconclusive', () => {
    const hop = { server: REGISTRY, response: 'Domain Name: EXAMPLE.COM\nQuery limit exceeded. Try again later.\n' };
    const a = analyzeWhoisChainAuthority([ianaHop, hop]);
    assert.equal(a.registrationStatus, 'inconclusive');
    assert.equal(a.notFound, false);
    assert.equal(a.failedHop, REGISTRY);
  });
});

describe('parseWhoisChain wires the authority result through', () => {
  test('normalizes malformed imported hops before authority analysis', () => {
    const parsed = parseWhoisChain([
      null,
      { response: 'Domain Name: UNATTRIBUTED.EXAMPLE' },
      ianaHop,
      registryPositive,
      ...Array.from({ length: 10 }, (_, index) => ({
        server: `extra-${index}.example`,
        response: 'No match for domain extra.example.',
      })),
    ]);

    assert.equal(parsed.registrationStatus, 'registered');
    assert.equal(parsed.authoritativeHop, REGISTRY);
    assert.equal(parsed.notFound, false);
  });

  test('positive registry + "no match" registrar: notFound stays false and fields populate', () => {
    const parsed = parseWhoisChain([ianaHop, registryPositive, registrarNoMatch]);
    assert.equal(parsed.notFound, false);
    assert.equal(parsed.chainStatus, 'partial');
    assert.equal(parsed.conflictingHop, 'whois.exampleregistrar.com');
    assert.ok(parsed.nameservers.length >= 1);
    assert.match(requiredValue(parsed.registrar), /Example Registrar/);
  });

  test('registry no-match: notFound true with the source hop', () => {
    const parsed = parseWhoisChain([ianaHop, registryNoMatch]);
    assert.equal(parsed.notFound, true);
    assert.equal(parsed.notFoundSource, REGISTRY);
  });

  test('preserves registry and registrar identifiers, endpoint, reseller, and registrar expiration label', () => {
    const parsed = parseWhoisChain([
      ianaHop,
      {
        server: REGISTRY,
        response: [
          'Domain Name: EXAMPLE.COM',
          'Registry Domain ID: 12345_DOMAIN_COM-VRSN',
          'Registrar: Example Registrar, LLC',
          'Registrar IANA ID: 9999',
          'Registrar WHOIS Server: whois.exampleregistrar.com',
          'Registrar URL: https://registrar.example',
          'Reseller: Example Reseller',
          'Registrar Registration Expiration Date: 2028-04-03T00:00:00Z',
        ].join('\n'),
      },
    ]);
    assert.equal(parsed.registryDomainId, '12345_DOMAIN_COM-VRSN');
    assert.equal(parsed.registrarIanaId, '9999');
    assert.equal(parsed.registrarWhoisServer, 'whois.exampleregistrar.com');
    assert.equal(parsed.reseller, 'Example Reseller');
    assert.equal(parsed.expiryDate, '2028-04-03T00:00:00Z');
  });
});

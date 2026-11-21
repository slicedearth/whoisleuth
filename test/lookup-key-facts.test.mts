import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildLookupKeyFacts, lookupKeyFactProvenance, lookupKeyFactValueText, lookupRegistrationCreatedObservations,
} from '../lib/lookup-key-facts.mts';
import { selectRegistrationCreation } from '../packages/evidence/prior-registration.mts';
import { formatTerminalLookup } from '../cli/formatters/terminal.mts';

const saved = JSON.parse(readFileSync(new URL('./fixtures/cli-lookup-v1.json', import.meta.url), 'utf8'));
const byId = (document: unknown) => new Map(buildLookupKeyFacts(document).map((item) => [item.id, item]));

test('key facts follow registry RDAP before WHOIS and keep each value attributed', () => {
  const facts = byId({
    type: 'domain',
    rdap: { fetchedAt: '2026-08-01T00:00:00.000Z', parsed: { registrar: { name: 'Registry Registrar' }, nameservers: ['ns1.example.test', 'ns1.example.test', 'ns2.example.test'] } },
    whois: { parsed: { registrar: 'WHOIS Registrar', createdDate: '2020-01-02T00:00:00Z' } },
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete' } },
  });
  assert.equal(facts.get('registration.registrar')?.value, 'Registry Registrar');
  assert.equal(facts.get('registration.registrar')?.source, 'Registry RDAP');
  assert.equal(facts.get('registration.registrar')?.observedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(facts.get('registration.nameservers')?.value, 'ns1.example.test, ns2.example.test');
  // RDAP published no creation date, so the separately attributed WHOIS value is shown as WHOIS.
  assert.equal(facts.get('registration.created')?.value, '2020-01-02T00:00:00Z');
  assert.equal(lookupKeyFactProvenance(facts.get('registration.created')!), 'WHOIS · complete');
});

test('decision values are used only with the attribution of the source they name', () => {
  const lookup = (source: string) => byId({
    type: 'domain',
    rdap: { parsed: {} },
    diagnostics: { rdap: { status: 'success' } },
    availability: { source, registrar: { name: 'Decision Registrar' } },
  });
  assert.equal(lookup('rdap').get('registration.registrar')?.value, 'Decision Registrar');
  assert.equal(lookup('rdap').get('registration.registrar')?.source, 'Registry RDAP');
  assert.equal(lookup('dns').get('registration.registrar')?.value, null);
});

test('missing values keep their source state instead of becoming absence', () => {
  const facts = byId({
    type: 'domain',
    rdap: { parsed: {} },
    diagnostics: { rdap: { status: 'success' } },
    availability: {
      dns: { status: 'partial', complete: false, records: { a: [], aaaa: [] } },
      http: { status: 'error' },
    },
  });
  assert.equal(lookupKeyFactValueText(facts.get('registration.registrar')!), 'None reported');
  assert.equal(lookupKeyFactValueText(facts.get('dns.addresses')!), 'Not reported; source incomplete');
  assert.equal(lookupKeyFactValueText(facts.get('http.final_origin')!), 'Unavailable');
  assert.equal(lookupKeyFactValueText(facts.get('tls.issuer')!), 'Not collected');
  assert.equal(lookupKeyFactProvenance(facts.get('tls.issuer')!), 'TLS');
});

test('key facts bound untrusted values and reduce website URLs to their origin', () => {
  const nameservers = Array.from({ length: 11 }, (_, index) => `ns${index}.example.test`);
  const facts = byId({
    type: 'domain',
    rdap: { parsed: { registrar: { name: 'Example\u0000‮Registrar' }, nameservers } },
    diagnostics: { rdap: { status: 'success' } },
    availability: { http: { status: 'success', finalUrl: 'https://www.example.test/path?token=private', response: { status: 200 } } },
  });
  assert.equal(facts.get('registration.registrar')?.value, 'Example Registrar');
  assert.match(facts.get('registration.nameservers')?.value ?? '', /, ns7\.example\.test \+3 more$/u);
  assert.equal(facts.get('http.final_origin')?.value, 'https://www.example.test');
  assert.equal(facts.get('http.response_status')?.value, '200');
  assert.equal(byId({ type: 'domain', availability: { http: { status: 'success', finalUrl: 'https://user:pass@example.test/' } } })
    .get('http.final_origin')?.value, null);
});

test('the TLS issuer comes from the collector\u2019s distinguished name', () => {
  const facts = byId({ type: 'domain', availability: { tls: { status: 'success', certificate: {
    issuer: { commonNames: ['Example Issuing CA'], organizations: ['Example CA'], organizationalUnits: [], countries: [], localities: [], states: [] },
  } } } });
  assert.equal(facts.get('tls.issuer')?.value, 'Example Issuing CA · Example CA');
});

test('registration creation for inference skips values retained from failed or incomplete sources', () => {
  const lookup = (rdapStatus: string, whoisStatus: string) => ({
    type: 'domain',
    rdap: { parsed: { lifecycle: { createdDateIso: '2024-03-01T00:00:00.000Z' } } },
    whois: { parsed: { createdDate: '2019-05-01T00:00:00Z' } },
    diagnostics: { rdap: { status: rdapStatus, complete: rdapStatus === 'success' ? true : false }, whois: { status: whoisStatus } },
  });
  // The displayed key fact still names the failed RDAP value with its state.
  assert.equal(lookupKeyFactProvenance(byId(lookup('error', 'complete')).get('registration.created')!), 'Registry RDAP · error');
  assert.deepEqual(selectRegistrationCreation(lookupRegistrationCreatedObservations(lookup('error', 'complete'))),
    { createdAt: '2019-05-01T00:00:00.000Z', source: 'WHOIS' });
  assert.deepEqual(selectRegistrationCreation(lookupRegistrationCreatedObservations(lookup('success', 'complete'))),
    { createdAt: '2024-03-01T00:00:00.000Z', source: 'Registry RDAP' });
  assert.equal(selectRegistrationCreation(lookupRegistrationCreatedObservations(lookup('error', 'error'))), null);
  assert.deepEqual(lookupRegistrationCreatedObservations({ type: 'ipv4' }), []);
});

test('only domain Lookups produce key facts, and the CLI terminal view lists them outside summaries', () => {
  assert.deepEqual(buildLookupKeyFacts({ type: 'ipv4', rdap: { parsed: {} } }), []);
  const standard = formatTerminalLookup(saved);
  assert.match(standard, /^Key facts:\nRegistrar {6}Example Registrar \(Registry RDAP · success\)$/mu);
  assert.match(standard, /^TLS issuer {5}Not collected \(TLS\)$/mu);
  assert.ok(standard.indexOf('Key facts:') < standard.indexOf('Registration:'));
  assert.doesNotMatch(formatTerminalLookup(saved, { detail: 'summary' }), /Key facts:/u);
});

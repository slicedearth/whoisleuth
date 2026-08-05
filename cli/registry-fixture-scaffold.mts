import { registryCompatibilityMatrix } from '../lib/registry-capabilities.mts';

type Scenario = 'registered' | 'not_found' | 'inconclusive';

const SAFE_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
const SAFE_SUFFIX_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SCENARIOS = new Set<Scenario>(['registered', 'not_found', 'inconclusive']);

export function buildRegistryFixtureScaffold(
  profileIdInput: unknown,
  suffixInput: unknown,
  scenarioInput: unknown,
): string {
  const profileId = typeof profileIdInput === 'string' ? profileIdInput.toLowerCase() : '';
  const suffix = typeof suffixInput === 'string' ? suffixInput.toLowerCase().replace(/^\./u, '') : '';
  const scenario = typeof scenarioInput === 'string' ? scenarioInput.toLowerCase() as Scenario : '' as Scenario;
  if (!SAFE_ID_RE.test(profileId)) throw new TypeError('The capability profile is invalid.');
  if (!SAFE_SUFFIX_RE.test(suffix)) throw new TypeError('The suffix is invalid.');
  if (!SCENARIOS.has(scenario)) throw new TypeError('Scenario must be registered, not_found, or inconclusive.');
  const profile = registryCompatibilityMatrix().find((item) => item.id === profileId);
  if (!profile) throw new TypeError('The capability profile is not present in the registry catalogue.');
  if (!profile.suffixes.includes(suffix)) throw new TypeError(`The capability profile does not cover .${suffix}.`);

  const domain = `EXAMPLE.${suffix.toUpperCase()}`;
  const response = scenario === 'registered'
    ? [
        `Domain Name: ${domain}`,
        'Registry Domain ID: EXAMPLE-SYNTHETIC-ID',
        'Registrar: Example Registrar',
        'Creation Date: 2020-01-02T03:04:05Z',
        'Updated Date: 2024-05-06T07:08:09Z',
        'Registry Expiry Date: 2030-01-02T03:04:05Z',
        'Domain Status: active',
        'Registrant Organization: Example Organisation',
        'Registrant Email: registrant@example.invalid',
        'Name Server: NS1.EXAMPLE.INVALID',
        'DNSSEC: unsigned',
      ]
    : scenario === 'not_found'
      ? ['REPLACE WITH A SYNTHETIC AUTHORITATIVE NO-RECORD DIALECT']
      : ['REPLACE WITH A SYNTHETIC RESTRICTED, RATE-LIMITED, OR TEMPORARY-FAILURE DIALECT'];
  const expected = scenario === 'registered'
    ? {
        registrationStatus: 'registered',
        domainName: domain,
        registrar: 'Example Registrar',
        registrantOrg: 'Example Organisation',
        registrantEmail: 'registrant@example.invalid',
        nameservers: ['NS1.EXAMPLE.INVALID'],
      }
    : scenario === 'not_found'
      ? { registrationStatus: 'not_found', notFound: true }
      : { registrationStatus: 'inconclusive', notFound: false };

  return [
    '// Synthetic scaffold only. Do not paste a live WHOIS response or personal registration data.',
    '// Preserve the registry dialect while replacing domains, contacts, handles, addresses, phones,',
    '// nameservers, dates, identifiers, and free text with reserved or fictional values.',
    '{',
    `  name: ${JSON.stringify(`.${suffix} ${scenario} synthetic response`)},`,
    `  capabilityProfile: ${JSON.stringify(profileId)},`,
    `  scenario: ${JSON.stringify(scenario)},`,
    '  chain: [',
    `    rootHop(${JSON.stringify(suffix.toUpperCase())}, ${JSON.stringify(`whois.${suffix}.invalid`)}),`,
    `    registryHop(${JSON.stringify(`whois.${suffix}.invalid`)}, ${JSON.stringify(response, null, 2).replace(/\n/gu, '\n    ')}),`,
    '  ],',
    `  expected: ${JSON.stringify(expected, null, 2).replace(/\n/gu, '\n  ')},`,
    '},',
    '',
    '// Review checklist:',
    '// - every domain and hostname uses the requested suffix or .invalid;',
    '// - every email ends in .invalid; IP examples use documentation ranges;',
    '// - no real name, address, phone, handle, identifier, or free-text notice remains;',
    '// - authoritative absence is asserted only for a documented registry response;',
    '// - add or refresh the tracked provenance digest after review.',
    '',
  ].join('\n');
}

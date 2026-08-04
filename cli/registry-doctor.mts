import { registryCapabilityFor, REGISTRY_CAPABILITIES_VERSION } from '../lib/registry-capabilities.mts';
import { CliUsageError } from './errors.mts';
import { parseSavedLookupDocument, type UnknownRecord } from './saved-lookup.mts';

const REGISTRY_DOCTOR_SCHEMA = 'whoisleuth.cli.registry-doctor';
const REGISTRY_DOCTOR_VERSION = 1;

type ExpectedState = 'allowed' | 'permission_required' | 'unsupported';
type Alignment = 'expected_constraint' | 'investigate' | 'observed' | 'unexpected_observation';

type RegistryDoctorReport = Readonly<{
  schema: typeof REGISTRY_DOCTOR_SCHEMA;
  version: typeof REGISTRY_DOCTOR_VERSION;
  generatedAt: string;
  domain: string;
  suffix: string;
  catalogueVersion: number;
  profile: Readonly<{
    id: string;
    explicitSuffixProfile: boolean;
    coverageState: string;
  }>;
  sources: readonly Readonly<{
    source: 'rdap' | 'whois';
    expected: ExpectedState;
    observed: string;
    alignment: Alignment;
    normalizedFields: number;
    objectIdentifier: 'not_observed' | 'observed';
    limitation: string;
  }>[];
  summary: Readonly<{ investigate: number; expectedConstraints: number; observed: number }>;
  recommendations: readonly string[];
  limitations: readonly string[];
}>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function status(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim().toLowerCase().slice(0, 40) || 'unavailable'
    : 'unavailable';
}

function expectedWhois(profile: string): ExpectedState {
  if (profile === 'iana-referral') return 'allowed';
  if (profile === 'registry-policy-restricted' || profile === 'source-ip-authorization-required') return 'permission_required';
  return 'unsupported';
}

function sourceAlignment(expected: ExpectedState, observed: string): Alignment {
  const successful = ['complete', 'partial', 'success'].includes(observed);
  const constrained = ['disabled', 'skipped', 'unsupported'].includes(observed);
  if (expected === 'allowed') return successful ? 'observed' : 'investigate';
  if (successful) return 'unexpected_observation';
  return constrained ? 'expected_constraint' : 'investigate';
}

function normalizedObjectIdentifier(parsed: UnknownRecord): 'not_observed' | 'observed' {
  const candidate = parsed.handle ?? parsed.objectIdentifier ?? parsed.registryObjectId ?? parsed.id;
  return typeof candidate === 'string' && candidate.trim() ? 'observed' : 'not_observed';
}

function buildRegistryDoctorReport(raw: string, generatedAt = new Date().toISOString()): RegistryDoctorReport {
  const document = parseSavedLookupDocument(raw, { label: 'Registry doctor input' });
  const capability = registryCapabilityFor(document.registrableDomain);
  if (!capability) throw new CliUsageError('Registry doctor could not resolve a capability profile for this domain.');
  const diagnostics = record(document.diagnostics);
  const rdap = record(document.rdap);
  const whois = record(document.whois);
  const rdapParsed = record(rdap.parsed);
  const whoisParsed = record(whois.parsed);
  const sourceInputs = [
    {
      source: 'rdap' as const,
      expected: capability.rdapAccessProfile === 'iana-bootstrap' ? 'allowed' as const : 'unsupported' as const,
      observed: status(record(diagnostics.rdap).status),
      parsed: rdapParsed,
    },
    {
      source: 'whois' as const,
      expected: expectedWhois(capability.whoisAccessProfile),
      observed: status(record(diagnostics.whois).status),
      parsed: whoisParsed,
    },
  ];
  const sources = sourceInputs.map((source) => ({
    source: source.source,
    expected: source.expected,
    observed: source.observed,
    alignment: sourceAlignment(source.expected, source.observed),
    normalizedFields: Object.keys(source.parsed).length,
    objectIdentifier: normalizedObjectIdentifier(source.parsed),
    limitation: capability.limitation.slice(0, 500),
  }));
  const recommendations = [
    ...sources.filter((source) => source.alignment === 'investigate').map((source) => (
      source.expected === 'allowed'
        ? `Review ${source.source.toUpperCase()} source health, transport attempts, and fixture coverage; the catalogue expected collection to be available.`
        : `Review the ${source.source.toUpperCase()} result and capability profile; the observed state did not match the declared access constraint.`
    )),
    ...sources.filter((source) => source.alignment === 'unexpected_observation').map((source) => (
      `Review why ${source.source.toUpperCase()} produced normalized evidence despite the declared ${source.expected.replaceAll('_', ' ')} access profile.`
    )),
    ...sources.filter((source) => source.alignment === 'observed' && source.objectIdentifier === 'not_observed').map((source) => (
      `${source.source.toUpperCase()} succeeded without a retained registry object identifier; this can be a valid publication omission and should remain unknown rather than an error.`
    )),
  ].slice(0, 12);
  return {
    schema: REGISTRY_DOCTOR_SCHEMA,
    version: REGISTRY_DOCTOR_VERSION,
    generatedAt,
    domain: document.registrableDomain,
    suffix: capability.suffixes[0] || document.registrableDomain.split('.').at(-1) || '',
    catalogueVersion: REGISTRY_CAPABILITIES_VERSION,
    profile: {
      id: capability.id,
      explicitSuffixProfile: capability.explicitSuffixProfile,
      coverageState: capability.coverageState,
    },
    sources,
    summary: {
      investigate: sources.filter((source) => source.alignment === 'investigate' || source.alignment === 'unexpected_observation').length,
      expectedConstraints: sources.filter((source) => source.alignment === 'expected_constraint').length,
      observed: sources.filter((source) => source.alignment === 'observed').length,
    },
    recommendations,
    limitations: [
      'This diagnostic compares one saved observation with the local reviewed capability catalogue and makes no registry, registrar, RDAP, or WHOIS request.',
      'A catalogue alignment does not prove live reachability, parser completeness, current registry policy, registration, availability, ownership, safety, or maliciousness.',
      'A missing registry object identifier can be a publication characteristic. It remains not observed and is not converted into a collection failure.',
      'Use fixture-based maintenance checks before changing a registry parser or access profile; automated tests must not contact live registries.',
    ],
  };
}

function formatRegistryDoctorReport(report: RegistryDoctorReport): string {
  const output = [
    'Registry compatibility diagnostic',
    `Domain             ${report.domain}`,
    `Profile            ${report.profile.id}${report.profile.explicitSuffixProfile ? ' (explicit)' : ' (default)'}`,
    `Review items       ${report.summary.investigate}`,
    '',
  ];
  for (const source of report.sources) {
    output.push(`${source.source.toUpperCase()} [${source.alignment.replaceAll('_', ' ')}]`);
    output.push(`  Expected: ${source.expected.replaceAll('_', ' ')}`);
    output.push(`  Observed: ${source.observed.replaceAll('_', ' ')}`);
    output.push(`  Object identifier: ${source.objectIdentifier.replaceAll('_', ' ')}`);
  }
  if (report.recommendations.length) {
    output.push('', 'Recommendations:');
    for (const item of report.recommendations) output.push(`  - ${item}`);
  }
  output.push('', 'Limitations:');
  for (const limitation of report.limitations) output.push(`  - ${limitation}`);
  return `${output.join('\n')}\n`;
}

export {
  REGISTRY_DOCTOR_SCHEMA,
  REGISTRY_DOCTOR_VERSION,
  buildRegistryDoctorReport,
  formatRegistryDoctorReport,
};
export type { RegistryDoctorReport };

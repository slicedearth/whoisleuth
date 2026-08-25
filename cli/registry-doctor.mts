import { registryCapabilityFor, REGISTRY_CAPABILITIES_VERSION } from '../lib/registry-capabilities.mts';
import { recordOrEmpty } from '../lib/bounded-contract-normalizers.mts';
import { registryDateIso } from '../lib/registry-dates.mts';
import { CliUsageError } from './errors.mts';
import { parseSavedLookupDocument, type UnknownRecord } from './saved-lookup.mts';

const REGISTRY_DOCTOR_SCHEMA = 'whoisleuth.cli.registry-doctor';
const REGISTRY_DOCTOR_VERSION = 3;

type ExpectedState = 'allowed' | 'permission_required' | 'unsupported';
type Alignment = 'expected_constraint' | 'investigate' | 'observed' | 'unexpected_observation';
type PublicationState = 'inconsistent' | 'not_observed' | 'observed' | 'unavailable';

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
  publication: Readonly<{
    objectClass: Readonly<{ state: PublicationState; value: string | null }>;
    objectIdentifier: Readonly<{ state: PublicationState; value: string | null }>;
    mediaType: Readonly<{ state: 'unavailable'; value: null }>;
    baseConformance: Readonly<{ state: PublicationState; declarations: readonly string[]; truncated: boolean }>;
    redactionMetadata: Readonly<{ state: PublicationState; count: number; truncated: boolean }>;
    selfLink: Readonly<{ state: PublicationState; observedRelations: readonly string[]; truncated: boolean }>;
    events: Readonly<{ state: PublicationState; count: number; conflictingActions: readonly string[]; truncated: boolean }>;
    reviewItems: number;
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

function stringArray(value: unknown, limit = 100): string[] {
  return Array.isArray(value)
    ? [...new Set(value.slice(0, limit).filter((item): item is string => typeof item === 'string').map((item) => item.trim().toLowerCase()).filter(Boolean))]
    : [];
}

function publicationQuality(parsed: UnknownRecord, rdapStatus: string): RegistryDoctorReport['publication'] {
  if (!['success', 'partial'].includes(rdapStatus)) {
    const unavailable = { state: 'unavailable' as const, value: null };
    return {
      objectClass: unavailable,
      objectIdentifier: unavailable,
      mediaType: unavailable,
      baseConformance: { state: 'unavailable', declarations: [], truncated: false },
      redactionMetadata: { state: 'unavailable', count: 0, truncated: false },
      selfLink: { state: 'unavailable', observedRelations: [], truncated: false },
      events: { state: 'unavailable', count: 0, conflictingActions: [], truncated: false },
      reviewItems: 0,
    };
  }
  const objectClassName = typeof parsed.objectClassName === 'string' ? parsed.objectClassName.trim().toLowerCase() : '';
  const identifier = [parsed.handle, parsed.objectIdentifier, parsed.registryObjectId, parsed.id]
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))?.trim() ?? null;
  const conformanceValues = Array.isArray(parsed.conformance) ? parsed.conformance : [];
  const conformanceTruncated = parsed.conformanceTruncated === true || conformanceValues.length > 100;
  const declarations = stringArray(conformanceValues);
  const redactions = Array.isArray(parsed.redactions) ? parsed.redactions.slice(0, 100) : [];
  const redactionsTruncated = parsed.redactionsTruncated === true
    || (Array.isArray(parsed.redactions) && parsed.redactions.length > 100);
  const linkValues = Array.isArray(parsed.links) ? parsed.links : [];
  const links = linkValues.slice(0, 100).map(recordOrEmpty);
  const linksTruncated = parsed.linksTruncated === true
    || linkValues.length > 100
    || links.some((link) => Array.isArray(link.rel) && link.rel.length > 10);
  const relations = [...new Set(links.flatMap((link) => stringArray(link.rel, 10).length
    ? stringArray(link.rel, 10)
    : typeof link.rel === 'string' ? [link.rel.trim().toLowerCase()] : []).filter(Boolean))];
  const eventValues = Array.isArray(parsed.events) ? parsed.events : [];
  const events = eventValues.slice(0, 100).map(recordOrEmpty);
  const eventsTruncated = parsed.eventsTruncated === true || eventValues.length > 100;
  const actionDates = new Map<string, string[]>();
  for (const event of events) {
    const action = typeof event.action === 'string' ? event.action.trim().toLowerCase() : '';
    const date = registryDateIso(event.date);
    if (!action || !date) continue;
    const dates = actionDates.get(action) ?? [];
    dates.push(date);
    actionDates.set(action, dates);
  }
  const lifecycle = recordOrEmpty(parsed.lifecycle);
  const lifecycleMappings = [
    ['registration', 'createdDateIso', false],
    ['reregistration', 'reregistrationDateIso', true],
    ['expiration', 'expiryDateIso', true],
    ['last changed', 'updatedDateIso', true],
    ['transfer', 'transferDateIso', true],
    ['deletion', 'deletionDateIso', true],
    ['reinstantiation', 'reinstantiationDateIso', true],
    ['last update of rdap database', 'databaseUpdatedDateIso', true],
  ] as const;
  const lifecycleDates = new Map<(typeof lifecycleMappings)[number][1], string>();
  let lifecycleMalformed = false;
  for (const [, field] of lifecycleMappings) {
    const supplied = lifecycle[field];
    if (supplied === undefined || supplied === null) continue;
    const normalized = registryDateIso(supplied);
    if (normalized) lifecycleDates.set(field, normalized);
    else lifecycleMalformed = true;
  }
  const conflictingActions = lifecycleMappings.flatMap(([action, field, newest]) => {
    const publishedDate = lifecycleDates.get(field);
    const published = publishedDate ? Date.parse(publishedDate) : Number.NaN;
    if (!Number.isFinite(published)) return [];
    const dates = (actionDates.get(action) ?? []).map(Date.parse).filter(Number.isFinite);
    if (!dates.length) return [action];
    const selected = newest ? Math.max(...dates) : Math.min(...dates);
    return selected === published ? [] : [action];
  }).sort();
  const objectClassState: PublicationState = !objectClassName ? 'not_observed' : objectClassName === 'domain' ? 'observed' : 'inconsistent';
  const baseConformanceState: PublicationState = declarations.includes('rdap_level_0')
    ? 'observed'
    : conformanceTruncated ? 'unavailable' : 'not_observed';
  const selfLinkState: PublicationState = relations.includes('self')
    ? 'observed'
    : linksTruncated ? 'unavailable' : 'not_observed';
  const hasLifecycle = lifecycleDates.size > 0;
  const eventsState: PublicationState = eventsTruncated || lifecycleMalformed
    ? 'unavailable'
    : conflictingActions.length
    ? 'inconsistent'
    : events.length && hasLifecycle
      ? 'observed'
      : events.length
        ? 'unavailable'
        : 'not_observed';
  return {
    objectClass: { state: objectClassState, value: objectClassName || null },
    objectIdentifier: { state: identifier ? 'observed' : 'not_observed', value: identifier },
    mediaType: { state: 'unavailable', value: null },
    baseConformance: { state: baseConformanceState, declarations, truncated: conformanceTruncated },
    redactionMetadata: {
      state: redactions.length ? 'observed' : redactionsTruncated ? 'unavailable' : 'not_observed',
      count: redactions.length,
      truncated: redactionsTruncated,
    },
    selfLink: { state: selfLinkState, observedRelations: relations.sort(), truncated: linksTruncated },
    events: {
      state: eventsState,
      count: events.length,
      conflictingActions: eventsTruncated || lifecycleMalformed ? [] : conflictingActions,
      truncated: eventsTruncated,
    },
    reviewItems: [objectClassState, baseConformanceState, selfLinkState, eventsState]
      .filter((state) => state !== 'observed').length,
  };
}

function buildRegistryDoctorReport(raw: string, generatedAt = new Date().toISOString()): RegistryDoctorReport {
  const document = parseSavedLookupDocument(raw, { label: 'Registry doctor input' });
  const capability = registryCapabilityFor(document.registrableDomain);
  if (!capability) throw new CliUsageError('Registry doctor could not resolve a capability profile for this domain.');
  const diagnostics = recordOrEmpty(document.diagnostics);
  const rdap = recordOrEmpty(document.rdap);
  const whois = recordOrEmpty(document.whois);
  const rdapParsed = recordOrEmpty(rdap.parsed);
  const whoisParsed = recordOrEmpty(whois.parsed);
  const sourceInputs = [
    {
      source: 'rdap' as const,
      expected: capability.rdapAccessProfile === 'iana-bootstrap' ? 'allowed' as const : 'unsupported' as const,
      observed: status(recordOrEmpty(diagnostics.rdap).status),
      parsed: rdapParsed,
    },
    {
      source: 'whois' as const,
      expected: expectedWhois(capability.whoisAccessProfile),
      observed: status(recordOrEmpty(diagnostics.whois).status),
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
  const publication = publicationQuality(rdapParsed, sourceInputs[0]?.observed ?? 'unavailable');
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
    publication,
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
      'Publication-quality observations describe the saved normalised RDAP object. The saved Lookup format does not retain the response media type, so that field remains unavailable.',
      ...(publication.baseConformance.truncated || publication.redactionMetadata.truncated
        || publication.selfLink.truncated || publication.events.truncated
        ? ['One or more bounded RDAP publication families were truncated; omitted values remain unavailable and cannot support absence or consistency conclusions.']
        : []),
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
  output.push('', 'RDAP publication quality');
  output.push(`  Object class: ${report.publication.objectClass.state.replaceAll('_', ' ')}`);
  output.push(`  Object identifier: ${report.publication.objectIdentifier.state.replaceAll('_', ' ')}`);
  output.push(`  Base conformance: ${report.publication.baseConformance.state.replaceAll('_', ' ')}${report.publication.baseConformance.truncated ? ' (partial)' : ''}`);
  output.push(`  Self link: ${report.publication.selfLink.state.replaceAll('_', ' ')}${report.publication.selfLink.truncated ? ' (partial)' : ''}`);
  output.push(`  Events: ${report.publication.events.state.replaceAll('_', ' ')}${report.publication.events.truncated ? ' (partial)' : ''}`);
  output.push('  Media type: unavailable in the saved Lookup contract');
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

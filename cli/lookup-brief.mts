import { parseSavedLookupDocument, type UnknownRecord } from './saved-lookup.mts';
import { safeTerminalValue } from './formatters/terminal.mts';
import { compareRdapPublications, compareRegistrySources } from '../lib/registry-comparison.mts';

export const CLI_LOOKUP_BRIEF_SCHEMA = 'whoisleuth.cli.lookup-brief';
export const CLI_LOOKUP_BRIEF_VERSION = 3;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, maximum = 300): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
  return normalized || null;
}

function sourceState(value: unknown): string {
  return text(value, 40)?.toLowerCase() ?? 'unavailable';
}

function joinedText(value: unknown, maximumItems = 8): string | null {
  if (!Array.isArray(value)) return null;
  const retained = value.slice(0, maximumItems).flatMap((item) => {
    const normalized = text(item, 253);
    return normalized ? [normalized] : [];
  });
  if (!retained.length) return null;
  return `${retained.join(', ')}${value.length > retained.length ? ` (+${value.length - retained.length} more)` : ''}`;
}

function observedBoolean(value: unknown, positive: string, negative: string): string | null {
  return value === true ? positive : value === false ? negative : null;
}

type BriefSource = Readonly<{
  id: string;
  label: string;
  state: string;
  observedAt: string | null;
}>;

function sourceObservation(
  id: string,
  label: string,
  stateValue: unknown,
  ...timeValues: unknown[]
): BriefSource {
  return Object.freeze({
    id,
    label,
    state: sourceState(stateValue),
    observedAt: timeValues.map((value) => text(value, 64)).find(Boolean) ?? null,
  });
}

function contradictionRows(
  value: unknown,
  left: BriefSource,
  right: BriefSource,
  leftStateKey: string,
  rightStateKey: string,
  leftDisplayKey: string,
  rightDisplayKey: string,
) {
  const fields = Array.isArray(record(value).fields) ? record(value).fields as unknown[] : [];
  return fields.flatMap((fieldValue) => {
    const field = record(fieldValue);
    if (field.status !== 'conflict') return [];
    const label = text(field.label, 120) ?? 'Registration publication field';
    const observations = [
      Object.freeze({
        source: left,
        state: sourceState(field[leftStateKey] ?? left.state),
        value: text(field[leftDisplayKey], 300) ?? 'Value not retained',
      }),
      Object.freeze({
        source: right,
        state: sourceState(field[rightStateKey] ?? right.state),
        value: text(field[rightDisplayKey], 300) ?? 'Value not retained',
      }),
    ];
    return [Object.freeze({
      field: label,
      detail: `${left.label} and ${right.label} publish different values for ${label}.`,
      observations: Object.freeze(observations),
    })];
  });
}

export function buildCliLookupBrief(input: string, generatedAt = new Date().toISOString()) {
  const document = parseSavedLookupDocument(input, { label: 'Lookup brief input' });
  const diagnostics = record(document.diagnostics);
  const availability = record(document.availability);
  const rdapDiagnostics = record(diagnostics.rdap);
  const registrarRdapDiagnostics = record(rdapDiagnostics.registrar);
  const whoisDiagnostics = record(diagnostics.whois);
  const availabilityDiagnostics = record(diagnostics.availability);
  const rdap = record(record(document.rdap).parsed);
  const whois = record(record(document.whois).parsed);
  const registrarRdap = record(record(record(document.rdap).registrarRdap).parsed);
  const preferred = Object.keys(rdap).length ? rdap : whois;
  const rdapSource = sourceObservation('rdap', 'Registry RDAP', rdapDiagnostics.status, rdapDiagnostics.observedAt, rdapDiagnostics.fetchedAt, record(document.rdap).observedAt, record(document.rdap).fetchedAt);
  const registrarRdapSource = sourceObservation('registrar_rdap', 'Registrar RDAP', registrarRdapDiagnostics.status, registrarRdapDiagnostics.observedAt, registrarRdapDiagnostics.fetchedAt);
  const whoisSource = sourceObservation('whois', 'WHOIS', whoisDiagnostics.status, whoisDiagnostics.observedAt, whoisDiagnostics.queriedAt, record(document.whois).observedAt, record(document.whois).queriedAt);
  const availabilitySource = sourceObservation('availability', 'Authority-aware availability', availabilityDiagnostics.status ?? availability.status, availabilityDiagnostics.observedAt, availability.observedAt);
  const dns = record(availability.dns);
  const http = record(availability.http);
  const tls = record(availability.tls);
  const dnsSource = sourceObservation('dns', 'DNS', dns.status ?? dns.state, dns.observedAt, dns.checkedAt);
  const httpSource = sourceObservation('http', 'HTTP and static page identity', http.status ?? http.state, http.observedAt, http.checkedAt, record(availability.pageIdentity).observedAt);
  const tlsSource = sourceObservation('tls', 'TLS', tls.status ?? tls.state, tls.observedAt, tls.checkedAt);
  const pageIdentity = record(availability.pageIdentity);
  const technology = record(availability.technologyProfile);
  const sslbl = record(document.sslbl);
  const pageAnalysisSource = sourceObservation(
    'page_analysis',
    'Static page analysis',
    pageIdentity.status ?? technology.status,
    pageIdentity.observedAt,
    technology.observedAt,
    http.observedAt,
  );
  const sslblSource = sourceObservation(
    'sslbl',
    'Local SSLBL certificate snapshot',
    sslbl.status,
    sslbl.observedAt,
    record(sslbl.snapshot).sourceUpdatedAt,
  );
  const sources = [
    rdapSource,
    registrarRdapSource,
    whoisSource,
    availabilitySource,
    dnsSource,
    httpSource,
    tlsSource,
    pageAnalysisSource,
    ...(Object.keys(sslbl).length ? [sslblSource] : []),
  ];
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const preferredRegistrationSource = Object.keys(rdap).length ? rdapSource : whoisSource;
  const externalFormActions = record(pageIdentity.forms).externalActionOrigins;
  const facts = [
    ['registration-state', 'Registration state', availability.state, availabilitySource.id],
    ['registrar', 'Registrar', record(preferred.registrar).name ?? preferred.registrar, preferredRegistrationSource.id],
    ['created', 'Created', record(preferred.lifecycle).createdIso ?? preferred.createdDateIso, preferredRegistrationSource.id],
    ['expires', 'Expires', record(preferred.lifecycle).expiryIso ?? preferred.expiryDateIso, preferredRegistrationSource.id],
    ['name-servers', 'Name servers', joinedText(preferred.nameservers), preferredRegistrationSource.id],
    ['website-activity', 'Website activity', availability.activityStatus, httpSource.id],
    ['page-title', 'Page title', availability.pageTitle, httpSource.id],
    ['dnssec', 'DNSSEC publication', availability.dnssec, dnsSource.id],
    ['mail-exchanger', 'Mail exchanger', observedBoolean(availability.hasMx, 'Observed', 'Not observed in retained DNS evidence'), dnsSource.id],
    ['spf', 'SPF publication', observedBoolean(availability.hasSpf, 'Observed', 'Not observed in retained DNS evidence'), dnsSource.id],
    ['dmarc', 'DMARC publication', observedBoolean(availability.hasDmarc, 'Observed', 'Not observed in retained DNS evidence'), dnsSource.id],
    ['password-input', 'Password input', observedBoolean(availability.hasPasswordField, 'Observed in static HTML', 'Not observed in retained static HTML'), pageAnalysisSource.id],
    ['external-form-actions', 'External form actions', Array.isArray(externalFormActions)
      ? `${externalFormActions.length} retained origin${externalFormActions.length === 1 ? '' : 's'}`
      : null, pageAnalysisSource.id],
    ['page-role', 'Page role', record(availability.pageRoleProfile).primaryRole, pageAnalysisSource.id],
    ['technology-indicators', 'Technology indicators', joinedText(
      Array.isArray(technology.findings)
        ? technology.findings.map((finding) => record(finding).name ?? record(finding).id)
        : null,
    ), pageAnalysisSource.id],
    ['certificate-warning-data', 'Certificate warning data', sslbl.verdict === 'listed'
      ? 'Listed certificate review lead'
      : sslbl.verdict === 'not_listed' && sslbl.status === 'success' && sslbl.complete === true
        ? 'No match in retained local snapshot'
        : Object.keys(sslbl).length
          ? 'Inconclusive'
          : null, sslblSource.id],
  ].flatMap(([id, label, value, sourceId]) => {
    const normalized = text(value);
    const source = sourceById.get(String(sourceId));
    return normalized && source ? [Object.freeze({ id: String(id), label: String(label), value: normalized, source })] : [];
  });
  const incomplete = sources.filter((item) => !['complete', 'success'].includes(item.state));
  const registryComparison = compareRegistrySources(rdap, whois, {
    rdapStatus: rdapDiagnostics.status,
    whoisStatus: whoisDiagnostics.status,
  });
  const registrarComparison = compareRdapPublications(rdap, registrarRdap, {
    registryStatus: rdapDiagnostics.status,
    registrarStatus: registrarRdapDiagnostics.status,
  });
  const contradictions = [
    ...contradictionRows(registryComparison, rdapSource, whoisSource, 'rdapState', 'whoisState', 'rdapDisplay', 'whoisDisplay'),
    ...contradictionRows(registrarComparison, rdapSource, registrarRdapSource, 'registryState', 'registrarState', 'registryDisplay', 'registrarDisplay'),
  ].slice(0, 16);
  const actionPlan = [
    ...(contradictions.length ? [{
      id: 'registration-publication-review',
      action: 'Review the separately attributed registration publications before relying on the conflicting fields.',
      reason: `${contradictions.length} conflicting publication field${contradictions.length === 1 ? '' : 's'} were retained with separate source values.`,
      expectedOutcome: 'Establish which observation is current, authoritative, or still unresolved.',
      evidence: 'registry publication comparison',
    }] : []),
    ...(incomplete.length ? [{
      id: 'source-state-review',
      action: `Refresh or explain the ${incomplete.map((item) => item.id).join(', ')} source state before treating missing values as meaningful.`,
      reason: 'At least one source was not complete in the saved observation.',
      expectedOutcome: 'Determine whether each limitation is transient, persistent, or expected for that source.',
      evidence: 'source health',
    }] : []),
    ...(document.mode === 'fast' ? [{
      id: 'collection-depth-review',
      action: 'Run a deliberate Deep lookup if DNS, HTTP, TLS, page, or network evidence is required.',
      reason: 'The saved observation used the intentionally narrower Fast contract.',
      expectedOutcome: 'Collect the explicitly selected additional source classes without implying that unavailable evidence is absent.',
      evidence: 'collection mode',
    }] : []),
    ...(sslbl.verdict === 'listed' ? [{
      id: 'certificate-warning-review',
      action: 'Review the matching certificate fingerprint alongside current TLS, page, and infrastructure evidence.',
      reason: 'The retained local warning-data snapshot contains the observed certificate fingerprint as a review lead.',
      expectedOutcome: 'Determine whether the listing is relevant and current without treating it alone as a maliciousness verdict.',
      evidence: 'local SSLBL certificate snapshot',
    }] : []),
    {
      id: 'case-evidence-review',
      action: 'Pin only the facts needed for the decision and keep analyst hypotheses separate from observations.',
      reason: 'The brief organises one observation but does not create an analyst decision.',
      expectedOutcome: 'Preserve a reviewable boundary between observed facts, hypotheses, unknowns, and decisions.',
      evidence: 'case workflow',
    },
  ].slice(0, 6).map((item) => Object.freeze(item));
  const recommendedActions = actionPlan.map((item) => item.action);
  return Object.freeze({
    schema: CLI_LOOKUP_BRIEF_SCHEMA,
    version: CLI_LOOKUP_BRIEF_VERSION,
    generatedAt,
    target: document.registrableDomain,
    observedAt: document.generatedAt,
    mode: document.mode,
    facts: Object.freeze(facts),
    sourceHealth: Object.freeze(sources),
    contradictions: Object.freeze(contradictions),
    unknowns: Object.freeze(incomplete.map((item) => `${item.id}: ${item.state}`)),
    actionPlan: Object.freeze(actionPlan),
    recommendedActions: Object.freeze(recommendedActions.slice(0, 6)),
    limitations: Object.freeze([
      'This brief is derived from one saved Lookup and makes no request.',
      'It organises bounded facts and uncertainty but does not create an analyst assertion, decide maliciousness, or establish current state.',
      'Raw registry, provider, HTTP and page payloads are excluded.',
    ]),
  });
}

export function formatCliLookupBrief(document: ReturnType<typeof buildCliLookupBrief>): string {
  return [
    `Lookup brief: ${safeTerminalValue(document.target)}`,
    `Observed  ${safeTerminalValue(document.observedAt)}`,
    `Mode      ${safeTerminalValue(document.mode)}`,
    '',
    'Source-attributed facts',
    ...(document.facts.length ? document.facts.map((item) => `  ${safeTerminalValue(item.label)}: ${safeTerminalValue(item.value)} (${safeTerminalValue(item.source.label)}; ${safeTerminalValue(item.source.state)}; ${item.source.observedAt ? `observed ${safeTerminalValue(item.source.observedAt)}` : 'source time not recorded'})`) : ['  No bounded fact was available.']),
    '',
    'Contradictions',
    ...(document.contradictions.length ? document.contradictions.flatMap((item) => [
      `  ${safeTerminalValue(item.field)}: ${safeTerminalValue(item.detail)}`,
      ...item.observations.map((observation) => `    ${safeTerminalValue(observation.source.label)}: ${safeTerminalValue(observation.value)} (${safeTerminalValue(observation.state)}; ${observation.source.observedAt ? `observed ${safeTerminalValue(observation.source.observedAt)}` : 'source time not recorded'})`),
    ]) : ['  No conflicting publication field was retained.']),
    '',
    'Unknown or incomplete',
    ...(document.unknowns.length ? document.unknowns.map((item) => `  ${safeTerminalValue(item)}`) : ['  No incomplete source state was identified.']),
    '',
    'Recommended manual actions',
    ...document.actionPlan.flatMap((item, index) => [
      `  ${index + 1}. ${safeTerminalValue(item.action)}`,
      `     Expected outcome: ${safeTerminalValue(item.expectedOutcome)}`,
    ]),
    '',
  ].join('\n');
}

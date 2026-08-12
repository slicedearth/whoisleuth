import {
  assertLookupEvidencePortableTree,
  LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES,
  LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS,
  LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH,
  LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES,
  LOOKUP_EVIDENCE_SCHEMA,
  LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
  SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS,
} from './evidence-export.ts';
import { scanBoundedJson } from '../../../../lib/bounded-json.mts';
import {
  buildLookupAssetGraph,
  type LookupAssetGraph,
} from './lookup-asset-graph.ts';

export const LOOKUP_EVIDENCE_REPLAY_MAX_BYTES = LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES;
export const LOOKUP_EVIDENCE_REPLAY_MAX_ENTRIES = LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES;

export type LookupEvidenceReplaySource = Readonly<{
  id: string;
  label: string;
  state: string;
  complete: boolean | null;
  observedAt: string | null;
  limitations: readonly string[];
}>;

export type LookupEvidenceReplayFact = Readonly<{
  id: string;
  label: string;
  value: string;
  sourceId: string;
  source: string;
  sourceState: string;
  sourceComplete: boolean | null;
}>;

export type LookupEvidenceReplay = Readonly<{
  version: 1;
  schemaVersion: number;
  digestSha256: string;
  digestVerified: boolean;
  exportedAt: string;
  generatorVersion: string | null;
  target: string;
  targetType: string;
  availability: string;
  confidence: string;
  sources: readonly LookupEvidenceReplaySource[];
  facts: readonly LookupEvidenceReplayFact[];
  contradictions: readonly string[];
  unknowns: readonly string[];
  recommendedSteps: readonly string[];
  graph: LookupAssetGraph;
  limitations: readonly string[];
}>;

type JsonRecord = Record<string, unknown>;
type SourceDescriptor = Readonly<{
  id: string;
  label: string;
  value: unknown;
  fallbackObservedAt?: unknown;
}>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const MAX_SOURCES = 16;
const MAX_FACTS = 20;
const MAX_LIMITATIONS = 24;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const RDAP_STATES = new Set(['success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled']);
const WHOIS_STATES = new Set(['complete', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled']);
const LEGACY_RDAP_WRAPPER_STATES = new Set(['success', 'not_found', 'error']);
const LEGACY_WHOIS_WRAPPER_STATES = new Set(['complete', 'partial', 'unknown', 'error']);

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, maximum = 320): string {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function stringList(value: unknown, count = 8, maximum = 300): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = text(item, maximum);
    if (!normalized || seen.has(normalized)) continue;
    output.push(normalized);
    seen.add(normalized);
    if (output.length >= count) break;
  }
  return output;
}

function unique(values: readonly string[], maximum: number): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, maximum);
}

function sourceState(value: JsonRecord): string {
  return text(
    value.state
      ?? value.status
      ?? value.outcome
      ?? (Object.keys(value).length ? 'reported' : 'unavailable'),
    64,
  ).replaceAll('_', ' ');
}

function source(descriptor: SourceDescriptor): LookupEvidenceReplaySource {
  const value = record(descriptor.value);
  const state = sourceState(value);
  return {
    id: descriptor.id,
    label: descriptor.label,
    state,
    complete: typeof value.complete === 'boolean' ? value.complete : null,
    observedAt: timestamp(
      value.observedAt
        ?? value.fetchedAt
        ?? value.queriedAt
        ?? descriptor.fallbackObservedAt,
    ),
    limitations: stringList(value.limitations),
  };
}

function factValue(value: unknown): string {
  let normalized = '';
  if (Array.isArray(value)) normalized = stringList(value, 12, 160).join(', ');
  else if (value && typeof value === 'object') {
    const item = record(value);
    normalized = text(item.name ?? item.org ?? item.handle ?? item.value, 300);
  } else normalized = text(value, 300);
  return normalized;
}

function addFact(
  output: LookupEvidenceReplayFact[],
  id: string,
  label: string,
  candidates: readonly Readonly<{ value: unknown; sourceId: string }>[],
  sources: ReadonlyMap<string, LookupEvidenceReplaySource>,
): void {
  if (output.length >= MAX_FACTS) return;
  for (const candidate of candidates) {
    const value = factValue(candidate.value);
    const source = sources.get(candidate.sourceId);
    if (!value || !source) continue;
    output.push({
      id,
      label,
      value,
      sourceId: source.id,
      source: source.label,
      sourceState: source.state,
      sourceComplete: source.complete,
    });
    return;
  }
}

function lifecycleValue(parsed: JsonRecord, key: string): unknown {
  const lifecycle = record(parsed.lifecycle);
  const aliases = key === 'created'
    ? ['createdIso', 'createdDateIso', 'created', 'createdDate']
    : ['expiresIso', 'expiryDateIso', 'expires', 'expiryDate'];
  for (const alias of aliases) {
    if (lifecycle[alias] !== undefined && lifecycle[alias] !== null) return lifecycle[alias];
    if (parsed[alias] !== undefined && parsed[alias] !== null) return parsed[alias];
  }
  return null;
}

function comparisonContradictions(value: unknown, label: string): string[] {
  const comparison = record(value);
  const fields = Array.isArray(comparison.fields) ? comparison.fields.slice(0, 24) : [];
  return fields.flatMap((item) => {
    const field = record(item);
    if (text(field.status, 64) !== 'conflict') return [];
    const fieldLabel = text(field.label, 120) || 'Registration field';
    return [`${label}: ${fieldLabel} differs between the compared publications.`];
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function validateDocumentShape(value: unknown): void {
  try {
    assertLookupEvidencePortableTree(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The evidence file exceeds the portable structure limits.';
    throw new Error(detail.replace(/^Lookup evidence/u, 'Lookup evidence replay'));
  }
}

export async function parseLookupEvidenceReplay(
  input: string,
  options: Readonly<{ expectedSha256?: string }> = {},
): Promise<LookupEvidenceReplay> {
  const bytes = new TextEncoder().encode(input).byteLength;
  if (!bytes) throw new Error('The evidence file is empty.');
  if (bytes > LOOKUP_EVIDENCE_REPLAY_MAX_BYTES) {
    throw new Error('Lookup evidence replay files are limited to 5 MB.');
  }
  let parsed: unknown;
  try {
    scanBoundedJson(input, {
      maximumDepth: LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH,
      maximumKeys: LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES,
      maximumValues: LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES,
      maximumContainerItems: LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS,
    });
    parsed = JSON.parse(input);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : '';
    if (detail.startsWith('Artefact JSON ')) {
      throw new Error(detail.replace(/^Artefact JSON/u, 'Lookup evidence replay'));
    }
    throw new Error('The selected file is not valid JSON.');
  }
  validateDocumentShape(parsed);
  const expectedSha256 = text(options.expectedSha256, 64).toLowerCase();
  if (expectedSha256 && !SHA256_RE.test(expectedSha256)) {
    throw new Error('The expected SHA-256 checksum must contain exactly 64 hexadecimal characters.');
  }
  const digestSha256 = await sha256(input);
  if (expectedSha256 && expectedSha256 !== digestSha256) {
    throw new Error('The evidence file does not match the expected SHA-256 checksum.');
  }
  const document = record(parsed);
  if (document.schema !== LOOKUP_EVIDENCE_SCHEMA) {
    throw new Error('The selected file is not a WHOISleuth Lookup evidence export.');
  }
  if (!SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS.some((version) => version === document.schemaVersion)) {
    throw new Error(`Only Lookup evidence schemas ${SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS.join(' and ')} can be replayed by this build.`);
  }
  const exportedAt = timestamp(document.generatedAt);
  if (!exportedAt) throw new Error('The evidence export timestamp is missing or invalid.');
  const application = record(document.application);
  const generatorVersion = text(application.version, 128) || null;

  const query = record(document.query);
  const diagnostics = record(document.diagnostics);
  const sources = record(document.sources);
  const analysis = record(document.analysis);
  const availability = record(analysis.availability);
  const rdap = record(sources.rdap);
  const whois = record(sources.whois);
  const rdapDiagnosticState = text(record(diagnostics.rdap).status, 40);
  const whoisDiagnosticState = text(record(diagnostics.whois).status, 40);
  const rdapSourceState = text(rdap.status, 40);
  const whoisSourceState = text(whois.status, 40);
  const schemaVersion = Number(document.schemaVersion);
  const legacySourceWrappers = schemaVersion === LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION;
  if (!RDAP_STATES.has(rdapDiagnosticState) || !WHOIS_STATES.has(whoisDiagnosticState)) {
    throw new Error('Lookup evidence source states contradict their retained diagnostics.');
  }
  if (legacySourceWrappers) {
    if (!LEGACY_RDAP_WRAPPER_STATES.has(rdapSourceState)
      || !LEGACY_WHOIS_WRAPPER_STATES.has(whoisSourceState)
      || (rdapDiagnosticState === 'success' && rdapSourceState !== 'success')
      || (rdapDiagnosticState === 'not_found' && rdapSourceState !== 'not_found')
      || (rdapDiagnosticState === 'error' && rdapSourceState !== 'error')
      || (whoisDiagnosticState === 'complete' && whoisSourceState !== 'complete')
      || (whoisDiagnosticState === 'partial' && whoisSourceState !== 'partial')
      || (whoisDiagnosticState === 'error' && whoisSourceState !== 'error')) {
      throw new Error('Lookup evidence source states contradict their retained diagnostics.');
    }
  } else if (rdapSourceState !== rdapDiagnosticState || whoisSourceState !== whoisDiagnosticState) {
    throw new Error('Lookup evidence source states contradict their retained diagnostics.');
  }
  const rdapPublicationAvailable = ['success', 'partial'].includes(rdapDiagnosticState);
  const whoisPublicationAvailable = ['complete', 'partial'].includes(whoisDiagnosticState);
  const retainedRdapParsed = record(rdap.parsed);
  const retainedWhoisParsed = record(whois.parsed);
  const rdapParsed = rdapPublicationAvailable ? retainedRdapParsed : {};
  const whoisParsed = whoisPublicationAvailable ? retainedWhoisParsed : {};
  if ((rdapDiagnosticState === 'success' && Object.keys(rdapParsed).length === 0)
    || (!legacySourceWrappers && !rdapPublicationAvailable && Object.keys(retainedRdapParsed).length > 0)) {
    throw new Error('Lookup evidence RDAP publication state is inconsistent with its retained data.');
  }
  if ((whoisDiagnosticState === 'complete' && Object.keys(whoisParsed).length === 0)
    || (!legacySourceWrappers && !whoisPublicationAvailable && Object.keys(retainedWhoisParsed).length > 0)) {
    throw new Error('Lookup evidence WHOIS publication state is inconsistent with its retained data.');
  }
  const replayRdap = {
    ...rdap,
    status: rdapDiagnosticState,
    parsed: rdapPublicationAvailable ? rdap.parsed ?? null : null,
    raw: rdapPublicationAvailable ? rdap.raw ?? null : null,
  };
  const replayWhois = {
    ...whois,
    status: whoisDiagnosticState,
    parsed: whoisPublicationAvailable ? whois.parsed ?? null : null,
    chain: whoisPublicationAvailable && Array.isArray(whois.chain) ? whois.chain : [],
  };
  const dns = record(availability.dns);
  const http = record(availability.http);
  const tls = record(availability.tls);
  const pageIdentity = record(availability.pageIdentity);
  const technology = record(availability.technologyProfile);
  const securityPosture = record(availability.securityPosture);
  const structuredDataIdentity = record(availability.structuredDataIdentity);
  const sourceDescriptors: SourceDescriptor[] = [
    { id: 'submitted-query', label: 'Submitted query', value: { state: 'provided', complete: true, observedAt: exportedAt } },
    { id: 'rdap', label: 'Registry RDAP', value: replayRdap, fallbackObservedAt: record(diagnostics.rdap).fetchedAt },
    { id: 'whois', label: 'WHOIS', value: replayWhois, fallbackObservedAt: record(diagnostics.whois).queriedAt },
    { id: 'reverse-dns', label: 'Reverse DNS', value: sources.reverseDns },
    { id: 'network-context', label: 'Observed network context', value: sources.network },
    { id: 'dns', label: 'DNS', value: dns },
    { id: 'http', label: 'HTTP', value: http },
    { id: 'tls', label: 'TLS', value: tls },
    { id: 'page-identity', label: 'Page identity', value: pageIdentity },
    { id: 'technology', label: 'Technology profile', value: technology },
    { id: 'security-posture', label: 'Passive security posture', value: securityPosture },
    { id: 'security-txt', label: 'security.txt', value: sources.securityTxt },
    { id: 'sslbl', label: 'SSLBL snapshot comparison', value: sources.sslbl },
  ];
  const replaySources = sourceDescriptors
    .map((item) => source(item))
    .slice(0, MAX_SOURCES);
  const replaySourcesById = new Map(replaySources.map((item) => [item.id, item]));

  const facts: LookupEvidenceReplayFact[] = [];
  addFact(facts, 'registration.domain', 'Domain', [
    { value: rdapParsed.domain, sourceId: 'rdap' },
    { value: whoisParsed.domain ?? whoisParsed.domainName, sourceId: 'whois' },
    { value: query.registrableDomain ?? query.submitted, sourceId: 'submitted-query' },
  ], replaySourcesById);
  addFact(facts, 'registration.registrar', 'Registrar', [
    { value: rdapParsed.registrar, sourceId: 'rdap' },
    { value: whoisParsed.registrar, sourceId: 'whois' },
  ], replaySourcesById);
  addFact(facts, 'registration.created', 'Created', [
    { value: lifecycleValue(rdapParsed, 'created'), sourceId: 'rdap' },
    { value: lifecycleValue(whoisParsed, 'created'), sourceId: 'whois' },
  ], replaySourcesById);
  addFact(facts, 'registration.expires', 'Expires', [
    { value: lifecycleValue(rdapParsed, 'expires'), sourceId: 'rdap' },
    { value: lifecycleValue(whoisParsed, 'expires'), sourceId: 'whois' },
  ], replaySourcesById);
  addFact(facts, 'registration.nameservers', 'Nameservers', [
    { value: rdapParsed.nameservers, sourceId: 'rdap' },
    { value: whoisParsed.nameservers, sourceId: 'whois' },
    { value: availability.nameservers, sourceId: 'dns' },
  ], replaySourcesById);
  addFact(facts, 'website.activity', 'Website activity', [{ value: availability.activityStatus, sourceId: 'http' }], replaySourcesById);
  addFact(facts, 'website.final-url', 'Final website URL', [{ value: http.finalUrl ?? record(http.response).finalUrl, sourceId: 'http' }], replaySourcesById);
  addFact(facts, 'tls.connected-address', 'Connected address', [{ value: tls.connectedAddress, sourceId: 'tls' }], replaySourcesById);
  addFact(facts, 'tls.certificate-fingerprint', 'Certificate fingerprint', [{ value: record(tls.certificate).fingerprintSha256, sourceId: 'tls' }], replaySourcesById);
  addFact(facts, 'page.title', 'Page title', [{ value: pageIdentity.title ?? availability.pageTitle, sourceId: 'page-identity' }], replaySourcesById);
  const technologyFindings = Array.isArray(technology.findings)
    ? technology.findings.slice(0, 12).map((item) => record(item).name)
    : [];
  addFact(facts, 'technology.detected', 'Detected technology', [{ value: technologyFindings, sourceId: 'technology' }], replaySourcesById);

  const contradictions = unique([
    ...comparisonContradictions(analysis.registryComparison, 'Registry RDAP and WHOIS'),
    ...comparisonContradictions(analysis.registrarPublicationComparison, 'Registry and registrar RDAP'),
  ], 16);
  const unknowns = unique(replaySources.flatMap((item) => (
    ['success', 'complete', 'provided'].includes(item.state) && item.complete !== false
      ? []
      : [`${item.label}: ${item.state}${item.complete === false ? ' and incomplete' : ''}.`]
  )), 12);
  const recommendedSteps = unique([
    ...(contradictions.length ? ['Review each contradictory registration field against its separately attributed source evidence.'] : []),
    ...(unknowns.length ? ['Refresh incomplete or unavailable sources in a deliberate live Lookup if current evidence is required.'] : []),
    'Use the retained observation time and file digest when citing this historical evidence.',
    'Record analyst assertions separately from the replayed observations.',
  ], 6);
  const retainedNetworkContext = record(sources.network);
  const networkState = text(retainedNetworkContext.status, 40);
  const networkContext = ['success', 'partial'].includes(networkState) ? retainedNetworkContext : {};
  const graph = buildLookupAssetGraph({
    target: query.registrableDomain ?? query.inputHostname ?? query.submitted,
    observedAt: exportedAt,
    rdapEvidence: replayRdap,
    rdapParsed,
    dnsEvidence: dns,
    dnsRecords: dns.records,
    observedNetworkContext: networkContext,
    observedNetworkEndpoint: networkContext.endpoint,
    observedNetwork: networkContext.network,
    httpEvidence: http,
    tlsEvidence: tls,
    tlsCertificate: tls.certificate,
    tlsAuthorization: tls.authorization,
    tlsHostname: tls.hostname,
    tlsAltNames: record(tls.certificate).subjectAltNames,
    tlsPublicKey: record(tls.certificate).publicKey,
    tlsIssuer: record(tls.certificate).issuer,
    pageCanonical: pageIdentity.canonical,
    pageOpenGraphUrl: pageIdentity.openGraph,
    pageForms: pageIdentity.forms,
    pageResources: pageIdentity.resources,
    pageIdentity,
    structuredDataIdentity,
  });
  const limitations = unique([
    ...replaySources.flatMap((item) => item.limitations),
    ...stringList(availability.limitations, 12),
    'This is a local replay of a deliberate evidence export. It does not refresh any source or establish the target state at import time.',
    'Only bounded normalised facts are shown here. Raw source payloads in the export are not rendered.',
    'Missing or unsupported evidence remains unavailable and is not evidence of absence, safety, or equivalence.',
    ...(legacySourceWrappers && (rdapSourceState !== rdapDiagnosticState || whoisSourceState !== whoisDiagnosticState)
      ? ['Schema 25 used legacy publication wrappers; retained diagnostics are authoritative and unavailable wrapper data was suppressed during replay.']
      : []),
  ], MAX_LIMITATIONS);

  return {
    version: 1,
    schemaVersion,
    digestSha256,
    digestVerified: Boolean(expectedSha256),
    exportedAt,
    generatorVersion,
    target: text(query.registrableDomain ?? query.inputHostname ?? query.submitted, 253) || 'Unknown target',
    targetType: text(query.type, 40) || 'unknown',
    availability: text(availability.state, 64).replaceAll('_', ' ') || 'unknown',
    confidence: text(availability.confidence, 64).replaceAll('_', ' ') || 'not reported',
    sources: replaySources,
    facts,
    contradictions,
    unknowns,
    recommendedSteps,
    graph,
    limitations,
  };
}

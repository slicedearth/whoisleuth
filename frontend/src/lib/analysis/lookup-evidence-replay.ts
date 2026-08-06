import {
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
} from './evidence-export.ts';
import {
  buildLookupAssetGraph,
  type LookupAssetGraph,
} from './lookup-asset-graph.ts';

export const LOOKUP_EVIDENCE_REPLAY_MAX_BYTES = 5 * 1024 * 1024;
export const LOOKUP_EVIDENCE_REPLAY_MAX_ENTRIES = 20_000;

export type LookupEvidenceReplaySource = Readonly<{
  id: string;
  label: string;
  state: string;
  complete: boolean | null;
  observedAt: string | null;
  limitations: readonly string[];
}>;

export type LookupEvidenceReplayFact = Readonly<{
  label: string;
  value: string;
  source: string;
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
const MAX_DOCUMENT_DEPTH = 24;
const SHA256_RE = /^[a-f0-9]{64}$/u;

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

function addFact(
  output: LookupEvidenceReplayFact[],
  label: string,
  value: unknown,
  sourceLabel: string,
): void {
  if (output.length >= MAX_FACTS) return;
  let normalized = '';
  if (Array.isArray(value)) normalized = stringList(value, 12, 160).join(', ');
  else if (value && typeof value === 'object') {
    const item = record(value);
    normalized = text(item.name ?? item.org ?? item.handle ?? item.value, 300);
  } else normalized = text(value, 300);
  if (!normalized) return;
  output.push({ label, value: normalized, source: sourceLabel });
}

function lifecycleValue(parsed: JsonRecord, key: string): unknown {
  const lifecycle = record(parsed.lifecycle);
  return lifecycle[`${key}Iso`] ?? lifecycle[key] ?? parsed[`${key}Iso`] ?? parsed[key];
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
  const pending: Array<Readonly<{ value: unknown; depth: number }>> = [{ value, depth: 0 }];
  let entries = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    entries += 1;
    if (entries > LOOKUP_EVIDENCE_REPLAY_MAX_ENTRIES) {
      throw new Error(`Lookup evidence replay files are limited to ${LOOKUP_EVIDENCE_REPLAY_MAX_ENTRIES.toLocaleString('en')} structured entries.`);
    }
    if (current.depth > MAX_DOCUMENT_DEPTH) {
      throw new Error(`Lookup evidence replay files are limited to ${MAX_DOCUMENT_DEPTH} nested levels.`);
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (current.value && typeof current.value === 'object') {
      for (const item of Object.values(current.value)) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
    }
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
    parsed = JSON.parse(input);
  } catch {
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
  if (document.schemaVersion !== LOOKUP_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`Only Lookup evidence schema ${LOOKUP_EVIDENCE_SCHEMA_VERSION} can be replayed by this build.`);
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
  const rdapParsed = record(rdap.parsed);
  const whoisParsed = record(whois.parsed);
  const dns = record(availability.dns);
  const http = record(availability.http);
  const tls = record(availability.tls);
  const pageIdentity = record(availability.pageIdentity);
  const technology = record(availability.technologyProfile);
  const securityPosture = record(availability.securityPosture);
  const structuredDataIdentity = record(availability.structuredDataIdentity);
  const sourceDescriptors: SourceDescriptor[] = [
    { id: 'rdap', label: 'Registry RDAP', value: rdap, fallbackObservedAt: record(diagnostics.rdap).fetchedAt },
    { id: 'whois', label: 'WHOIS', value: whois, fallbackObservedAt: record(diagnostics.whois).queriedAt },
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

  const facts: LookupEvidenceReplayFact[] = [];
  addFact(facts, 'Domain', rdapParsed.domain ?? whoisParsed.domain ?? query.registrableDomain ?? query.submitted, 'Registration');
  addFact(facts, 'Registrar', rdapParsed.registrar ?? whoisParsed.registrar, 'Registry RDAP / WHOIS');
  addFact(facts, 'Created', lifecycleValue(rdapParsed, 'created') ?? lifecycleValue(whoisParsed, 'created'), 'Registry RDAP / WHOIS');
  addFact(facts, 'Expires', lifecycleValue(rdapParsed, 'expires') ?? lifecycleValue(whoisParsed, 'expires'), 'Registry RDAP / WHOIS');
  addFact(facts, 'Nameservers', rdapParsed.nameservers ?? whoisParsed.nameservers ?? availability.nameservers, 'Registration / DNS');
  addFact(facts, 'Website activity', availability.activityStatus, 'HTTP');
  addFact(facts, 'Final website URL', http.finalUrl ?? record(http.response).finalUrl, 'HTTP');
  addFact(facts, 'Connected address', tls.connectedAddress, 'TLS');
  addFact(facts, 'Certificate fingerprint', record(tls.certificate).fingerprintSha256, 'TLS');
  addFact(facts, 'Page title', pageIdentity.title ?? availability.pageTitle, 'HTML');
  const technologyFindings = Array.isArray(technology.findings)
    ? technology.findings.slice(0, 12).map((item) => record(item).name)
    : [];
  addFact(facts, 'Detected technology', technologyFindings, 'Derived technology profile');

  const contradictions = unique([
    ...comparisonContradictions(analysis.registryComparison, 'Registry RDAP and WHOIS'),
    ...comparisonContradictions(analysis.registrarPublicationComparison, 'Registry and registrar RDAP'),
  ], 16);
  const unknowns = unique(replaySources.flatMap((item) => (
    item.state === 'success' && item.complete !== false
      ? []
      : [`${item.label}: ${item.state}${item.complete === false ? ' and incomplete' : ''}.`]
  )), 12);
  const recommendedSteps = unique([
    ...(contradictions.length ? ['Review each contradictory registration field against its separately attributed source evidence.'] : []),
    ...(unknowns.length ? ['Refresh incomplete or unavailable sources in a deliberate live Lookup if current evidence is required.'] : []),
    'Use the retained observation time and file digest when citing this historical evidence.',
    'Record analyst assertions separately from the replayed observations.',
  ], 6);
  const networkContext = record(sources.network);
  const graph = buildLookupAssetGraph({
    target: query.registrableDomain ?? query.inputHostname ?? query.submitted,
    observedAt: exportedAt,
    rdapEvidence: rdap,
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
  ], MAX_LIMITATIONS);

  return {
    version: 1,
    schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
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

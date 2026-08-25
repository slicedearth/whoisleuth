// Pure evidence-coverage projection shared by Lookup artefact builders.
export type EvidenceCoverageCategory = 'analysis' | 'external' | 'network' | 'registry' | 'web';
export type EvidenceCoverageState =
  | 'complete'
  | 'not_found'
  | 'partial'
  | 'skipped'
  | 'unavailable'
  | 'unknown'
  | 'unsupported';

export type EvidenceCoverageInput = Readonly<{
  id: string;
  label: string;
  category: EvidenceCoverageCategory;
  status?: unknown;
  complete?: unknown;
  truncated?: unknown;
  limitations?: unknown;
}>;

export type EvidenceCoverageEntry = Readonly<{
  id: string;
  label: string;
  category: EvidenceCoverageCategory;
  state: EvidenceCoverageState;
  statusLabel: string;
  truncated: boolean;
  limitations: readonly string[];
  manualReviewSuggested: boolean;
}>;

export type EvidenceCoverageLedger = Readonly<{
  version: 1;
  entries: readonly EvidenceCoverageEntry[];
  counts: Readonly<Record<EvidenceCoverageState, number>>;
  completeCount: number;
  limitedCount: number;
}>;

export type LookupEvidenceCoverageInput = Readonly<{
  targetType?: unknown;
  availability?: unknown;
  diagnostics?: unknown;
  dnsEvidence?: unknown;
  httpEvidence?: unknown;
  httpResponse?: unknown;
  observedNetworkContext?: unknown;
  pageIdentity?: unknown;
  pageRoleProfile?: unknown;
  clientBehaviorProfile?: unknown;
  rdapParsed?: unknown;
  registrarRdap?: unknown;
  reverseDns?: unknown;
  securityPosture?: unknown;
  securityTxt?: unknown;
  sslbl?: unknown;
  technologyProfile?: unknown;
  threatIntelligenceProviders?: unknown;
  tlsEvidence?: unknown;
  whoisParsed?: unknown;
}>;

const MAX_ENTRIES = 24;
const MAX_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 120;
const MAX_LIMITATIONS = 8;
const MAX_LIMITATION_LENGTH = 280;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;

const COMPLETE_STATES = new Set([
  'available',
  'complete',
  'completed',
  'observed',
  'success',
  'supported',
]);
const PARTIAL_STATES = new Set(['incomplete', 'limited', 'partial', 'truncated']);
const SKIPPED_STATES = new Set(['disabled', 'not_applicable', 'skipped']);
const UNAVAILABLE_STATES = new Set([
  'blocked',
  'error',
  'failed',
  'rate_limited',
  'timeout',
  'unavailable',
]);

function boundedText(value: unknown, maximum: number): string {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function rdapLimitations(rdapParsed: Record<string, unknown>): string[] {
  if (rdapParsed.serverTruncated !== true) return [];
  const reasons = stringList(rdapParsed.serverTruncationReasons).slice(0, MAX_LIMITATIONS);
  return [
    `The registry reported that some RDAP data was omitted.${reasons.length ? ` ${reasons.join(' · ')}.` : ''}`,
  ];
}

function dnsLimitations(dnsEvidence: Record<string, unknown>): string[] {
  const limitations = stringList(dnsEvidence.limitations);
  const failures = Object.entries(record(dnsEvidence.diagnostics))
    .slice(0, 16)
    .filter(([, value]) => record(value).status === 'error')
    .map(([name, value]) => `${name.toUpperCase()}: ${record(value).error || 'query failed'}`)
    .join(' · ');
  return failures ? [...limitations, failures] : limitations;
}

function normalizeStatus(value: unknown): string {
  return boundedText(value, 64)
    .toLowerCase()
    .replace(/[\s-]+/gu, '_');
}

function normalizeLimitations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = boundedText(item, MAX_LIMITATION_LENGTH);
    if (!text || seen.has(text)) continue;
    output.push(text);
    seen.add(text);
    if (output.length >= MAX_LIMITATIONS) break;
  }
  return output;
}

function coverageState(input: EvidenceCoverageInput): EvidenceCoverageState {
  const status = normalizeStatus(input.status);
  if (status === 'not_found') return 'not_found';
  if (SKIPPED_STATES.has(status)) return 'skipped';
  if (status === 'unsupported') return 'unsupported';
  if (UNAVAILABLE_STATES.has(status)) return 'unavailable';
  if (input.truncated === true || input.complete === false || PARTIAL_STATES.has(status)) return 'partial';
  if (COMPLETE_STATES.has(status) || (status === '' && input.complete === true)) return 'complete';
  return 'unknown';
}

function statusLabel(state: EvidenceCoverageState): string {
  return {
    complete: 'Complete',
    not_found: 'Not found',
    partial: 'Partial',
    skipped: 'Skipped',
    unavailable: 'Unavailable',
    unknown: 'Unknown',
    unsupported: 'Unsupported',
  }[state];
}

export function buildEvidenceCoverageLedger(
  inputs: readonly EvidenceCoverageInput[],
): EvidenceCoverageLedger {
  const entries: EvidenceCoverageEntry[] = [];
  const seen = new Set<string>();

  for (const input of inputs.slice(0, MAX_ENTRIES)) {
    const id = boundedText(input.id, MAX_ID_LENGTH).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-');
    const label = boundedText(input.label, MAX_LABEL_LENGTH);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const state = coverageState(input);
    entries.push({
      id,
      label,
      category: input.category,
      state,
      statusLabel: statusLabel(state),
      truncated: input.truncated === true,
      limitations: normalizeLimitations(input.limitations),
      manualReviewSuggested: state === 'partial' || state === 'unavailable' || state === 'unknown',
    });
  }

  const counts: Record<EvidenceCoverageState, number> = {
    complete: 0,
    not_found: 0,
    partial: 0,
    skipped: 0,
    unavailable: 0,
    unknown: 0,
    unsupported: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;

  return {
    version: 1,
    entries,
    counts,
    completeCount: counts.complete,
    limitedCount: counts.partial + counts.unavailable + counts.unknown,
  };
}

export function buildLookupEvidenceCoverageLedger(
  input: LookupEvidenceCoverageInput,
): EvidenceCoverageLedger {
  const targetType = boundedText(input.targetType, 20);
  const availability = record(input.availability);
  const diagnostics = record(input.diagnostics);
  const rdapDiagnostic = record(diagnostics.rdap);
  const whoisDiagnostic = record(diagnostics.whois);
  const registrarRdap = record(input.registrarRdap);
  const reverseDns = record(input.reverseDns);
  const observedNetworkContext = record(input.observedNetworkContext);
  const dnsEvidence = record(input.dnsEvidence);
  const httpEvidence = record(input.httpEvidence);
  const httpResponse = record(input.httpResponse);
  const tlsEvidence = record(input.tlsEvidence);
  const pageIdentity = record(input.pageIdentity);
  const pageRoleProfile = record(input.pageRoleProfile);
  const clientBehaviorProfile = record(input.clientBehaviorProfile);
  const technologyProfile = record(input.technologyProfile);
  const securityPosture = record(input.securityPosture);
  const securityTxt = record(input.securityTxt);
  const sslbl = record(input.sslbl);
  const rdapParsed = record(input.rdapParsed);
  const whoisParsed = record(input.whoisParsed);
  const items: EvidenceCoverageInput[] = [
    {
      id: 'rdap',
      label: targetType === 'domain' ? 'Registry RDAP' : 'RDAP',
      category: 'registry',
      status: rdapDiagnostic.status,
      truncated: rdapParsed.serverTruncated,
      limitations: rdapLimitations(rdapParsed),
    },
    {
      id: 'whois',
      label: 'WHOIS',
      category: 'registry',
      status: whoisDiagnostic.status,
      truncated: Array.isArray(whoisParsed.fieldsTruncated) && whoisParsed.fieldsTruncated.length > 0,
      limitations: stringList(whoisParsed.limitations),
    },
    {
      id: 'availability',
      label: 'Availability decision',
      category: 'analysis',
      status: record(diagnostics.availability).status,
      complete: availability.complete,
      limitations: stringList(availability.limitations),
    },
  ];

  if (registrarRdap.status) {
    items.push({
      id: 'registrar-rdap',
      label: 'Registrar RDAP',
      category: 'registry',
      status: registrarRdap.status,
      limitations: stringList(registrarRdap.limitations),
    });
  }
  if (reverseDns.source === 'reverse_dns' || record(diagnostics.reverseDns).status) {
    items.push({
      id: 'reverse-dns',
      label: 'Reverse DNS',
      category: 'network',
      status: reverseDns.status || record(diagnostics.reverseDns).status,
      complete: reverseDns.complete,
      truncated: reverseDns.truncated,
      limitations: stringList(reverseDns.limitations),
    });
  }
  if (observedNetworkContext.contextVersion === 1) {
    items.push({
      id: 'network-context',
      label: 'Observed network context',
      category: 'network',
      status: observedNetworkContext.status,
      complete: observedNetworkContext.complete,
      limitations: stringList(observedNetworkContext.limitations),
    });
  }
  if (targetType === 'domain') {
    items.push(
      {
        id: 'dns',
        label: 'DNS',
        category: 'network',
        status: dnsEvidence.status,
        complete: dnsEvidence.complete,
        truncated: dnsEvidence.truncated,
        limitations: dnsLimitations(dnsEvidence),
      },
      {
        id: 'http',
        label: 'HTTP',
        category: 'web',
        status: httpEvidence.status,
        complete: httpEvidence.complete,
        truncated: httpResponse.bodyTruncated,
        limitations: stringList(httpEvidence.limitations),
      },
      {
        id: 'tls',
        label: 'TLS',
        category: 'web',
        status: tlsEvidence.status,
        complete: tlsEvidence.complete,
        truncated: tlsEvidence.chainTruncated,
        limitations: stringList(tlsEvidence.limitations),
      },
      {
        id: 'page-identity',
        label: 'Page identity',
        category: 'web',
        status: pageIdentity.status,
        complete: pageIdentity.complete,
        truncated: pageIdentity.truncated,
        limitations: stringList(pageIdentity.limitations),
      },
      {
        id: 'technology',
        label: 'Technology indicators',
        category: 'analysis',
        status: technologyProfile.status,
        complete: technologyProfile.complete,
        truncated: technologyProfile.truncated,
        limitations: stringList(technologyProfile.limitations),
      },
      {
        id: 'page-role',
        label: 'Page role classification',
        category: 'analysis',
        status: pageRoleProfile.status,
        complete: pageRoleProfile.complete,
        truncated: pageRoleProfile.truncated,
        limitations: stringList(pageRoleProfile.limitations),
      },
      {
        id: 'client-behavior',
        label: 'Client-side behaviour indicators',
        category: 'analysis',
        status: clientBehaviorProfile.status,
        complete: clientBehaviorProfile.complete,
        truncated: clientBehaviorProfile.truncated,
        limitations: stringList(clientBehaviorProfile.limitations),
      },
      {
        id: 'security-posture',
        label: 'Security posture',
        category: 'analysis',
        status: securityPosture.status,
        complete: securityPosture.complete,
        truncated: securityPosture.truncated,
        limitations: stringList(securityPosture.limitations),
      },
    );
  }
  if (securityTxt.securityTxtVersion === 1) {
    items.push({
      id: 'security-txt',
      label: 'security.txt',
      category: 'web',
      status: securityTxt.state,
      limitations: stringList(securityTxt.limitations),
    });
  }
  if (sslbl.sslblVersion === 1) {
    items.push({
      id: 'sslbl-certificate',
      label: 'SSLBL certificate comparison',
      category: 'external',
      status: sslbl.status,
      complete: sslbl.complete,
      limitations: stringList(sslbl.limitations),
    });
  }

  const providers = Array.isArray(input.threatIntelligenceProviders)
    ? input.threatIntelligenceProviders
    : [];
  for (const [providerIndex, providerValue] of providers.entries()) {
    if (items.length >= MAX_ENTRIES) break;
    const provider = record(providerValue);
    const identity = record(provider.provider);
    const fallback = `external-${providerIndex + 1}`;
    const id = boundedText(identity.id || fallback, MAX_ID_LENGTH);
    items.push({
      id: `external-${id}`,
      label: boundedText(identity.label || `External source ${providerIndex + 1}`, MAX_LABEL_LENGTH),
      category: 'external',
      status: provider.state,
      limitations: [boundedText(provider.detail, MAX_LIMITATION_LENGTH)].filter(Boolean),
    });
  }

  return buildEvidenceCoverageLedger(items);
}

import { buildBulkComparisonEvidence } from '../lib/bulk-comparison-evidence.mts';
import { recordOrEmpty } from '../lib/bounded-contract-normalizers.mts';
import {
  buildBulkDomainComparison,
  type BulkDomainComparison,
} from '../frontend/src/lib/analysis/bulk-domain-comparison.ts';
import { relationshipObservation } from '../frontend/src/lib/analysis/relationship-evidence.ts';
import { CliUsageError } from './errors.mts';
import { parseSavedLookupDocument, type SavedLookupDocument, type UnknownRecord } from './saved-lookup.mts';

export const CLI_LOOKUP_DIFF_SCHEMA = 'whoisleuth.cli.lookup-diff';
export const CLI_LOOKUP_DIFF_VERSION = 1;

type CliLookupDiffDocument = Readonly<{
  schema: typeof CLI_LOOKUP_DIFF_SCHEMA;
  version: typeof CLI_LOOKUP_DIFF_VERSION;
  generatedAt: string;
  left: Readonly<{ domain: string; generatedAt: string; mode: 'deep' | 'fast' }>;
  right: Readonly<{ domain: string; generatedAt: string; mode: 'deep' | 'fast' }>;
  comparison: BulkDomainComparison;
  limitations: readonly string[];
}>;
type LookupDiffOptions = Readonly<{
  domainMode?: 'different' | 'same';
}>;

function text(value: unknown, maximum = 300): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\x00-\x1f\x7f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum);
  return normalized || null;
}

function stringList(value: unknown, maximum = 100): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, maximum * 2).flatMap((candidate) => {
    const normalized = text(candidate, 253)?.toLowerCase().replace(/\.$/u, '');
    return normalized ? [normalized] : [];
  }))].slice(0, maximum);
}

function lifecycleValue(parsed: UnknownRecord, field: 'createdDate' | 'expiryDate'): string | null {
  const lifecycle = recordOrEmpty(parsed.lifecycle);
  return text(lifecycle[`${field}Iso`] ?? lifecycle[field] ?? parsed[`${field}Iso`] ?? parsed[field], 64);
}

function registrarLabel(parsed: UnknownRecord): string | null {
  const registrar = parsed.registrar;
  if (typeof registrar === 'string') return text(registrar);
  const source = recordOrEmpty(registrar);
  return text(source.name ?? source.org ?? source.handle);
}

function sourceState(value: unknown): 'complete' | 'error' | 'not_found' | 'partial' | 'skipped' | 'unavailable' | 'unsupported' {
  const normalized = text(value, 40)?.toLowerCase() || 'unavailable';
  if (normalized === 'success' || normalized === 'complete') return 'complete';
  if (normalized === 'not_found') return 'not_found';
  if (normalized === 'partial') return 'partial';
  if (normalized === 'skipped' || normalized === 'disabled' || normalized === 'not_applicable') return 'skipped';
  if (normalized === 'unsupported') return 'unsupported';
  if (normalized === 'error' || normalized === 'failed' || normalized === 'timeout' || normalized === 'rate_limited') return 'error';
  return 'unavailable';
}

function sourceCoverage(document: SavedLookupDocument, availability: UnknownRecord) {
  const diagnostics = recordOrEmpty(document.diagnostics);
  const entries = [
    ['rdap', recordOrEmpty(diagnostics.rdap).status],
    ['whois', recordOrEmpty(diagnostics.whois).status],
    ['availability', recordOrEmpty(diagnostics.availability).status],
    ['dns', recordOrEmpty(availability.dns).status],
    ['http', recordOrEmpty(availability.http).status],
    ['tls', recordOrEmpty(availability.tls).status],
  ] as const;
  return entries.map(([source, status]) => ({ source, state: sourceState(status) }));
}

function lookupComparisonInput(document: SavedLookupDocument): UnknownRecord {
  const availability = recordOrEmpty(document.availability);
  const rdapParsed = recordOrEmpty(recordOrEmpty(document.rdap).parsed);
  const whoisParsed = recordOrEmpty(recordOrEmpty(document.whois).parsed);
  const preferredRegistry = Object.keys(rdapParsed).length ? rdapParsed : whoisParsed;
  const relationship = relationshipObservation(availability);
  const dns = recordOrEmpty(availability.dns);
  const dnsRecords = recordOrEmpty(dns.records);
  const comparisonEvidence = buildBulkComparisonEvidence(availability);
  return {
    domain: document.registrableDomain,
    status: 'complete',
    availability: text(availability.state, 40) || 'unknown',
    confidence: text(availability.confidence, 40) || 'unknown',
    registrar: registrarLabel(preferredRegistry) || '—',
    activity: text(availability.activityStatus) || '—',
    risk: null,
    opportunity: null,
    mutationTypes: [],
    trusted: null,
    error: '',
    scanDepth: document.mode,
    createdDate: lifecycleValue(preferredRegistry, 'createdDate'),
    expiryDate: lifecycleValue(preferredRegistry, 'expiryDate'),
    nameservers: relationship.nameservers.length ? relationship.nameservers : stringList(preferredRegistry.nameservers, 20),
    hasMx: typeof availability.hasMx === 'boolean' ? availability.hasMx : null,
    hasNullMx: typeof availability.hasNullMx === 'boolean' ? availability.hasNullMx : null,
    hasSpf: typeof availability.hasSpf === 'boolean' ? availability.hasSpf : null,
    hasDmarc: typeof availability.hasDmarc === 'boolean' ? availability.hasDmarc : null,
    activityStatus: text(availability.activityStatus, 40),
    pageTitle: text(availability.pageTitle),
    faviconHash: relationship.faviconHash,
    faviconPHash: relationship.faviconPHash,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    hasPasswordField: recordOrEmpty(recordOrEmpty(availability.credentialSurfaceProfile).inputs).categories
      ? Number(recordOrEmpty(recordOrEmpty(recordOrEmpty(availability.credentialSurfaceProfile).inputs).categories).password) > 0
      : false,
    hasExternalFormAction: null,
    phishingLanguageMatch: null,
    riskModelVersion: null,
    riskFactors: [],
    dns: {
      status: text(dns.status, 40),
      records: {
        a: stringList(dnsRecords.a),
        aaaa: stringList(dnsRecords.aaaa),
        cname: stringList(dnsRecords.cname),
        caa: Array.isArray(dnsRecords.caa) ? dnsRecords.caa.slice(0, 100) : [],
      },
    },
    dnssec: text(preferredRegistry.dnssec, 40),
    comparisonEvidence,
    relationship,
    sourceCoverage: sourceCoverage(document, availability),
  };
}

function buildCliLookupDiff(
  leftText: string,
  rightText: string,
  generatedAt = new Date().toISOString(),
  options: LookupDiffOptions = {},
): CliLookupDiffDocument {
  const left = parseSavedLookupDocument(leftText, { label: 'Left lookup input' });
  const right = parseSavedLookupDocument(rightText, { label: 'Right lookup input' });
  const domainMode = options.domainMode ?? 'different';
  if (domainMode === 'different' && left.registrableDomain === right.registrableDomain) {
    throw new CliUsageError('Lookup diff requires documents for two different domains.');
  }
  if (domainMode === 'same' && left.registrableDomain !== right.registrableDomain) {
    throw new CliUsageError('Lookup history requires observations for the same domain.');
  }
  const comparison = buildBulkDomainComparison(
    lookupComparisonInput(left),
    lookupComparisonInput(right),
    domainMode === 'same' ? right.generatedAt : null,
    {
      allowSameDomain: domainMode === 'same',
      ...(domainMode === 'same' ? { now: Date.parse(right.generatedAt) } : {}),
    },
  );
  if (!comparison) throw new CliUsageError('Lookup documents could not be compared.');
  return {
    schema: CLI_LOOKUP_DIFF_SCHEMA,
    version: CLI_LOOKUP_DIFF_VERSION,
    generatedAt,
    left: { domain: left.registrableDomain, generatedAt: left.generatedAt, mode: left.mode },
    right: { domain: right.registrableDomain, generatedAt: right.generatedAt, mode: right.mode },
    comparison,
    limitations: [
      domainMode === 'same'
        ? 'This comparison uses bounded observations already present in two saved Lookup documents for the same domain and makes no network request.'
        : 'This command compares bounded observations already present in two saved Lookup documents and makes no network request.',
      'A missing value remains distinct from unavailable collection and from an observed difference.',
      domainMode === 'same'
        ? 'An observed difference can reflect a domain change or changed collection conditions and does not by itself establish current state, intent, safety, or maliciousness.'
        : 'Shared infrastructure or matching values do not establish common ownership, control, intent, safety, or maliciousness.',
    ],
  };
}

function formatCliLookupDiff(document: CliLookupDiffDocument): string {
  const rows = document.comparison.rows.filter((row) => row.state !== 'equal');
  const output = [
    'Domain evidence diff',
    `Left             ${document.left.domain}`,
    `Left observed    ${document.left.generatedAt}`,
    `Right            ${document.right.domain}`,
    `Right observed   ${document.right.generatedAt}`,
    `Changed          ${document.comparison.counts.different + document.comparison.counts.conflicting}`,
    `One-sided        ${document.comparison.counts.missing}`,
    `Unavailable      ${document.comparison.counts.unavailable + document.comparison.counts.not_recorded}`,
    '',
  ];
  if (!rows.length) output.push('No bounded differences were observed in the comparable fields.');
  for (const row of rows) {
    output.push(`${row.label} [${row.state.replaceAll('_', ' ')}]`);
    output.push(`  Left:  ${row.left}`);
    output.push(`  Right: ${row.right}`);
    output.push(`  Source: ${row.source}`);
  }
  output.push('', 'Limitations:');
  for (const limitation of document.limitations) output.push(`  - ${limitation}`);
  return `${output.join('\n')}\n`;
}

export { buildCliLookupDiff, formatCliLookupDiff };
export type { CliLookupDiffDocument, LookupDiffOptions };

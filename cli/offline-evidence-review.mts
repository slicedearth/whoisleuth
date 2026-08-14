import { Buffer } from 'node:buffer';

import { scanBoundedJson } from '../lib/bounded-json.mts';

import {
  normalizeEncryptedDnsAdapter,
  planEncryptedDnsQuery,
} from '../lib/encrypted-dns-contract.mts';
import { validateDnssecEvidence } from '../lib/dnssec-evidence-validation.mts';
import { reviewDomainChange } from '../lib/domain-change-review.mts';
import { reviewDomainPortfolio } from '../lib/domain-portfolio-review.mts';
import { reviewNameserverPreflight } from '../lib/nameserver-preflight-review.mts';
import {
  buildLocalGeoIpDatabase,
  lookupLocalGeoIp,
} from '../lib/local-geoip-evidence.mts';
import {
  inspectRdapReverseSearchResponse,
  normalizeRdapSearchHelp,
  planRdapReverseSearch,
} from '../lib/rdap-search-workbench.mts';
import { reviewRpkiRoute } from '../lib/rpki-evidence.mts';
import { analyzeTlsaEvidence } from '../lib/tlsa-evidence.mts';
import {
  CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
  buildCryptographicAssuranceReview,
} from '../lib/cryptographic-assurance.mts';
import { reviewZoneIntent } from '../lib/zone-intent-review.mts';
import { reviewDnsConvergence } from '../lib/dns-convergence-review.mts';
import { compareTrustStoreEvidence } from '../lib/trust-store-comparison.mts';
import { CliUsageError } from './errors.mts';
import { LOCAL_MMDB_QUERY_SCHEMA, reviewLocalMmdb } from './local-mmdb-review.mts';

const OFFLINE_EVIDENCE_REVIEW_SCHEMA = 'whoisleuth.cli.offline-evidence-review';
const OFFLINE_EVIDENCE_REVIEW_VERSION = 1;
const MAX_OFFLINE_EVIDENCE_INPUT_BYTES = 16 * 1024 * 1024;
const RDAP_SEARCH_INPUT_SCHEMA = 'whoisleuth.rdap-search-input';
const DNSSEC_EVIDENCE_INPUT_SCHEMA = 'whoisleuth.dnssec-evidence-input';
const TLSA_EVIDENCE_INPUT_SCHEMA = 'whoisleuth.tlsa-evidence-input';
const RPKI_ROUTE_INPUT_SCHEMA = 'whoisleuth.rpki-route-input';
const LOCAL_GEOIP_QUERY_SCHEMA = 'whoisleuth.local-geoip-query';
const ENCRYPTED_DNS_PLAN_INPUT_SCHEMA = 'whoisleuth.encrypted-dns-plan-input';
const OFFLINE_EVIDENCE_INPUT_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function parseInput(value: unknown): UnknownRecord {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_OFFLINE_EVIDENCE_INPUT_BYTES) {
    throw new CliUsageError(`Offline evidence input is limited to ${MAX_OFFLINE_EVIDENCE_INPUT_BYTES} bytes.`);
  }
  const normalized = value.replace(/^\uFEFF/u, '');
  let parsed: unknown;
  try {
    scanBoundedJson(normalized);
    parsed = JSON.parse(normalized);
  } catch {
    throw new CliUsageError('Offline evidence review requires one valid bounded JSON document without duplicate keys.');
  }
  const document = record(parsed);
  if (document.version !== 1 || typeof document.schema !== 'string') {
    throw new CliUsageError('Offline evidence review requires a supported versioned input schema.');
  }
  return document;
}

function buildOfflineEvidenceReview(value: unknown, generatedAt = new Date().toISOString()) {
  const input = parseInput(value);
  let kind: 'rdap_search' | 'dnssec' | 'tlsa' | 'rpki' | 'cryptographic_assurance' | 'geoip' | 'encrypted_dns' | 'zone_intent' | 'domain_portfolio' | 'domain_change' | 'dns_convergence' | 'nameserver_preflight' | 'trust_store';
  let result: unknown;
  if (input.schema === RDAP_SEARCH_INPUT_SCHEMA) {
    kind = 'rdap_search';
    const request = record(input.request);
    const help = normalizeRdapSearchHelp(input.help);
    const plan = planRdapReverseSearch(help, {
      searchableResourceType: String(request.searchableResourceType ?? ''),
      relatedResourceType: String(request.relatedResourceType ?? ''),
      property: String(request.property ?? ''),
      value: request.value,
    });
    result = Object.freeze({
      help,
      plan,
      responseInspection: input.response === undefined
        ? null
        : inspectRdapReverseSearchResponse(input.response, [request.property]),
    });
  } else if (input.schema === DNSSEC_EVIDENCE_INPUT_SCHEMA) {
    kind = 'dnssec';
    result = validateDnssecEvidence({
      ownerName: input.ownerName,
      delegationSigned: input.delegationSigned,
      dsRecords: input.dsRecords,
      dnskeyRecords: input.dnskeyRecords,
      rrSigRecords: input.rrSigRecords,
      observedAt: input.observedAt,
    });
  } else if (input.schema === TLSA_EVIDENCE_INPUT_SCHEMA) {
    kind = 'tlsa';
    result = analyzeTlsaEvidence({
      serviceName: input.serviceName,
      dnssecState: input.dnssecState,
      pkixValidationState: input.pkixValidationState,
      records: input.records,
      certificateDerBase64: input.certificateDerBase64,
      spkiDerBase64: input.spkiDerBase64,
      authorityMaterials: input.authorityMaterials,
    });
  } else if (input.schema === RPKI_ROUTE_INPUT_SCHEMA) {
    kind = 'rpki';
    result = reviewRpkiRoute({
      routePrefix: input.routePrefix,
      originAsn: input.originAsn,
      authorizations: input.authorizations,
    });
  } else if (input.schema === CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA) {
    kind = 'cryptographic_assurance';
    result = buildCryptographicAssuranceReview(input, generatedAt);
  } else if (input.schema === LOCAL_GEOIP_QUERY_SCHEMA) {
    kind = 'geoip';
    result = lookupLocalGeoIp(buildLocalGeoIpDatabase(input.database), input.address);
  } else if (input.schema === ENCRYPTED_DNS_PLAN_INPUT_SCHEMA) {
    kind = 'encrypted_dns';
    const query = record(input.query);
    result = planEncryptedDnsQuery(
      normalizeEncryptedDnsAdapter(input.adapter),
      { name: query.name, type: query.type },
    );
  } else if (input.schema === 'whoisleuth.zone-intent.input') {
    kind = 'zone_intent';
    result = reviewZoneIntent(input, generatedAt);
  } else if (input.schema === 'whoisleuth.domain-portfolio.input') {
    kind = 'domain_portfolio';
    result = reviewDomainPortfolio(input, generatedAt);
  } else if (input.schema === 'whoisleuth.domain-change.input') {
    kind = 'domain_change';
    result = reviewDomainChange(input, generatedAt);
  } else if (input.schema === 'whoisleuth.dns-convergence.input') {
    kind = 'dns_convergence';
    result = reviewDnsConvergence(input, generatedAt);
  } else if (input.schema === 'whoisleuth.nameserver-preflight.input') {
    kind = 'nameserver_preflight';
    result = reviewNameserverPreflight(input, generatedAt);
  } else if (input.schema === 'whoisleuth.trust-store-comparison.input') {
    kind = 'trust_store';
    result = compareTrustStoreEvidence(input, generatedAt);
  } else {
    throw new CliUsageError('Offline evidence review does not recognise this input schema.');
  }
  return Object.freeze({
    schema: OFFLINE_EVIDENCE_REVIEW_SCHEMA,
    version: OFFLINE_EVIDENCE_REVIEW_VERSION,
    generatedAt,
    kind,
    result,
    limitations: Object.freeze([
      'The review is local and uses only the supplied document. It does not refresh, transmit, or independently establish the current completeness of the evidence.',
    ]),
  });
}

async function buildOfflineEvidenceReviewWithLocalResources(
  value: unknown,
  generatedAt = new Date().toISOString(),
  options: Readonly<{ mmdbPath?: string | null }> = {},
) {
  const input = parseInput(value);
  if (input.schema !== LOCAL_MMDB_QUERY_SCHEMA) return buildOfflineEvidenceReview(value, generatedAt);
  if (!options.mmdbPath) throw new CliUsageError('Local MMDB review requires --mmdb <database-file>.');
  return Object.freeze({
    schema: OFFLINE_EVIDENCE_REVIEW_SCHEMA,
    version: OFFLINE_EVIDENCE_REVIEW_VERSION,
    generatedAt,
    kind: 'geoip' as const,
    result: await reviewLocalMmdb(input, options.mmdbPath),
    limitations: Object.freeze([
      'The review is local and uses only the supplied query metadata and analyst-supplied database. It does not transmit the address or refresh the database.',
    ]),
  });
}

function formatOfflineEvidenceReview(document: ReturnType<typeof buildOfflineEvidenceReview>): string {
  const result = record(document.result);
  const gate = record(result.gate);
  const counts = record(result.counts);
  const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const listLength = (value: unknown): number => Array.isArray(value) ? value.length : 0;
  const state = typeof result.state === 'string'
    ? result.state
    : document.kind === 'zone_intent'
      ? result.complete === true
        && ['different', 'missing', 'unexpected', 'incomplete'].every((key) => count(counts[key]) === 0)
        ? 'aligned'
        : 'review'
      : typeof gate.pass === 'boolean'
        ? gate.pass ? 'ready' : 'review'
        : document.kind === 'domain_portfolio' ? 'inventory'
          : document.kind === 'cryptographic_assurance' ? 'separate' : 'reviewed';
  const lines = [
    'Offline evidence review',
    `Kind   ${document.kind.replaceAll('_', ' ')}`,
    `State  ${state.replaceAll('_', ' ')}`,
  ];
  if (document.kind === 'rdap_search') {
    const help = record(result.help);
    const plan = record(result.plan);
    const responseInspection = record(result.responseInspection);
    lines.push(`Help   ${String(help.state ?? 'unavailable').replaceAll('_', ' ')}`);
    lines.push(`Plan   ${String(plan.state ?? 'unavailable').replaceAll('_', ' ')}`);
    if (result.responseInspection !== null) lines.push(`Result ${String(responseInspection.state ?? 'invalid').replaceAll('_', ' ')}`);
  } else if (document.kind === 'zone_intent') {
    const desired = record(result.desired);
    lines.push(`Desired ${listLength(desired.records)}`);
    lines.push(`Compared ${listLength(result.comparisons)}`);
    lines.push(`Aligned ${count(counts.aligned)}`);
    lines.push(`Changed ${count(counts.different) + count(counts.missing) + count(counts.unexpected)}`);
    lines.push(`Partial ${count(counts.incomplete)}`);
    lines.push(`Rejected ${listLength(desired.rejected)}`);
  } else if (document.kind === 'domain_change') {
    lines.push(`Authority ${listLength(result.authoritativeRecordMatrix)} rows`);
    lines.push(`Resolvers ${listLength(result.resolverDivergenceMatrix)} rows`);
  } else if (document.kind === 'dns_convergence') {
    lines.push(`Observers ${listLength(result.observers)}`);
    lines.push(`Snapshots ${listLength(result.snapshots)}`);
    lines.push(`Record sets ${listLength(result.rows)}`);
  } else if (document.kind === 'nameserver_preflight') {
    const rows = Array.isArray(result.rows) ? result.rows : [];
    lines.push(`Servers ${rows.length}`);
    lines.push(`Ready  ${rows.filter((item) => record(item).ready === true).length}`);
  } else if (document.kind === 'trust_store') {
    lines.push(`Stores ${count(counts.stores)}`);
    lines.push(`Matched ${count(counts.anchorObserved)}`);
    lines.push(`Not observed ${count(counts.notObserved)}`);
    lines.push(`Inconclusive ${count(counts.inconclusive)}`);
  } else if (document.kind === 'domain_portfolio') {
    const unknownCounts = record(result.unknownCounts);
    lines.push(`Assets ${listLength(result.assets)}`);
    lines.push(`Dependencies ${listLength(result.simulations)}`);
    lines.push(`Renewals ${listLength(result.renewalQueue)}`);
    lines.push(`Recovery ${listLength(result.recoveryCycles)}`);
    lines.push(`Unknown ${Object.values(unknownCounts).reduce<number>((total, value) => total + count(value), 0)}`);
  } else if (document.kind === 'cryptographic_assurance') {
    const cards = Array.isArray(result.cards) ? result.cards : [];
    for (const value of cards) {
      const card = record(value);
      lines.push(`${String(card.label ?? card.family ?? 'Evidence')}  ${String(card.state ?? 'unavailable').replaceAll('_', ' ')} (${String(card.completeness ?? 'unavailable')})`);
    }
  } else {
    for (const [label, key] of [
      ['Records', 'records'],
      ['Rejected', 'rejectedCount'],
      ['Matches', 'matchingAuthorizationCount'],
    ] as const) {
      const candidate = result[key];
      if (Array.isArray(candidate)) lines.push(`${label.padEnd(7)}${candidate.length}`);
      else if (typeof candidate === 'number') lines.push(`${label.padEnd(7)}${candidate}`);
    }
  }
  const reasons = Array.isArray(gate.reasons) ? gate.reasons : [];
  if (reasons.length) {
    lines.push('', 'Review reasons:');
    for (const reason of reasons.slice(0, 8)) {
      if (typeof reason === 'string') lines.push(`  - ${reason.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim().slice(0, 240)}`);
    }
    if (reasons.length > 8) lines.push(`  - ${reasons.length - 8} more reason(s) omitted.`);
  }
  lines.push('', 'Limitations:');
  for (const limitation of document.limitations) lines.push(`  - ${limitation}`);
  const nestedLimitations = Array.isArray(result.limitations) ? result.limitations : [];
  for (const limitation of nestedLimitations) {
    if (typeof limitation === 'string') lines.push(`  - ${limitation}`);
  }
  return `${lines.join('\n')}\n`;
}

export {
  DNSSEC_EVIDENCE_INPUT_SCHEMA,
  ENCRYPTED_DNS_PLAN_INPUT_SCHEMA,
  LOCAL_GEOIP_QUERY_SCHEMA,
  MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
  OFFLINE_EVIDENCE_INPUT_VERSION,
  OFFLINE_EVIDENCE_REVIEW_SCHEMA,
  OFFLINE_EVIDENCE_REVIEW_VERSION,
  RDAP_SEARCH_INPUT_SCHEMA,
  RPKI_ROUTE_INPUT_SCHEMA,
  TLSA_EVIDENCE_INPUT_SCHEMA,
  buildOfflineEvidenceReview,
  buildOfflineEvidenceReviewWithLocalResources,
  formatOfflineEvidenceReview,
};

import { Buffer } from 'node:buffer';

import {
  normalizeEncryptedDnsAdapter,
  planEncryptedDnsQuery,
} from '../lib/encrypted-dns-contract.mts';
import { validateDnssecEvidence } from '../lib/dnssec-evidence-validation.mts';
import {
  buildLocalGeoIpDatabase,
  lookupLocalGeoIp,
} from '../lib/local-geoip-evidence.mts';
import {
  normalizeRdapSearchHelp,
  planRdapReverseSearch,
} from '../lib/rdap-search-workbench.mts';
import { reviewRpkiRoute } from '../lib/rpki-evidence.mts';
import { analyzeTlsaEvidence } from '../lib/tlsa-evidence.mts';
import { CliUsageError } from './errors.mts';

const OFFLINE_EVIDENCE_REVIEW_SCHEMA = 'whoisleuth.cli.offline-evidence-review';
const OFFLINE_EVIDENCE_REVIEW_VERSION = 1;
const MAX_OFFLINE_EVIDENCE_INPUT_BYTES = 16 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function parseInput(value: unknown): UnknownRecord {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_OFFLINE_EVIDENCE_INPUT_BYTES) {
    throw new CliUsageError(`Offline evidence input is limited to ${MAX_OFFLINE_EVIDENCE_INPUT_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.replace(/^\uFEFF/u, ''));
  } catch {
    throw new CliUsageError('Offline evidence review requires one valid JSON document.');
  }
  const document = record(parsed);
  if (document.version !== 1 || typeof document.schema !== 'string') {
    throw new CliUsageError('Offline evidence review requires a supported versioned input schema.');
  }
  return document;
}

function buildOfflineEvidenceReview(value: unknown, generatedAt = new Date().toISOString()) {
  const input = parseInput(value);
  let kind: 'rdap_search' | 'dnssec' | 'tlsa' | 'rpki' | 'geoip' | 'encrypted_dns';
  let result: unknown;
  if (input.schema === 'whoisleuth.rdap-search-input') {
    kind = 'rdap_search';
    const request = record(input.request);
    const help = normalizeRdapSearchHelp(input.help);
    result = Object.freeze({
      help,
      plan: planRdapReverseSearch(help, {
        searchableResourceType: String(request.searchableResourceType ?? ''),
        relatedResourceType: String(request.relatedResourceType ?? ''),
        property: String(request.property ?? ''),
        value: request.value,
      }),
    });
  } else if (input.schema === 'whoisleuth.dnssec-evidence-input') {
    kind = 'dnssec';
    result = validateDnssecEvidence({
      ownerName: input.ownerName,
      delegationSigned: input.delegationSigned,
      dsRecords: input.dsRecords,
      dnskeyRecords: input.dnskeyRecords,
      rrSigRecords: input.rrSigRecords,
      observedAt: input.observedAt,
    });
  } else if (input.schema === 'whoisleuth.tlsa-evidence-input') {
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
  } else if (input.schema === 'whoisleuth.rpki-route-input') {
    kind = 'rpki';
    result = reviewRpkiRoute({
      routePrefix: input.routePrefix,
      originAsn: input.originAsn,
      authorizations: input.authorizations,
    });
  } else if (input.schema === 'whoisleuth.local-geoip-query') {
    kind = 'geoip';
    result = lookupLocalGeoIp(buildLocalGeoIpDatabase(input.database), input.address);
  } else if (input.schema === 'whoisleuth.encrypted-dns-plan-input') {
    kind = 'encrypted_dns';
    const query = record(input.query);
    result = planEncryptedDnsQuery(
      normalizeEncryptedDnsAdapter(input.adapter),
      { name: query.name, type: query.type },
    );
  } else {
    throw new CliUsageError('Offline evidence review does not recognize this input schema.');
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

function formatOfflineEvidenceReview(document: ReturnType<typeof buildOfflineEvidenceReview>): string {
  const result = record(document.result);
  const state = typeof result.state === 'string' ? result.state : 'reviewed';
  const lines = [
    'Offline evidence review',
    `Kind   ${document.kind.replaceAll('_', ' ')}`,
    `State  ${state.replaceAll('_', ' ')}`,
  ];
  if (document.kind === 'rdap_search') {
    const help = record(result.help);
    const plan = record(result.plan);
    lines.push(`Help   ${String(help.state ?? 'unavailable').replaceAll('_', ' ')}`);
    lines.push(`Plan   ${String(plan.state ?? 'unavailable').replaceAll('_', ' ')}`);
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
  lines.push('', 'Limitations:');
  for (const limitation of document.limitations) lines.push(`  - ${limitation}`);
  const nestedLimitations = Array.isArray(result.limitations) ? result.limitations : [];
  for (const limitation of nestedLimitations) {
    if (typeof limitation === 'string') lines.push(`  - ${limitation}`);
  }
  return `${lines.join('\n')}\n`;
}

export {
  MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
  OFFLINE_EVIDENCE_REVIEW_SCHEMA,
  OFFLINE_EVIDENCE_REVIEW_VERSION,
  buildOfflineEvidenceReview,
  formatOfflineEvidenceReview,
};

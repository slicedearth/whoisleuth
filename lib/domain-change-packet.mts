import {
  exactKeys,
  requireBoundedString,
  requireDomainName,
  requireIsoTimestamp,
  requireRecord,
} from './bounded-contract-normalizers.mts';
import {
  DOMAIN_ASSURANCE_INPUT_SCHEMA,
  buildDomainAssurance,
} from './domain-assurance.mts';
import {
  DOMAIN_CHANGE_INPUT_SCHEMA,
  reviewDomainChange,
} from './domain-change-review.mts';
import { SORTED_JSON_V2, sha256ArtifactDigestV2 } from '../frontend/src/lib/analysis/artifact-integrity.ts';

export const DOMAIN_CHANGE_PACKET_INPUT_SCHEMA = 'whoisleuth.domain-change-packet.input';
export const DOMAIN_CHANGE_PACKET_SCHEMA = 'whoisleuth.domain-change-packet';
export const DOMAIN_CHANGE_PACKET_INPUT_VERSION = 1;
export const DOMAIN_CHANGE_PACKET_VERSION = 2;
export const MAX_DOMAIN_CHANGE_PACKET_INPUT_BYTES = 6 * 1024 * 1024;

const ROOT_KEYS = new Set([
  'schema',
  'version',
  'domain',
  'reference',
  'preChange',
  'postChange',
  'assurance',
]);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  return requireRecord(value, label);
}

function domainFromInput(value: unknown, label: string): string {
  const input = record(value, label);
  if (input.schema !== DOMAIN_CHANGE_INPUT_SCHEMA) {
    throw new TypeError(`${label} must use ${DOMAIN_CHANGE_INPUT_SCHEMA}.`);
  }
  return requireDomainName(input.domain, `${label}.domain`);
}

function assuranceDomain(value: unknown): string {
  const input = record(value, 'assurance');
  if (input.schema !== DOMAIN_ASSURANCE_INPUT_SCHEMA || input.kind !== 'planned-change') {
    throw new TypeError('assurance must contain a planned-change domain assurance input.');
  }
  return requireDomainName(input.domain, 'assurance.domain');
}

function changeSummary(
  before: ReturnType<typeof reviewDomainChange>,
  after: ReturnType<typeof reviewDomainChange>,
) {
  const rows = (review: ReturnType<typeof reviewDomainChange>) => new Map(
    review.authoritativeRecordMatrix.map((row) => [`${row.owner}\u0000${row.type}`, row]),
  );
  const beforeRows = rows(before);
  const afterRows = rows(after);
  const keys = [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort();
  return Object.freeze(keys.slice(0, 500).flatMap((key) => {
    const left = beforeRows.get(key);
    const right = afterRows.get(key);
    const leftValues = left?.observations.flatMap((item) => item.values) ?? [];
    const rightValues = right?.observations.flatMap((item) => item.values) ?? [];
    const beforeValues = [...new Set(leftValues)].sort();
    const afterValues = [...new Set(rightValues)].sort();
    if (JSON.stringify(beforeValues) === JSON.stringify(afterValues)) return [];
    const [owner, type] = key.split('\u0000');
    return [Object.freeze({
      owner: owner ?? '',
      type: type ?? '',
      beforeValues: Object.freeze(beforeValues),
      afterValues: Object.freeze(afterValues),
    })];
  }));
}

export async function buildDomainChangePacket(
  inputRaw: unknown,
  generatedAtValue = new Date().toISOString(),
) {
  const input = record(inputRaw, 'Domain change packet input');
  if (input.schema !== DOMAIN_CHANGE_PACKET_INPUT_SCHEMA || input.version !== DOMAIN_CHANGE_PACKET_INPUT_VERSION) {
    throw new TypeError(`Domain change packet input must use ${DOMAIN_CHANGE_PACKET_INPUT_SCHEMA} version ${DOMAIN_CHANGE_PACKET_INPUT_VERSION}.`);
  }
  exactKeys(input, ROOT_KEYS, 'Domain change packet input');
  const domain = requireDomainName(input.domain, 'domain');
  const domains = [
    domainFromInput(input.preChange, 'preChange'),
    domainFromInput(input.postChange, 'postChange'),
    assuranceDomain(input.assurance),
  ];
  if (domains.some((candidate) => candidate !== domain)) {
    throw new TypeError('The packet, change reviews, and assurance plan must refer to the same domain.');
  }
  const generatedAt = requireIsoTimestamp(generatedAtValue, 'generatedAt');
  const preChange = reviewDomainChange(input.preChange, generatedAt);
  const postChange = reviewDomainChange(input.postChange, generatedAt);
  const assurance = buildDomainAssurance(input.assurance, generatedAt);
  const assuranceReasons = assurance.result.review.reasons;
  const gateReasons = Object.freeze([
    ...preChange.gate.reasons.map((reason) => `Pre-change evidence: ${reason}`),
    ...postChange.gate.reasons.map((reason) => `Post-change evidence: ${reason}`),
    ...assuranceReasons.map((reason) => `Change plan: ${reason}`),
  ].slice(0, 100));
  const unsigned = Object.freeze({
    schema: DOMAIN_CHANGE_PACKET_SCHEMA,
    version: DOMAIN_CHANGE_PACKET_VERSION,
    generatedAt,
    domain,
    reference: requireBoundedString(input.reference, 'reference', 200),
    state: gateReasons.length ? 'review' as const : 'ready' as const,
    gate: Object.freeze({ pass: gateReasons.length === 0, reasons: gateReasons }),
    summary: Object.freeze({
      changedAuthoritativeRecordSets: changeSummary(preChange, postChange),
      preChangeState: preChange.state,
      postChangeState: postChange.state,
      assuranceState: assurance.result.review.state,
    }),
    evidence: Object.freeze({ preChange, postChange, assurance }),
    limitations: Object.freeze([
      'This packet is assembled only from analyst-supplied observations and planning metadata and makes no network request or configuration change.',
      'A ready result means the supplied bounded checks passed; it does not prove control, propagation completion, successful recovery, or absence of unobserved dependencies.',
      'The integrity digest detects later changes to this packet but does not authenticate its author. Use a separately managed signing key when signer authentication is required.',
    ]),
  });
  return Object.freeze({
    ...unsigned,
    integrity: Object.freeze({
      algorithm: 'SHA-256' as const,
      canonicalization: SORTED_JSON_V2,
      digestSha256: await sha256ArtifactDigestV2(unsigned),
    }),
  });
}

export function formatDomainChangePacket(
  packet: Awaited<ReturnType<typeof buildDomainChangePacket>>,
): string {
  const lines = [
    'Domain change assurance packet',
    `Domain             ${packet.domain}`,
    `Reference          ${packet.reference}`,
    `State              ${packet.state}`,
    `Changed record sets ${packet.summary.changedAuthoritativeRecordSets.length}`,
    `Pre-change review  ${packet.summary.preChangeState}`,
    `Post-change review ${packet.summary.postChangeState}`,
    `Change plan        ${packet.summary.assuranceState}`,
    `Integrity          ${packet.integrity.digestSha256}`,
  ];
  if (packet.gate.reasons.length) {
    lines.push('', 'Review reasons:');
    for (const reason of packet.gate.reasons) lines.push(`  - ${reason}`);
  }
  lines.push('', 'Limitations:');
  for (const limitation of packet.limitations) lines.push(`  - ${limitation}`);
  return `${lines.join('\n')}\n`;
}

import type { AcquisitionDueDiligence } from './acquisition-due-diligence.mts';
import { SORTED_JSON_V2, sha256ArtifactDigestV2 } from '../evidence/artifact-integrity.mts';
import {
  ACQUISITION_DECISION_PACKET_SCHEMA,
  ACQUISITION_DECISION_PACKET_VERSION,
} from '../contracts/investigation-portability.mts';
import { isValidAsciiDomainName } from '../contracts/domain-name.mts';
import { parseBoundedJsonObject } from '../analysis/bounded-json.mts';
import { MAX_INVESTIGATION_PORTABLE_BYTES } from '../contracts/investigation-portability.mts';
import { array, boolean, domain, enumeration, exact, fail, iso, sameValues, strings, text as structureText, validateIntegrity } from '../evidence/artifact-structure.mts';

export { ACQUISITION_DECISION_PACKET_SCHEMA, ACQUISITION_DECISION_PACKET_VERSION };
export { MAX_INVESTIGATION_PORTABLE_BYTES as MAX_ACQUISITION_DECISION_PACKET_BYTES };

export const ACQUISITION_DECISIONS = [
  'unresolved',
  'continue_manual_review',
  'pause',
  'do_not_proceed',
] as const;
export type AcquisitionDecision = typeof ACQUISITION_DECISIONS[number];

export const ACQUISITION_MANUAL_CHECKS = [
  'eligibility',
  'counterparty',
  'transfer',
  'continuity',
  'legal',
] as const;
export type AcquisitionManualCheck = typeof ACQUISITION_MANUAL_CHECKS[number];

const DECISION_SET = new Set<string>(ACQUISITION_DECISIONS);
const CHECK_SET = new Set<string>(ACQUISITION_MANUAL_CHECKS);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;

function validateAcquisitionItem(value: unknown, label: string): string {
  const item = exact(value, ['id', 'label', 'state', 'detail', 'provenance'], label);
  const id = enumeration(item.id, ['availability', 'contacts', 'lifecycle', 'mail', 'nameservers', 'operations', 'policy_eligibility', 'policy_lifecycle', 'policy_transfer', 'tls', 'transfer', 'web'], label);
  enumeration(item.state, ['authoritative', 'observed', 'review', 'unavailable'], label);
  structureText(item.label, label, 200);
  structureText(item.detail, label, 2_000);
  structureText(item.provenance, label, 300);
  return id;
}

export function validateAcquisitionDecisionPacketStructure(value: unknown): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'target', 'synthetic', 'evidenceObservedAt', 'analystReview', 'evidenceReview', 'limitations', 'integrity'], 'Acquisition decision packet');
  if (root.schema !== ACQUISITION_DECISION_PACKET_SCHEMA) fail('Acquisition decision packet schema');
  iso(root.generatedAt, 'Acquisition decision packet generatedAt');
  domain(root.target, 'Acquisition decision packet target');
  boolean(root.synthetic, 'Acquisition decision packet synthetic');
  iso(root.evidenceObservedAt, 'Acquisition decision packet evidenceObservedAt', true);
  const review = exact(root.analystReview, ['decision', 'rationale', 'reviewedChecks', 'outstandingChecks', 'state'], 'Acquisition analyst review');
  const decision = enumeration(review.decision, ACQUISITION_DECISIONS, 'Acquisition analyst review decision');
  structureText(review.rationale, 'Acquisition analyst review rationale', 2_000, true);
  const reviewed = strings(review.reviewedChecks, 'Acquisition reviewed checks', ACQUISITION_MANUAL_CHECKS.length, 40);
  const outstanding = strings(review.outstandingChecks, 'Acquisition outstanding checks', ACQUISITION_MANUAL_CHECKS.length, 40);
  const expectedReviewed = ACQUISITION_MANUAL_CHECKS.filter((item) => reviewed.includes(item));
  const expectedOutstanding = ACQUISITION_MANUAL_CHECKS.filter((item) => !reviewed.includes(item));
  if (!sameValues(reviewed, expectedReviewed) || !sameValues(outstanding, expectedOutstanding)) fail('Acquisition analyst review checks');
  const expectedState = decision === 'unresolved' || reviewed.length < ACQUISITION_MANUAL_CHECKS.length ? 'draft' : 'reviewed';
  if (review.state !== expectedState) fail('Acquisition analyst review state');
  const evidence = exact(root.evidenceReview, ['version', 'label', 'state', 'items', 'transitionDependencies', 'policyChecks', 'nextSteps', 'limitations'], 'Acquisition evidence review');
  if (evidence.version !== 2) fail('Acquisition evidence review');
  structureText(evidence.label, 'Acquisition evidence review label', 200);
  enumeration(evidence.state, ['incomplete', 'registered', 'review_transition', 'sale_signal', 'unregistered_observation'], 'Acquisition evidence review state');
  const expectedEvidenceIds = {
    items: ['availability', 'lifecycle', 'transfer', 'operations', 'contacts'],
    transitionDependencies: ['nameservers', 'web', 'mail', 'tls'],
    policyChecks: ['policy_eligibility', 'policy_lifecycle', 'policy_transfer'],
  } as const;
  for (const key of ['items', 'transitionDependencies', 'policyChecks'] as const) {
    const expected = expectedEvidenceIds[key];
    const values = array(evidence[key], `Acquisition evidence review ${key}`, expected.length, expected.length);
    const ids = values.map((item, index) => validateAcquisitionItem(item, `Acquisition evidence review ${key}[${index}]`));
    if (!sameValues(ids, expected)) fail(`Acquisition evidence review ${key}`);
  }
  strings(evidence.nextSteps, 'Acquisition next steps', 6, 600);
  strings(evidence.limitations, 'Acquisition evidence limitations', 12, 600);
  strings(root.limitations, 'Acquisition limitations', 8, 600);
  validateIntegrity(root.integrity, 'Acquisition integrity', root.version, ACQUISITION_DECISION_PACKET_VERSION);
}

export type AcquisitionDecisionPacket = Awaited<ReturnType<typeof buildAcquisitionDecisionPacket>>['document'];

function freezePacket(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freezePacket(item);
    Object.freeze(value);
  }
}

/** Validate the existing supported format and full canonical digest before preview. */
export async function readAcquisitionDecisionPacket(raw: string, expected: Readonly<{ target: string; synthetic: boolean }>): Promise<AcquisitionDecisionPacket> {
  const value = parseBoundedJsonObject(raw, { label: 'Acquisition decision packet', maximumBytes: MAX_INVESTIGATION_PORTABLE_BYTES });
  if (value.schema !== ACQUISITION_DECISION_PACKET_SCHEMA) fail('Acquisition decision packet schema');
  validateAcquisitionDecisionPacketStructure(value);
  const { integrity, ...unsigned } = value;
  if (await sha256ArtifactDigestV2(unsigned) !== (integrity as { digestSha256: string }).digestSha256) {
    throw new TypeError('The acquisition decision packet failed its integrity check.');
  }
  if (value.target !== target(expected.target) || value.synthetic !== expected.synthetic) {
    throw new TypeError('This packet belongs to a different target or demonstration context. The current review is unchanged.');
  }
  freezePacket(value);
  return value as AcquisitionDecisionPacket;
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function target(value: unknown): string {
  const submitted = typeof value === 'string'
    ? value.trim().replace(/\.$/u, '')
    : '';
  if (!isValidAsciiDomainName(submitted, { requireDot: true })) {
    throw new Error('A canonical domain is required for an acquisition decision packet.');
  }
  return submitted.toLowerCase();
}

function decision(value: unknown): AcquisitionDecision {
  return typeof value === 'string' && DECISION_SET.has(value)
    ? value as AcquisitionDecision
    : 'unresolved';
}

function checks(value: unknown): AcquisitionManualCheck[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set<AcquisitionManualCheck>();
  for (const item of value.slice(0, ACQUISITION_MANUAL_CHECKS.length * 2)) {
    if (typeof item === 'string' && CHECK_SET.has(item)) selected.add(item as AcquisitionManualCheck);
  }
  return ACQUISITION_MANUAL_CHECKS.filter((item) => selected.has(item));
}

export async function buildAcquisitionDecisionPacket(input: Readonly<{
  target: unknown;
  evidenceObservedAt?: unknown;
  generatedAt?: unknown;
  decision?: unknown;
  rationale?: unknown;
  reviewedChecks?: unknown;
  synthetic?: unknown;
  review: AcquisitionDueDiligence;
}>) {
  const generatedAt = timestamp(input.generatedAt) ?? new Date().toISOString();
  const selectedDecision = decision(input.decision);
  const reviewedChecks = checks(input.reviewedChecks);
  const rationale = text(input.rationale, 2_000);
  const unsigned = {
    schema: ACQUISITION_DECISION_PACKET_SCHEMA,
    version: ACQUISITION_DECISION_PACKET_VERSION,
    generatedAt,
    target: target(input.target),
    synthetic: input.synthetic === true,
    evidenceObservedAt: timestamp(input.evidenceObservedAt),
    analystReview: {
      decision: selectedDecision,
      rationale,
      reviewedChecks,
      outstandingChecks: ACQUISITION_MANUAL_CHECKS.filter((item) => !reviewedChecks.includes(item)),
      state: selectedDecision === 'unresolved' || reviewedChecks.length < ACQUISITION_MANUAL_CHECKS.length
        ? 'draft'
        : 'reviewed',
    },
    evidenceReview: input.review,
    limitations: [
      'This local artefact records an analyst review of bounded point-in-time evidence and does not submit, reserve, value, purchase, or transfer a domain.',
      'A reviewed state records completion of the displayed manual checklist, not the accuracy of external statements or a legal, financial, eligibility, or ownership determination.',
      'Refresh authoritative registration and policy evidence immediately before acting.',
      ...(input.synthetic === true
        ? ['This packet contains synthetic demonstration data and must not be used as evidence or an acquisition record.']
        : []),
    ],
  };
  const digestSha256 = await sha256ArtifactDigestV2(unsigned);
  const document = {
    ...unsigned,
    integrity: { algorithm: 'SHA-256' as const, canonicalization: SORTED_JSON_V2, digestSha256 },
  };
  return {
    document,
    content: `${JSON.stringify(document, null, 2)}\n`,
    filename: `whoisleuth-acquisition-review-${unsigned.target}-${generatedAt.slice(0, 10)}.json`,
  };
}

import type { AcquisitionDueDiligence } from './acquisition-due-diligence.mts';
import { SORTED_JSON_V2, sha256ArtifactDigestV2 } from '../evidence/artifact-integrity.mts';
import {
  ACQUISITION_DECISION_PACKET_SCHEMA,
  ACQUISITION_DECISION_PACKET_VERSION,
} from '../contracts/investigation-portability.mts';

export { ACQUISITION_DECISION_PACKET_SCHEMA, ACQUISITION_DECISION_PACKET_VERSION };

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
  const normalized = text(value, 253).toLowerCase().replace(/\.$/u, '');
  if (!normalized || !normalized.includes('.') || /[/\\\s]/u.test(normalized)) {
    throw new Error('A canonical domain is required for an acquisition decision packet.');
  }
  return normalized;
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

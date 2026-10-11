import { createHash } from 'node:crypto';
import { assertCaseResponseReviewedInputDigest, inspectCaseResponsePacketSemantics } from '../../packages/cases/case-response-packet-validation.mts';
import type { UnknownRecord } from './structure-primitives.mts';

/** Preserve synchronous CLI validation; the offline verifier checks the outer
 * packet digest separately before returning a successful verification report. */
export function validateCaseResponsePacket(value: UnknownRecord): void {
  const pending = inspectCaseResponsePacketSemantics(value);
  if (pending) assertCaseResponseReviewedInputDigest(pending, createHash('sha256').update(pending.canonicalInputs).digest('hex'));
}

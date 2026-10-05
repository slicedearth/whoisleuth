import type { CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';
import type { CaseActionRecord } from '../../../../packages/cases/case-response-records.mts';
import { readCaseDeliveryPacketReceipt, type CaseDeliveryPacketReceipt } from '../../../../packages/cases/case-packet-correction.mts';
import { MAX_CASE_ACTION_BYTES, MAX_CASE_STORE_BYTES } from '../../../../packages/contracts/case-portability.mts';

function boundedSignature(value: unknown, maximumBytes: number): string {
  const signature = JSON.stringify(value);
  if (typeof signature !== 'string' || new TextEncoder().encode(signature).byteLength > maximumBytes) {
    throw new Error('The current delivery review exceeds its bounded local context. Nothing was prepared.');
  }
  return signature;
}

/** One bounded, memory-only permission. Recovering form text never recovers it. */
export function createCasePacketDeliveryAuthority() {
  let binding: Readonly<{ receipt: CaseDeliveryPacketReceipt; caseSignature: string; actionSignature: string }> | null = null;
  const invalidate = () => { binding = null; };
  const stale = (): never => {
    invalidate();
    throw new Error('The exact packet receipt or Case response context changed, or review authority was cleared. Review and export the current packet again before recording delivery.');
  };
  function bind(record: CaseRecord, actionId: string, value: CaseDeliveryPacketReceipt, digestSha256: string): void {
    invalidate();
    const receipt = readCaseDeliveryPacketReceipt(value)!, action = record.actions.find(action => action.id === actionId);
    if (!action || receipt.caseId !== record.id || receipt.target !== record.domain || receipt.actionId !== action.id
      || receipt.packetDigestSha256 !== digestSha256 || receipt.recipient !== action.recipient || receipt.recipient === '[redacted]'
      || JSON.stringify(receipt.responseObjects) !== JSON.stringify(action.responseObjects ?? [])) stale();
    boundedSignature(receipt, MAX_CASE_ACTION_BYTES);
    // The 32 KiB action limit covers history only. The entire action, including
    // correction statements, is already contained by the checked Case budget.
    binding = Object.freeze({ receipt, caseSignature: boundedSignature(record, MAX_CASE_STORE_BYTES), actionSignature: boundedSignature(action, MAX_CASE_STORE_BYTES) });
  }
  function reconcile(record: CaseRecord): void {
    try { if (binding && binding.caseSignature !== boundedSignature(record, MAX_CASE_STORE_BYTES)) invalidate(); }
    catch { invalidate(); }
  }
  function capture(record: CaseRecord, action: CaseActionRecord, reference: string) {
    const current = binding;
    if (!current || reference !== `response-packet-sha256:${current.receipt.packetDigestSha256}`
      || current.receipt.actionId !== action.id || current.actionSignature !== boundedSignature(action, MAX_CASE_STORE_BYTES)
      || current.caseSignature !== boundedSignature(record, MAX_CASE_STORE_BYTES)) stale();
    return Object.freeze({ packetReceipt: current!.receipt, expectedResponseContext: current!.caseSignature });
  }
  return { bind, capture, reconcile, invalidate, hasAuthority: () => binding !== null };
}

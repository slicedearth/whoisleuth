import { MAX_CASE_EVIDENCE_PINS, COLLECTION_RECEIPT_CASE_SCHEMA_VERSION } from '../contracts/case-portability.mts';
import { parseLookupCollectionReceipt, lookupCollectionReceiptIdentity, type LookupCollectionReceipt } from '../evidence/lookup-collection-receipt.mts';
import type { CaseEvidencePin } from './case-response-records.mts';
import { canonicalArtifactJsonV2 } from '../evidence/artifact-integrity.mts';

/** Operation context for selected pins, not retention of every collected result. */
export type CaseCheckpointCollectionReceipt = Readonly<{
  checkpointId: string;
  collectionReceipt: LookupCollectionReceipt;
}>;

/** Removing the last pin in a group also removes its context. No other pin edit
 * needs bookkeeping, and normalisation never changes a pin or checkpoint ID. */
export function readCaseCheckpointReceipts(
  value: unknown,
  pins: readonly CaseEvidencePin[],
  sourceVersion?: number | null,
): CaseCheckpointCollectionReceipt[] | undefined {
  if (value === undefined) return undefined;
  if (sourceVersion != null && sourceVersion < COLLECTION_RECEIPT_CASE_SCHEMA_VERSION) {
    throw new TypeError('Checkpoint collection receipts require Case schema 20.');
  }
  if (!Array.isArray(value) || value.length > MAX_CASE_EVIDENCE_PINS) {
    throw new TypeError('Checkpoint collection receipts must fit the retained evidence-pin limit.');
  }
  const groups = new Set(pins.map(pin => pin.checkpointId).filter(Boolean));
  const entries = new Map<string, CaseCheckpointCollectionReceipt>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'checkpointId') || !Object.hasOwn(raw, 'collectionReceipt')
      || typeof raw.checkpointId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(raw.checkpointId)) {
      throw new TypeError('A checkpoint collection receipt is malformed.');
    }
    const collectionReceipt = parseLookupCollectionReceipt(raw.collectionReceipt);
    if (!collectionReceipt || collectionReceipt.targetClass !== 'domain') throw new TypeError('A Case checkpoint requires a domain collection receipt.');
    const previous = entries.get(raw.checkpointId);
    if (previous && lookupCollectionReceiptIdentity(previous.collectionReceipt) !== lookupCollectionReceiptIdentity(collectionReceipt)) {
      throw new TypeError('Conflicting collection receipts use the same checkpoint identity. No evidence was changed.');
    }
    entries.set(raw.checkpointId, { checkpointId: raw.checkpointId, collectionReceipt });
  }
  const retained = [...entries.values()].filter(entry => groups.has(entry.checkpointId))
    .sort((a, b) => a.checkpointId < b.checkpointId ? -1 : a.checkpointId > b.checkpointId ? 1 : 0);
  for (const entry of retained) {
    if (pins.some(pin => pin.checkpointId === entry.checkpointId && pin.collectionDepth !== entry.collectionReceipt.requestedDepth)) {
      throw new TypeError('The checkpoint collection receipt does not match its retained pins.');
    }
  }
  return retained.length ? retained : undefined;
}

type CheckpointReceiptSource = Readonly<{ evidencePins: readonly CaseEvidencePin[]; checkpointCollectionReceipts?: unknown }>;

export function mergeCaseCheckpointReceipts(
  left: CheckpointReceiptSource,
  right: CheckpointReceiptSource,
  pins: readonly CaseEvidencePin[],
): CaseCheckpointCollectionReceipt[] | undefined {
  const before = readCaseCheckpointReceipts(left.checkpointCollectionReceipts, left.evidencePins) ?? [];
  const incoming = readCaseCheckpointReceipts(right.checkpointCollectionReceipts, right.evidencePins) ?? [];
  // Each input is bounded independently. Deduplicate before applying the final
  // group bound so re-importing a full Case remains idempotent.
  const byId = new Map(before.map(entry => [entry.checkpointId, entry]));
  for (const entry of incoming) {
    const previous = byId.get(entry.checkpointId);
    if (previous && lookupCollectionReceiptIdentity(previous.collectionReceipt) !== lookupCollectionReceiptIdentity(entry.collectionReceipt)) {
      throw new TypeError('Conflicting collection receipts use the same checkpoint identity. No evidence was changed.');
    }
    byId.set(entry.checkpointId, entry);
  }
  const groups = new Set(pins.map(pin => pin.checkpointId));
  const retained = [...byId.values()].filter(entry => groups.has(entry.checkpointId));
  for (const entry of retained) {
    // A colliding group ID must not lend its receipt to unrelated retained
    // pins. Identical imports and partial retention remain valid.
    const sourcePins = [before.some(item => item.checkpointId === entry.checkpointId) ? left.evidencePins : [],
      incoming.some(item => item.checkpointId === entry.checkpointId) ? right.evidencePins : []].flat();
    for (const pin of pins.filter(pin => pin.checkpointId === entry.checkpointId)) {
      if (!sourcePins.some(source => source.id === pin.id && canonicalArtifactJsonV2(source) === canonicalArtifactJsonV2(pin))) {
        throw new TypeError('A checkpoint identity belongs to different retained pins. Its collection context cannot be reassigned.');
      }
    }
  }
  return readCaseCheckpointReceipts(retained, pins);
}

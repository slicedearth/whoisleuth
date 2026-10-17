import { readEditableCaseExport } from './case-export-input.mts';
import { CASE_RESPONSE_PACKET_SCHEMA, MAX_EDITABLE_CASE_INPUT_BYTES } from '../contracts/case-portability.mts';
import { MAX_DOMAIN_CONTROL_MANIFEST_BYTES } from '../contracts/domain-control-manifest.mts';
import { boundedJsonLimitsForBytes, parseBoundedJsonObject } from '../analysis/bounded-json.mts';
import { canonicalArtifactJsonV2, sha256ArtifactBytes } from '../evidence/artifact-integrity.mts';
import { validateCaseResponsePacket } from './case-response-packet-validation.mts';

// The CLI applies its non-workspace artefact byte bound to response packets.
export const MAX_CASE_HANDOFF_INPUT_BYTES = Math.max(MAX_EDITABLE_CASE_INPUT_BYTES, MAX_DOMAIN_CONTROL_MANIFEST_BYTES);

export type CaseHandoffCopy = Readonly<{
  kind: 'case_export' | 'response_packet';
  caseId: string;
  domain: string;
  version: number;
  exportedAt: string | null;
  digest: string;
  record: Readonly<Record<string, unknown>>;
}>;
export type CaseHandoffChange = 'unchanged' | 'changed' | 'baseline_only' | 'comparison_only';
export type CaseHandoffChangeRow = Readonly<{
  key: string;
  field: string;
  recordId: string | null;
  order: boolean;
  state: CaseHandoffChange;
  baseline: unknown;
  comparison: unknown;
}>;

/** Each family uses its complete canonical admission. Comparison retains the
 * original wire values: historical missing fields must not become defaults. */
export async function readCaseHandoffCopy(bytes: Uint8Array): Promise<CaseHandoffCopy> {
  if (!bytes.byteLength || bytes.byteLength > MAX_CASE_HANDOFF_INPUT_BYTES) {
    throw new TypeError(`Select a Case export or response packet between 1 and ${MAX_CASE_HANDOFF_INPUT_BYTES} bytes.`);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const root = parseBoundedJsonObject(text, {
    label: 'Case comparison file', maximumBytes: MAX_CASE_HANDOFF_INPUT_BYTES,
    limits: boundedJsonLimitsForBytes(MAX_CASE_HANDOFF_INPUT_BYTES),
  });
  if (root.schema === CASE_RESPONSE_PACKET_SCHEMA) {
    if (bytes.byteLength > MAX_DOMAIN_CONTROL_MANIFEST_BYTES) throw new TypeError('The selected response packet exceeds the artefact byte limit.');
    await validateCaseResponsePacket(root);
    const identity = root.case as { id: string; domain: string };
    return { kind: 'response_packet', caseId: identity.id, domain: identity.domain, version: root.schemaVersion as number,
      exportedAt: root.generatedAt as string, digest: await sha256ArtifactBytes(bytes), record: root };
  }
  const admitted = readEditableCaseExport(text);
  if (admitted.length !== 1) throw new TypeError('Select an ordinary export containing exactly one Case.');
  return {
    kind: 'case_export', caseId: admitted[0]!.id, domain: admitted[0]!.domain, version: root.version as number,
    exportedAt: (root.exportedAt as string | undefined) ?? null, digest: await sha256ArtifactBytes(bytes),
    record: (root.cases as Record<string, unknown>[])[0]!,
  };
}

function identifiedRecords(value: unknown, identity: 'id' | 'actionId'): Map<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  const records = new Map<string, unknown>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const id = (item as Record<string, unknown>)[identity];
    if (typeof id !== 'string' || !id || records.has(id)) return null;
    records.set(id, item);
  }
  return records;
}

/** No write projection or import permission is produced. All admitted members
 * participate; records align by exact IDs and other values compare as a whole. */
export function compareCaseHandoffCopies(baseline: CaseHandoffCopy | null, comparison: CaseHandoffCopy | null) {
  const rows: CaseHandoffChangeRow[] = [];
  const counts: Record<CaseHandoffChange, number> = { unchanged: 0, changed: 0, baseline_only: 0, comparison_only: 0 };
  if (!baseline || !comparison) return { state: 'unavailable' as const, rows, counts };
  if (baseline.caseId !== comparison.caseId || baseline.domain !== comparison.domain) {
    throw new TypeError('Both selected exports must identify the same Case ID and domain.');
  }
  if (baseline.kind !== comparison.kind) throw new TypeError('Compare two ordinary Case exports or two response packets, not one of each.');
  const add = (field: string, recordId: string | null, left: unknown, right: unknown, order = false) => {
    const state: CaseHandoffChange = left === undefined ? 'comparison_only' : right === undefined ? 'baseline_only'
      : canonicalArtifactJsonV2(left) === canonicalArtifactJsonV2(right) ? 'unchanged' : 'changed';
    counts[state]++;
    rows.push({ key: JSON.stringify([field, order ? 'order' : 'value', recordId]), field, recordId, order,
      state, baseline: left, comparison: right });
  };
  for (const field of new Set([...Object.keys(baseline.record), ...Object.keys(comparison.record)])) {
    const left = baseline.record[field], right = comparison.record[field];
    const identity = baseline.kind === 'response_packet' && field === 'escalationHistory' ? 'actionId' : 'id';
    const earlier = identifiedRecords(left, identity), later = identifiedRecords(right, identity);
    if (earlier && later && (earlier.size || later.size)) {
      for (const id of new Set([...earlier.keys(), ...later.keys()])) add(field, id, earlier.get(id), later.get(id));
      const earlierOrder = [...earlier.keys()].filter(id => later.has(id));
      const laterOrder = [...later.keys()].filter(id => earlier.has(id));
      if (canonicalArtifactJsonV2(earlierOrder) !== canonicalArtifactJsonV2(laterOrder)) {
        add(field, null, earlierOrder, laterOrder, true);
      }
    } else add(field, null, left, right);
  }
  return { state: 'ready' as const, rows, counts };
}

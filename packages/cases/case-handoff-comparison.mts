import { readEditableCaseExport } from './case-export-input.mts';
import { MAX_EDITABLE_CASE_INPUT_BYTES } from '../contracts/case-portability.mts';
import { canonicalArtifactJsonV2, sha256ArtifactBytes } from '../evidence/artifact-integrity.mts';

export type CaseHandoffCopy = Readonly<{
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

/** Lossless admission is shared with Case editing, but comparison retains the
 * original wire values: historical missing fields must not become defaults. */
export async function readCaseHandoffCopy(bytes: Uint8Array): Promise<CaseHandoffCopy> {
  if (!bytes.byteLength || bytes.byteLength > MAX_EDITABLE_CASE_INPUT_BYTES) {
    throw new TypeError(`Select a Case export between 1 and ${MAX_EDITABLE_CASE_INPUT_BYTES} bytes.`);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const admitted = readEditableCaseExport(text);
  if (admitted.length !== 1) throw new TypeError('Select an ordinary export containing exactly one Case.');
  const root = JSON.parse(text) as { version: number; exportedAt?: string; cases: Record<string, unknown>[] };
  return {
    caseId: admitted[0]!.id, domain: admitted[0]!.domain, version: root.version,
    exportedAt: root.exportedAt ?? null, digest: await sha256ArtifactBytes(bytes), record: root.cases[0]!,
  };
}

function identifiedRecords(value: unknown): Map<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  const records = new Map<string, unknown>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || !item.id || records.has(item.id)) return null;
    records.set(item.id, item);
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
  const add = (field: string, recordId: string | null, left: unknown, right: unknown, order = false) => {
    const state: CaseHandoffChange = left === undefined ? 'comparison_only' : right === undefined ? 'baseline_only'
      : canonicalArtifactJsonV2(left) === canonicalArtifactJsonV2(right) ? 'unchanged' : 'changed';
    counts[state]++;
    rows.push({ key: JSON.stringify([field, order ? 'order' : 'value', recordId]), field, recordId, order,
      state, baseline: left, comparison: right });
  };
  for (const field of new Set([...Object.keys(baseline.record), ...Object.keys(comparison.record)])) {
    const left = baseline.record[field], right = comparison.record[field];
    const earlier = identifiedRecords(left), later = identifiedRecords(right);
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

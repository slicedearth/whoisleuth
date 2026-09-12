import { assertBoundedJsonStructure, boundedJsonLimitsForBytes } from '../../lib/bounded-json.mts';
import {
  CASE_SCHEMA_VERSION, MAX_CASE_ASSERTIONS, MAX_CASE_DECISIONS, MAX_CASE_EVIDENCE_PINS,
  MAX_CASE_IMPORT_BYTES, MAX_NOTES_PER_CASE,
} from '../contracts/case-portability.mts';
import { canonicalArtifactJsonV2 } from '../evidence/artifact-integrity.mts';
import { sha256IdentityHex } from '../evidence/record-identity.mts';
import type { CaseRecord } from './case-record-contracts.mts';
import { updateCase } from './case-record-operations.mts';
import { mergeCases } from './case-migration-model.mts';
import { enforceStoreBudget } from './case-storage-model.mts';

// This is an import policy, not a second durable format. Response authority,
// observations and Case metadata are deliberately outside a review return.
export const CASE_REVIEW_KINDS = Object.freeze({
  notes: { label: 'Note', capacity: MAX_NOTES_PER_CASE },
  evidencePins: { label: 'Evidence pin', capacity: MAX_CASE_EVIDENCE_PINS },
  decisions: { label: 'Decision', capacity: MAX_CASE_DECISIONS },
  assertions: { label: 'Assertion', capacity: MAX_CASE_ASSERTIONS },
} as const);
export type CaseReviewKind = keyof typeof CASE_REVIEW_KINDS;
const REVIEW_FIELDS = Object.keys(CASE_REVIEW_KINDS) as CaseReviewKind[];
type ReviewEntry = CaseRecord[CaseReviewKind][number];
export type CaseReviewRow = Readonly<{
  key: string;
  kind: CaseReviewKind;
  state: 'new' | 'unchanged' | 'conflict';
  returned: ReviewEntry;
  local: ReviewEntry | null;
  evidencePinIds: readonly string[];
}>;
export type CaseReviewReturn = Readonly<{
  caseId: string;
  domain: string;
  expectedCase: string;
  returnedCase: CaseRecord;
  fileDigest: string;
  isCliPack: boolean;
  rows: readonly CaseReviewRow[];
}>;

export function previewCaseReviewReturn(current: CaseRecord, input: unknown, fileDigest: string): CaseReviewReturn {
  if (!/^sha256:[a-f0-9]{64}$/u.test(fileDigest)) throw new Error('The selected review file needs a SHA-256 content digest.');
  assertBoundedJsonStructure(input, 'Case review return', boundedJsonLimitsForBytes(MAX_CASE_IMPORT_BYTES));
  if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_CASE_IMPORT_BYTES) {
    throw new Error('Case review files are limited to 2 MiB. Export a single Case without silently omitting records.');
  }
  const admitted = mergeCases([], input);
  const root = input as { version: unknown; cases: Record<string, unknown>[]; packet?: unknown };
  if (root.version !== CASE_SCHEMA_VERSION) {
    throw new Error('Review returns require a current Case export. Import an older file into a separate workspace and export the selected Case before review.');
  }
  if (root.cases.length !== 1 || admitted.cases.length !== 1 || admitted.skipped) {
    throw new Error('Select a review copy containing exactly one Case. No data was changed.');
  }
  const returned = admitted.cases[0]!;
  if (root.cases[0]?.id !== current.id || returned.id !== current.id || returned.domain !== current.domain) {
    throw new Error('The returned Case ID and domain must match this incident. No data was changed.');
  }
  const rows: CaseReviewRow[] = [];
  for (const kind of REVIEW_FIELDS) {
    if (canonicalArtifactJsonV2(root.cases[0]![kind]) !== canonicalArtifactJsonV2(returned[kind])) {
      throw new Error(`Returned ${CASE_REVIEW_KINDS[kind].label.toLowerCase()} entries contain invalid, duplicate, shortened or unsupported content. Correct the file before reviewing; no data was changed.`);
    }
    const local = new Map<string, ReviewEntry>(current[kind].map(entry => [entry.id, entry]));
    for (const entry of returned[kind]) {
      const existing = local.get(entry.id) ?? null;
      rows.push({
        key: `${kind}:${entry.id}`, kind, returned: entry, local: existing,
        state: !existing ? 'new' : canonicalArtifactJsonV2(existing) === canonicalArtifactJsonV2(entry) ? 'unchanged' : 'conflict',
        evidencePinIds: 'evidencePinIds' in entry ? entry.evidencePinIds : [],
      });
    }
  }
  return {
    caseId: current.id, domain: current.domain, expectedCase: canonicalArtifactJsonV2(current),
    returnedCase: returned, fileDigest, isCliPack: Object.hasOwn(root, 'packet'), rows,
  };
}

export function selectedCaseReviewRows(preview: CaseReviewReturn, keys: readonly string[]): readonly CaseReviewRow[] {
  if (!keys.length) throw new Error('Select at least one new review entry.');
  if (keys.length > preview.rows.length || new Set(keys).size !== keys.length) throw new Error('The review selection is invalid.');
  const selected = new Set(keys);
  const rows = preview.rows.filter(row => selected.has(row.key));
  if (rows.length !== keys.length || rows.some(row => row.state !== 'new')) {
    throw new Error('Only new entries from this preview can be added. Existing and conflicting records are not overwritten.');
  }
  const pins = new Map(preview.rows.filter(row => row.kind === 'evidencePins').map(row => [row.returned.id, row]));
  for (const row of rows) for (const id of row.evidencePinIds) {
    const pin = pins.get(id);
    if (!pin || pin.state === 'conflict' || (pin.state === 'new' && !selected.has(pin.key))) {
      throw new Error('A selected decision or assertion needs an identical existing pin or its selected new pin. Review the linked evidence first.');
    }
  }
  return rows;
}

export function applyCaseReviewReturn(
  cases: CaseRecord[], preview: CaseReviewReturn, keys: readonly string[], nowIso?: string,
): { record: CaseRecord; cases: CaseRecord[]; pruned: number } {
  const current = cases.find(record => record.id === preview.caseId);
  if (!current || canonicalArtifactJsonV2(current) !== preview.expectedCase) {
    throw new Error('This Case changed after the preview. Reload the Case and preview the returned file again; no data was changed.');
  }
  // Rebuild the selection inside the atomic updater, never trust UI row state.
  const checked = previewCaseReviewReturn(current, { version: CASE_SCHEMA_VERSION, cases: [preview.returnedCase] }, preview.fileDigest);
  const rows = selectedCaseReviewRows(checked, keys);
  const next = { ...current };
  for (const kind of REVIEW_FIELDS) {
    const additions = rows.filter(row => row.kind === kind).map(row => row.returned);
    if (current[kind].length + additions.length > CASE_REVIEW_KINDS[kind].capacity) {
      throw new Error(`The selected ${CASE_REVIEW_KINDS[kind].label.toLowerCase()} entries exceed this Case's ${CASE_REVIEW_KINDS[kind].capacity}-entry capacity. Reduce the selection or retain the review separately; no data was changed.`);
    }
    Object.assign(next, { [kind]: [...current[kind], ...additions] });
  }
  const changed = updateCase(cases.map(record => record.id === next.id ? next : record), next.id, {
    trailEvent: {
      kind: 'handoff', target: preview.fileDigest,
      summary: `Accepted reviewed additions: ${REVIEW_FIELDS.map(kind => `${CASE_REVIEW_KINDS[kind].label.toLowerCase()} entries: ${rows.filter(row => row.kind === kind).length}`).join(', ')}. Selected record keys (sorted-json-v2): sha256:${sha256IdentityHex(new TextEncoder().encode(canonicalArtifactJsonV2([...keys].sort())))}. File identity does not authenticate the reviewer.`,
    },
  }, nowIso);
  const bounded = enforceStoreBudget(changed.cases);
  if (bounded.pruned) throw new Error('There is not enough workspace room for this review without removing evidence. Reduce the selection or export and free space; no data was changed.');
  const record = bounded.cases.find(item => item.id === current.id)!;
  for (const row of rows) {
    const retained = record[row.kind].find(entry => entry.id === row.returned.id);
    if (!retained || canonicalArtifactJsonV2(retained) !== canonicalArtifactJsonV2(row.returned)) {
      throw new Error('A selected review entry could not be retained exactly. No data was changed.');
    }
  }
  return { cases: bounded.cases, record, pruned: 0 };
}

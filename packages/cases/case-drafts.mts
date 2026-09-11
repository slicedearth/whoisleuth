import { assertBoundedJsonStructure } from '../../lib/bounded-json.mts';
import {
  CASE_DRAFT_SCHEMA, CASE_DRAFT_VERSION, MAX_CASE_DRAFT_BYTES,
  MAX_CASE_DRAFT_RECORDS, MAX_CASE_DRAFT_STORE_BYTES,
  type CaseDraftFields, type CaseDraftReceipt, type CaseDraftRecord, type CaseDraftStore,
} from '../contracts/case-drafts.mts';

const encoder = new TextEncoder();
const token = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/u;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Case draft object.');
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !token.test(value)) throw new Error('Invalid Case draft identity.');
  return value;
}

/** Incomplete form values remain verbatim; domain validation happens on submission. */
export function caseDraftFields(value: unknown): CaseDraftFields {
  assertBoundedJsonStructure(value, 'Case draft', {
    maximumDepth: 4, maximumKeys: 4096, maximumValues: 4096,
    maximumContainerItems: 512, maximumStringCodeUnits: MAX_CASE_DRAFT_BYTES,
  });
  const fields = object(value);
  if (Object.keys(fields).length > 64) throw new Error('Case draft has too many fields.');
  const text = (item: unknown) => typeof item === 'string' && item.length <= 8192;
  for (const [key, field] of Object.entries(fields)) {
    if (!token.test(key)) throw new Error('Invalid Case draft field name.');
    if (text(field) || typeof field === 'boolean') continue;
    if (!Array.isArray(field) || field.length > 512) throw new Error('Invalid Case draft field.');
    for (const item of field) {
      if (text(item)) continue;
      const pair = object(item);
      if (Object.keys(pair).length > 8 || !Object.entries(pair).every(([key, value]) => token.test(key) && text(value))) throw new Error('Invalid Case draft selection.');
    }
  }
  if (encoder.encode(JSON.stringify(fields)).byteLength > MAX_CASE_DRAFT_BYTES) throw new Error('Case draft exceeds its 64 KiB storage limit. Existing drafts were not removed.');
  return structuredClone(fields) as CaseDraftFields;
}

export function emptyCaseDraftStore(): CaseDraftStore {
  return { schema: CASE_DRAFT_SCHEMA, version: CASE_DRAFT_VERSION, records: [] };
}

export function caseDraftStoreVersion(value: unknown): number | null {
  const entry = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  return entry?.schema === CASE_DRAFT_SCHEMA && Number.isSafeInteger(entry.version) ? entry.version as number : null;
}

export function normalizeCaseDraftStore(value: unknown): CaseDraftStore {
  if (value === null || value === undefined) return emptyCaseDraftStore();
  const store = object(value);
  if (Object.keys(store).some(key => !['schema', 'version', 'records'].includes(key))) throw new Error('Unknown Case draft store field.');
  if (store.schema !== CASE_DRAFT_SCHEMA || store.version !== CASE_DRAFT_VERSION || !Array.isArray(store.records)) throw new Error('Unsupported Case draft format. Saved drafts were not changed.');
  if (store.records.length > MAX_CASE_DRAFT_RECORDS) throw new Error('Case draft record limit reached. Discard unwanted drafts explicitly before saving more.');
  const ids = new Set<string>();
  const records: CaseDraftRecord[] = [];
  let bytes = encoder.encode(JSON.stringify(emptyCaseDraftStore())).byteLength;
  for (const input of store.records) {
    const record = object(input);
    if (Object.keys(record).some(key => !['id', 'revision', 'caseId', 'form', 'formVersion', 'updatedAt', 'fields'].includes(key))) throw new Error('Unknown Case draft record field.');
    const id = identifier(record.id);
    if (ids.has(id)) throw new Error('Duplicate Case draft identity.');
    ids.add(id);
    if (typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt)) || new Date(record.updatedAt).toISOString() !== record.updatedAt) throw new Error('Invalid Case draft time.');
    if (!Number.isSafeInteger(record.formVersion) || (record.formVersion as number) < 1 || (record.formVersion as number) > 1000) throw new Error('Invalid Case draft form version.');
    const normalized: CaseDraftRecord = {
      id, revision: identifier(record.revision), caseId: identifier(record.caseId), form: identifier(record.form),
      formVersion: record.formVersion as number, updatedAt: record.updatedAt, fields: caseDraftFields(record.fields),
    };
    bytes += encoder.encode(JSON.stringify(normalized)).byteLength + (records.length ? 1 : 0);
    if (bytes > MAX_CASE_DRAFT_STORE_BYTES) throw new Error('Case draft storage is full. Existing drafts were not removed.');
    records.push(normalized);
  }
  return { ...emptyCaseDraftStore(), records };
}

export function serializeCaseDraftStore(value: unknown): string {
  return JSON.stringify(normalizeCaseDraftStore(value));
}

export function replaceCaseDraft(store: CaseDraftStore, draft: CaseDraftRecord, expected: string | null): CaseDraftStore {
  const current = store.records.find(item => item.id === draft.id);
  if ((current?.revision ?? null) !== expected) throw new Error('This draft changed in another tab. Keep this form open and review the saved drafts before replacing it.');
  return normalizeCaseDraftStore({ ...store, records: [...store.records.filter(item => item.id !== draft.id), draft] });
}

export function removeCaseDraft(store: CaseDraftStore, receipt: CaseDraftReceipt, caseId: string): CaseDraftStore {
  const current = store.records.find(item => item.id === receipt.id);
  if (!current || current.caseId !== caseId || current.revision !== receipt.revision) throw new Error('The submitted recovery draft changed. No Case write was made; review the current draft first.');
  return { ...store, records: store.records.filter(item => item.id !== receipt.id) };
}

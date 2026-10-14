import { parseBoundedJson, type BoundedJsonStringLocation } from '../../../../packages/analysis/bounded-json.mts';
import { EXTERNAL_FINDINGS_SCHEMA, MAX_EXTERNAL_FINDINGS, MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
  parseExternalFindingsDocument, type ExternalFinding, type ExternalFindingsDocument } from '../../../../packages/interchange/external-findings-import.mts';
import { MAX_EXTERNAL_INTELLIGENCE_IMPORT_BYTES } from './external-intelligence-import.ts';

export type SelectedFindingLocation = Readonly<{
  state: 'available'; path: string; lexical: string; value: string;
  offset: number; end: number; line: number; column: number;
  digestSha256: string; byteLength: number; byteOrderMark: boolean;
}> | Readonly<{ state: 'unavailable' | 'not_supplied' | 'ambiguous'; reason: string }>;

export type SelectedFindingOriginal = Readonly<{
  locate(document: ExternalFindingsDocument, finding: ExternalFinding, field: string): SelectedFindingLocation;
  dispose(): void;
}>;

const findingFields = new Set(['domain', 'observedAt', 'summary', 'reference', 'evidenceClass', 'structuredObservation.value']);
function fieldKey(path: readonly (string | number)[]): string | null {
  if (path.length === 2 && path[0] === 'source' && path[1] === 'name') return 'source.name';
  const [root, index, ...field] = path;
  if (root !== 'findings' || typeof index !== 'number' || index >= MAX_EXTERNAL_FINDINGS
    || field.some(part => typeof part !== 'string') || !findingFields.has(field.join('.'))) return null;
  return `findings[${index}].${field.join('.')}`;
}

/** Exact selected bytes and parser locations are temporary, never Case fields. */
export async function parseSelectedFindingJson(input: ArrayBuffer): Promise<{
  value: unknown; document: ExternalFindingsDocument | null; original: SelectedFindingOriginal | null;
}> {
  if (!input.byteLength || input.byteLength > MAX_EXTERNAL_INTELLIGENCE_IMPORT_BYTES) throw new TypeError('External intelligence imports are limited to 512 KiB.');
  // Freeze the selected input before any asynchronous digest can yield ownership.
  const bytes = input.slice(0);
  const byteLength = bytes.byteLength;
  let raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const byteOrderMark = raw.startsWith('\ufeff'), prefix = byteOrderMark ? 1 : 0;
  const locations = new Map<string, BoundedJsonStringLocation>();
  const value = parseBoundedJson(raw.slice(prefix), {
    label: 'External intelligence import', maximumBytes: MAX_EXTERNAL_INTELLIGENCE_IMPORT_BYTES,
    observeStringLocation(location) {
      const key = fieldKey(location.path);
      if (key) locations.set(key, { ...location, offset: location.offset + prefix, end: location.end + prefix });
    },
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (value as Record<string, unknown>).schema !== EXTERNAL_FINDINGS_SCHEMA) return { value, document: null, original: null };
  if (bytes.byteLength > MAX_EXTERNAL_FINDINGS_IMPORT_BYTES) throw new TypeError('External finding imports are limited to 384 KiB.');
  const origins = new Map<ExternalFinding, number[]>();
  const document = parseExternalFindingsDocument(value, (finding, index) => {
    const indexes = origins.get(finding);
    if (indexes) indexes.push(index); else origins.set(finding, [index]);
  });
  let digest: ArrayBuffer;
  try { digest = await globalThis.crypto.subtle.digest('SHA-256', bytes); }
  catch { throw new Error('The selected file digest could not be prepared. No findings were imported.'); }
  const digestSha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  let active = true;
  const original: SelectedFindingOriginal = Object.freeze({
    locate(selectedDocument, finding, field) {
      const indexes = origins.get(finding);
      if (!active || selectedDocument !== document || !indexes) return { state: 'unavailable', reason: 'The selected original no longer belongs to this preview.' };
      let key: string;
      if (field === 'source.name') key = field;
      else {
        const relative = field.startsWith('finding.') ? field.slice('finding.'.length) : '';
        if (!findingFields.has(relative)) return { state: 'unavailable', reason: 'This field has no supported original-file location.' };
        if (indexes.length !== 1) return { state: 'ambiguous', reason: 'Several original findings normalise to this accepted finding. No single original location is selected.' };
        key = `findings[${indexes[0]}].${relative}`;
      }
      const location = locations.get(key);
      if (!location) return { state: 'not_supplied', reason: 'No string value was supplied at this original field. Accepted defaults are not reconstructed as source text.' };
      let line = 1, lineStart = 0;
      for (let index = 0; index < location.offset; index++) {
        if (raw[index] === '\r') { if (raw[index + 1] === '\n') index++; line++; lineStart = index + 1; }
        else if (raw[index] === '\n') { line++; lineStart = index + 1; }
      }
      return { state: 'available', path: `$.${key}`, lexical: raw.slice(location.offset, location.end),
        value: location.value, offset: location.offset, end: location.end,
        line, column: location.offset - lineStart + 1, digestSha256, byteLength, byteOrderMark };
    },
    dispose() { active = false; raw = ''; locations.clear(); origins.clear(); },
  });
  return { value, document, original };
}

import { boundedJsonLimitsForBytes, parseBoundedJsonObject } from '../../lib/bounded-json.mts';
import { canonicalArtifactJsonV2 } from '../evidence/artifact-integrity.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { CASE_SCHEMA_VERSION, CLI_CASE_PACK_INPUT_CASE_VERSIONS, MAX_CASE_STORE_BYTES, MAX_EDITABLE_CASE_INPUT_BYTES, PUBLISHED_V2_3_CASE_SCHEMA_VERSION } from '../contracts/case-portability.mts';
import { normalizeCaseStore } from './case-migration-model.mts';
import { serializeCaseStore } from './case-storage-model.mts';
import type { CaseRecord } from './case-record-contracts.mts';

/** Historical wire shape remains independent of current in-memory defaults. */
export function canonicalCaseExportProjection(cases: readonly CaseRecord[], caseVersion: number): CaseRecord[] {
  if (caseVersion !== PUBLISHED_V2_3_CASE_SCHEMA_VERSION) return [...cases];
  return cases.map((value) => {
    if ([...value.evidencePins, ...value.sightings].some((item) => item.observedAt === null)) {
      throw new TypeError('The published Case 15 format requires a known observation time on each retained pin and sighting.');
    }
    const { title: _title, ...published } = value;
    return {
      ...published,
      sightings: [...value.sightings].sort((left, right) => Date.parse(left.observedAt!) - Date.parse(right.observedAt!)
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    };
  });
}

/** Editing never silently repairs, drops or truncates an imported record. */
export function readEditableCaseExport(input: string): CaseRecord[] {
  const root = parseBoundedJsonObject(input, {
    label: 'Case file', maximumBytes: MAX_EDITABLE_CASE_INPUT_BYTES,
    limits: boundedJsonLimitsForBytes(MAX_CASE_STORE_BYTES),
  });
  if (Object.keys(root).some(key => !['version', 'exportedAt', 'cases'].includes(key))) {
    throw new TypeError('Case editing requires an ordinary Case export, not a response packet or an envelope with additional fields.');
  }
  if (!CLI_CASE_PACK_INPUT_CASE_VERSIONS.some(version => version === root.version) || !Array.isArray(root.cases)) {
    throw new TypeError(`Case editing reads exact schemas ${CLI_CASE_PACK_INPUT_CASE_VERSIONS.join(', ')} and writes schema ${CASE_SCHEMA_VERSION}. Re-export other supported historical formats through the ordinary import workflow first.`);
  }
  if (Object.hasOwn(root, 'exportedAt') && !normalizeExplicitIsoTimestamp(root.exportedAt)) {
    throw new TypeError('The Case export time is invalid.');
  }
  const cases = normalizeCaseStore(root).cases;
  const projected = canonicalCaseExportProjection(cases, root.version as number);
  const byId = new Map(projected.map(record => [record.id, record]));
  const seen = new Set<string>();
  if (cases.length !== root.cases.length || root.cases.some(value => {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || seen.has(value.id)) return true;
    seen.add(value.id);
    return canonicalArtifactJsonV2(value) !== canonicalArtifactJsonV2(byId.get(value.id));
  })) throw new TypeError('The Case file would lose, repair or truncate retained data during normalisation. Nothing was changed.');
  if (new TextEncoder().encode(serializeCaseStore(cases)).byteLength > MAX_CASE_STORE_BYTES) {
    throw new TypeError('The Case file exceeds the canonical store byte budget. Select fewer Cases; no retained evidence was pruned.');
  }
  return cases;
}

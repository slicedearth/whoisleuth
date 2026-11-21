import { boundedJsonLimitsForBytes, parseBoundedJsonObject } from '../packages/analysis/bounded-json.mts';
import { LOOKUP_EVIDENCE_SCHEMA } from '../packages/contracts/lookup-evidence.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES } from './saved-lookup.mts';

/**
 * Whether selected JSON is a Lookup evidence export rather than a saved Lookup.
 * The check uses a structurally bounded parse; the matching reader then applies
 * its own, narrower limits.
 */
export function isLookupEvidenceText(raw: string, maximumBytes = MAX_SAVED_LOOKUP_INPUT_BYTES): boolean {
  try {
    return parseBoundedJsonObject(raw, { label: 'Selected JSON', maximumBytes, limits: boundedJsonLimitsForBytes(maximumBytes) })
      .schema === LOOKUP_EVIDENCE_SCHEMA;
  } catch {
    return false;
  }
}

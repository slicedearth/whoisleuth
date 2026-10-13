import type { CaseRecord } from '../../../../packages/cases/case-model.mts';
import { retainedGalleryInventory } from './retained-evidence-gallery.ts';

export const BRAND_REFERENCE_CONTEXTS = ['Unspecified', 'Desktop', 'Mobile', 'Regional', 'Campaign', 'Login', 'Other'] as const;
export type BrandReferenceContext = typeof BRAND_REFERENCE_CONTEXTS[number];
export const MAX_BRAND_REVIEW_REFERENCES = 4;

/** Association is analyst-authored scope, not proof that a file is official. */
export function brandReviewReferences(profileId: string, records: readonly CaseRecord[]) {
  // Resolve identities across the complete collection before restricting scope;
  // filtering first could hide a conflicting, unlinked copy of a Case identity.
  const inventory = retainedGalleryInventory(records);
  const associated = new Set(records.filter(record => record.brandProfileIds.includes(profileId)).map(record => record.id));
  return inventory.files.filter(file => file.kind === 'png' && associated.has(file.reference.caseId));
}

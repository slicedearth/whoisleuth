import { STOREFRONT_FIELDS, type StorefrontField, type StorefrontObservation } from '../../../../packages/investigation/storefront-review.mts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
export type StorefrontDraft = { hostname: string; observedAt: string; source: string; fields: Record<StorefrontField, { reviewed: boolean; values: string }> };
export function storefrontDraft(hostname = ''): StorefrontDraft {
  return { hostname, observedAt: '', source: '', fields: Object.fromEntries(STOREFRONT_FIELDS.map(field => [field.id, { reviewed: false, values: '' }])) as StorefrontDraft['fields'] };
}
export function storefrontDraftInput(draft: StorefrontDraft): StorefrontObservation {
  const observedAt = normalizeExplicitIsoTimestamp(draft.observedAt);
  if (!observedAt) throw new TypeError('Storefront observation time must include a date, time and explicit timezone.');
  return { hostname: draft.hostname.trim().toLowerCase(), observedAt, source: draft.source.trim(),
    ...Object.fromEntries(STOREFRONT_FIELDS.map(field => [field.id, draft.fields[field.id].reviewed ? draft.fields[field.id].values.split('\n').map(value => value.trim()).filter(Boolean) : null])) as Record<StorefrontField, string[] | null> };
}
export function draftFromStorefront(value: StorefrontObservation): StorefrontDraft {
  return { hostname: value.hostname, observedAt: value.observedAt, source: value.source,
    fields: Object.fromEntries(STOREFRONT_FIELDS.map(field => [field.id, { reviewed: value[field.id] !== null, values: value[field.id]?.join('\n') ?? '' }])) as StorefrontDraft['fields'] };
}

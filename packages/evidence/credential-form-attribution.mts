export const CREDENTIAL_CATEGORY_NAMES = ['password', 'email', 'username', 'one_time_code', 'payment'] as const;
export const MAX_CREDENTIAL_FORMS = 50;
export const MAX_CREDENTIAL_INPUTS = 500;
export const MAX_FORM_DESTINATIONS = 10;
export type CredentialFormDestination = {
  relationship: 'same_origin' | 'external' | 'unknown' | 'no_submission';
  origin: string | null;
};
export type CredentialFormAttribution = {
  complete: boolean;
  unassociatedInputs: number;
  forms: Array<{
    index: number;
    categories: Record<typeof CREDENTIAL_CATEGORY_NAMES[number], number>;
    destinations: CredentialFormDestination[];
  }>;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
const count = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
export function validCredentialFormAttribution(value: unknown): value is CredentialFormAttribution {
  if (!record(value) || !keys(value, ['complete', 'unassociatedInputs', 'forms']) || typeof value.complete !== 'boolean'
    || !count(value.unassociatedInputs, MAX_CREDENTIAL_INPUTS) || !Array.isArray(value.forms) || value.forms.length > MAX_CREDENTIAL_FORMS) return false;
  let classified = 0;
  for (const [index, form] of value.forms.entries()) {
    if (!record(form) || !keys(form, ['index', 'categories', 'destinations']) || form.index !== index + 1
      || !record(form.categories) || !keys(form.categories, CREDENTIAL_CATEGORY_NAMES)
      || !CREDENTIAL_CATEGORY_NAMES.every(key => count((form.categories as Record<string, unknown>)[key], MAX_CREDENTIAL_INPUTS))
      || !Array.isArray(form.destinations) || !form.destinations.length || form.destinations.length > MAX_FORM_DESTINATIONS) return false;
    classified += Math.max(...CREDENTIAL_CATEGORY_NAMES.map(key => Number((form.categories as Record<string, unknown>)[key])));
    const seen = new Set<string>();
    for (const destination of form.destinations) {
      if (!record(destination) || !keys(destination, ['relationship', 'origin'])) return false;
      if (destination.relationship === 'unknown' || destination.relationship === 'no_submission') {
        if (destination.origin !== null || (destination.relationship === 'unknown' && value.complete)) return false;
      } else if (destination.relationship === 'external' || destination.relationship === 'same_origin') {
        if (typeof destination.origin !== 'string' || destination.origin.length > 320) return false;
        try {
          const url = new URL(destination.origin);
          if (!['http:', 'https:'].includes(url.protocol) || url.origin !== destination.origin || url.username || url.password) return false;
        } catch { return false; }
      } else return false;
      const identity = `${destination.relationship}:${destination.origin}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
    }
  }
  return classified + value.unassociatedInputs <= MAX_CREDENTIAL_INPUTS && (!value.complete || value.unassociatedInputs === 0);
}

export function externalPasswordFormObservation(value: unknown): boolean | null {
  if (!validCredentialFormAttribution(value)) return null;
  if (value.forms.some(form => form.categories.password > 0 && form.destinations.some(destination => destination.relationship === 'external'))) return true;
  return value.complete ? false : null;
}

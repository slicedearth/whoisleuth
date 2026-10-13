import { registryDateIso } from '../../../../packages/evidence/registry-dates.mts';
import { MAX_LOOKUP_DISPLAY_ARRAY_ITEMS, MAX_LOOKUP_DISPLAY_VALUE_LENGTH } from './lookup-display-shared.ts';
import type { RegistrationTraceState } from './lookup-registry-display.ts';

export const REGISTRY_DATE_FIELDS = [
  { key: 'createdDate', label: 'Created' },
  { key: 'expiryDate', label: 'Expires' },
  { key: 'updatedDate', label: 'Last updated' },
] as const;
export type RegistryDateField = typeof REGISTRY_DATE_FIELDS[number]['key'];
export type RegistryDateState = RegistrationTraceState | 'not_collected';
type ExactValue = Readonly<{ value: string | null; state: 'present' | 'missing' | 'invalid' | 'oversized' }>;

function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function exactValue(value: unknown): ExactValue {
  if (value === undefined || value === null || value === '') return { value: null, state: 'missing' };
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return { value: null, state: 'invalid' };
  if (value.length > MAX_LOOKUP_DISPLAY_VALUE_LENGTH) return { value: null, state: 'oversized' };
  return { value, state: 'present' };
}

function pair(value: unknown, field: RegistryDateField, path: string) {
  const source = exactValue(own(value, field));
  const companion = exactValue(own(value, `${field}Iso`));
  const calculated = source.value === null ? null : registryDateIso(source.value);
  const check = source.state !== 'present' ? 'Source text is unavailable for a conversion check.'
    : calculated === null ? 'The current date parser does not accept this source text.'
      : companion.state !== 'present' ? 'No usable ISO companion was supplied; the calculation below is a current check only.'
        : calculated === companion.value ? 'The current parser reproduces the supplied ISO companion.'
          : 'The supplied ISO companion differs from the current parser result.';
  return { path, source, companion, calculated, check };
}

/** Explain only retained date pairs; never recover source locations or fill absent companions. */
export function explainRegistryDate(parsed: unknown, field: RegistryDateField, kind: 'rdap' | 'whois', state: RegistryDateState) {
  if (!REGISTRY_DATE_FIELDS.some(item => item.key === field)) throw new TypeError('Choose a supported lifecycle date.');
  const lifecycle = own(parsed, 'lifecycle');
  const hasPair = (value: unknown) => own(value, field) !== undefined || own(value, `${field}Iso`) !== undefined;
  const variants = [] as ReturnType<typeof pair>[];
  if (hasPair(lifecycle) || kind === 'rdap') variants.push(pair(lifecycle, field, `parsed.lifecycle.${field}`));
  let aliasesDiffer = false;
  if (kind === 'whois' && hasPair(parsed)) {
    aliasesDiffer = variants.length > 0 && (own(lifecycle, field) !== own(parsed, field)
      || own(lifecycle, `${field}Iso`) !== own(parsed, `${field}Iso`));
    if (!variants.length || aliasesDiffer) variants.push(pair(parsed, field, `parsed.${field}`));
  }
  if (!variants.length) variants.push(pair(lifecycle, field, `parsed.lifecycle.${field}`));
  const limitations: string[] = [];
  if (state !== 'complete') limitations.push(`Publication state: ${state.replaceAll('_', ' ')}. Displayed values do not make this source complete.`);
  if (own(parsed, 'serverTruncated') === true) limitations.push('The server reported omitted data.');
  if (own(parsed, 'eventsTruncated') === true) limitations.push('The RDAP event inventory contains omitted or rejected fields.');
  const truncated = own(parsed, 'fieldsTruncated');
  if (Array.isArray(truncated)) {
    if (truncated.length > MAX_LOOKUP_DISPLAY_ARRAY_ITEMS) limitations.push('The field-truncation inventory is outside its supported display bound.');
    else if (truncated.includes(field)) limitations.push('This date is a retained prefix; its complete source text is unavailable here.');
  }
  const rule = kind === 'whois'
    ? 'The WHOIS parser selects and bounds field text and normalises whitespace before adding the ISO companion.'
    : field === 'createdDate'
      ? 'The RDAP parser selects the earliest valid registration event before adding the ISO companion.'
      : `The RDAP parser selects the latest valid ${field === 'expiryDate' ? 'expiration' : 'last changed'} event before adding the ISO companion.`;
  return {
    state, variants, aliasesDiffer, limitations, rule,
    provenance: kind === 'whois'
      ? 'The parsed record does not identify the selected WHOIS hop or line for this field.'
      : 'The lifecycle summary does not identify a unique original RDAP event or event index.',
  };
}

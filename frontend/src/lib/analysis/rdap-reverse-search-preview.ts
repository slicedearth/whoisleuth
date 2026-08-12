export const RDAP_REVERSE_SEARCH_PREVIEW_VERSION = 1;
export const MAX_RDAP_REVERSE_SEARCH_PREVIEWS = 8;

export type RdapReverseSearchProperty = 'email' | 'fn' | 'handle' | 'role';

export type RdapReverseSearchPreview = Readonly<{
  id: string;
  property: RdapReverseSearchProperty;
  value: string;
  sourceRole: string;
  queryShape: string;
  disclosure: string;
}>;

type JsonRecord = Record<string, unknown>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const ALLOWED_PROPERTIES = new Set<RdapReverseSearchProperty>([
  'email',
  'fn',
  'handle',
  'role',
]);
const RDAP_ENTITY_ROLE_ORDER = [
  'registrar', 'registrant', 'administrative', 'technical', 'billing', 'abuse',
  'noc', 'reseller', 'sponsor', 'proxy', 'notifications',
] as const;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function records(value: unknown, maximum = 32): JsonRecord[] {
  return Array.isArray(value)
    ? value.slice(0, maximum).map(record).filter((item) => Object.keys(item).length > 0)
    : [];
}

function boundedText(value: unknown, maximum = 200): string {
  return typeof value === 'string'
    ? value
      .replace(CONTROL_CHARACTERS, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, maximum)
    : '';
}

function textList(value: unknown, maximum = 8): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, maximum * 2)) {
    const normalized = boundedText(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maximum) break;
  }
  return output;
}

function advertisedReverseProperties(capability: unknown): Set<RdapReverseSearchProperty> {
  const reverseSearch = record(record(capability).reverseSearch);
  if (reverseSearch.state !== 'advertised') return new Set();
  const declared = Array.isArray(reverseSearch.properties)
    ? reverseSearch.properties
    : [...ALLOWED_PROPERTIES];
  return new Set(
    declared
      .slice(0, ALLOWED_PROPERTIES.size * 2)
      .map((value) => boundedText(value, 32).toLowerCase())
      .filter((value): value is RdapReverseSearchProperty => ALLOWED_PROPERTIES.has(value as RdapReverseSearchProperty)),
  );
}

function identifier(value: string): string {
  let state = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 16_777_619);
  }
  return (state >>> 0).toString(36);
}

export function buildRdapReverseSearchPreviews(
  parsedValue: unknown,
  capabilityValue: unknown,
): RdapReverseSearchPreview[] {
  const properties = advertisedReverseProperties(capabilityValue);
  if (properties.size === 0) return [];

  const parsed = record(parsedValue);
  const entitiesByRole = record(parsed.entitiesByRole);
  const output: RdapReverseSearchPreview[] = [];
  const seen = new Set<string>();
  const add = (
    property: RdapReverseSearchProperty,
    value: unknown,
    sourceRole: string,
  ): void => {
    if (!properties.has(property) || output.length >= MAX_RDAP_REVERSE_SEARCH_PREVIEWS) return;
    const normalized = boundedText(value);
    if (!normalized) return;
    const key = `${property}\u0000${normalized.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const queryShape = `/domains/reverse_search/entity?${property}=${encodeURIComponent(normalized)}`;
    output.push({
      id: `${property}-${identifier(key)}`,
      property,
      value: normalized,
      sourceRole,
      queryShape,
      disclosure: `A confirmed request would disclose the exact ${property} value “${normalized}” to the selected RDAP operator.`,
    });
  };

  for (const rawRole of RDAP_ENTITY_ROLE_ORDER) {
    const rawEntities = entitiesByRole[rawRole];
    const role = boundedText(rawRole, 80);
    if (!Array.isArray(rawEntities) || rawEntities.length === 0) continue;
    if (properties.has('role')) add('role', role, role);
    for (const entity of records(rawEntities, 5)) {
      add('handle', entity.handle, role);
      add('fn', entity.name, role);
      for (const name of textList(entity.names, 4)) add('fn', name, role);
      add('email', entity.email, role);
      for (const email of textList(entity.emails, 4)) add('email', email, role);
      if (output.length >= MAX_RDAP_REVERSE_SEARCH_PREVIEWS) return output;
    }
  }
  return output;
}

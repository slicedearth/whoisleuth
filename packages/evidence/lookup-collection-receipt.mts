// A bounded account of one completed Lookup operation. This records collector
// execution, not proof of network delivery, independent verification or history.
export const LOOKUP_SOURCE_IDS = Object.freeze([
  'rdap', 'whois', 'domain_evidence', 'reverse_dns', 'registrar_rdap',
  'network_context', 'security_txt', 'external_intelligence',
  'malware_host_intelligence', 'malware_ioc_intelligence',
] as const);
export const LOOKUP_SOURCE_STATES = Object.freeze([
  'success', 'partial', 'not_found', 'skipped', 'error', 'unsupported',
  'not_applicable', 'unavailable', 'rate_limited', 'complete', 'disabled', 'stale',
] as const);
export type LookupSourceId = typeof LOOKUP_SOURCE_IDS[number];
export type LookupSourceState = typeof LOOKUP_SOURCE_STATES[number];
export const LOOKUP_COLLECTION_RECEIPT_VERSION = 1;
export const LOOKUP_CHOICE_KEYS = Object.freeze([
  'securityTxt', 'externalIntelligence', 'malwareHostIntelligence', 'malwareIocIntelligence',
] as const);
export const LOOKUP_CHOICE_SOURCES = Object.freeze({
  securityTxt: 'security_txt', externalIntelligence: 'external_intelligence',
  malwareHostIntelligence: 'malware_host_intelligence', malwareIocIntelligence: 'malware_ioc_intelligence',
} as const satisfies Record<typeof LOOKUP_CHOICE_KEYS[number], LookupSourceId>);
export type LookupCollectionChoices = Readonly<Record<typeof LOOKUP_CHOICE_KEYS[number], boolean>>;
export type LookupCollectionIntent = Readonly<{
  requestedDepth: 'fast' | 'deep';
  targetClass: 'domain' | 'ipv4' | 'ipv6' | 'asn';
  webSelection: 'hostname' | 'selected_url' | 'not_applicable';
  originalChoices: LookupCollectionChoices;
}>;
const ADMISSIONS = ['admitted', 'disabled', 'unsupported', 'not_applicable', 'prerequisite_unavailable', 'unknown'] as const;
export type LookupCollectionSource = Readonly<{
  source: LookupSourceId;
  intent: 'requested' | 'not_requested';
  admission: typeof ADMISSIONS[number];
  attempt: 'started' | 'not_started' | 'unknown';
  settlement: LookupSourceState | 'unknown';
  complete: boolean | null;
  truncated: boolean | null;
}>;
export type LookupCollectionReceipt = LookupCollectionIntent & Readonly<{
  version: typeof LOOKUP_COLLECTION_RECEIPT_VERSION;
  sources: readonly LookupCollectionSource[];
}>;

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Collection receipt must contain ordinary objects.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Collection receipt must contain ordinary objects.');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError('Collection receipt contains an unsupported field set.');
  }
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError('Collection receipt contains an invalid field.');
    output[key] = descriptor.value;
  }
  return output;
}
function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new TypeError('Collection receipt contains an invalid state.');
  return value as T;
}
function quality(value: unknown): boolean | null {
  if (value !== null && typeof value !== 'boolean') throw new TypeError('Collection receipt quality must be explicit or unknown.');
  return value;
}
export function lookupCollectionChoices(input: Readonly<Partial<LookupCollectionChoices>>): LookupCollectionChoices {
  return Object.freeze({
    securityTxt: input.securityTxt === true,
    externalIntelligence: input.externalIntelligence === true,
    malwareHostIntelligence: input.malwareHostIntelligence === true,
    malwareIocIntelligence: input.malwareIocIntelligence === true,
  });
}

/** Absence is historical unknown, never reconstructed as a negative choice. */
export function parseLookupCollectionReceipt(raw: unknown): LookupCollectionReceipt | null {
  if (raw === undefined) return null;
  const value = fields(raw, ['version', 'requestedDepth', 'targetClass', 'webSelection', 'originalChoices', 'sources']);
  if (value.version !== LOOKUP_COLLECTION_RECEIPT_VERSION) throw new TypeError('Collection receipt version is unsupported.');
  const choices = fields(value.originalChoices, LOOKUP_CHOICE_KEYS);
  if (Object.values(choices).some(choice => typeof choice !== 'boolean')) throw new TypeError('Collection receipt choices must be explicit.');
  const requestedDepth = oneOf(value.requestedDepth, ['fast', 'deep']);
  const targetClass = oneOf(value.targetClass, ['domain', 'ipv4', 'ipv6', 'asn']);
  const webSelection = oneOf(value.webSelection, ['hostname', 'selected_url', 'not_applicable']);
  if ((targetClass !== 'domain' && webSelection !== 'not_applicable') || (webSelection === 'selected_url' && requestedDepth !== 'deep')) {
    throw new TypeError('Collection receipt target and web selection disagree.');
  }
  if (!Array.isArray(value.sources) || Object.getPrototypeOf(value.sources) !== Array.prototype
    || value.sources.length !== LOOKUP_SOURCE_IDS.length
    || Reflect.ownKeys(value.sources).length !== LOOKUP_SOURCE_IDS.length + 1) throw new TypeError('Collection receipt source inventory is invalid.');
  const bySource = new Map<LookupSourceId, LookupCollectionSource>();
  for (let index = 0; index < LOOKUP_SOURCE_IDS.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value.sources, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError('Collection receipt source entry is invalid.');
    const row = fields(descriptor.value, ['source', 'intent', 'admission', 'attempt', 'settlement', 'complete', 'truncated']);
    const source = oneOf(row.source, LOOKUP_SOURCE_IDS);
    if (bySource.has(source)) throw new TypeError('Collection receipt source is duplicated.');
    const attempt = oneOf(row.attempt, ['started', 'not_started', 'unknown']);
    const admission = oneOf(row.admission, ADMISSIONS);
    const complete = quality(row.complete), truncated = quality(row.truncated);
    const intent = oneOf(row.intent, ['requested', 'not_requested']);
    const settlement = oneOf(row.settlement, [...LOOKUP_SOURCE_STATES, 'unknown']);
    if (attempt === 'started' && admission !== 'admitted'
      || attempt === 'started' && intent !== 'requested'
      || attempt !== 'started' && (complete !== null || truncated !== null)
      || attempt === 'not_started' && settlement !== 'unknown'
      || complete === true && !['success', 'complete', 'not_found'].includes(settlement)
      || complete === true && truncated === true) throw new TypeError('Collection receipt execution and quality disagree.');
    bySource.set(source, Object.freeze({
      source, intent, admission, attempt, settlement, complete, truncated,
    }));
  }
  for (const choice of LOOKUP_CHOICE_KEYS) {
    if ((bySource.get(LOOKUP_CHOICE_SOURCES[choice])!.intent === 'requested') !== choices[choice]) {
      throw new TypeError('Collection receipt choice and source intent disagree.');
    }
  }
  return Object.freeze({ version: LOOKUP_COLLECTION_RECEIPT_VERSION, requestedDepth, targetClass, webSelection,
    originalChoices: lookupCollectionChoices(choices as LookupCollectionChoices),
    sources: Object.freeze(LOOKUP_SOURCE_IDS.map(source => bySource.get(source)!)),
  });
}

/** Bind a validated execution account to this submission's pre-filter choices.
 * A browser may omit an ineligible optional request; the server cannot know
 * which unchecked/disabled control led to that omission. Do not invent why. */
export function bindLookupCollectionChoices(raw: unknown, originalChoices: LookupCollectionChoices) {
  const receipt = parseLookupCollectionReceipt(raw);
  if (!receipt) return null;
  const choices = fields(originalChoices, LOOKUP_CHOICE_KEYS);
  if (Object.values(choices).some(choice => typeof choice !== 'boolean')) throw new TypeError('Collection receipt choices must be explicit.');
  const sources = receipt.sources.map(row => {
    const choice = LOOKUP_CHOICE_KEYS.find(key => LOOKUP_CHOICE_SOURCES[key] === row.source);
    if (!choice || choices[choice] === receipt.originalChoices[choice]) return { ...row };
    if (receipt.originalChoices[choice] || choices[choice] !== true || row.attempt !== 'not_started') {
      throw new TypeError('Collection receipt does not match the submitted choices.');
    }
    return { ...row, intent: 'requested' as const, admission: 'unknown' as const };
  });
  const bound = { ...receipt, originalChoices: lookupCollectionChoices(choices as LookupCollectionChoices), sources };
  parseLookupCollectionReceipt(bound);
  return bound;
}

/** Stable, payload-free material comparison. Parsing also removes key order as a difference. */
export function lookupCollectionReceiptIdentity(raw: unknown): string | null {
  const receipt = parseLookupCollectionReceipt(raw);
  return receipt ? JSON.stringify(receipt) : null;
}

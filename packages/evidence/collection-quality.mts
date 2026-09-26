/** Collection outcomes only: no target, payload, request or analyst decision. */
export type WebCollectionState = 'complete' | 'partial' | 'unavailable' | 'not_collected' | 'unknown';
// Combined-input fields (including scores) must retain a single collection
// cohort, even when a Watchlist baseline preserves page and favicon facts
// independently from different checks.
export type WebCollectionQuality = Readonly<{ version: 1; page: WebCollectionState; favicon: WebCollectionState; combined: WebCollectionState }>;
const STATES: ReadonlySet<string> = new Set(['complete', 'partial', 'unavailable', 'not_collected', 'unknown']);

export function isWebCollectionQuality(value: unknown): value is WebCollectionQuality {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 4 || keys.some(key => !['version', 'page', 'favicon', 'combined'].includes(key)
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(record, key) ?? {}, 'value'))) return false;
  return record.version === 1
    && typeof record.page === 'string' && STATES.has(record.page)
    && typeof record.favicon === 'string' && STATES.has(record.favicon)
    && typeof record.combined === 'string' && STATES.has(record.combined)
    && (record.combined !== 'complete' || (record.page === 'complete' && record.favicon === 'complete'));
}

export function normalizeWebCollectionQuality(value: unknown, depth?: string): WebCollectionQuality | undefined {
  if (value === undefined) return undefined;
  if (!isWebCollectionQuality(value)) throw new TypeError('Unsupported or invalid web collection quality.');
  if (depth === 'fast') return capturedWebCollectionQuality('not_collected', 'not_collected');
  return { version: 1, page: value.page, favicon: value.favicon, combined: value.combined };
}

export function capturedWebCollectionQuality(page: WebCollectionState, favicon: WebCollectionState): WebCollectionQuality {
  const combined = page === 'complete' && favicon === 'complete' ? 'complete'
    : page === favicon ? page : 'partial';
  return { version: 1, page, favicon, combined };
}

export function webCollectionQualityForCapture(value: unknown, depth: string): WebCollectionQuality {
  if (depth !== 'deep') return capturedWebCollectionQuality('not_collected', 'not_collected');
  return normalizeWebCollectionQuality(value) ?? capturedWebCollectionQuality('unknown', 'unknown');
}

const PAGE_FIELDS = new Set(['activityStatus', 'pageTitle', 'hasPasswordField', 'hasExternalFormAction', 'phishingLanguageMatch', 'pageBaselineMatch']);
const FAVICON_FIELDS = new Set(['faviconHash', 'faviconPHash', 'faviconMatch', 'faviconNearMatch']);
const COMBINED_FIELDS = new Set(['riskScore', 'riskFactors', 'riskModelVersion', 'opportunityScore', 'opportunityFactors', 'reusesOfficialAssets']);

/** Missing historical quality never proves that a false/null value was observed. */
export function webCollectionAllowsComparison(field: string, quality: WebCollectionQuality | undefined, depth: string): boolean {
  if (PAGE_FIELDS.has(field)) return quality?.page === 'complete';
  if (FAVICON_FIELDS.has(field)) return quality?.favicon === 'complete';
  if (COMBINED_FIELDS.has(field) && depth === 'deep') return quality?.combined === 'complete';
  return true;
}

/** An incomplete current attempt cannot erase the last comparable baseline. */
export function mergeWebCollectionQuality(previous: WebCollectionQuality | undefined, current: WebCollectionQuality | undefined): WebCollectionQuality | undefined {
  if (!previous && !current) return undefined;
  return { version: 1,
    page: current?.page === 'complete' ? 'complete' : previous?.page ?? current?.page ?? 'unknown',
    favicon: current?.favicon === 'complete' ? 'complete' : previous?.favicon ?? current?.favicon ?? 'unknown',
    combined: current?.combined === 'complete' ? 'complete' : previous?.combined ?? current?.combined ?? 'unknown',
  };
}

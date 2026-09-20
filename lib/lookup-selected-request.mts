import { MAX_OUTBOUND_HTTP_URL_CHARACTERS } from '../packages/contracts/http-url.mts';
import { prepareSelectedLookupUrl } from '../packages/evidence/lookup-target.mts';
import type { ClassifiedQuery } from './classify.mts';
import { featureDecision, type NetworkFeaturePolicy } from './feature-policy.mts';
import { parseBoundedJsonObject } from './bounded-json.mts';

// JSON escaping can use six bytes per URL character. Check before decoding or parsing.
export const MAX_LOOKUP_SELECTION_BODY_BYTES = MAX_OUTBOUND_HTTP_URL_CHARACTERS * 6 + 32;
type SelectionRequest = Readonly<{
  method: string;
  contentType?: unknown;
  body?: unknown;
  base64?: boolean;
  classified: ClassifiedQuery;
  fast: boolean;
  compact: boolean;
  featurePolicy: NetworkFeaturePolicy;
}>;
type SelectionResult = { ok: true; selectedUrl?: string } | { ok: false; status: number; error: string };

/** Both server entry points admit the same explicit, body-only URL selection. */
export function parseLookupWebSelection(request: SelectionRequest): SelectionResult {
  if (request.method === 'GET') return { ok: true };
  if (request.method !== 'POST') return { ok: false, status: 405, error: 'Use GET for a hostname or POST for a selected URL.' };
  if (request.classified.type !== 'domain' || request.fast || request.compact) {
    return { ok: false, status: 400, error: 'Selected URL collection requires a full Deep domain lookup.' };
  }
  if (!featureDecision('availability', request.featurePolicy).enabled || !featureDecision('website_probe', request.featurePolicy).enabled) {
    return { ok: false, status: 403, error: 'Selected URL collection is disabled by deployment policy.' };
  }
  if (typeof request.contentType !== 'string' || !/^application\/json(?:\s*;|$)/iu.test(request.contentType)
    || typeof request.body !== 'string') return { ok: false, status: 400, error: 'Provide a JSON body containing only the selected URL.' };
  let body = request.body;
  if (request.base64) {
    if (body.length > Math.ceil(MAX_LOOKUP_SELECTION_BODY_BYTES / 3) * 4) return { ok: false, status: 413, error: 'Selected URL request is too large.' };
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(body)) {
      return { ok: false, status: 400, error: 'Invalid request encoding.' };
    }
    try { body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(body, 'base64')); }
    catch { return { ok: false, status: 400, error: 'Invalid request encoding.' }; }
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_LOOKUP_SELECTION_BODY_BYTES) return { ok: false, status: 413, error: 'Selected URL request is too large.' };
  try {
    const parsed = parseBoundedJsonObject(body, { maximumBytes: MAX_LOOKUP_SELECTION_BODY_BYTES,
      limits: { maximumDepth: 1, maximumKeys: 1, maximumValues: 2, maximumContainerItems: 1, maximumStringCodeUnits: MAX_OUTBOUND_HTTP_URL_CHARACTERS } });
    if (Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'url')) throw new TypeError();
    return { ok: true, selectedUrl: prepareSelectedLookupUrl(Reflect.get(parsed, 'url'), request.classified.inputHostname) };
  } catch { return { ok: false, status: 400, error: 'Selected URL must match the submitted hostname and use HTTP(S) without credentials or a custom port.' }; }
}

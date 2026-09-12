import { classifyQuery } from './classify.mts';
import { runUnifiedLookup, LOOKUP_ERROR_CODES, type LookupOptions } from './lookup.mts';
import { createLookupHttpResponse } from './lookup-response-contract.mts';
import { parseLookupWebSelection } from './lookup-selected-request.mts';
import { plannedLookupProgressSources } from './lookup-source-progress.mts';
import { LOOKUP_PROGRESS_CONTENT_TYPE } from './lookup-progress-http.mts';
import type { NetworkFeaturePolicy } from './feature-policy.mts';

export type LookupHttpDependencies = Readonly<{
  runUnifiedLookup: typeof runUnifiedLookup;
  createLookupHttpResponse: typeof createLookupHttpResponse;
}>;

/** Shared request decisions; authentication, body admission and leases remain transport-owned. */
export function prepareLookupHttpOperation(request: Readonly<{
  params: Readonly<Record<string, unknown>>;
  method: string;
  contentType?: unknown;
  accept?: unknown;
  body?: unknown;
  featurePolicy: NetworkFeaturePolicy;
}>) {
  const q = typeof request.params.q === 'string' ? request.params.q.trim() : '';
  if (!q) return { ok: false as const, status: 400, body: { error: 'Missing query parameter "q"', errorCode: LOOKUP_ERROR_CODES.MISSING_QUERY } };
  let classified;
  try { classified = classifyQuery(q); }
  catch { return { ok: false as const, status: 400, body: { error: 'Invalid query', errorCode: LOOKUP_ERROR_CODES.INVALID_QUERY } }; }
  const enabled = (key: string) => request.params[key] === '1' || request.params[key] === 'true';
  const options = {
    fast: enabled('fast'), compact: enabled('compact'), externalIntelligence: enabled('intelligence'),
    malwareHostIntelligence: enabled('malware'), malwareIocIntelligence: enabled('ioc'), securityTxt: enabled('security_txt'),
    featurePolicy: request.featurePolicy,
  };
  const selection = parseLookupWebSelection({ ...request, classified, fast: options.fast, compact: options.compact });
  if (!selection.ok) return { ok: false as const, status: selection.status, body: { error: selection.error } };
  const streaming = !options.fast && !options.compact && typeof request.accept === 'string'
    && request.accept.split(',').some(value => {
      const [type, ...parameters] = value.trim().toLowerCase().split(';');
      return type === LOOKUP_PROGRESS_CONTENT_TYPE && !parameters.some(parameter => /^\s*q\s*=\s*0(?:\.0*)?\s*$/u.test(parameter));
    });
  return {
    ok: true as const, streaming, options,
    sources: plannedLookupProgressSources(classified, options),
    async run(dependencies: LookupHttpDependencies, signal: AbortSignal, onSourceSettled?: LookupOptions['onSourceSettled']) {
      const result = await dependencies.runUnifiedLookup(classified, {
        ...options, signal, waitForStartedCollectors: true,
        ...(onSourceSettled ? { onSourceSettled } : {}),
        ...(selection.selectedUrl ? { selectedUrl: selection.selectedUrl } : {}),
      });
      return dependencies.createLookupHttpResponse(selection.selectedUrl ? classified.inputHostname! : q, classified, result);
    },
  };
}

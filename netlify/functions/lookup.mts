import { runUnifiedLookup, LOOKUP_ERROR_CODES } from '../../lib/lookup.mts';
import { createLookupHttpResponse } from '../../lib/lookup-response-contract.mts';
import { prepareLookupHttpOperation, type LookupHttpDependencies } from '../../lib/lookup-http-operation.mts';
import { createLookupProgressBody, LOOKUP_PROGRESS_CONTENT_TYPE } from '../../lib/lookup-progress-http.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json, netlifyJsonToResponse, readRequestTextCapped, withNetlifyFetchApiErrorBoundary } from '../../lib/http.mts';
import { MAX_LOOKUP_SELECTION_BODY_BYTES } from '../../lib/lookup-selected-request.mts';

type LookupHandlerDependencies = LookupHttpDependencies;
type LookupFunctionContext = Readonly<{ waitUntil: (completion: Promise<unknown>) => void }>;

function createLookupHandler(dependencies: LookupHandlerDependencies = { runUnifiedLookup, createLookupHttpResponse }) {
  return withNetlifyFetchApiErrorBoundary(async (request: Request, context?: LookupFunctionContext): Promise<Response> => {
    const guard = guardNetlifyNetworkRequest({ headers: Object.fromEntries(request.headers) }, 'lookup');
    if (guard.response) return netlifyJsonToResponse(guard.response);
    let body: string | undefined;
    if (request.method === 'POST') {
      const encoding = request.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') return netlifyJsonToResponse(json(415, { error: 'Selected URL requests must use uncompressed JSON.' }));
      const read = await readRequestTextCapped(request, MAX_LOOKUP_SELECTION_BODY_BYTES);
      if (read.status !== 'ok') return netlifyJsonToResponse(json(read.status === 'too_large' ? 413 : read.status === 'invalid_encoding' ? 400 : 408, {
        error: read.status === 'too_large' ? 'Selected URL request is too large.' : read.status === 'invalid_encoding' ? 'Invalid request encoding.' : 'Request body read timed out.',
      }));
      body = read.body;
    }
    const operation = prepareLookupHttpOperation({
      params: Object.fromEntries(new URL(request.url).searchParams), method: request.method,
      contentType: request.headers.get('content-type'), accept: request.headers.get('accept'),
      ...(body === undefined ? {} : { body }), featurePolicy: guard.featurePolicy,
    });
    if (!operation.ok) return netlifyJsonToResponse(json(operation.status, operation.body, operation.status === 405 ? { Allow: 'GET, POST' } : {}));
    const target = operationBudgetTargetFor('lookup', operation.options);
    // Without a lifecycle extension, use ordinary JSON rather than abandoning a lease after headers.
    if (!operation.streaming || !context?.waitUntil) {
      return netlifyJsonToResponse(await withNetlifyOperationBudget(guard.sessionKey, target,
        async () => json(200, await operation.run(dependencies, request.signal))));
    }
    return new Promise<Response>((resolve, reject) => {
      let responded = false;
      const completion = withNetlifyOperationBudget(guard.sessionKey, target, async () => {
        const stream = createLookupProgressBody({ sources: operation.sources, signal: request.signal,
          run: (settled, signal) => operation.run(dependencies, signal, settled) });
        responded = true;
        resolve(new Response(stream.body, { headers: { ...json(200, null).headers,
          'Content-Type': `${LOOKUP_PROGRESS_CONTENT_TYPE}; charset=utf-8` } }));
        await stream.completion;
        return json(204, null);
      });
      context.waitUntil(completion.catch(() => {}));
      void completion.then(response => { if (!responded) resolve(netlifyJsonToResponse(response)); }, reject);
    });
  }, LOOKUP_ERROR_CODES.LOOKUP_FAILED);
}

export default createLookupHandler();
export { createLookupHandler };
export type { LookupHandlerDependencies, LookupFunctionContext };

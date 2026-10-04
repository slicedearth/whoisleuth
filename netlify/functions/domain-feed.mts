import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json, netlifyJsonToResponse, readRequestTextCapped, withNetlifyFetchApiErrorBoundary } from '../../lib/http.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { DOMAIN_FEED_BODY_BYTES } from '../../lib/server/domain-feed-config.mts';
import { parseDomainFeedOperation, executeDomainFeedOperation } from '../../lib/server/domain-feed-client.mts';

export const config = { path: '/api/domain-feed', rateLimit: { windowLimit: 60, windowSize: 600, aggregateBy: ['ip', 'domain'] } };

function createDomainFeedHandler(execute = executeDomainFeedOperation) {
  return withNetlifyFetchApiErrorBoundary(async (request: Request): Promise<Response> => {
    const guard = guardNetlifyNetworkRequest({ httpMethod: request.method, headers: Object.fromEntries(request.headers) }, undefined, ['POST']);
    if (guard.response) return netlifyJsonToResponse(guard.response);
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json'
      || (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity')) return netlifyJsonToResponse(json(415, { error: 'Use uncompressed JSON.' }));
    const read = await readRequestTextCapped(request, DOMAIN_FEED_BODY_BYTES, 5000);
    if (read.status !== 'ok') return netlifyJsonToResponse(json(read.status === 'too_large' ? 413 : read.status === 'invalid_encoding' ? 400 : 408, { error: 'Feed request body could not be read.' }));
    let operation;
    try { operation = parseDomainFeedOperation(JSON.parse(read.body)); }
    catch { return netlifyJsonToResponse(json(400, { error: 'Invalid domain feed request.' })); }
    return netlifyJsonToResponse(await withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('domain_feed_search'), async () => {
      const reply = await execute(operation, { signal: request.signal });
      return json(reply.status, reply.body);
    }));
  });
}

export default createDomainFeedHandler();
export { createDomainFeedHandler };

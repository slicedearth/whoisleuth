import { collectResolverComparison } from '../../lib/resolver-comparison.mts';
import { normaliseResolverComparisonRequest } from '../../packages/evidence/resolver-comparison.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

export function createResolverComparisonHandler(dependencies = { collectResolverComparison }): NetlifyFunctionHandler {
  return withNetlifyApiErrorBoundary(async event => {
    const guard = guardNetlifyNetworkRequest(event, 'resolver_comparison', ['GET']);
    if (guard.response) return guard.response;
    let request;
    try { request = normaliseResolverComparisonRequest(event.queryStringParameters?.q, event.queryStringParameters?.resolvers); }
    catch { return json(400, { error: 'Select one hostname and two supported resolvers.' }); }
    return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('resolver_comparison'), async () =>
      json(200, await dependencies.collectResolverComparison(request.hostname, request.resolvers)));
  });
}
export const handler = createResolverComparisonHandler();

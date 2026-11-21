import { collectWebArchiveHistory } from '../../lib/web-archive-history.mts';
import { normaliseWebArchiveRequest } from '../../packages/evidence/web-archive-history.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

export function createWebArchiveHistoryHandler(dependencies = { collectWebArchiveHistory }): NetlifyFunctionHandler {
  return withNetlifyApiErrorBoundary(async event => {
    const guard = guardNetlifyNetworkRequest(event, 'web_archive_history', ['GET']);
    if (guard.response) return guard.response;
    let request;
    try { request = normaliseWebArchiveRequest(event.queryStringParameters?.q); }
    catch { return json(400, { error: 'Select one domain name.' }); }
    return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('web_archive_history'), async () =>
      json(200, await dependencies.collectWebArchiveHistory(request.domain)));
  });
}
export const handler = createWebArchiveHistoryHandler();

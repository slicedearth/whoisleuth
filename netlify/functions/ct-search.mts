import { searchCertificateTransparency } from '../../lib/ct-search.mts';
import { isCtQueryError, normalizeCtQuery } from '../../lib/ct-query.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handleCtSearch: NetlifyFunctionHandler = async (event) => {
  const guard = guardNetlifyNetworkRequest(event, 'certificate_transparency');
  if (guard.response) return guard.response;

  let q: string;
  try {
    q = normalizeCtQuery(event.queryStringParameters?.q);
  } catch (error) {
    if (isCtQueryError(error)) return json(400, { error: error.message, errorCode: error.code });
    throw error;
  }
  if (!q) return json(400, { error: 'Missing query parameter "q"', errorCode: 'MISSING_QUERY' });

  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('certificate_transparency'), async () => {
    const result = await searchCertificateTransparency(q);
    return json(200, { keyword: q, ...result });
  });
};

const handler = withNetlifyApiErrorBoundary(handleCtSearch);

export { handler };

import { searchCertificateTransparency } from '../../lib/ct-search.mts';
import { operationBudgetTargetFor } from '../../lib/operation-budget.mts';
import { guardNetlifyNetworkRequest, withNetlifyOperationBudget } from '../../lib/netlify-network-guard.mts';
import { json } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handler: NetlifyFunctionHandler = async (event) => {
  const guard = guardNetlifyNetworkRequest(event, 'certificate_transparency');
  if (guard.response) return guard.response;

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  return withNetlifyOperationBudget(guard.sessionKey, operationBudgetTargetFor('certificate_transparency'), async () => {
    try {
      const result = await searchCertificateTransparency(q);
      return json(200, { keyword: q, ...result });
    } catch (err) {
      return json(500, { error: err.message });
    }
  });
};

export { handler };
